// src/index.ts — Library entry point for @theihtisham/agent-shadow-brain

// Types
export type {
  AgentTool,
  AgentAdapter,
  AgentPaths,
  AgentMemory,
  AgentActivity,
  BrainInsight,
  BrainConfig,
  LLMProvider,
  BrainPersonality,
  FileChange,
  ProjectContext,
  BrainSession,
} from './types.js';

// Adapters
export { createAdapter, detectRunningAgents } from './adapters/index.js';
export { ClaudeCodeAdapter } from './adapters/claude-code.js';
export { KiloCodeAdapter } from './adapters/kilo-code.js';
export { ClineAdapter } from './adapters/cline.js';
export { OpenCodeAdapter } from './adapters/opencode.js';
export { CodexAdapter } from './adapters/codex.js';
export { BaseAdapter } from './adapters/base-adapter.js';

// Brain
export { LLMClient, LLMError } from './brain/llm-client.js';
export { Analyzer, PromptBuilder } from './brain/analyzer.js';
export { ProjectContextBuilder } from './brain/project-context.js';
export { PatternMemory } from './brain/pattern-memory.js';
export { Orchestrator } from './brain/orchestrator.js';

// Watchers
export { FileWatcher } from './watchers/file-watcher.js';
export { GitWatcher } from './watchers/git-watcher.js';
export type { GitState, GitCommit } from './watchers/git-watcher.js';
