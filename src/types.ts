// src/types.ts — Core type definitions for Agent Shadow Brain

export type AgentTool =
  | 'claude-code'
  | 'kilo-code'
  | 'cline'
  | 'opencode'
  | 'codex'
  | 'roo-code'
  | 'aider'
  | 'cursor'
  | 'windsurf';

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
  type: 'review' | 'suggestion' | 'warning' | 'context' | 'pattern' | 'instruction' | 'prediction' | 'mutation' | 'a11y' | 'i18n' | 'dead-code' | 'api-contract' | 'env' | 'license' | 'config-drift' | 'complexity' | 'security' | 'architecture';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  content: string;
  files?: string[];
  timestamp: Date;
  sourceAgent?: AgentTool;
  targetAgent?: AgentTool;
  confidence?: number;
  metadata?: Record<string, unknown>;
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

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'openrouter' | 'gemini' | 'mistral' | 'deepseek';

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

// ── v2.0.0 Super-Intelligence Types ────────────────────────────────────────────

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'import' | 'export' | 'method' | 'interface' | 'type';
  line: number;
  file: string;
  exported: boolean;
  usedInFiles: string[];
}

export interface GraphNode {
  id: string;
  file: string;
  imports: number;
  importedBy: number;
  type: 'source' | 'config' | 'test' | 'style' | 'other';
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic';
}

export interface DependencyGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  orphans: string[];
  cycles: string[][];
}

export interface HubInfo {
  file: string;
  dependents: number;
  risk: 'high' | 'medium' | 'low';
}

export interface CodeBlock {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  type: 'function' | 'method' | 'class' | 'block';
}

export interface DuplicateGroup {
  blocks: CodeBlock[];
  similarity: number;
  suggestedRefactor: string;
}

export interface ADRDecision {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  date: Date;
  context: string;
  decision: string;
  consequences: string;
  alternatives?: string[];
  files?: string[];
}

export interface LearnedLesson {
  id: string;
  category: string;
  pattern: string;
  lesson: string;
  confidence: number;
  occurrences: number;
  lastSeen: Date;
  source: 'rule' | 'llm' | 'user-feedback';
}

export interface CodePattern {
  id: string;
  language: string;
  pattern: string;
  description: string;
  frequency: number;
  lastSeen: Date;
  associatedInsights: string[];
}

export interface ProjectKnowledge {
  name: string;
  conventions: string[];
  architecture: string;
  commonPatterns: string[];
  avoidPatterns: string[];
  dependencies: string[];
  lastUpdated: Date;
}

export interface SharedPattern {
  id: string;
  pattern: string;
  description: string;
  language: string;
  category: string;
  addedBy: string;
  addedAt: Date;
  occurrences: number;
}

export interface TeamInsight {
  id: string;
  insight: BrainInsight;
  sharedBy: string;
  sharedAt: Date;
  upvotes: number;
  downvotes: number;
  tags: string[];
}

export interface TeamStats {
  members: number;
  totalInsights: number;
  totalPatterns: number;
  topContributors: Array<{ name: string; insights: number }>;
  recentActivity: Array<{ user: string; action: string; timestamp: Date }>;
}

export interface ProjectInfo {
  id: string;
  dir: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  lastHealth: number | null;
  lastAnalyzed: Date | null;
  insightCount: number;
}

