// src/index.ts — Library entry point for @theihtisham/agent-shadow-brain v5.1.1

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
  CustomRule,
  ProjectConfig,
  CodeMetrics,
  PRDescription,
  CommitMessage,
  VulnResult,
  NotificationPayload,
  ProjectFileChange,
  // v2.0.0 types
  SymbolInfo,
  GraphNode,
  GraphEdge,
  DependencyGraphResult,
  HubInfo,
  CodeBlock,
  DuplicateGroup,
  ADRDecision,
  LearnedLesson,
  CodePattern,
  ProjectKnowledge,
  SharedPattern,
  TeamInsight,
  TeamStats,
  ProjectInfo,
  AggregatedHealth,
  MCPRequest,
  MCPResponse,
  MCPTool,
  MCPServerOptions,
  PerfInsight,
  // v2.1.0 Neural Mesh types
  MeshNode,
  MeshMessage,
  MeshKnowledge,
  MeshState,
  CrossSessionInsight,
  NeuralMeshConfig,
  // v3.0.0 Hyper-Intelligence types
  ASTFunctionInfo,
  ComplexityReport,
  A11yIssue,
  I18nIssue,
  DeadCodeResult,
  MutationSuggestion,
  CodeAgeResult,
  APIEndpoint,
  EnvIssue,
  LicenseIssue,
  ConfigDrift,
  // v4.0.0 Hyper-Intelligence types
  TurboVector,
  TurboEntry,
  TurboMemoryStore,
  InfiniteMemoryStats,
  SSSPEdge,
  SSSPGraph,
  SSSPResult,
  PivotSet,
  CAIPMessage,
  CAIPHandshake,
  CAIPChannel,
  AgentBoostPacket,
  CrossAgentBus,
  GeneticRule,
  EvolutionSnapshot,
  MetaLearningLog,
  SelfEvolutionConfig,
  BugRiskScore,
  TechDebtForecast,
  AnomalyEvent,
  MonteCarloResult,
  KGEntity,
  KGRelation,
  KGGraph,
  PageRankResult,
  PheromoneTrail,
  SwarmTask,
  AntColonyState,
  SwarmConfig,
  HallucinationFlag,
  EnsembleVote,
  AdversarialLog,
  ThreatVector,
  // v5.0.0 Infinite Intelligence types
  MemoryTier,
  HierarchicalMemoryEntry,
  HierarchicalMemoryStats,
  RecallTrigger,
  RecallResult,
  RecallContext,
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  TrustScore,
  CollectiveRule,
  CollectiveLearningStats,
  // v5.1.1 Hyper-Cognitive Intelligence types
  FineTuneModel,
  StyleRule,
  CodeSuggestion,
  FineTuneStats,
  SmartCacheStats,
  IntentAction,
  DeveloperIntent,
  IntentStats,
  GeneCategory,
  CodeGene,
  DNAProfile,
  DNAComparison,
  StyleConsistencyReport,
  CodeDNAStats,
  TemporalEvent,
  VelocityMetrics,
  TemporalAnomaly,
  FileHeatmap,
  BugPrediction,
  TemporalStats,
  LSPStats,
  V6ModuleStatus,
} from './types.js';

// Adapters
export { createAdapter, detectRunningAgents } from './adapters/index.js';
export { ClaudeCodeAdapter } from './adapters/claude-code.js';
export { KiloCodeAdapter } from './adapters/kilo-code.js';
export { ClineAdapter } from './adapters/cline.js';
export { OpenCodeAdapter } from './adapters/opencode.js';
export { CodexAdapter } from './adapters/codex.js';
export { RooCodeAdapter } from './adapters/roo-code.js';
export { AiderAdapter } from './adapters/aider.js';
export { BaseAdapter } from './adapters/base-adapter.js';

// Brain — Core
export { LLMClient, LLMError } from './brain/llm-client.js';
export { Analyzer, PromptBuilder } from './brain/analyzer.js';
export { ProjectContextBuilder } from './brain/project-context.js';
export { PatternMemory } from './brain/pattern-memory.js';
export { Orchestrator } from './brain/orchestrator.js';

// Brain — Health Score
export { HealthScoreEngine } from './brain/health-score.js';
export type { HealthScore, HealthDimension, HealthHistory } from './brain/health-score.js';

// Brain — Smart Fix Engine
export { SmartFixEngine } from './brain/smart-fix.js';
export type { FixSuggestion } from './brain/smart-fix.js';

// Brain — Report Generator
export { ReportGenerator } from './brain/report-generator.js';
export type { ReportOptions } from './brain/report-generator.js';

