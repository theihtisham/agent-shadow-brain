// src/adapters/index.ts — Export all adapters + factory

import { AgentAdapter, AgentTool } from '../types.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { KiloCodeAdapter } from './kilo-code.js';
import { ClineAdapter } from './cline.js';
import { OpenCodeAdapter } from './opencode.js';
import { CodexAdapter } from './codex.js';
import { RooCodeAdapter } from './roo-code.js';
import { AiderAdapter } from './aider.js';

export const ALL_ADAPTERS: Record<AgentTool, () => AgentAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'kilo-code': () => new KiloCodeAdapter(),
  'cline': () => new ClineAdapter(),
  'opencode': () => new OpenCodeAdapter(),
  'codex': () => new CodexAdapter(),
  'roo-code': () => new RooCodeAdapter(),
  'aider': () => new AiderAdapter(),
  'cursor': () => new ClineAdapter(),      // Similar VS Code pattern
  'windsurf': () => new ClineAdapter(),    // Similar VS Code pattern
};

export function createAdapter(tool: AgentTool): AgentAdapter {
  const factory = ALL_ADAPTERS[tool];
  if (!factory) throw new Error(`Unknown agent tool: ${tool}`);
  return factory();
}

export async function detectRunningAgents(projectDir: string): Promise<AgentAdapter[]> {
  const detected: AgentAdapter[] = [];

  for (const [tool, factory] of Object.entries(ALL_ADAPTERS)) {
    const adapter = factory();
    (adapter as any).projectDir = projectDir;
    try {
      if (await adapter.detect()) {
        detected.push(adapter);
      }
    } catch { /* skip failures */ }
  }

  return detected;
}

export { ClaudeCodeAdapter, KiloCodeAdapter, ClineAdapter, OpenCodeAdapter, CodexAdapter, RooCodeAdapter, AiderAdapter };
