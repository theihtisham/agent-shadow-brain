// src/adapters/windsurf.ts — Adapter for Windsurf (Codeium)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class WindsurfAdapter extends BaseAdapter {
  name: AgentTool = 'windsurf';
  displayName = 'Windsurf';

  private getGlobalDir(): string {
    return path.join(os.homedir(), '.windsurf');
  }

  private getWindsurfDir(): string {
    return path.join(this.projectDir, '.windsurf');
  }

  async detect(): Promise<boolean> {
    const projectMarkers = [
      path.join(this.projectDir, '.windsurfrules'),
      this.getWindsurfDir(),
    ];
    if (projectMarkers.some(p => fs.existsSync(p))) return true;
    return fs.existsSync(this.getGlobalDir());
  }

  getConfigPaths(): AgentPaths {
    const projectDir = this.getWindsurfDir();
    return {
      memoryDir: path.join(projectDir, 'memory'),
      rulesDir: projectDir,
      conversationDir: path.join(this.getGlobalDir(), 'conversations'),
      configFile: path.join(this.getGlobalDir(), 'mcp.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const candidates = [
      path.join(this.getGlobalDir(), 'conversations'),
      path.join(this.getGlobalDir(), 'logs'),
    ];

    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.log'))
          .map(f => ({
            path: path.join(dir, f),
            mtime: fs.statSync(path.join(dir, f)).mtimeMs,
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
                if (entry.role === 'assistant' || entry.type === 'response') {
                  activities.push({
                    timestamp: new Date(entry.timestamp || file.mtime),
                    type: 'conversation',
                    detail: (entry.content || entry.text || '').slice(0, 200),
                    file: entry.file,
                  });
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Windsurf reads .windsurfrules (similar to .cursorrules)
    const rulesPath = path.join(this.projectDir, '.windsurfrules');
    const existing = this.readFile(rulesPath) || '';

    const marker = '# === Shadow Brain Insights ===';
    let updated: string;

    if (existing.includes(marker)) {
      // Replace the section
      const before = existing.split(marker)[0];
      updated = before + marker + '\n' + this.formatInsightForWindsurf(insight);
    } else {
      updated = existing + '\n\n' + marker + '\n' + this.formatInsightForWindsurf(insight);
    }

    fs.writeFileSync(rulesPath, updated, 'utf-8');

    // Also write to dedicated brain file in memory dir
    const memoryDir = path.join(this.getWindsurfDir(), 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const brainFile = path.join(memoryDir, 'SHADOW_BRAIN.md');
    const existingBrain = this.readFile(brainFile) || '';
    fs.writeFileSync(brainFile, this.appendToBrainFile(existingBrain, insight), 'utf-8');

    return true;
  }

  private formatInsightForWindsurf(insight: BrainInsight): string {
    return `## ${insight.title}\n_${insight.priority}_ — ${insight.content}\n`;
  }
}
