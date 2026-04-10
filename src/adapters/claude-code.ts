// src/adapters/claude-code.ts — Adapter for Claude Code (Anthropic)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

export class ClaudeCodeAdapter extends BaseAdapter {
  name: AgentTool = 'claude-code';
  displayName = 'Claude Code';

  private getGlobalDir(): string {
    return path.join(os.homedir(), '.claude');
  }

  private getProjectClaudeDir(): string {
    return path.join(this.projectDir, '.claude');
  }

  async detect(): Promise<boolean> {
    // Check if Claude Code global config exists
    const globalDir = this.getGlobalDir();
    if (!fs.existsSync(globalDir)) return false;

    // Check if a claude process is running
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH 2>NUL || ps aux | grep -i claude 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 3000,
      });
      return result.toLowerCase().includes('claude');
    } catch {
      // Fallback: check if .claude dir exists
      return fs.existsSync(globalDir);
    }
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.getProjectClaudeDir(), 'memory'),
      rulesDir: path.join(this.getProjectClaudeDir(), 'rules'),
      conversationDir: path.join(this.getProjectClaudeDir(), 'projects'),
      configFile: path.join(this.getProjectClaudeDir(), 'settings.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    const activities: AgentActivity[] = [];

    // Read from conversation JSONL files
    const projectsDir = path.join(this.getGlobalDir(), 'projects');
    if (!fs.existsSync(projectsDir)) return activities;

    try {
      // Find project-specific conversation dirs
      const dirs = fs.readdirSync(projectsDir, { recursive: true }) as string[];
      const jsonlFiles = dirs
        .filter((f: string) => f.endsWith('.jsonl'))
        .map((f: string) => path.join(projectsDir, f));

      // Read last JSONL file (most recent conversation)
      const sorted = jsonlFiles
        .filter((f: string) => fs.existsSync(f))
        .sort((a: string, b: string) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch { return 0; }
        });

      if (sorted.length > 0) {
        const content = fs.readFileSync(sorted[0], 'utf-8');
        const lines = content.trim().split('\n').slice(-50); // last 50 entries

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'assistant' && entry.message?.content) {
              for (const block of entry.message.content) {
                if (block.type === 'tool_use') {
                  activities.push({
                    timestamp: new Date(entry.timestamp || Date.now()),
                    type: this.mapToolToActivityType(block.name),
                    detail: `${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`,
                    file: block.input?.file_path || block.input?.path,
                  });
                }
              }
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch { /* permission errors */ }

    return activities;
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    // Claude Code specific: inject into .claude/memory/ and CLAUDE.md
    const memoryDir = path.join(this.getProjectClaudeDir(), 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    // Write brain insights file that Claude Code will pick up
    const brainFile = path.join(memoryDir, 'SHADOW_BRAIN.md');
    const existing = this.readFile(brainFile) || '';
    const updated = this.appendToBrainFile(existing, insight);
    fs.writeFileSync(brainFile, updated, 'utf-8');

    // Also inject into rules if critical
    if (insight.priority === 'critical') {
      const rulesDir = path.join(this.getProjectClaudeDir(), 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      const ruleFile = path.join(rulesDir, 'shadow-brain-alerts.md');
      const ruleContent = `# Shadow Brain Critical Alerts\n\n${insight.content}\n`;
      fs.writeFileSync(ruleFile, ruleContent, 'utf-8');
    }

    return true;
  }

  private mapToolToActivityType(toolName: string): AgentActivity['type'] {
    if (toolName.includes('Edit') || toolName.includes('Write')) return 'file_edit';
    if (toolName.includes('Read') || toolName.includes('Glob') || toolName.includes('Grep')) return 'file_read';
    if (toolName.includes('Bash')) return 'command';
    if (toolName.includes('Agent') || toolName.includes('Ask')) return 'conversation';
    return 'search';
  }
}
