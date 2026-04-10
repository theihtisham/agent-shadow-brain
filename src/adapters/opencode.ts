// src/adapters/opencode.ts — Adapter for OpenCode CLI

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class OpenCodeAdapter extends BaseAdapter {
  name: AgentTool = 'opencode';
  displayName = 'OpenCode';

  private getGlobalDir(): string {
    return path.join(os.homedir(), '.opencode');
  }

  async detect(): Promise<boolean> {
    // Check for opencode config
    if (fs.existsSync(this.getGlobalDir())) return true;
    if (fs.existsSync(path.join(this.projectDir, '.opencode'))) return true;
    if (fs.existsSync(path.join(this.projectDir, 'opencode.json'))) return true;

    // Check for running process
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq opencode*" /NH 2>NUL || pgrep -f opencode 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 3000,
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.opencode', 'memory'),
      rulesDir: path.join(this.projectDir, '.opencode', 'rules'),
      conversationDir: path.join(this.getGlobalDir(), 'sessions'),
      configFile: path.join(this.projectDir, 'opencode.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];
    const sessionsDir = path.join(this.getGlobalDir(), 'sessions');

    if (!fs.existsSync(sessionsDir)) return activities;

    try {
      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => {
          try {
            return fs.statSync(path.join(sessionsDir, b)).mtimeMs - fs.statSync(path.join(sessionsDir, a)).mtimeMs;
          } catch { return 0; }
        })
        .slice(0, 3);

      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
          if (data.messages) {
            for (const msg of data.messages.slice(-20)) {
              if (msg.tool_calls) {
                for (const call of msg.tool_calls) {
                  activities.push({
                    timestamp: new Date(msg.timestamp || Date.now()),
                    type: call.function?.name?.includes('write') ? 'file_edit' : 'file_read',
                    detail: `${call.function?.name}: ${JSON.stringify(call.function?.arguments || {}).slice(0, 200)}`,
                  });
                }
              }
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* permission */ }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // OpenCode: inject into project .opencode/rules/
    const rulesDir = path.join(this.projectDir, '.opencode', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    const brainFile = path.join(rulesDir, 'shadow-brain.md');
    const existing = this.readFile(brainFile) || '';
    const updated = this.appendToBrainFile(existing, insight);
    fs.writeFileSync(brainFile, updated, 'utf-8');

    // Also create AGENTS.md or .opencode.md for native pickup
    const agentsMd = path.join(this.projectDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMd)) {
      fs.writeFileSync(agentsMd, `# Agent Instructions\n\nSee .opencode/rules/shadow-brain.md for AI brain insights.\n`, 'utf-8');
    }

    return true;
  }
}