export interface AggregatedHealth {
  projects: number;
  averageHealth: number;
  bestProject: string;
  worstProject: string;
  criticalIssues: number;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServerOptions {
  port?: number;
  host?: string;
}

export interface PerfInsight {
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: string;
  description: string;
  suggestion: string;
  estimatedImpact: string;
}

// ── v2.1.0 Quantum Neural Mesh Types ──────────────────────────────────────────

export interface MeshNode {
  id: string;
  sessionId: string;
  projectDir: string;
  projectName: string;
  pid: number;
  startedAt: Date;
  lastHeartbeat: Date;
  status: 'active' | 'idle' | 'disconnected';
  personality: BrainPersonality;
  insightsGenerated: number;
  healthScore: number | null;
  currentTask: string | null;
}

export interface MeshMessage {
  id: string;
  fromNode: string;
  type: 'insight' | 'health-update' | 'task-update' | 'pattern-learned' | 'warning' | 'knowledge-sync' | 'heartbeat' | 'session-start' | 'session-end';
  payload: unknown;
  timestamp: Date;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tags: string[];
  entropy: number; // 0-1 relevance score
}

export interface MeshKnowledge {
  id: string;
  sourceNode: string;
  sourceProject: string;
  category: 'architecture' | 'pattern' | 'anti-pattern' | 'security' | 'performance' | 'convention' | 'dependency' | 'config';
  content: string;
  confidence: number; // 0-1
  frequency: number; // how many nodes observed this
  firstSeen: Date;
  lastSeen: Date;
  relatedFiles: string[];
  vector: number[]; // simplified embedding for similarity
}

export interface MeshState {
  nodes: MeshNode[];
  messages: MeshMessage[];
  knowledge: MeshKnowledge[];
  totalInsightsExchanged: number;
  meshUptime: number;
  averageEntropy: number;
  quantumState: 'coherent' | 'decoherent' | 'collapsed';
}

export interface CrossSessionInsight {
  sourceSession: string;
  sourceProject: string;
  insight: BrainInsight;
  relevanceScore: number; // 0-1 how relevant to current project
  transferredAt: Date;
}

export interface NeuralMeshConfig {
  enabled: boolean;
  meshPort: number;
  meshHost: string;
  discoveryInterval: number; // ms between node discovery
  heartbeatInterval: number; // ms between heartbeats
  maxNodes: number;
  knowledgeRetentionMs: number; // how long to keep shared knowledge
  entropyThreshold: number; // minimum relevance score to accept insight
  conflictResolution: 'latest-wins' | 'highest-confidence' | 'consensus';
}

// ── v3.0.0 Hyper-Intelligence Types ────────────────────────────────────────────

// AST & Complexity Analysis
export interface ASTFunctionInfo {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  params: number;
  nestingDepth: number;
  returnPaths: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  linesOfCode: number;
  isExported: boolean;
  isAsync: boolean;
  isPure: boolean;
}

export interface ComplexityReport {
  totalFunctions: number;
  avgComplexity: number;
  maxComplexity: number;
  highComplexityFunctions: ASTFunctionInfo[];
  maintainabilityIndex: number;
  halsteadVolume: number;
  technicalDebtMinutes: number;
}

// Accessibility (a11y) Checking
export interface A11yIssue {
  rule: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  element: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
  wcagLevel: 'A' | 'AA' | 'AAA';
  wcagCriterion: string;
}

// i18n Readiness
export interface I18nIssue {
  type: 'hardcoded-string' | 'concatenation' | 'date-format' | 'number-format' | 'rtl-missing' | 'pluralization';
  file: string;
  line: number;
  content: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

// Dead Code Detection
export interface DeadCodeResult {
  type: 'unreachable' | 'unused-export' | 'unused-variable' | 'unused-import' | 'dead-branch' | 'unused-parameter';
  name: string;
  file: string;
  line: number;
  confidence: number;
  safeToRemove: boolean;
  impact: string;
}

// Mutation Testing Advisor
export interface MutationSuggestion {
  id: string;
  file: string;
  line: number;
  originalCode: string;
  mutatedCode: string;
  mutationType: 'arithmetic' | 'conditional' | 'logical' | 'negation' | 'string' | 'boundary' | 'return-value' | 'statement-deletion';
  killability: 'easy' | 'medium' | 'hard';
  rationale: string;
}

// Code Age / Staleness
export interface CodeAgeResult {
  file: string;
  lastModified: Date;
  daysSinceModification: number;
  linesChangedRecently: number;
  stalenessScore: number; // 0-1, 1 = very stale
  risk: 'fresh' | 'stable' | 'aging' | 'stale' | 'ancient';
  authors: string[];
  churnRate: number;
}

// API Contract Analysis
export interface APIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  file: string;
  line: number;
  hasValidation: boolean;
  hasAuth: boolean;
  hasRateLimit: boolean;
  hasDocs: boolean;
  hasTests: boolean;
  requestType?: string;
  responseType?: string;
  statusCode: number[];
  issues: string[];
}

// Environment Variable Analysis
export interface EnvIssue {
  variable: string;
  file: string;
  line: number;
  type: 'missing-default' | 'hardcoded-secret' | 'missing-validation' | 'wrong-type' | 'unused' | 'missing-docs' | 'inconsistent-naming';
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string;
}

// License Compliance
export interface LicenseIssue {
  package: string;
  version: string;
  license: string;
  type: 'restricted' | 'unknown' | 'conflict' | 'outdated' | 'copyleft';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

// Enhanced Health Dimensions (v3.0.0 — 8 dimensions)
export interface HealthDimensionV3 {
  name: string;
  score: number;
  weight: number;
  grade: string;
  issues: string[];
  trend: 'improving' | 'stable' | 'declining';
  predictedScore: number; // next-cycle prediction
}

export interface PredictiveInsight {
  type: 'degradation-warning' | 'improvement-opportunity' | 'risk-forecast' | 'trend-anomaly';
  confidence: number;
  description: string;
  projectedImpact: string;
  recommendation: string;
  timeframe: string;
}

// Streaming LLM Support
export interface LLMStreamChunk {
  text: string;
  done: boolean;
  tokensUsed?: number;
}

// WebSocket Mesh Message (real-time)
export interface WSMeshMessage {
  type: 'insight' | 'health' | 'knowledge' | 'node-join' | 'node-leave' | 'sync-request' | 'sync-response';
  fromNode: string;
  payload: unknown;
  timestamp: number;
}

// Cross-Language Pattern
export interface CrossLanguagePattern {
  pattern: string;
  languages: string[];
  files: string[];
  description: string;
  severity: 'info' | 'warning' | 'critical';
}

// Config Drift Detection
export interface ConfigDrift {
  file: string;
  expected: string;
  actual: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  autoFixable: boolean;
}

// ── v4.0.0 Hyper-Intelligence Types ────────────────────────────────────────────

// TurboQuant Infinite Memory
export interface TurboVector {
  /** PolarQuant main body: 2 bits per angle, packed into Uint8Array */
  polar: Uint8Array;
  /** QJL residual: 1 bit per dimension, packed into Uint8Array */
  qjl: Uint8Array;
  /** Original dimension count */
  dim: number;
  /** Radius from PolarQuant (stored as float, single value) */
  radius: number;
}

export interface TurboEntry {
  id: string;
  key: string;
  vector: TurboVector;
  metadata: Record<string, unknown>;
  timestamp: Date;
  accessCount: number;
  lastAccessed: Date;
}

export interface TurboMemoryStore {
  version: 4;
  entries: TurboEntry[];
  totalCompressed: number;
  totalOriginal: number;
  compressionRatio: number;
  createdAt: Date;
  lastUpdated: Date;
}

export interface InfiniteMemoryStats {
  totalEntries: number;
  compressionRatio: number;
  memoryUsedMB: number;
  queryTimeMs: number;
  hitRate: number;
  retentionDays: number;
}

// SSSP Router (Breaking the Sorting Barrier)
export interface SSSPEdge {
  to: string;
  weight: number;
}

export interface SSSPGraph {
  adjacency: Map<string, SSSPEdge[]>;
  nodeCount: number;
  edgeCount: number;
}

export interface SSSPResult {
  distances: Map<string, number>;
  predecessors: Map<string, string | null>;
  pivots: string[];
  computedAt: Date;
}

export interface PivotSet {
  pivots: string[];
  covered: string[];
  uncovered: string[];
  k: number;
  computedAt: Date;
}

// Cross-Agent Intelligence Protocol (CAIP)
export interface CAIPMessage {
  id: string;
  from: AgentTool;
  to: AgentTool | 'broadcast';
  type: 'insight' | 'boost' | 'health' | 'knowledge' | 'handshake' | 'heartbeat' | 'disconnect';
  payload: unknown;
  timestamp: Date;
  priority: 'critical' | 'high' | 'medium' | 'low';
  signature?: string;
}

export interface CAIPHandshake {
  agentId: string;
  agentTool: AgentTool;
  version: string;
  capabilities: string[];
  publicKey?: string;
  projectDir: string;
  personality: string;
}

export interface CAIPChannel {
  id: string;
  participants: AgentTool[];
  created: Date;
  messageCount: number;
  lastActivity: Date;
  type: 'broadcast' | 'pair' | 'team';
}

export interface AgentBoostPacket {
  fromAgent: AgentTool;
  insights: BrainInsight[];
  patterns: string[];
  rules: string[];
  healthScore: number;
  contextSummary: string;
  timestamp: Date;
}

export interface CrossAgentBus {
  channels: CAIPChannel[];
  pendingMessages: CAIPMessage[];
  connectedAgents: Map<AgentTool, CAIPHandshake>;
  totalExchanged: number;
  uptime: number;
}

// Self-Evolution Engine
export interface GeneticRule {
  id: string;
  chromosome: number[];
  fitness: number;
  generation: number;
  mutations: number;
  category: string;
  originalRuleId?: string;
  createdAt: Date;
}

export interface EvolutionSnapshot {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
  population: GeneticRule[];
  eliteCount: number;
  timestamp: Date;
}

export interface MetaLearningLog {
  strategy: string;
  successRate: number;
  avgImprovement: number;
  sampleCount: number;
  lastUpdated: Date;
  category: string;
}

export interface SelfEvolutionConfig {
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  elitePercent: number;
  fitnessTarget: number;
  maxGenerations: number;
  tournamentSize: number;
}

// Predictive Engine
export interface BugRiskScore {
  file: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  factors: string[];
  confidence: number;
  predicted30Days: number;
  churnRate: number;
  complexity: number;
  age: number;
}

export interface TechDebtForecast {
  currentDebt: number;
  projectedDebt30d: number;
  projectedDebt90d: number;
  breakEvenDate: Date | null;
  recommendation: string;
  trend: 'improving' | 'stable' | 'worsening';
  velocity: number;
}

export interface AnomalyEvent {
  timestamp: Date;
  metric: string;
  observed: number;
  expected: number;
  zScore: number;
  severity: 'info' | 'warning' | 'critical';
  description: string;
}

export interface MonteCarloResult {
  simulations: number;
  median: number;
  p95: number;
  p99: number;
  confidenceInterval: [number, number];
  mean: number;
  stdDev: number;
}

// Knowledge Graph with PageRank
export interface KGEntity {
  id: string;
  type: 'function' | 'class' | 'interface' | 'module' | 'variable' | 'method';
  name: string;
  file: string;
  line: number;
  refs: string[];
  pageRankScore: number;
  exported: boolean;
  async: boolean;
}

export interface KGRelation {
  from: string;
  to: string;
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'uses' | 'tests';
  weight: number;
}

export interface KGGraph {
  entities: Map<string, KGEntity>;
  relations: KGRelation[];
  lastBuilt: Date;
  fileCount: number;
}

export interface PageRankResult {
  scores: Map<string, number>;
  iterations: number;
  converged: boolean;
  danglingNodes: number;
}

// Swarm Intelligence (Ant Colony)
export interface PheromoneTrail {
  path: string[];
  strength: number;
  evaporation: number;
  lastReinforced: Date;
  totalDetections: number;
}

export interface SwarmTask {
  id: string;
  type: 'analyze' | 'deep-scan' | 'pattern-hunt' | 'security-sweep';
  file?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  result?: unknown;
  createdAt: Date;
}

export interface AntColonyState {
  trails: PheromoneTrail[];
  activeTasks: SwarmTask[];
  convergenceScore: number;
  totalAnts: number;
  cycleCount: number;
  highPriorityFiles: string[];
}

export interface SwarmConfig {
  antCount: number;
  evaporationRate: number;
  reinforcementFactor: number;
  maxIterations: number;
  convergenceThreshold: number;
}

// Adversarial Defense
export interface HallucinationFlag {
  claim: string;
  confidence: number;
  verified: boolean;
  contradictions: string[];
  verdict: 'real' | 'hallucinated' | 'uncertain';
  evidence: string[];
  checkedAt: Date;
}

export interface EnsembleVote {
  question: string;
  votes: Array<{ model: string; answer: string; confidence: number }>;
  consensus: 'unanimous' | 'majority' | 'split' | 'none';
  agreedAnswer: string;
  confidence: number;
}

export interface AdversarialLog {
  timestamp: Date;
  flagged: number;
  blocked: number;
  accuracy: number;
  totalChecked: number;
  falsePositives: number;
}

export interface ThreatVector {
  type: 'prompt-injection' | 'hallucination' | 'data-poisoning' | 'contradiction';
  severity: 'low' | 'medium' | 'high' | 'critical';
  blocked: boolean;
  source: string;
  pattern: string;
  timestamp: Date;
}

// ── v5.0.0 Infinite Intelligence Types ────────────────────────────────────────

// Hierarchical Memory — 4-tier compression: raw → summary → pattern → principle
export type MemoryTier = 'raw' | 'summary' | 'pattern' | 'principle';

export interface HierarchicalMemoryEntry {
  id: string;
  tier: MemoryTier;
  content: string;
  category: string;
  confidence: number;
  importance: number; // 0-1, determines promotion/demotion
  accessCount: number;
  createdAt: Date;
  lastAccessed: Date;
  promotedAt: Date | null;
  parentIds: string[]; // link to entries this was compressed from
  childIds: string[]; // link to entries compressed into this
  vector: number[]; // semantic embedding for associative recall
  metadata: Record<string, unknown>;
  compressedSize: number; // bytes after compression
  originalSize: number; // bytes before compression
}

export interface HierarchicalMemoryStats {
  rawCount: number;
  summaryCount: number;
  patternCount: number;
  principleCount: number;
  totalEntries: number;
  totalSizeMB: number;
  compressionRatio: number;
  promotionRate: number; // entries promoted to higher tier per day
  retentionDays: number; // Infinity
  drillDownDepth: number;
}

// Context-Triggered Associative Recall
export interface RecallTrigger {
  /** What activates this memory — file path patterns, keywords, categories, code patterns */
  patterns: string[];
  /** How strongly this trigger activates (0-1) */
  strength: number;
  /** Recency boost — newer triggers get slight priority */
  recency: number;
}

export interface RecallResult {
  entry: HierarchicalMemoryEntry;
  relevanceScore: number;
  activatedTriggers: string[];
  activationPath: string[]; // chain of associations that led here
}

export interface RecallContext {
  currentFile: string;
  currentCategory: string;
  recentEdits: string[];
  projectType: string;
  keywords: string[];
  timeOfDay: number; // hour 0-23
  dayOfWeek: number; // 0-6
}

// Consensus Engine — Multi-agent agreement protocol
export interface ConsensusProposal {
  id: string;
  proposer: string;
  content: string;
  category: string;
  confidence: number;
  evidence: string[];
  timestamp: Date;
}

export interface ConsensusVote {
  voter: string;
  proposalId: string;
  vote: 'agree' | 'disagree' | 'abstain';
  confidence: number;
  reasoning: string;
  timestamp: Date;
}

export interface ConsensusResult {
  proposal: ConsensusProposal;
  votes: ConsensusVote[];
  verdict: 'accepted' | 'rejected' | 'pending' | 'conflicted';
  agreementScore: number; // 0-1
  confidenceInterval: [number, number];
  resolvedAt: Date | null;
  conflictResolution?: string;
}

export interface TrustScore {
  agent: string;
  score: number; // 0-1
  totalProposals: number;
  acceptedProposals: number;
  rejectedProposals: number;
  accuracyHistory: number[];
  lastUpdated: Date;
}

// Collective Learning — Cross-project knowledge sharing
export interface CollectiveRule {
  id: string;
  content: string;
  category: string;
  originProject: string;
  originAgent: string;
  verifiedBy: string[]; // agents/projects that confirmed this rule
  verifiedCount: number;
  contradictCount: number;
  trustScore: number; // 0-1
  applicability: string[]; // project types, languages, frameworks this applies to
  exceptions: string[]; // known cases where this rule doesn't apply
  createdAt: Date;
  lastVerifiedAt: Date;
  timesApplied: number;
  timesCorrect: number;
  accuracy: number;
  viralScore: number; // how widely this has spread
}

export interface CollectiveLearningStats {
  totalRules: number;
  verifiedRules: number;
  averageAccuracy: number;
  topCategories: Array<{ category: string; count: number; avgAccuracy: number }>;
  recentAdoptions: number;
  consensusRate: number;
  networkSize: number; // number of connected projects/agents
  knowledgeBaseSizeMB: number;
}

// ── v5.0.1 Types ────────────────────────────────────────────────────────────────

export interface AutoConfigResult {
  projectDir: string;
  projectName: string;
  projectType: string;
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
  aiTools: Array<{ name: string; path: string; detected: boolean }>;
  testFrameworks: string[];
  linters: string[];
  formatters: string[];
  cicd: string[];
  hasGit: boolean;
  hasDocker: boolean;
  config: Partial<BrainConfig>;
  timestamp: Date;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  hooks: PluginHook[];
  dependencies?: string[];
}

export interface PluginHook {
  event: 'pre-analysis' | 'post-analysis' | 'pre-insight' | 'post-insight' | 'pre-fix' | 'post-fix' | 'on-start' | 'on-stop' | 'on-file-change';
  handler: string; // function name exported from plugin main
  priority?: number; // lower = runs first
}

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  loadedAt: Date;
  errorCount: number;
  lastError?: string;
}

export interface BrainExportData {
  version: string;
  exportedAt: Date;
  projectName: string;
  projectDir: string;
  hierarchicalMemory: any;
  patternMemory: any;
  learningEngine: any;
  neuralMesh: any;
  consensusState: any;
  recallState: any;
  collectiveRules: any;
  turboMemory: any;
  knowledgeGraph: any;
  swarmState: any;
  evolutionState: any;
  customRules: any;
  plugins: PluginManifest[];
}

export interface ConnectedTool {
  name: string;
  type: AgentTool;
  status: 'connected' | 'disconnected' | 'unknown';
  lastSeen: Date;
  capabilities: string[];
}

export interface BrainModuleStatus {
  name: string;
  version: string;
  status: 'active' | 'idle' | 'error';
  entries?: number;
  memoryMB?: number;
  lastActivity?: Date;
  details?: Record<string, unknown>;
}

// ── v6.0.0 — Hyper-Cognitive Intelligence Types ────────────────────────────

// Fine-Tuning Engine types
export interface FineTuneModel {
  version: string;
  trainedAt: number;
  totalPatterns: number;
  totalTrainingPoints: number;
  styleRules: StyleRule[];
  accuracy: number;
}

export interface StyleRule {
  name: string;
  pattern: string;
  confidence: number;
  occurrences: number;
  category: string;
  enforced: boolean;
}

export interface CodeSuggestion {
  type: string;
  suggestion: string;
  confidence: number;
  basedOn: string;
  example?: string;
}

export interface FineTuneStats {
  totalPatterns: number;
  totalTrainingPoints: number;
  styleRules: number;
  modelAccuracy: number;
  categoryCounts: Record<string, number>;
  lastTrained: number | null;
  topPatterns: Array<{ pattern: string; category: string; frequency: number }>;
}

// Smart Cache types
export interface SmartCacheStats {
  hotEntries: number;
  warmEntries: number;
  coldEntries: number;
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  promotions: number;
  demotions: number;
  memoryUsageMB: number;
  prefetchHits: number;
  avgAccessTime: number;
}

// Intent Engine types
export type IntentAction =
  | 'adding-feature' | 'fixing-bug' | 'refactoring' | 'adding-tests'
  | 'updating-deps' | 'improving-perf' | 'adding-docs' | 'cleanup'
  | 'security-fix' | 'api-change' | 'ui-change' | 'config-change'
  | 'ci-cd' | 'database-migration' | 'unknown';

export interface DeveloperIntent {
  action: IntentAction;
  confidence: number;
  evidence: string[];
  prediction: string;
  suggestions: string[];
  relatedFiles: string[];
  estimatedScope: 'small' | 'medium' | 'large';
  timestamp: number;
}

export interface IntentStats {
  totalPredictions: number;
  confirmedCorrect: number;
  confirmedWrong: number;
  accuracy: number;
  topActions: Array<{ action: IntentAction; count: number }>;
  sessionCount: number;
  avgConfidence: number;
}

// Code DNA types
export type GeneCategory =
  | 'formatting' | 'naming' | 'structure' | 'complexity'
  | 'documentation' | 'error-handling' | 'testing' | 'imports'
  | 'typing' | 'async-patterns' | 'functional' | 'oop';

export interface CodeGene {
  name: string;
  category: GeneCategory;
  value: number;
  confidence: number;
  sampleSize: number;
}

export interface DNAProfile {
  id: string;
  name: string;
  genes: CodeGene[];
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DNAComparison {
  similarity: number;
  profileA: string;
  profileB: string;
  matchingGenes: string[];
  divergentGenes: Array<{ gene: string; valueA: number; valueB: number; delta: number }>;
}

export interface StyleConsistencyReport {
  overallScore: number;
  fileScores: Array<{ file: string; score: number; deviations: string[] }>;
  topDeviations: Array<{ gene: string; avgDeviation: number; worstFile: string }>;
  recommendations: string[];
}

export interface CodeDNAStats {
  profileCount: number;
  totalGenesTracked: number;
  avgGeneConfidence: number;
  categoryCoverage: Record<GeneCategory, number>;
  filesAnalyzed: number;
  lastProfileUpdate: number | null;
}

// Temporal Intelligence types
export interface TemporalEvent {
  id: string;
  timestamp: number;
  type: 'commit' | 'file-change' | 'bug-fix' | 'feature' | 'refactor' | 'incident' | 'deploy' | 'review';
  file?: string;
  description: string;
  impact: number;
  metadata?: Record<string, unknown>;
}

export interface VelocityMetrics {
  daily: number;
  weekly: number;
  monthly: number;
  trend: 'accelerating' | 'stable' | 'decelerating' | 'stalled';
  trendConfidence: number;
  peakHours: number[];
  peakDays: number[];
  avgCycleTime: number;
}

export interface TemporalAnomaly {
  timestamp: number;
  type: 'burst' | 'drought' | 'pattern-break' | 'unusual-hour' | 'regression';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  evidence: string[];
  recommendation: string;
}

export interface FileHeatmap {
  file: string;
  changeFrequency: number;
  lastChanged: number;
  avgTimeBetweenChanges: number;
  hotness: number;
  churnRisk: number;
  stabilityScore: number;
}

export interface BugPrediction {
  file: string;
  probability: number;
  factors: string[];
  lastBugFix: number | null;
  changesSinceLastFix: number;
  complexity: number;
}

export interface TemporalStats {
  totalEvents: number;
  timeSpan: { start: number; end: number; durationDays: number };
  velocity: VelocityMetrics;
  anomalyCount: number;
  hotFiles: number;
  bugPredictions: number;
  avgEventsPerDay: number;
}

// LSP Server types
export interface LSPDiagnosticRule {
  code: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  pattern: RegExp;
  message: string;
  category: string;
}

export interface LSPStats {
  documentsOpen: number;
  diagnosticsEmitted: number;
  hoversServed: number;
  completionsServed: number;
  codeActionsServed: number;
  uptime: number;
  lastActivity: number;
}

// v6.0.0 Orchestrator Status Extension
export interface V6ModuleStatus {
  fineTuning: FineTuneStats | null;
  smartCache: SmartCacheStats | null;
  intentEngine: IntentStats | null;
  codeDNA: CodeDNAStats | null;
  temporal: TemporalStats | null;
  lsp: LSPStats | null;
}
