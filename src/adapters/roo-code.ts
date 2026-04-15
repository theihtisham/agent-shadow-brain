// src/adapters/roo-code.ts — Adapter for Roo Code (VS Code extension, fork of Cline)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class RooCodeAdapter extends BaseAdapter {
  name: AgentTool = 'roo-code';
  displayName = 'Roo Code';

  private getGlobalStorageDir(): string {
    const platform = os.platform();
    if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline');
    }
    return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline');
  }

  private getVSCodeExtensionsDir(): string {
    const platform = os.platform();
    if (platform === 'win32') {
      return path.join(os.homedir(), '.vscode', 'extensions');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), '.vscode', 'extensions');
    }
    return path.join(os.homedir(), '.vscode', 'extensions');
  }

  async detect(): Promise<boolean> {
    // Check for .roo/ directory in project
    if (fs.existsSync(path.join(this.projectDir, '.roo'))) return true;

    // Check for .roo/rules/ directory
    if (fs.existsSync(path.join(this.projectDir, '.roo', 'rules'))) return true;

    // Check for VS Code extension installed
    const extDir = this.getVSCodeExtensionsDir();
    if (fs.existsSync(extDir)) {
      try {
        const entries = fs.readdirSync(extDir);
        if (entries.some(e => e.startsWith('rooveterinaryinc.roo-cline-'))) {
          return true;
        }
      } catch {
        // Permission error, skip
      }
    }

    // Check global storage directory
    if (fs.existsSync(this.getGlobalStorageDir())) return true;

    return false;
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.roo'),
      rulesDir: path.join(this.projectDir, '.roo', 'rules'),
      conversationDir: path.join(this.getGlobalStorageDir(), 'tasks'),
      configFile: path.join(this.projectDir, '.roo', 'config.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const tasksDir = path.join(this.getGlobalStorageDir(), 'tasks');

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
        .slice(0, 5);

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
          } catch {
            // Skip malformed task files
          }
        }
      }
    } catch {
      // Permission or other filesystem errors
    }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    const rulesDir = path.join(this.projectDir, '.roo', 'rules');

    try {
      fs.mkdirSync(rulesDir, { recursive: true });

      const rulesFile = path.join(rulesDir, 'shadow-brain.md');

      const priorityLabel: Record<string, string> = {
        critical: 'CRITICAL',
        high: 'HIGH PRIORITY',
        medium: 'SUGGESTION',
        low: 'INFO',
      };

      const ruleContent = `---
description: Shadow Brain insights for Roo Code
globs:
alwaysApply: true
---

# Shadow Brain — ${priorityLabel[insight.priority] ?? insight.priority}

**Type:** ${insight.type}
**Priority:** ${insight.priority}
**Time:** ${insight.timestamp.toISOString()}
${insight.files?.length ? `**Files:** ${insight.files.join(', ')}` : ''}

---

${insight.content}

${insight.files?.length ? `## Affected Files\n${insight.files.map(f => `- \`${f}\``).join('\n')}` : ''}
`;

      // If file exists, append section; otherwise create new file
      if (fs.existsSync(rulesFile)) {
        const existing = fs.readFileSync(rulesFile, 'utf-8');

        // Replace the section for this insight type+priority or append
        const sectionMarker = `## Shadow Brain — ${priorityLabel[insight.priority] ?? insight.priority}`;
        if (existing.includes(sectionMarker)) {
          const before = existing.split(sectionMarker)[0];
          fs.writeFileSync(rulesFile, before + ruleContent, 'utf-8');
        } else {
          fs.writeFileSync(rulesFile, existing + '\n\n---\n\n' + ruleContent, 'utf-8');
        }
      } else {
        fs.writeFileSync(rulesFile, ruleContent, 'utf-8');
      }

      return true;
    } catch {
      return false;
    }
  }

  private mapTool(name: string): AgentActivity['type'] {
    if (name.includes('write') || name.includes('edit') || name.includes('replace') || name.includes('apply_diff')) {
      return 'file_edit';
    }
    if (name.includes('read') || name.includes('list') || name.includes('search')) {
      return 'file_read';
    }
    if (name.includes('execute') || name.includes('command') || name.includes('terminal')) {
      return 'command';
    }
    return 'search';
  }
}
