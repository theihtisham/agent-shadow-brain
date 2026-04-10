// src/types.ts — Core type definitions for Agent Shadow Brain

export type AgentTool =
  | 'claude-code'
  | 'kilo-code'
  | 'cline'
  | 'opencode'
  | 'codex'
  | 'roo-code'
  | 'aider'
  | 'cursor';

export interface AgentAdapter {
  name: AgentTool;
  displayName: string;

  /** Detect if this agent tool is running */
  detect(): Promise<boolean>;

  /** Get the project directory the agent is working on */
  getProjectDir(): Promise<string | null>;

  /** Read the agent's memory/context files */
  readMemory(): Promise<AgentMemory>;

  /** Inject context/instructions into the agent's memory */
  injectContext(ctx: BrainInsight): Promise<boolean>;

  /** Read recent conversation/activity logs */
  readActivity(): Promise<AgentActivity[]>;

  /** Get agent-specific config paths */
  getConfigPaths(): AgentPaths;
}

export interface AgentPaths {
  memoryDir: string;
  rulesDir: string;
  conversationDir?: string;
  configFile?: string;
}

export interface AgentMemory {
  rules: string[];
  context: string[];
  recentFiles: string[];
  projectKnowledge: Record<string, string>;
}

export interface AgentActivity {
  timestamp: Date;
  type: 'file_edit' | 'file_read' | 'command' | 'conversation' | 'error' | 'search';
  detail: string;
  file?: string;
  diff?: string;
}

export interface BrainInsight {
  type: 'review' | 'suggestion' | 'warning' | 'context' | 'pattern' | 'instruction';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  content: string;
  files?: string[];
  timestamp: Date;
  sourceAgent?: AgentTool;
  targetAgent?: AgentTool;
}

export interface BrainConfig {
  provider: LLMProvider;
  apiKey?: string;
  model?: string;
  agents: AgentTool[];
  projectDir: string;
  watchMode: boolean;
  autoInject: boolean;
  reviewDepth: 'quick' | 'standard' | 'deep';
  brainPersonality: BrainPersonality;
}

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'openrouter';

export type BrainPersonality =
  | 'mentor'       // Teaches and explains
  | 'critic'       // Harsh code reviewer
  | 'architect'    // Big-picture thinker
  | 'security'     // Security-first
  | 'performance'  // Optimization focused
  | 'balanced';    // Mix of all

export interface FileChange {
  path: string;
  type: 'add' | 'modify' | 'delete' | 'rename';
  diff?: string;
  content?: string;
  oldPath?: string;
}

export interface ProjectContext {
  name: string;
  rootDir: string;
  language: string[];
  framework?: string;
  packageManager?: string;
  structure: string[];
  recentChanges: FileChange[];
  gitBranch?: string;
  gitStatus?: string;
}

export interface BrainSession {
  id: string;
  startedAt: Date;
  agent: AgentTool;
  projectDir: string;
  insights: BrainInsight[];
  filesReviewed: number;
  suggestionsInjected: number;
}
