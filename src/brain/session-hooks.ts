// src/brain/session-hooks.ts — Universal Session Hook Installer (v5.2.0)
//
// Installs SessionStart-equivalent hooks for every supported AI coding agent so
// that Shadow Brain is the FIRST thing each agent calls when a new session begins.
//
// Each agent has a different hook mechanism — this module abstracts them:
//
//   Claude Code  → ~/.claude/settings.json hooks.SessionStart
//   Cursor       → .cursor/rules + global ~/.cursor/mcp.json
//   Cline        → ~/.vscode/User/cline_mcp_settings.json
//   Windsurf     → .windsurfrules + ~/.windsurf/mcp.json
//   Codex        → ~/.codex/config.json
//   Kilo Code    → ~/.kilocode/settings.json
//   OpenCode     → ~/.opencode/settings.json
//   Roo Code     → ~/.roocode/mcp.json
//   Aider        → ~/.aider.conf.yml load_md
//   Copilot      → .github/copilot-instructions.md (workspace) + user settings.json
//
// Falls back gracefully when a specific agent's hook system isn't available.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTool,
  SessionHook,
  AttachReport,
} from '../types.js';

const SHADOW_BRAIN_HOOK_CMD = 'shadow-brain subconscious inject';
const SHADOW_BRAIN_MCP_NAME = 'shadow-brain';
const SHADOW_BRAIN_MCP_CONFIG = {
  command: 'npx',
  args: ['-y', '@theihtisham/agent-shadow-brain', 'mcp', '--stdio'],
};

export class SessionHookInstaller {
  /** Detect installed agents on this machine + project */
  async detectInstalled(projectDir: string): Promise<AgentTool[]> {
    const detected: AgentTool[] = [];
    const home = os.homedir();

    const checks: Array<{ agent: AgentTool; paths: string[] }> = [
      { agent: 'claude-code', paths: [path.join(home, '.claude'), path.join(projectDir, '.claude')] },
      { agent: 'cursor', paths: [path.join(home, '.cursor'), path.join(projectDir, '.cursor'), path.join(projectDir, '.cursorrules')] },
      { agent: 'cline', paths: [path.join(home, 'AppData', 'Roaming', 'Code', 'User'), path.join(home, '.vscode')] },
      { agent: 'windsurf', paths: [path.join(home, '.windsurf'), path.join(projectDir, '.windsurfrules')] },
      { agent: 'codex', paths: [path.join(home, '.codex'), path.join(projectDir, '.codex')] },
      { agent: 'kilo-code', paths: [path.join(home, '.kilocode'), path.join(projectDir, '.kilocode')] },
      { agent: 'opencode', paths: [path.join(home, '.opencode'), path.join(projectDir, '.opencode')] },
      { agent: 'roo-code', paths: [path.join(home, '.roocode'), path.join(home, '.rovodev')] },
      { agent: 'aider', paths: [path.join(home, '.aider.conf.yml'), path.join(projectDir, '.aider.conf.yml')] },
      { agent: 'copilot', paths: [path.join(projectDir, '.github', 'copilot-instructions.md'), path.join(home, '.config', 'copilot')] },
    ];

    for (const { agent, paths } of checks) {
      if (paths.some(p => fs.existsSync(p))) {
        detected.push(agent);
      }
    }

    return detected;
  }