// Brain — Framework Presets
export { detectFramework, applyFrameworkRules } from './brain/framework-presets.js';

// Brain — v1.2.0 Modules
export { CustomRulesEngine } from './brain/custom-rules.js';
export { PRGenerator } from './brain/pr-generator.js';
export { Notifier } from './brain/notifier.js';
export type { NotifyConfig } from './brain/notifier.js';
export { CodeMetricsEngine } from './brain/code-metrics.js';
export { ProjectConfigLoader } from './brain/project-config.js';
export { VulnScanner } from './brain/vuln-scanner.js';
export { checkForUpdate, formatUpdateNotice } from './brain/auto-update.js';
export type { UpdateCheck } from './brain/auto-update.js';

// Brain — v2.0.0 Super-Intelligence Modules
export { SemanticAnalyzer } from './brain/semantic-analyzer.js';
export { DependencyGraphBuilder } from './brain/dependency-graph.js';
export { CodeSimilarityDetector } from './brain/code-similarity.js';
export { ADREngine } from './brain/adr-engine.js';
export { TypeSafetyAnalyzer } from './brain/type-safety.js';
export { PerformanceProfiler } from './brain/perf-profiler.js';
export { ContextCompletionEngine } from './brain/context-completion.js';
export { LearningEngine } from './brain/learning-engine.js';

// Brain — v2.0.0 Infrastructure Modules
export { MCPServer } from './brain/mcp-server.js';
export { TeamMode } from './brain/team-mode.js';
export { MultiProjectManager } from './brain/multi-project.js';

// Brain — v2.1.0 Quantum Neural Mesh
export { NeuralMesh } from './brain/neural-mesh.js';

// Brain — v3.0.0 Hyper-Intelligence Modules
export { ASTAnalyzer } from './brain/ast-analyzer.js';
export { AccessibilityChecker } from './brain/accessibility-checker.js';
export { I18nDetector } from './brain/i18n-detector.js';
export { DeadCodeEliminator } from './brain/dead-code-eliminator.js';
export { MutationAdvisor } from './brain/mutation-advisor.js';
export { CodeAgeAnalyzer } from './brain/code-age-analyzer.js';
export { APIContractAnalyzer } from './brain/api-contract-analyzer.js';
export { EnvAnalyzer } from './brain/env-analyzer.js';
export { LicenseCompliance } from './brain/license-compliance.js';
export { ConfigDriftDetector } from './brain/config-drift-detector.js';

// Brain — v4.0.0 Hyper-Intelligence Modules
export { TurboMemory } from './brain/turbo-memory.js';
export { SSSPRouter } from './brain/sssp-router.js';
export { CrossAgentProtocol } from './brain/cross-agent-protocol.js';
export { SelfEvolution } from './brain/self-evolution.js';
export { PredictiveEngine } from './brain/predictive-engine.js';
export { KnowledgeGraph } from './brain/knowledge-graph.js';
export { SwarmIntelligence } from './brain/swarm-intelligence.js';
export { AdversarialDefense } from './brain/adversarial-defense.js';

// Brain — v5.0.0 Infinite Intelligence Modules
export { HierarchicalMemory } from './brain/hierarchical-memory.js';
export { ContextRecall } from './brain/context-recall.js';
export { ConsensusEngine } from './brain/consensus-engine.js';
export { CollectiveLearning } from './brain/collective-learning.js';

// Brain — v5.0.1 Zero-Config & Portability Modules
export { AutoSetup } from './brain/auto-setup.js';
export { PluginSystem } from './brain/plugin-system.js';
export { BrainPortability } from './brain/brain-portability.js';

// Brain — v5.1.1 Hyper-Cognitive Intelligence Modules
export { FineTuningEngine } from './brain/fine-tuning-engine.js';
export { SmartCache } from './brain/smart-cache.js';
export type { CacheConfig, CacheEntry, PrefetchHint } from './brain/smart-cache.js';
export { IntentEngine } from './brain/intent-engine.js';
export { CodeDNA } from './brain/code-dna.js';
export { TemporalIntelligence } from './brain/temporal-intelligence.js';
export { LSPServer } from './brain/lsp-server.js';

// Dashboard
export { DashboardServer } from './dashboard/server.js';
export type { DashboardOptions } from './dashboard/server.js';

// Watchers
export { FileWatcher } from './watchers/file-watcher.js';
export { GitWatcher } from './watchers/git-watcher.js';
export type { GitState, GitCommit } from './watchers/git-watcher.js';
