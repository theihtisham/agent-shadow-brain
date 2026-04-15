// src/adapters/cline.ts — Adapter for Cline (VS Code extension)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class ClineAdapter extends BaseAdapter {
  name: AgentTool = 'cline';
  displayName = 'Cline';

  private getGlobalDir(): string {
    const platform = os.platform();
    if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
    }
    return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  }

  async detect(): Promise<boolean> {
    const dir = this.getGlobalDir();
    if (fs.existsSync(dir)) return true;
    // Also check .clinerules
    return fs.existsSync(path.join(this.projectDir, '.clinerules'));
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.cline', 'memory'),
      rulesDir: this.projectDir, // .clinerules is in project root
      conversationDir: path.join(this.getGlobalDir(), 'tasks'),
      configFile: path.join(this.getGlobalDir(), 'settings.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const tasksDir = path.join(this.getGlobalDir(), 'tasks');

    if (!fs.existsSync(tasksDir)) return activities;

    try {
      const taskDirs = fs.readdirSync(tasksDir)
        .map(d => path.join(tasksDir, d))
        .filter(d => {
          try { return fs.statSync(d).isDirectory(); } catch { return false; }
        })
        .sort((a, b) => {
          try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
        })
        .slice(0, 3);

      for (const taskDir of taskDirs) {
        const historyFile = path.join(taskDir, 'api_conversation_history.json');
        if (fs.existsSync(historyFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            for (const msg of (data || []).slice(-20)) {
              if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === 'tool_use') {
                    activities.push({
                      timestamp: new Date(),
                      type: this.mapTool(block.name),
                      detail: `${block.name}: ${JSON.stringify(block.input || {}).slice(0, 200)}`,
                      file: block.input?.path,
                    });
                  }
                }
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* permission */ }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Cline reads .clinerules file in project root
    const rulesFile = path.join(this.projectDir, '.clinerules');
    const memDir = path.join(this.projectDir, '.cline', 'memory');
    fs.mkdirSync(memDir, { recursive: true });

    // Write brain file to memory
    const brainFile = path.join(memDir, 'shadow-brain.md');
    const existing = this.readFile(brainFile) || '';
    const updated = this.appendToBrainFile(existing, insight);
    fs.writeFileSync(brainFile, updated, 'utf-8');

    // For critical insights, add to .clinerules
    if (insight.priority === 'critical' || insight.priority === 'high') {
      const existingRules = this.readFile(rulesFile) || '';
      if (!existingRules.includes('Shadow Brain')) {
        const brainSection = `\n\n# Shadow Brain Alerts\n\n${insight.content}\n`;
        fs.writeFileSync(rulesFile, existingRules + brainSection, 'utf-8');
      }
    }

    return true;
  }

  private mapTool(name: string): AgentActivity['type'] {
    if (name.includes('write') || name.includes('edit') || name.includes('replace')) return 'file_edit';
    if (name.includes('read') || name.includes('list')) return 'file_read';
    if (name.includes('execute') || name.includes('command')) return 'command';
    return 'search';
  }
}