  /** Install hooks for ALL detected agents in one shot */
  async attachAll(projectDir: string): Promise<AttachReport> {
    const start = Date.now();
    const detected = await this.detectInstalled(projectDir);
    const attached: AgentTool[] = [];
    const failed: Array<{ agent: AgentTool; reason: string }> = [];
    const hooks: SessionHook[] = [];

    for (const agent of detected) {
      try {
        const installed = await this.attach(agent, projectDir);
        if (installed.length) {
          attached.push(agent);
          hooks.push(...installed);
        } else {
          failed.push({ agent, reason: 'no hook installed (no supported mechanism)' });
        }
      } catch (err) {
        failed.push({ agent, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      detected,
      attached,
      failed,
      hooks,
      totalAgents: detected.length,
      durationMs: Date.now() - start,
    };
  }

  /** Install hooks for a single agent. Returns list of installed hooks. */
  async attach(agent: AgentTool, projectDir: string): Promise<SessionHook[]> {
    switch (agent) {
      case 'claude-code': return this.attachClaudeCode(projectDir);
      case 'cursor':      return this.attachCursor(projectDir);
      case 'cline':       return this.attachCline(projectDir);
      case 'windsurf':    return this.attachWindsurf(projectDir);
      case 'codex':       return this.attachCodex(projectDir);
      case 'kilo-code':   return this.attachKiloCode(projectDir);
      case 'opencode':    return this.attachOpenCode(projectDir);
      case 'roo-code':    return this.attachRooCode(projectDir);
      case 'aider':       return this.attachAider(projectDir);
      case 'copilot':     return this.attachCopilot(projectDir);
      default: return [];
    }
  }

  /** Detach Shadow Brain from a specific agent */
  async detach(agent: AgentTool, projectDir: string): Promise<boolean> {
    // For now, document what would be removed; implementation per-agent.
    // We keep this simple: detach is best-effort and never destructive of other config.
    const hooks = await this.attach(agent, projectDir);
    for (const hook of hooks) {
      try {
        if (fs.existsSync(hook.installPath) && hook.hookType === 'workspace-rule') {
          // Only delete files we created
          if (hook.installPath.includes('shadow-brain')) {
            fs.unlinkSync(hook.installPath);
          }
        }
      } catch { /* ignore */ }
    }
    return true;
  }

  // ─── Per-agent installers ───────────────────────────────────────────────────

  private attachClaudeCode(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const hooks: SessionHook[] = [];

    try {
      let settings: any = {};
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }

      settings.hooks ??= {};
      settings.hooks.SessionStart ??= [];

      const existing = (settings.hooks.SessionStart as any[]).find(h =>
        typeof h === 'object' && h?.command?.includes('shadow-brain')
      );

      if (!existing) {
        (settings.hooks.SessionStart as any[]).push({
          name: 'shadow-brain-subconscious',
          command: SHADOW_BRAIN_HOOK_CMD,
          timeout: 5000,
        });
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      hooks.push({
        agent: 'claude-code',
        event: 'session-start',
        hookType: 'settings-json',
        installPath: settingsPath,
        command: SHADOW_BRAIN_HOOK_CMD,
        active: true,
        installedAt: new Date(),
      });
    } catch (err) {
      throw new Error(`claude-code attach failed: ${err}`);
    }

    return hooks;
  }

  private attachCursor(projectDir: string): SessionHook[] {
    const hooks: SessionHook[] = [];
    const cursorDir = path.join(projectDir, '.cursor');
    const rulesDir = path.join(cursorDir, 'rules');
    const mcpPath = path.join(cursorDir, 'mcp.json');

    fs.mkdirSync(rulesDir, { recursive: true });

    // 1. Workspace rule that tells Cursor to call shadow-brain on session
    const ruleFile = path.join(rulesDir, 'shadow-brain.md');
    if (!fs.existsSync(ruleFile)) {
      fs.writeFileSync(ruleFile, this.cursorRuleTemplate(), 'utf-8');
    }
    hooks.push({
      agent: 'cursor',
      event: 'session-start',
      hookType: 'workspace-rule',
      installPath: ruleFile,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    });

    // 2. MCP server registration
    this.upsertMcpJson(mcpPath);
    hooks.push({
      agent: 'cursor',
      event: 'session-start',
      hookType: 'extension-config',
      installPath: mcpPath,
      command: SHADOW_BRAIN_MCP_CONFIG.command,
      active: true,
      installedAt: new Date(),
    });

    return hooks;
  }

  private attachCline(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const candidates = [
      path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    ];

    const hooks: SessionHook[] = [];

    for (const settingsPath of candidates) {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(path.dirname(dir))) continue;

      try {
        fs.mkdirSync(dir, { recursive: true });
        this.upsertMcpJson(settingsPath, 'mcpServers');

        hooks.push({
          agent: 'cline',
          event: 'session-start',
          hookType: 'extension-config',
          installPath: settingsPath,
          command: SHADOW_BRAIN_MCP_CONFIG.command,
          active: true,
          installedAt: new Date(),
        });
        break; // Only one location per OS
      } catch { /* try next */ }
    }

    // Workspace fallback rule
    const projectRule = path.join(projectDir, '.clinerules');
    if (!fs.existsSync(projectRule)) {
      fs.writeFileSync(projectRule, this.genericRuleTemplate('Cline'), 'utf-8');
    }
    hooks.push({
      agent: 'cline',
      event: 'session-start',
      hookType: 'workspace-rule',
      installPath: projectRule,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    });

    return hooks;
  }

  private attachWindsurf(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const hooks: SessionHook[] = [];

    const ruleFile = path.join(projectDir, '.windsurfrules');
    if (!fs.existsSync(ruleFile)) {
      fs.writeFileSync(ruleFile, this.genericRuleTemplate('Windsurf'), 'utf-8');
    }
    hooks.push({
      agent: 'windsurf',
      event: 'session-start',
      hookType: 'workspace-rule',
      installPath: ruleFile,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    });

    const mcpPath = path.join(home, '.windsurf', 'mcp.json');
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    this.upsertMcpJson(mcpPath);
    hooks.push({
      agent: 'windsurf',
      event: 'session-start',
      hookType: 'extension-config',
      installPath: mcpPath,
      command: SHADOW_BRAIN_MCP_CONFIG.command,
      active: true,
      installedAt: new Date(),
    });

    return hooks;
  }

  private attachCodex(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const cfgPath = path.join(home, '.codex', 'config.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

    let cfg: any = {};
    if (fs.existsSync(cfgPath)) {
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { cfg = {}; }
    }

    cfg.session_start_command = SHADOW_BRAIN_HOOK_CMD;
    cfg.mcp_servers ??= {};
    cfg.mcp_servers[SHADOW_BRAIN_MCP_NAME] = SHADOW_BRAIN_MCP_CONFIG;

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    return [{
      agent: 'codex',
      event: 'session-start',
      hookType: 'config-file',
      installPath: cfgPath,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    }];
  }

  private attachKiloCode(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const settingsPath = path.join(home, '.kilocode', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    let cfg: any = {};
    if (fs.existsSync(settingsPath)) {
      try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { cfg = {}; }
    }

    cfg.mcpServers ??= {};
    cfg.mcpServers[SHADOW_BRAIN_MCP_NAME] = SHADOW_BRAIN_MCP_CONFIG;
    cfg.sessionStartHook = SHADOW_BRAIN_HOOK_CMD;

    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));

    return [{
      agent: 'kilo-code',
      event: 'session-start',
      hookType: 'settings-json',
      installPath: settingsPath,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    }];
  }

  private attachOpenCode(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const settingsPath = path.join(home, '.opencode', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    let cfg: any = {};
    if (fs.existsSync(settingsPath)) {
      try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { cfg = {}; }
    }

    cfg.mcpServers ??= {};
    cfg.mcpServers[SHADOW_BRAIN_MCP_NAME] = SHADOW_BRAIN_MCP_CONFIG;

    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2));

    return [{
      agent: 'opencode',
      event: 'session-start',
      hookType: 'settings-json',
      installPath: settingsPath,
      command: SHADOW_BRAIN_MCP_CONFIG.command,
      active: true,
      installedAt: new Date(),
    }];
  }

  private attachRooCode(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.roocode', 'mcp.json'),
      path.join(home, '.rovodev', 'mcp.json'),
    ];

    const hooks: SessionHook[] = [];
    for (const mcpPath of candidates) {
      try {
        fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
        this.upsertMcpJson(mcpPath);
        hooks.push({
          agent: 'roo-code',
          event: 'session-start',
          hookType: 'extension-config',
          installPath: mcpPath,
          command: SHADOW_BRAIN_MCP_CONFIG.command,
          active: true,
          installedAt: new Date(),
        });
        break;
      } catch { /* try next */ }
    }
    return hooks;
  }

