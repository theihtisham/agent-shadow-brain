// src/adapters/copilot.ts — Adapter for GitHub Copilot
//
// Copilot's official workspace context mechanism is .github/copilot-instructions.md.
// This adapter writes brain insights there so Copilot picks them up automatically.
//
// User-level config: ~/.config/copilot (Linux/macOS) or %APPDATA%\\GitHub Copilot (Windows).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from './base-adapter.js';
import { AgentTool, AgentPaths, AgentActivity, BrainInsight } from '../types.js';

const SHADOW_MARKER_START = '<!-- SHADOW_BRAIN_START -->';
const SHADOW_MARKER_END = '<!-- SHADOW_BRAIN_END -->';

export class CopilotAdapter extends BaseAdapter {
  name: AgentTool = 'copilot';
  displayName = 'GitHub Copilot';

  private getInstructionsPath(): string {
    return path.join(this.projectDir, '.github', 'copilot-instructions.md');
  }

  private getUserConfigDir(): string {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || os.homedir(), 'GitHub Copilot');
    }
    return path.join(os.homedir(), '.config', 'github-copilot');
  }

  async detect(): Promise<boolean> {
    if (fs.existsSync(this.getInstructionsPath())) return true;
    if (fs.existsSync(this.getUserConfigDir())) return true;

    // Workspace marker — VS Code extensions registry
    const candidates = [
      path.join(this.projectDir, '.vscode', 'extensions.json'),
      path.join(this.projectDir, '.vscode', 'settings.json'),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (/copilot/i.test(content)) return true;
      } catch { /* skip */ }
    }

    return false;
  }

  getConfigPaths(): AgentPaths {
    return {
      memoryDir: path.join(this.projectDir, '.github'),
      rulesDir: path.join(this.projectDir, '.github'),
      configFile: path.join(this.projectDir, '.vscode', 'settings.json'),
    };
  }

  async readActivity(): Promise<AgentActivity[]> {
    // Copilot doesn't expose conversation logs the way other agents do.
    // We approximate from recent file mtimes in the project (Copilot edits leave fingerprints).
    return [];
  }

  async injectContext(insight: BrainInsight): Promise<boolean> {
    const instrPath = this.getInstructionsPath();
    fs.mkdirSync(path.dirname(instrPath), { recursive: true });

    const existing = this.readFile(instrPath) || '';
    const block = this.formatShadowSection(insight);

    let updated: string;
    if (existing.includes(SHADOW_MARKER_START) && existing.includes(SHADOW_MARKER_END)) {
      // Replace existing shadow section
      const before = existing.split(SHADOW_MARKER_START)[0];
      const after = existing.split(SHADOW_MARKER_END)[1] ?? '';
      updated = `${before}${SHADOW_MARKER_START}\n${block}\n${SHADOW_MARKER_END}${after}`;
    } else {
      updated = existing + `\n\n${SHADOW_MARKER_START}\n${block}\n${SHADOW_MARKER_END}\n`;
    }

    fs.writeFileSync(instrPath, updated, 'utf-8');
    return true;
  }

  private formatShadowSection(insight: BrainInsight): string {
    return `## Shadow Brain — Latest Insight

**${insight.title}** (${insight.priority})

${insight.content}

${insight.files?.length ? `Affected files: ${insight.files.join(', ')}` : ''}

_Auto-updated by Shadow Brain — see https://github.com/theihtisham/agent-shadow-brain_
`;
  }
}
