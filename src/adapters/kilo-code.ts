// src/adapters/kilo-code.ts — Adapter for Kilo Code (VS Code extension)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class KiloCodeAdapter extends BaseAdapter {
  name: AgentTool = 'kilo-code';
  displayName = 'Kilo Code';

  private getGlobalDir(): string {
    // Kilo Code stores data in VS Code's extension data
    const platform = os.platform();
    if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'kilocode.kilo-code');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'kilocode.kilo-code');
    }
    return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'kilocode.kilo-code');
  }

  async detect(): Promise<boolean> {
    // Check for Kilo Code extension data
    const dir = this.getGlobalDir();
    if (fs.existsSync(dir)) return true;

    // Check for .kilocode in project
    return fs.existsSync(path.join(this.projectDir, '.kilocode'));
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.kilocode', 'memory'),
      rulesDir: path.join(this.projectDir, '.kilocode', 'rules'),
      conversationDir: path.join(this.getGlobalDir(), 'tasks'),
      configFile: path.join(this.projectDir, '.kilocode', 'settings.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const tasksDir = path.join(this.getGlobalDir(), 'tasks');

    if (!fs.existsSync(tasksDir)) return activities;

    try {
      // Kilo Code stores tasks as directories with JSON files
      const taskDirs = fs.readdirSync(tasksDir)
        .map(d => path.join(tasksDir, d))
        .filter(d => fs.statSync(d).isDirectory())
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        .slice(0, 5);

      for (const taskDir of taskDirs) {
        const apiFile = path.join(taskDir, 'api_conversation_history.json');
        if (fs.existsSync(apiFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(apiFile, 'utf-8'));
            if (Array.isArray(data)) {
              for (const msg of data.slice(-20)) {
                if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block.type === 'tool_use') {
                      activities.push({
                        timestamp: new Date(),
                        type: block.name?.includes('write') ? 'file_edit' : 'file_read',
                        detail: `${block.name}: ${JSON.stringify(block.input || {}).slice(0, 200)}`,
                        file: block.input?.path,
                      });
                    }
                  }
                }
              }
            }
          } catch { /* malformed */ }
        }
      }
    } catch { /* permission issues */ }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Inject into .kilocode/rules/ as custom instructions
    const rulesDir = path.join(this.projectDir, '.kilocode', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    const brainFile = path.join(rulesDir, 'shadow-brain.md');
    const existing = this.readFile(brainFile) || '';
    const updated = this.appendToBrainFile(existing, insight);
    fs.writeFileSync(brainFile, updated, 'utf-8');

    // Also write to the memory dir
    const memoryDir = path.join(this.projectDir, '.kilocode', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    return await super.injectContext(insight);
  }
}