  private attachAider(projectDir: string): SessionHook[] {
    const home = os.homedir();
    const cfgPath = path.join(home, '.aider.conf.yml');
    const briefingPath = path.join(home, '.aider.shadow-brain.md');

    // Write the briefing wrapper file Aider will load via load_md
    fs.writeFileSync(briefingPath, '# Shadow Brain\n\nThis file is rewritten on each Shadow Brain session-start hook.\n');

    let cfg = '';
    if (fs.existsSync(cfgPath)) {
      cfg = fs.readFileSync(cfgPath, 'utf-8');
    }

    if (!cfg.includes('.aider.shadow-brain.md')) {
      cfg += `\n# Shadow Brain auto-injected\nread:\n  - ${briefingPath}\n`;
      fs.writeFileSync(cfgPath, cfg);
    }

    return [{
      agent: 'aider',
      event: 'session-start',
      hookType: 'config-file',
      installPath: cfgPath,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    }];
  }

  private attachCopilot(projectDir: string): SessionHook[] {
    // GitHub Copilot reads .github/copilot-instructions.md as workspace context.
    const githubDir = path.join(projectDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    const instrPath = path.join(githubDir, 'copilot-instructions.md');

    if (!fs.existsSync(instrPath)) {
      fs.writeFileSync(instrPath, this.copilotInstructionsTemplate(), 'utf-8');
    } else {
      // Append marker if not present
      const existing = fs.readFileSync(instrPath, 'utf-8');
      if (!existing.includes('Shadow Brain')) {
        fs.appendFileSync(instrPath, `\n\n---\n\n${this.copilotInstructionsTemplate()}`);
      }
    }

    return [{
      agent: 'copilot',
      event: 'session-start',
      hookType: 'workspace-rule',
      installPath: instrPath,
      command: SHADOW_BRAIN_HOOK_CMD,
      active: true,
      installedAt: new Date(),
    }];
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Add Shadow Brain to an MCP-server-style JSON config without clobbering existing servers */
  private upsertMcpJson(jsonPath: string, key: 'mcpServers' | 'servers' = 'mcpServers'): void {
    let cfg: any = {};
    if (fs.existsSync(jsonPath)) {
      try { cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch { cfg = {}; }
    }
    cfg[key] ??= {};
    cfg[key][SHADOW_BRAIN_MCP_NAME] = SHADOW_BRAIN_MCP_CONFIG;
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(cfg, null, 2));
  }

  private cursorRuleTemplate(): string {
    return `# Shadow Brain — Always-On Context Layer

This project is augmented by Shadow Brain (https://github.com/theihtisham/agent-shadow-brain).

At the start of every session, Shadow Brain auto-injects a briefing of:
- Recent project decisions
- Active tasks
- Cross-agent insights from Claude/Cline/Codex
- Known warnings and patterns

To check what Shadow Brain knows about this project: \`shadow-brain recall\`
To view the global brain stats: \`shadow-brain global stats\`
`;
  }

  private genericRuleTemplate(agentName: string): string {
    return `# Shadow Brain Integration (${agentName})

Shadow Brain is active for this project. It maintains a singleton global brain
across all your AI coding agents — what one agent learns, all agents know.

Auto-injects context on session start. Run \`shadow-brain status\` for state.
`;
  }

  private copilotInstructionsTemplate(): string {
    return `## Shadow Brain Context

This workspace is monitored by Shadow Brain — a cross-agent intelligence layer.
When making suggestions, prefer patterns documented in the Shadow Brain memory at \`.shadow-brain/\` over generic patterns.

Project-specific decisions, conventions, and warnings are recorded in \`.shadow-brain/SHADOW_BRAIN.md\`.
`;
  }
}

let defaultInstaller: SessionHookInstaller | null = null;

export function getHookInstaller(): SessionHookInstaller {
  if (!defaultInstaller) defaultInstaller = new SessionHookInstaller();
  return defaultInstaller;
}
