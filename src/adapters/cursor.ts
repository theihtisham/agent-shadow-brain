// src/adapters/cursor.ts — Adapter for Cursor (anysphere)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class CursorAdapter extends BaseAdapter {
  name: AgentTool = 'cursor';
  displayName = 'Cursor';

  private getGlobalDir(): string {
    return path.join(os.homedir(), '.cursor');
  }

  private getProjectCursorDir(): string {
    return path.join(this.projectDir, '.cursor');
  }

  async detect(): Promise<boolean> {
    const projectMarkers = [
      path.join(this.projectDir, '.cursorrules'),
      path.join(this.projectDir, '.cursorignore'),
      this.getProjectCursorDir(),
    ];
    if (projectMarkers.some(p => fs.existsSync(p))) return true;
    return fs.existsSync(this.getGlobalDir());
  }

  getConfigPaths(): AgentPaths {
    const projectDir = this.getProjectCursorDir();
    return {
      memoryDir: path.join(projectDir, 'memory'),
      rulesDir: path.join(projectDir, 'rules'),
      conversationDir: path.join(this.getGlobalDir(), 'conversations'),
      configFile: path.join(projectDir, 'mcp.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const conversationsDir = path.join(this.getGlobalDir(), 'conversations');
    if (!fs.existsSync(conversationsDir)) return activities;

    try {
      const files = fs.readdirSync(conversationsDir)
        .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))
        .map(f => ({
          path: path.join(conversationsDir, f),
          mtime: fs.statSync(path.join(conversationsDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 3);

      for (const file of files) {
        try {
          const content = fs.readFileSync(file.path, 'utf-8');
          const lines = content.trim().split('\n').slice(-30);

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.role === 'assistant' || entry.type === 'message') {
                activities.push({
                  timestamp: new Date(entry.timestamp || file.mtime),
                  type: 'conversation',
                  detail: (entry.content || entry.text || '').slice(0, 200),
                  file: entry.file || entry.path,
                });
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Cursor reads project-level .cursor/rules/*.md AND .cursorrules
    const rulesDir = path.join(this.getProjectCursorDir(), 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    const brainFile = path.join(rulesDir, 'shadow-brain-insights.md');
    const existing = this.readFile(brainFile) || '';
    const updated = this.appendToBrainFile(existing, insight);
    fs.writeFileSync(brainFile, updated, 'utf-8');

    if (insight.priority === 'critical') {
      const cursorRulesPath = path.join(this.projectDir, '.cursorrules');
      const existingRules = this.readFile(cursorRulesPath) || '';
      const marker = '# === Shadow Brain Critical Alerts ===';
      if (!existingRules.includes(marker)) {
        const newRules = existingRules + `\n\n${marker}\n${insight.content}\n`;
        fs.writeFileSync(cursorRulesPath, newRules, 'utf-8');
      }
    }

    return true;
  }
}
