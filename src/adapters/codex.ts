// src/adapters/codex.ts — Adapter for OpenAI Codex CLI

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class CodexAdapter extends BaseAdapter {
  name: AgentTool = 'codex';
  displayName = 'Codex CLI';

  private getGlobalDir(): string {
    return path.join(os.homedir(), '.codex');
  }

  async detect(): Promise<boolean> {
    if (fs.existsSync(this.getGlobalDir())) return true;
    if (fs.existsSync(path.join(this.projectDir, 'AGENTS.md'))) return true;

    try {
      execSync('codex --version', { timeout: 3000, encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.codex', 'memory'),
      rulesDir: this.projectDir, // Codex reads AGENTS.md from project root
      conversationDir: path.join(this.getGlobalDir(), 'sessions'),
      configFile: path.join(this.getGlobalDir(), 'config.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    // Codex CLI is newer, may not have persistent session logs yet
    return [];
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Codex reads AGENTS.md from project root
    const agentsFile = path.join(this.projectDir, 'AGENTS.md');

    const brainSection = `
## 🧠 Shadow Brain — ${insight.type.toUpperCase()}

**Priority:** ${insight.priority}
**Time:** ${insight.timestamp.toISOString()}

${insight.content}
${insight.files?.length ? `\nRelevant files: ${insight.files.map(f => `\`${f}\``).join(', ')}` : ''}
`;

    const existing = this.readFile(agentsFile) || '# Agent Instructions\n';

    // Replace or append brain section
    if (existing.includes('## 🧠 Shadow Brain')) {
      const before = existing.split('## 🧠 Shadow Brain')[0];
      fs.writeFileSync(agentsFile, before + brainSection, 'utf-8');
    } else {
      fs.writeFileSync(agentsFile, existing + '\n' + brainSection, 'utf-8');
    }

    return true;
  }
}
