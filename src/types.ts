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

// ── v1.2.0 Types ──────────────────────────────────────────────────────────────

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  pattern: string;
  flags?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'quality' | 'architecture' | 'style';
  suggestion?: string;
  enabled: boolean;
}

export interface ProjectConfig {
  version: string;
  rules?: {
    customRules?: CustomRule[];
    ignorePatterns?: string[];
    ignorePaths?: string[];
  };
  notifications?: {
    webhook?: string;
    slack?: string;
    discord?: string;
    email?: string;
    onHealthDrop?: boolean;
    onCriticalInsight?: boolean;
    minInterval?: number;
  };
  health?: {
    weights?: Record<string, number>;
    thresholds?: Record<string, number>;
  };
  metrics?: {
    excludePaths?: string[];
    complexityThreshold?: number;
  };
}

export interface CodeMetrics {
  totalFiles: number;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  languages: Record<string, { files: number; lines: number; percentage: number }>;
  largestFiles: Array<{ path: string; lines: number }>;
  complexityHotspots: Array<{ path: string; complexity: number; functions: number }>;
  fileTypes: Record<string, number>;
  avgFileSize: number;
  timestamp: Date;
}

export interface PRDescription {
  title: string;
  body: string;
  type: 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore' | 'perf';
  scope?: string;
  breaking: boolean;
}

export interface CommitMessage {
  conventional: string;
  short: string;
  detailed: string;
}

export interface VulnResult {
  package: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  url?: string;
  patchedIn?: string;
}

export interface NotificationPayload {
  type: 'health-drop' | 'critical-insight' | 'analysis-complete' | 'error';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface ProjectFileChange {
  path: string;
  type: 'add' | 'modify' | 'delete';
  insertions: number;
  deletions: number;
}
