// src/brain/orchestrator.ts — Central brain loop: watchers → analyzer → adapters
// v4.0.0 — Hyper-Intelligence Edition

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { LLMClient } from './llm-client.js';
import { ProjectContextBuilder } from './project-context.js';
import { Analyzer } from './analyzer.js';
import { PatternMemory } from './pattern-memory.js';
import { HealthScoreEngine, HealthScore } from './health-score.js';
import { SmartFixEngine, FixSuggestion } from './smart-fix.js';
import { detectFramework, applyFrameworkRules } from './framework-presets.js';
import { ReportGenerator } from './report-generator.js';
import { CustomRulesEngine } from './custom-rules.js';
import { PRGenerator } from './pr-generator.js';
import { Notifier, NotifyConfig } from './notifier.js';
import { CodeMetricsEngine } from './code-metrics.js';
import { ProjectConfigLoader } from './project-config.js';
import { VulnScanner } from './vuln-scanner.js';
import { checkForUpdate, formatUpdateNotice, UpdateCheck } from './auto-update.js';
import { SemanticAnalyzer } from './semantic-analyzer.js';
import { DependencyGraphBuilder } from './dependency-graph.js';
import { CodeSimilarityDetector } from './code-similarity.js';
import { ADREngine } from './adr-engine.js';
import { TypeSafetyAnalyzer } from './type-safety.js';
import { PerformanceProfiler } from './perf-profiler.js';
import { ContextCompletionEngine } from './context-completion.js';
import { LearningEngine } from './learning-engine.js';
import { MCPServer } from './mcp-server.js';
import { TeamMode } from './team-mode.js';
import { MultiProjectManager } from './multi-project.js';
import { NeuralMesh } from './neural-mesh.js';
// v3.0.0 Hyper-Intelligence Modules
import { ASTAnalyzer } from './ast-analyzer.js';
import { AccessibilityChecker } from './accessibility-checker.js';
import { I18nDetector } from './i18n-detector.js';
import { DeadCodeEliminator } from './dead-code-eliminator.js';
import { MutationAdvisor } from './mutation-advisor.js';
import { CodeAgeAnalyzer } from './code-age-analyzer.js';
import { APIContractAnalyzer } from './api-contract-analyzer.js';
import { EnvAnalyzer } from './env-analyzer.js';
import { LicenseCompliance } from './license-compliance.js';
import { ConfigDriftDetector } from './config-drift-detector.js';
import { FileWatcher } from '../watchers/file-watcher.js';
import { GitWatcher, GitState } from '../watchers/git-watcher.js';
import { createAdapter, detectRunningAgents } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base-adapter.js';
// v4.0.0 Hyper-Intelligence Modules
import { TurboMemory } from './turbo-memory.js';
import { SSSPRouter } from './sssp-router.js';
import { CrossAgentProtocol } from './cross-agent-protocol.js';
import { SelfEvolution } from './self-evolution.js';
import { PredictiveEngine } from './predictive-engine.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { SwarmIntelligence } from './swarm-intelligence.js';
import { AdversarialDefense } from './adversarial-defense.js';
// v5.0.0 Infinite Intelligence Modules
import { HierarchicalMemory } from './hierarchical-memory.js';
import { ContextRecall } from './context-recall.js';
import { ConsensusEngine } from './consensus-engine.js';
import { CollectiveLearning } from './collective-learning.js';
// v5.1.1 Hyper-Cognitive Intelligence Modules
import { FineTuningEngine } from './fine-tuning-engine.js';
import { SmartCache } from './smart-cache.js';
import { IntentEngine } from './intent-engine.js';
import { CodeDNA } from './code-dna.js';
import { TemporalIntelligence } from './temporal-intelligence.js';
import { LSPServer } from './lsp-server.js';
import {
  BrainConfig, BrainInsight, BrainSession, AgentTool, FileChange, AgentAdapter,
  CodeMetrics, VulnResult, CustomRule, ProjectConfig, PRDescription, CommitMessage,
  SymbolInfo, DependencyGraphResult, DuplicateGroup, ADRDecision, PerfInsight,
  ProjectKnowledge, SharedPattern, TeamInsight, TeamStats, ProjectInfo,
  AggregatedHealth, MCPServerOptions, CrossSessionInsight, MeshState, MeshNode, MeshMessage,
  ASTFunctionInfo, ComplexityReport, A11yIssue, I18nIssue, DeadCodeResult,
  MutationSuggestion, CodeAgeResult, APIEndpoint, EnvIssue, LicenseIssue, ConfigDrift,
  // v4.0.0 types
  InfiniteMemoryStats, SSSPResult, CrossAgentBus, EvolutionSnapshot,
  BugRiskScore, TechDebtForecast, AnomalyEvent, PageRankResult, AntColonyState,
  HallucinationFlag, AdversarialLog,
  // v5.1.1 types
  V6ModuleStatus,
} from '../types.js';

export class Orchestrator extends EventEmitter {
  private config: BrainConfig;
  private llmClient: LLMClient;
  private contextBuilder: ProjectContextBuilder;
  private analyzer: Analyzer;
  private fileWatcher: FileWatcher;
  private gitWatcher: GitWatcher;
  private adapters: BaseAdapter[] = [];
  private patternMemory: PatternMemory;
  private healthEngine: HealthScoreEngine;
  private fixEngine: SmartFixEngine;
  private reportGen: ReportGenerator;
  private customRulesEngine: CustomRulesEngine;
  private prGenerator: PRGenerator;
  private notifier: Notifier | null = null;
  private metricsEngine: CodeMetricsEngine;
  private projectConfigLoader: ProjectConfigLoader;
  private vulnScanner: VulnScanner;
  // v2.0.0 Super-Intelligence Modules
  private semanticAnalyzer: SemanticAnalyzer;
  private depGraphBuilder: DependencyGraphBuilder;
  private codeSimilarity: CodeSimilarityDetector;
  private adrEngine: ADREngine;
  private typeSafety: TypeSafetyAnalyzer;
  private perfProfiler: PerformanceProfiler;
  private contextCompletion: ContextCompletionEngine;
  private learningEngine: LearningEngine;
  private mcpServer: MCPServer | null = null;
  private teamMode: TeamMode | null = null;
  private multiProject: MultiProjectManager | null = null;
  // v2.1.0 Quantum Neural Mesh
  private neuralMesh: NeuralMesh | null = null;
  // v3.0.0 Hyper-Intelligence Modules
  private astAnalyzer: ASTAnalyzer;
  private a11yChecker: AccessibilityChecker;
  private i18nDetector: I18nDetector;
  private deadCodeEliminator: DeadCodeEliminator;
  private mutationAdvisor: MutationAdvisor;
  private codeAgeAnalyzer: CodeAgeAnalyzer;
  private apiContractAnalyzer: APIContractAnalyzer;
  private envAnalyzer: EnvAnalyzer;
  private licenseCompliance: LicenseCompliance;
  private configDriftDetector: ConfigDriftDetector;

  // v4.0.0 Hyper-Intelligence Modules
  private turboMemory: TurboMemory;
  private ssspRouter: SSSPRouter;
  private crossAgentProtocol: CrossAgentProtocol;
  private selfEvolution: SelfEvolution;
  private predictiveEngine: PredictiveEngine;
  private knowledgeGraph: KnowledgeGraph | null = null;
  private swarmIntelligence: SwarmIntelligence;
  private adversarialDefense: AdversarialDefense;

  // v5.0.0 Infinite Intelligence Modules
  private hierarchicalMemory: HierarchicalMemory;
  private contextRecall: ContextRecall;
  private consensusEngine: ConsensusEngine;
  private collectiveLearning: CollectiveLearning;

  // v5.1.1 Hyper-Cognitive Intelligence Modules
  private fineTuningEngine: FineTuningEngine;
  private smartCache: SmartCache;
  private intentEngine: IntentEngine;
  private codeDNA: CodeDNA;
  private temporalIntelligence: TemporalIntelligence;
  private lspServer: LSPServer | null = null;

  private running = false;
  private analyzing = false;
  private pendingChanges: FileChange[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;
  private currentSession: BrainSession | null = null;
  private startTime = 0;
  private lastHealthScore: HealthScore | null = null;
  private lastFixes: FixSuggestion[] = [];
  private lastMetrics: CodeMetrics | null = null;
  private lastVulns: VulnResult[] = [];
  private updateCheck: UpdateCheck | null = null;
  private lastSymbols: Map<string, SymbolInfo[]> | null = null;
  private lastDepGraph: DependencyGraphResult | null = null;
  private lastDuplicates: DuplicateGroup[] = [];
  private lastADRs: ADRDecision[] = [];
  private lastPerfInsights: PerfInsight[] = [];
  private lastKnowledge: ProjectKnowledge | null = null;

  constructor(config: BrainConfig) {
    super();
    this.config = config;
    this.llmClient = new LLMClient({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
    });
    this.contextBuilder = new ProjectContextBuilder(config.projectDir);
    this.analyzer = new Analyzer(this.llmClient, config.brainPersonality, config.reviewDepth);
    this.patternMemory = new PatternMemory();
    this.healthEngine = new HealthScoreEngine();
    this.fixEngine = new SmartFixEngine(this.llmClient);
    this.reportGen = new ReportGenerator();
    this.customRulesEngine = new CustomRulesEngine(config.projectDir);
    this.prGenerator = new PRGenerator(this.llmClient);
    this.metricsEngine = new CodeMetricsEngine(config.projectDir);
    this.projectConfigLoader = new ProjectConfigLoader(config.projectDir);
    this.vulnScanner = new VulnScanner(config.projectDir);
    this.fileWatcher = new FileWatcher(config.projectDir);
    this.gitWatcher = new GitWatcher(config.projectDir);

    // v2.0.0 Super-Intelligence Modules
    this.semanticAnalyzer = new SemanticAnalyzer(config.projectDir);
    this.depGraphBuilder = new DependencyGraphBuilder(config.projectDir);
    this.codeSimilarity = new CodeSimilarityDetector(config.projectDir);
    this.adrEngine = new ADREngine(config.projectDir, this.llmClient);
    this.typeSafety = new TypeSafetyAnalyzer(config.projectDir);
    this.perfProfiler = new PerformanceProfiler(config.projectDir);
    this.contextCompletion = new ContextCompletionEngine(config.projectDir);
    this.learningEngine = new LearningEngine(config.projectDir, this.llmClient);

    // v3.0.0 Hyper-Intelligence Modules
    this.astAnalyzer = new ASTAnalyzer(config.projectDir);
    this.a11yChecker = new AccessibilityChecker(config.projectDir);
    this.i18nDetector = new I18nDetector(config.projectDir);
    this.deadCodeEliminator = new DeadCodeEliminator(config.projectDir);
    this.mutationAdvisor = new MutationAdvisor(config.projectDir);
    this.codeAgeAnalyzer = new CodeAgeAnalyzer(config.projectDir);
    this.apiContractAnalyzer = new APIContractAnalyzer(config.projectDir);
    this.envAnalyzer = new EnvAnalyzer(config.projectDir);
    this.licenseCompliance = new LicenseCompliance(config.projectDir);
    this.configDriftDetector = new ConfigDriftDetector(config.projectDir);

    // v4.0.0 Hyper-Intelligence Modules
    this.turboMemory = new TurboMemory();
    this.ssspRouter = new SSSPRouter();
    this.crossAgentProtocol = new CrossAgentProtocol();
    this.selfEvolution = new SelfEvolution();
    this.predictiveEngine = new PredictiveEngine();
    this.knowledgeGraph = new KnowledgeGraph(config.projectDir);
    this.swarmIntelligence = new SwarmIntelligence();
    this.adversarialDefense = new AdversarialDefense();

    // v5.0.0 Infinite Intelligence Modules
    this.hierarchicalMemory = new HierarchicalMemory();
    this.contextRecall = new ContextRecall(this.hierarchicalMemory);
    this.consensusEngine = new ConsensusEngine();
    this.collectiveLearning = new CollectiveLearning(config.projectDir);

    // v5.1.1 Hyper-Cognitive Intelligence Modules
    this.fineTuningEngine = new FineTuningEngine(config.projectDir);
    this.smartCache = new SmartCache();
    this.intentEngine = new IntentEngine();
    this.codeDNA = new CodeDNA(config.projectDir);
    this.temporalIntelligence = new TemporalIntelligence(config.projectDir);

    // Load project config and setup notifier if configured
    const projectConfig = this.projectConfigLoader.load();
    if (projectConfig.notifications) {
      const nc = projectConfig.notifications;
      this.notifier = new Notifier({
        webhook: nc.webhook,
        slack: nc.slack,
        discord: nc.discord,
        minInterval: nc.minInterval,
      });
    }

    // Check for updates asynchronously
    checkForUpdate().then(check => {
      this.updateCheck = check;
      if (check.hasUpdate) {
        this.emit('info', formatUpdateNotice(check));
      }
    }).catch(() => { /* ignore */ });
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Load pattern memory + health history
    await this.patternMemory.load();
    await this.healthEngine.load();

    this.startTime = Date.now();
    this.currentSession = {
      id: crypto.randomUUID(),
      startedAt: new Date(),
      agent: this.config.agents[0] || 'claude-code',
      projectDir: this.config.projectDir,
      insights: [],
      filesReviewed: 0,
      suggestionsInjected: 0,
    };

    // Detect running agents
    try {
      const detected = await detectRunningAgents(this.config.projectDir);
      this.adapters = detected.filter(a => this.config.agents.includes(a.name)) as BaseAdapter[];

      // Also create adapters for configured agents that weren't auto-detected
      for (const tool of this.config.agents) {
        if (!this.adapters.some(a => a.name === tool)) {
          try {
            const adapter = createAdapter(tool) as BaseAdapter;
            adapter.setProjectDir(this.config.projectDir);
            this.adapters.push(adapter);
          } catch { /* skip unknown */ }
        }
      }
    } catch {
      // Fall back to creating adapters for all configured agents
      this.adapters = this.config.agents.map(tool => {
        const adapter = createAdapter(tool) as BaseAdapter;
        adapter.setProjectDir(this.config.projectDir);
        return adapter;
      });
    }

    this.emit('agents-detected', { adapters: this.adapters });

    // v4.0.0: Start Cross-Agent Protocol
    await this.crossAgentProtocol.start().catch(() => {});

    // v4.0.0: Initialize swarm with project files
    try {
      const projectContext = await this.contextBuilder.build([]);
      const projectFiles = (projectContext as any).recentFiles || (projectContext as any).structure || [];
      if (projectFiles.length > 0) {
        const paths = projectFiles.slice(0, 200).map((f: any) => typeof f === 'string' ? f : f.path || f.name || '');
        this.swarmIntelligence.initialize(paths.filter(Boolean));
      }
    } catch { /* swarm init is best-effort */ }

    // v4.0.0: Periodic self-evolution (every 30 minutes)
    this.evolutionTimer = setInterval(async () => {
      try {
        await this.selfEvolution.evolve(this.currentSession?.insights || []);
        if (this.knowledgeGraph) {
          await this.knowledgeGraph.build().catch(() => {});
        }
      } catch { /* evolution runs silently */ }
    }, 30 * 60 * 1000);

    if (this.config.watchMode) {
      this.setupWatchers();
      this.running = true;
      this.emit('started');
    } else {
      await this.reviewOnce();
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try { this.fileWatcher.stop(); } catch { /* ignore */ }
    try { this.gitWatcher.stop(); } catch { /* ignore */ }
    await this.patternMemory.save();
    await this.healthEngine.save();
    if (this.neuralMesh) { await this.neuralMesh.disconnect().catch(() => {}); }

    // v4.0.0: Cross-Agent Protocol shutdown + evolution timer cleanup
    await this.crossAgentProtocol.stop().catch(() => {});
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
      this.evolutionTimer = null;
    }

    this.emit('stopped');
  }

  async reviewOnce(): Promise<BrainInsight[]> {
    const context = await this.contextBuilder.build([]);
    const activities: import('../types.js').AgentActivity[] = [];

    for (const adapter of this.adapters) {
      try {
        const act = await adapter.readActivity();
        activities.push(...act);
      } catch { /* skip */ }
    }

    // Get git changes as FileChange[]
    const changes = await this.getGitChanges();

    const agentMemory = this.adapters.length > 0
      ? await this.adapters[0].readMemory().catch(() => undefined)
      : undefined;

    let insights = await this.analyzer.analyze({
      changes,
      context,
      activity: activities,
      agentMemory,
    });

    // v4.0.0: Adversarial defense — verify critical/high insights
    const verifiedInsights: BrainInsight[] = [];
    for (const insight of insights) {
      if (insight.priority === 'critical' || insight.priority === 'high') {
        try {
          const flag = await this.adversarialDefense.verifyInsight(insight, this.config.projectDir);
          if (!flag || flag.verdict === 'real') {
            verifiedInsights.push(insight);
          } else {
            (insight as any).adversarialFlag = flag;
          }
        } catch {
          verifiedInsights.push(insight); // trust on error
        }
      } else {
        verifiedInsights.push(insight);
      }
    }
    insights = verifiedInsights;

    // ── Apply framework-specific rules ─────────────────────────────────
    const framework = detectFramework(
      context.structure || [],
      {},
      context.language || [],
    );
    if (framework !== 'unknown') {
      const allContent = changes.map(c => c.content || c.diff || '').join('\n');
      const frameworkResults = applyFrameworkRules(framework, context.structure || [], allContent);
      for (const r of frameworkResults) {
        insights.push({
          type: (r.type as BrainInsight['type']) || 'warning',
          priority: (r.priority as BrainInsight['priority']) || 'medium',
          title: `[${framework}] ${r.message}`,
          content: r.fix || r.message,
          files: [],
          timestamp: new Date(),
        });
      }
    }

    // Add metadata
    for (const insight of insights) {
      insight.timestamp = new Date();
    }

    // ── Apply custom rules ────────────────────────────────────────────
    this.customRulesEngine.load();
    const customInsights = this.customRulesEngine.applyRules(changes);
    if (customInsights.length > 0) {
      insights.push(...customInsights);
    }

    // ── Health Score ──────────────────────────────────────────────────
    const healthScore = this.healthEngine.compute(insights, changes, context);
    this.lastHealthScore = healthScore;
    this.emit('health-score', { score: healthScore });

    // ── Smart Fix Engine ──────────────────────────────────────────────
    const fixes = this.fixEngine.generateFixes(changes, insights);
    this.lastFixes = fixes;
    if (fixes.length > 0) {
      this.emit('fixes', { fixes });
    }

    // ── Notify on critical insights ───────────────────────────────────
    if (this.notifier) {
      const criticals = insights.filter(i => i.priority === 'critical');
      if (criticals.length > 0) {
        this.notifier.send({
          type: 'critical-insight',
          title: `${criticals.length} critical issue(s) found`,
          message: criticals.map(i => i.title).join('\n'),
          timestamp: new Date(),
        }).catch(() => { /* ignore notify failures */ });
      }
    }

    // Inject if auto-inject is enabled
    if (this.config.autoInject) {
      await this.injectInsights(insights);
    }

    if (this.currentSession) {
      this.currentSession.insights.push(...insights);
      this.currentSession.filesReviewed += changes.length;
    }

    this.emit('insights', { insights });

    // ── v2.1.0: Neural Mesh Broadcasting (one-shot) ──────────────────
    if (this.neuralMesh && this.neuralMesh.isRunning()) {
      for (const insight of insights.filter(i => i.priority === 'critical' || i.priority === 'high')) {
        this.neuralMesh.broadcastInsight(insight);
      }
      if (healthScore.overall !== undefined) {
        this.neuralMesh.broadcastHealth(healthScore.overall);
      }
    }

    // v4.0.0: Cross-agent broadcast
    await this.crossAgentProtocol.broadcast('claude-code' as any, {
      type: 'insights',
      insights: insights.slice(0, 5),
      healthScore: healthScore.overall,
    }).catch(() => {});

    // v5.0.0: Store in hierarchical memory + collective learning
    try {
      for (const insight of insights.filter(i => i.priority === 'critical' || i.priority === 'high')) {
        await this.hierarchicalMemory.store(
          `${insight.title}\n${insight.content || ''}`,
          insight.type || 'general',
          insight.priority === 'critical' ? 0.95 : 0.8,
          { type: insight.type, files: insight.files || [] },
        );
      }
    } catch { /* hierarchical memory is best-effort */ }

    try {
      for (const insight of insights.filter(i => i.priority === 'critical').slice(0, 3)) {
        this.collectiveLearning.proposeRule(
          `${insight.type}: ${insight.title}`,
          insight.type || 'general',
          'shadow-brain',
          insight.files || [],
        );
      }
    } catch { /* collective learning is best-effort */ }

    return insights;
  }

  /** Generate a full report (HTML/markdown/JSON) */
  async generateReport(format: 'html' | 'markdown' | 'json' = 'html'): Promise<string> {
    const context = await this.contextBuilder.build([]);
    const changes = await this.getGitChanges();
    const insights = this.currentSession?.insights || [];
    const fixes = this.lastFixes;
    const healthScore = this.lastHealthScore || this.healthEngine.compute(insights, changes, context);

    return this.reportGen.generate(insights, changes, context, healthScore, fixes, { format });
  }

  /** Generate GitHub Actions workflow YAML */
  async generateCIWorkflow(): Promise<string> {
    const context = await this.contextBuilder.build([]);
    return this.reportGen.generate([], [], context, undefined, undefined, { format: 'github-actions' });
  }

  /** Generate pre-commit hook script */
  generatePreCommitHook(): string {
    return this.reportGen.generatePreCommitHook();
  }

  /** Get smart fix suggestions for current changes */
  async getSmartFixes(): Promise<FixSuggestion[]> {
    const context = await this.contextBuilder.build([]);
    const changes = await this.getGitChanges();
    const insights = this.currentSession?.insights || [];
    return this.fixEngine.generateFixes(changes, insights);
  }

  /** Get current health score */
  async getHealthScore(): Promise<HealthScore> {
    const context = await this.contextBuilder.build([]);
    const changes = await this.getGitChanges();
    const insights = this.currentSession?.insights || [];
    const score = this.healthEngine.compute(insights, changes, context);
    this.lastHealthScore = score;
    return score;
  }

  /** Format fix suggestions for terminal display */
  formatFixes(fixes: FixSuggestion[]): string {
    return this.fixEngine.formatFixes(fixes);
  }

  /** Format health score for terminal display */
  formatHealthScore(score: HealthScore): string {
    return this.healthEngine.formatConsole(score);
  }

  getLastHealthScore(): HealthScore | null { return this.lastHealthScore; }
  getLastFixes(): FixSuggestion[] { return this.lastFixes; }
  getLastMetrics(): CodeMetrics | null { return this.lastMetrics; }
  getLastVulns(): VulnResult[] { return this.lastVulns; }
  getUpdateCheck(): UpdateCheck | null { return this.updateCheck; }

  getSession(): BrainSession | null {
    return this.currentSession;
  }

  // ── v1.2.0: Custom Rules ────────────────────────────────────────────
  getCustomRules(): CustomRule[] {
    return this.customRulesEngine.getRules();
  }

  addCustomRule(rule: CustomRule): void {
    this.customRulesEngine.addRule(rule);
    this.customRulesEngine.save();
  }

  removeCustomRule(id: string): void {
    this.customRulesEngine.removeRule(id);
    this.customRulesEngine.save();
  }

  // ── v1.2.0: PR Generator ────────────────────────────────────────────
  async generatePRDescription(changes: FileChange[], branch?: string): Promise<PRDescription> {
    return this.prGenerator.generatePRDescription(changes, branch);
  }

  async generateCommitMessage(changes: FileChange[]): Promise<CommitMessage> {
    return this.prGenerator.generateCommitMessage(changes);
  }

  // ── v1.2.0: Vulnerability Scanner ────────────────────────────────────
  async runVulnScan(): Promise<VulnResult[]> {
    this.lastVulns = await this.vulnScanner.scan();
    return this.lastVulns;
  }

  formatVulns(vulns: VulnResult[], format: 'text' | 'json' | 'markdown' = 'text'): string {
    switch (format) {
      case 'json': return this.vulnScanner.formatJSON(vulns);
      case 'markdown': return this.vulnScanner.toMarkdown(vulns);
      default: return this.vulnScanner.formatConsole(vulns);
    }
  }

  // ── v1.2.0: Code Metrics ────────────────────────────────────────────
  async computeMetrics(): Promise<CodeMetrics> {
    const projectConfig = this.projectConfigLoader.load();
    this.lastMetrics = this.metricsEngine.compute();
    return this.lastMetrics;
  }

  formatMetrics(metrics: CodeMetrics, format: 'text' | 'json' | 'markdown' = 'text'): string {
    switch (format) {
      case 'json': return this.metricsEngine.formatJSON(metrics);
      case 'markdown': return this.metricsEngine.toMarkdown(metrics);
      default: return this.metricsEngine.formatConsole(metrics);
    }
  }

  // ── v1.2.0: Notifications ────────────────────────────────────────────
  async sendNotification(type: import('../types.js').NotificationPayload['type'], title: string, message: string): Promise<{ sent: boolean; channels: string[] }> {
    if (!this.notifier) return { sent: false, channels: [] };
    return this.notifier.send({ type, title, message, timestamp: new Date() });
  }

  async testNotifications(): Promise<{ channel: string; success: boolean; error?: string }[]> {
    if (!this.notifier) return [];
    return this.notifier.test();
  }

  // ── v1.2.0: Project Config ───────────────────────────────────────────
  getProjectConfig(): ProjectConfig {
    return this.projectConfigLoader.get();
  }

  saveProjectConfig(config: ProjectConfig): void {
    this.projectConfigLoader.save(config);
  }

  // ── v2.0.0: Super-Intelligence Methods ────────────────────────────────

  /** Semantic analysis — extract symbols, find unused exports, dead code */
  async getSemanticInsights(maxFiles?: number): Promise<{
    symbols: Map<string, SymbolInfo[]>;
    unusedExports: SymbolInfo[];
    deadCode: SymbolInfo[];
  }> {
    const result = await this.semanticAnalyzer.analyzeProject();
    this.lastSymbols = result.symbols;
    return result;
  }

  /** Dependency graph — imports, cycles, orphans, hubs */
  async getDependencyGraph(): Promise<DependencyGraphResult> {
    const result = await this.depGraphBuilder.build();
    this.lastDepGraph = result;
    return result;
  }

  /** Get dependency analysis details */
  getDependencyDetails(result: DependencyGraphResult): {
    orphans: string[];
    cycles: string[][];
    hubs: Array<{ file: string; dependents: number; risk: string }>;
  } {
    const details = this.depGraphBuilder.getDependencyDetails(result);
    return {
      orphans: details.orphans,
      cycles: details.cycles,
      hubs: details.hubs,
    };
  }

  /** Detect duplicate/near-duplicate code blocks */
  async detectDuplicates(minSimilarity?: number): Promise<DuplicateGroup[]> {
    this.lastDuplicates = await this.codeSimilarity.detectDuplicates(minSimilarity);
    return this.lastDuplicates;
  }

  /** Get Architecture Decision Records */
  async getADRs(): Promise<ADRDecision[]> {
    this.lastADRs = await this.adrEngine.loadADRs();
    return this.lastADRs;
  }

  /** Save a new ADR */
  async saveADR(adr: ADRDecision): Promise<void> {
    await this.adrEngine.saveADR(adr);
  }

  /** Detect architectural decisions from file changes */
  async detectADRs(changes: Array<{ path: string; diff?: string }>): Promise<ADRDecision[]> {
    return this.adrEngine.detectDecisions(changes);
  }

  /** Type safety analysis for TypeScript projects */
  async analyzeTypeSafety(maxFiles?: number): Promise<BrainInsight[]> {
    return this.typeSafety.analyzeProject(maxFiles);
  }

  /** Performance profiling across project */
  async profilePerformance(maxFiles?: number): Promise<PerfInsight[]> {
    this.lastPerfInsights = await this.perfProfiler.analyzeProject(maxFiles);
    return this.lastPerfInsights;
  }

  /** Build and persist project knowledge */
  async buildKnowledge(): Promise<ProjectKnowledge> {
    const knowledge = await this.contextCompletion.buildKnowledge();
    this.lastKnowledge = knowledge;
    await this.contextCompletion.saveKnowledge(knowledge);
    return knowledge;
  }

  /** Get context gaps — missing documentation, configs, etc. */
  async getContextGaps(): Promise<BrainInsight[]> {
    const knowledge = await this.contextCompletion.buildKnowledge();
    return this.contextCompletion.getContextGaps(knowledge);
  }

  /** Run the learning engine to extract patterns and lessons */
  async runLearningCycle(): Promise<void> {
    await this.learningEngine.learnFromProject();
  }

  /** Get learned lessons */
  async getLearnedLessons(): Promise<Array<{ category: string; pattern: string; lesson: string; confidence: number }>> {
    return this.learningEngine.getLessons();
  }

  // ── v2.0.0: MCP Server ──────────────────────────────────────────────

  /** Start the MCP server for tool integration */
  async startMCPServer(options?: MCPServerOptions): Promise<void> {
    this.mcpServer = new MCPServer(this, options);
    await this.mcpServer.start();
    this.emit('info', `MCP server started on port ${options?.port || 7342}`);
  }

  /** Stop the MCP server */
  async stopMCPServer(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.stop();
      this.mcpServer = null;
    }
  }

  // ── v2.0.0: Team Mode ───────────────────────────────────────────────

  /** Enable team mode with shared insights */
  enableTeamMode(userName?: string): void {
    this.teamMode = new TeamMode(this.config.projectDir, userName);
  }

  /** Share an insight with the team */
  async shareTeamInsight(insight: BrainInsight): Promise<TeamInsight | null> {
    if (!this.teamMode) return null;
    return this.teamMode.shareInsight(insight);
  }

  /** Get team insights */
  async getTeamInsights(limit?: number): Promise<TeamInsight[]> {
    if (!this.teamMode) return [];
    return this.teamMode.getTeamInsights(limit);
  }

  /** Get team stats */
  async getTeamStats(): Promise<TeamStats | null> {
    if (!this.teamMode) return null;
    return this.teamMode.getStats();
  }

  // ── v2.0.0: Multi-Project ──────────────────────────────────────────

  /** Get the multi-project manager */
  getMultiProjectManager(): MultiProjectManager {
    if (!this.multiProject) {
      this.multiProject = new MultiProjectManager();
    }
    return this.multiProject;
  }

  /** Get aggregated health across all registered projects */
  async getAggregatedHealth(): Promise<AggregatedHealth> {
    const mgr = this.getMultiProjectManager();
    return mgr.getAggregatedHealth();
  }

  /** Scan a parent directory for all git repos */
  async scanForProjects(parentDir: string): Promise<string[]> {
    const mgr = this.getMultiProjectManager();
    return mgr.scanDirectory(parentDir);
  }

  // ── v2.1.0: Quantum Neural Mesh ─────────────────────────────────────

  /** Enable the neural mesh for cross-session intelligence sharing */
  async enableNeuralMesh(): Promise<NeuralMesh> {
    if (this.neuralMesh) return this.neuralMesh;

    this.neuralMesh = new NeuralMesh(
      this.config.projectDir,
      this.config.brainPersonality,
    );

    // Wire mesh events into orchestrator
    this.neuralMesh.on('node-discovered', (node: MeshNode) => {
      this.emit('info', `[Mesh] Node discovered: ${node.projectName} (${node.personality})`);
    });

    this.neuralMesh.on('broadcast', (msg: MeshMessage) => {
      this.emit('info', `[Mesh] ${msg.type} from ${msg.fromNode.slice(0, 8)}`);
    });

    await this.neuralMesh.connect();
    this.emit('info', `[Mesh] Connected as node ${this.neuralMesh.getNodeId().slice(0, 8)}`);
    return this.neuralMesh;
  }

  /** Disable the neural mesh */
  async disableNeuralMesh(): Promise<void> {
    if (this.neuralMesh) {
      await this.neuralMesh.disconnect();
      this.neuralMesh = null;
    }
  }

  /** Get the neural mesh instance (null if not enabled) */
  getNeuralMesh(): NeuralMesh | null {
    return this.neuralMesh;
  }

  /** Get cross-session insights from other Shadow Brain instances */
  getCrossSessionInsights(limit?: number): CrossSessionInsight[] {
    if (!this.neuralMesh) return [];
    return this.neuralMesh.getCrossSessionInsights(limit);
  }

  /** Get the current mesh state */
  getMeshState(): MeshState | null {
    if (!this.neuralMesh) return null;
    return this.neuralMesh.getMeshState();
  }

  /** Get shared knowledge from all connected nodes */
  getSharedKnowledge(limit?: number): import('../types.js').MeshKnowledge[] {
    if (!this.neuralMesh) return [];
    return this.neuralMesh.getSharedKnowledge(limit);
  }

  /** Get aggregated insights across all mesh projects */
  getAggregatedInsights(): ReturnType<NeuralMesh['getAggregatedInsights']> | null {
    if (!this.neuralMesh) return null;
    return this.neuralMesh.getAggregatedInsights();
  }

  /** Get all connected mesh nodes */
  getConnectedNodes(): import('../types.js').MeshNode[] {
    if (!this.neuralMesh) return [];
    return this.neuralMesh.getConnectedNodes();
  }

  // ── v3.0.0: Hyper-Intelligence Methods ────────────────────────────────

  /** AST-level complexity analysis — functions, cyclomatic complexity, nesting */
  async runASTAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.astAnalyzer.analyzeProject(maxFiles);
  }

  /** WCAG accessibility audit for frontend code */
  async runA11yCheck(maxFiles?: number): Promise<BrainInsight[]> {
    return this.a11yChecker.analyzeProject(maxFiles);
  }

  /** Internationalization readiness detection */
  async runI18nAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.i18nDetector.analyzeProject(maxFiles);
  }

  /** Dead code elimination — unreachable code, unused exports */
  async runDeadCodeAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.deadCodeEliminator.analyzeProject(maxFiles);
  }

  /** Mutation testing advisor — suggests test-killing mutations */
  async runMutationAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.mutationAdvisor.analyzeProject(maxFiles);
  }

  /** Code age analysis — stale files, ownership, freshness */
  async runCodeAgeAnalysis(): Promise<BrainInsight[]> {
    return this.codeAgeAnalyzer.analyzeProject();
  }

  /** API contract analysis — endpoint discovery and security audit */
  async runAPIContractAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.apiContractAnalyzer.analyzeProject(maxFiles);
  }

  /** Environment variable analysis — secrets, validation, naming */
  async runEnvAnalysis(maxFiles?: number): Promise<BrainInsight[]> {
    return this.envAnalyzer.analyzeProject(maxFiles);
  }

  /** License compliance audit — restricted, copyleft, unknown licenses */
  async runLicenseCompliance(): Promise<BrainInsight[]> {
    return this.licenseCompliance.analyzeProject();
  }

  /** Configuration drift detection — missing configs, tsconfig, gitignore */
  async runConfigDriftDetection(): Promise<BrainInsight[]> {
    return this.configDriftDetector.analyzeProject();
  }

  /** Run ALL v3.0.0 + v4.0.0 hyper-intelligence analyses at once */
  async runFullHyperAnalysis(opts?: { maxFiles?: number }): Promise<{
    ast: BrainInsight[];
    a11y: BrainInsight[];
    i18n: BrainInsight[];
    deadCode: BrainInsight[];
    mutation: BrainInsight[];
    codeAge: BrainInsight[];
    apiContract: BrainInsight[];
    env: BrainInsight[];
    license: BrainInsight[];
    configDrift: BrainInsight[];
    // v4.0.0 results
    turboMemoryStats: InfiniteMemoryStats | null;
    swarmState: AntColonyState | null;
    defenseStats: AdversarialLog | null;
    evolutionSnapshot: EvolutionSnapshot | null;
    knowledgeGraphEntityCount: number;
    // v5.0.0 results
    hierarchicalMemoryStats: import('../types.js').HierarchicalMemoryStats | null;
    contextRecallStats: any;
    consensusStats: any;
    collectiveLearningStats: import('../types.js').CollectiveLearningStats | null;
    total: number;
  }> {
    const maxFiles = opts?.maxFiles ?? 200;
    const [ast, a11y, i18n, deadCode, mutation, codeAge, apiContract, env, license, configDrift] =
      await Promise.all([
        this.runASTAnalysis(maxFiles).catch(() => []),
        this.runA11yCheck(maxFiles).catch(() => []),
        this.runI18nAnalysis(maxFiles).catch(() => []),
        this.runDeadCodeAnalysis(maxFiles).catch(() => []),
        this.runMutationAnalysis(maxFiles).catch(() => []),
        this.runCodeAgeAnalysis().catch(() => []),
        this.runAPIContractAnalysis(maxFiles).catch(() => []),
        this.runEnvAnalysis(maxFiles).catch(() => []),
        this.runLicenseCompliance().catch(() => []),
        this.runConfigDriftDetection().catch(() => []),
      ]);

    // v4.0.0 analyses
    const turboMemoryStats = this.turboMemory?.stats() ?? null;
    const swarmState = this.swarmIntelligence?.getState?.() ?? null;
    const defenseStats = this.adversarialDefense?.getDefenseStats?.() ?? null;
    const evolutionSnapshot = this.selfEvolution?.getSnapshot?.() ?? null;
    let knowledgeGraphEntityCount = 0;
    try {
      if (this.knowledgeGraph) {
        await this.knowledgeGraph.build();
        const kgStats = this.knowledgeGraph.getStats?.();
        knowledgeGraphEntityCount = kgStats?.entities ?? 0;
      }
    } catch { /* best-effort */ }

    // v5.0.0 Infinite Intelligence analyses
    const hierarchicalMemoryStats = this.hierarchicalMemory?.stats?.() ?? null;
    const contextRecallStats = this.contextRecall?.getStats?.() ?? null;
    const consensusStats = this.consensusEngine?.getStats?.() ?? null;
    const collectiveLearningStats = this.collectiveLearning?.getStats?.() ?? null;

    return {
      ast, a11y, i18n, deadCode, mutation, codeAge, apiContract, env, license, configDrift,
      turboMemoryStats, swarmState, defenseStats, evolutionSnapshot, knowledgeGraphEntityCount,
      hierarchicalMemoryStats, contextRecallStats, consensusStats, collectiveLearningStats,
      total: ast.length + a11y.length + i18n.length + deadCode.length + mutation.length +
             codeAge.length + apiContract.length + env.length + license.length + configDrift.length,
    };
  }

  getStatus() {
    return {
      running: this.running,
      version: '5.1.1',
      agents: this.adapters.map(a => `${a.displayName} (${a.name})`),
      insightsGenerated: this.currentSession?.insights.length || 0,
      filesReviewed: this.currentSession?.filesReviewed || 0,
      suggestionsInjected: this.currentSession?.suggestionsInjected || 0,
      uptime: this.running ? Date.now() - this.startTime : 0,
      personality: this.config.brainPersonality,
      provider: this.config.provider,
      model: this.config.model,
      projectDir: this.config.projectDir,
      healthScore: this.lastHealthScore?.overall ?? null,
      healthGrade: this.lastHealthScore?.grade ?? null,
      fixCount: this.lastFixes.length,
      vulnCount: this.lastVulns.length,
      customRuleCount: this.customRulesEngine.getRules().length,
      updateAvailable: this.updateCheck?.hasUpdate ?? false,
      latestVersion: this.updateCheck?.latest ?? null,
      // v2.0.0
      duplicateCount: this.lastDuplicates.length,
      adrCount: this.lastADRs.length,
      perfInsightCount: this.lastPerfInsights.length,
      mcpServerRunning: this.mcpServer !== null,
      teamModeEnabled: this.teamMode !== null,
      symbolCount: this.lastSymbols ? Array.from(this.lastSymbols.values()).reduce((sum, s) => sum + s.length, 0) : 0,
      // v2.1.0
      neuralMeshEnabled: this.neuralMesh !== null,
      meshNodeId: this.neuralMesh?.getNodeId()?.slice(0, 8) ?? null,
      meshNodeCount: this.neuralMesh?.getConnectedNodes()?.length ?? 0,
      // v3.0.0
      hyperModules: [
        'ast', 'a11y', 'i18n', 'dead-code', 'mutation', 'code-age',
        'api-contract', 'env', 'license', 'config-drift',
      ],
      // v4.0.0 Hyper-Intelligence
      turboMemoryStats: this.turboMemory?.stats() ?? null,
      caipConnectedAgents: this.crossAgentProtocol?.getConnectedAgents?.() ?? [],
      evolutionGeneration: this.selfEvolution?.getSnapshot?.()?.generation ?? 0,
      swarmConvergence: (this.swarmIntelligence?.getState?.() as any)?.convergenceScore ?? 0,
      knowledgeGraphEntities: this.knowledgeGraph ? ((this.knowledgeGraph as any).getStats?.()?.entityCount ?? 0) : 0,
      adversarialStats: this.adversarialDefense?.getDefenseStats?.() ?? null,
      // v5.0.0 Infinite Intelligence
      hierarchicalMemoryStats: this.hierarchicalMemory?.stats?.() ?? null,
      contextRecallStats: this.contextRecall?.getStats?.() ?? null,
      consensusStats: this.consensusEngine?.getStats?.() ?? null,
      collectiveLearningStats: this.collectiveLearning?.getStats?.() ?? null,
      // v5.1.1 Hyper-Cognitive Intelligence
      fineTuningStats: this.fineTuningEngine?.stats?.() ?? null,
      smartCacheStats: this.smartCache?.stats?.() ?? null,
      intentEngineStats: this.intentEngine?.stats?.() ?? null,
      codeDNAStats: this.codeDNA?.stats?.() ?? null,
      temporalStats: this.temporalIntelligence?.stats?.() ?? null,
      lspEnabled: this.lspServer !== null,
      v511Modules: [
        'fine-tuning', 'smart-cache', 'intent-engine',
        'code-dna', 'temporal-intelligence', 'lsp-server',
      ],
    };
  }

  private setupWatchers(): void {
    this.fileWatcher.on('changes', (changes: FileChange[]) => {
      this.pendingChanges.push(...changes);
      this.emit('info', `${changes.length} file change(s) detected`);
      this.scheduleAnalysis();
    });

    this.gitWatcher.on('new-commit', (commit: any) => {
      this.pendingChanges.push({
        path: `git:commit:${commit.hash?.slice(0, 8) || 'unknown'}`,
        type: 'modify',
        diff: commit.message || 'New commit',
      });
      this.emit('info', `New commit: ${commit.message || 'no message'}`);
      this.contextBuilder.invalidateCache();
      this.scheduleAnalysis();
    });

    this.gitWatcher.on('branch-change', ({ from, to }: { from: string; to: string }) => {
      this.emit('info', `Branch changed: ${from} -> ${to}`);
      this.contextBuilder.invalidateCache();
    });

    this.fileWatcher.start();
    this.gitWatcher.start();
  }

  private scheduleAnalysis(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runAnalysis();
    }, 2000);
  }

  private async runAnalysis(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;

    try {
      const changes = [...this.pendingChanges];
      this.pendingChanges = [];

      if (changes.length === 0) return;

      this.emit('analysis-start', { changeCount: changes.length });

      const context = await this.contextBuilder.build(changes);
      const activities: import('../types.js').AgentActivity[] = [];

      for (const adapter of this.adapters) {
        try {
          const act = await adapter.readActivity();
          activities.push(...act);
        } catch { /* skip */ }
      }

      const agentMemory = this.adapters.length > 0
        ? await this.adapters[0].readMemory().catch(() => undefined)
        : undefined;

      let insights = await this.analyzer.analyze({
        changes,
        context,
        activity: activities,
        agentMemory,
      });

      // ── Framework rules ────────────────────────────────────────────
      const framework = detectFramework(
        context.structure || [],
        {},
        context.language || [],
      );
      if (framework !== 'unknown') {
        const allContent = changes.map(c => c.content || c.diff || '').join('\n');
        const frameworkResults = applyFrameworkRules(framework, context.structure || [], allContent);
        for (const r of frameworkResults) {
          insights.push({
            type: (r.type as BrainInsight['type']) || 'warning',
            priority: (r.priority as BrainInsight['priority']) || 'medium',
            title: `[${framework}] ${r.message}`,
            content: r.fix || r.message,
            files: [],
            timestamp: new Date(),
          });
        }
      }

      // Enhance with pattern memory insights
      const patternInsights = await this.patternMemory.getPatternInsights(changes);
      insights.push(...patternInsights);

      // ── Apply custom rules ────────────────────────────────────────
      const customInsights = this.customRulesEngine.applyRules(changes);
      if (customInsights.length > 0) {
        insights.push(...customInsights);
      }

      // Record patterns
      this.patternMemory.recordFileCorrelation(changes);
      this.patternMemory.recordChangeFrequency(changes);
      for (const insight of insights) {
        this.patternMemory.recordErrorPattern(insight);
      }

      // v4.0.0: Store patterns in TurboMemory for infinite retention
      try {
        for (const change of changes.slice(0, 30)) {
          const text = change.path + ' ' + (change.content || '').slice(0, 200);
          const vector = this.textToVector(text);
          await this.turboMemory.store(change.path, vector, {
            type: 'file_change',
            insightCount: insights.length,
          });
        }
      } catch { /* TurboMemory storage is best-effort */ }

      // ── v2.0.0: Super-Intelligence Enhancements ────────────────────
      // Type safety analysis on changed TypeScript files
      const tsFiles = changes.filter(c => c.path.endsWith('.ts') || c.path.endsWith('.tsx'));
      if (tsFiles.length > 0) {
        try {
          for (const f of tsFiles.slice(0, 10)) {
            const typeInsights = this.typeSafety.analyzeFile(f.path);
            insights.push(...typeInsights);
          }
        } catch { /* skip type analysis failures */ }
      }

      // Performance profiling on changed files
      try {
        for (const change of changes.slice(0, 20)) {
          if (change.content) {
            const perfInsights = this.perfProfiler.analyzeFile(change.path, change.content);
            for (const pi of perfInsights) {
              insights.push({
                type: 'suggestion',
                priority: pi.severity as BrainInsight['priority'],
                title: `[Perf] ${pi.description}`,
                content: `${pi.suggestion} (Impact: ${pi.estimatedImpact})`,
                files: [change.path],
                timestamp: new Date(),
              });
            }
          }
        }
      } catch { /* skip perf analysis failures */ }

      // ADR detection on changes
      try {
        const newADRs = await this.adrEngine.detectDecisions(changes);
        if (newADRs.length > 0) {
          for (const adr of newADRs) {
            await this.adrEngine.saveADR(adr);
          }
        }
      } catch { /* skip ADR detection failures */ }

      // Learning engine — record insights as lessons
      try {
        for (const insight of insights.filter(i => i.priority === 'critical' || i.priority === 'high')) {
          await this.learningEngine.recordInsight(insight).catch(() => {});
        }
      } catch { /* skip learning failures */ }

      // ── v3.0.0: Hyper-Intelligence Enhancements ────────────────────
      // AST complexity analysis on changed TypeScript files
      if (tsFiles.length > 0) {
        try {
          for (const f of tsFiles.slice(0, 5)) {
            const funcs = this.astAnalyzer.extractFunctionInfo(f.path);
            for (const fn of funcs) {
              if (fn.cyclomaticComplexity > 10) {
                insights.push({
                  type: 'warning',
                  priority: fn.cyclomaticComplexity > 20 ? 'high' : 'medium',
                  title: `[ast] High complexity in ${fn.name}() — cyclomatic: ${fn.cyclomaticComplexity}`,
                  content: `Function "${fn.name}" in ${f.path} has cyclomatic complexity of ${fn.cyclomaticComplexity}. ` +
                    `Consider breaking it into smaller functions. ` +
                    `Parameters: ${fn.params}, Lines: ${fn.endLine - fn.startLine}, Nesting: ${fn.nestingDepth}`,
                  files: [f.path],
                  timestamp: new Date(),
                });
              }
            }
          }
        } catch { /* skip AST failures */ }
      }

      // Accessibility check on changed frontend files
      const frontendFiles = changes.filter(c =>
        /\.(tsx|jsx|vue|svelte|html)$/.test(c.path) && c.content
      );
      if (frontendFiles.length > 0) {
        try {
          for (const f of frontendFiles.slice(0, 5)) {
            const a11yIssues = this.a11yChecker.analyzeFile(f.path);
            for (const issue of a11yIssues) {
              insights.push({
                type: 'a11y',
                priority: issue.severity === 'critical' ? 'critical' : issue.severity === 'serious' ? 'high' : issue.severity === 'moderate' ? 'medium' : 'low',
                title: `[a11y] ${issue.message}`,
                content: `${issue.message}\nRule: ${issue.rule} (WCAG ${issue.wcagCriterion} Level ${issue.wcagLevel})\nSuggestion: ${issue.suggestion}`,
                files: [f.path],
                timestamp: new Date(),
              });
            }
          }
        } catch { /* skip a11y failures */ }
      }

      // i18n detection on frontend files
      if (frontendFiles.length > 0) {
        try {
          for (const f of frontendFiles.slice(0, 5)) {
            const i18nIssues = this.i18nDetector.analyzeFile(f.path, false);
            for (const issue of i18nIssues) {
              insights.push({
                type: 'i18n',
                priority: issue.severity === 'high' ? 'high' : 'medium',
                title: `[i18n] ${issue.content}`,
                content: `${issue.content}\nType: ${issue.type}\nSuggestion: ${issue.suggestion}`,
                files: [f.path],
                timestamp: new Date(),
              });
            }
          }
        } catch { /* skip i18n failures */ }
      }

      // Env secret scan on changed files
      try {
        for (const change of changes.filter(c => c.content).slice(0, 10)) {
          const secretPatterns = [
            /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/gi,
            /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi,
          ];
          for (const regex of secretPatterns) {
            regex.lastIndex = 0;
            if (regex.test(change.content!) && !change.content!.includes('process.env')) {
              insights.push({
                type: 'env',
                priority: 'critical',
                title: `[env] Hardcoded secret in ${change.path}`,
                content: 'Never hardcode secrets in source code. Use environment variables or a secret manager.',
                files: [change.path],
                timestamp: new Date(),
                confidence: 0.95,
              });
            }
          }
        }
      } catch { /* skip env scan failures */ }

      // ── v4.0.0: Hyper-Intelligence Enhancements ────────────────────
      // Knowledge Graph build + PageRank
      try {
        if (this.knowledgeGraph) {
          await this.knowledgeGraph.build();
          const topEntities = this.knowledgeGraph.getTopEntities(10);
          const changedPaths = new Set(changes.map(c => c.path));
          for (const entity of topEntities) {
            const entityFile = entity.file || '';
            if (entityFile && changedPaths.has(entityFile)) {
              insights.push({
                priority: 'medium',
                type: 'pattern',
                title: `[graph] High-impact entity: ${entity.name}`,
                content: `${entity.name} in ${entityFile} has PageRank score ${(entity as any).pageRankScore?.toFixed(3) || 'N/A'} — changes here ripple across the codebase`,
                files: [entityFile],
                timestamp: new Date(),
              });
            }
          }
        }
      } catch { /* knowledge graph is best-effort */ }

      // Predictive Engine — Bug Risk + Debt Forecast
      try {
        const codeAgeFiles: CodeAgeResult[] = changes.filter(c => c.content).slice(0, 20).map(c => ({
          file: c.path,
          lastModified: new Date(),
          daysSinceModification: 0,
          linesChangedRecently: 1,
          stalenessScore: 0,
          risk: 'fresh' as const,
          authors: [],
          churnRate: 0,
        }));
        const metrics = this.lastMetrics;
        if (codeAgeFiles.length > 0 && metrics) {
          const bugRisks = this.predictiveEngine.scoreBugRisk(codeAgeFiles, metrics);
          for (const risk of bugRisks.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical')) {
            insights.push({
              priority: (risk.riskLevel === 'critical' ? 'high' : 'medium') as BrainInsight['priority'],
              type: 'warning',
              title: `[predict] Bug risk in ${risk.file}: ${risk.riskLevel}`,
              content: `Risk factors: ${risk.factors.join(', ')}. Confidence: ${(risk.confidence * 100).toFixed(0)}%`,
              files: [risk.file],
              timestamp: new Date(),
            });
          }
        }
      } catch { /* predictive engine is best-effort */ }

      for (const insight of insights) {
        insight.timestamp = new Date();
      }

      // ── Health Score ──────────────────────────────────────────────
      const healthScore = this.healthEngine.compute(insights, changes, context);
      this.lastHealthScore = healthScore;
      this.emit('health-score', { score: healthScore });

      // ── Smart Fix Engine ──────────────────────────────────────────
      const fixes = this.fixEngine.generateFixes(changes, insights);
      this.lastFixes = fixes;
      if (fixes.length > 0) {
        this.emit('fixes', { fixes });
      }

      if (this.config.autoInject) {
        await this.injectInsights(insights);
      }

      if (this.currentSession) {
        this.currentSession.insights.push(...insights);
        this.currentSession.filesReviewed += changes.length;
        // Cap insights at 100
        if (this.currentSession.insights.length > 100) {
          this.currentSession.insights = this.currentSession.insights.slice(-100);
        }
      }

      // v4.0.0: Swarm pheromone update
      try {
        for (const insight of insights) {
          const files = insight.files || [];
          if (files.length > 0) {
            const strength = (insight.priority === 'critical' ? 3 : insight.priority === 'high' ? 2 : 1) * 1.5;
            this.swarmIntelligence.depositPheromone(files, strength);
          }
        }
        this.swarmIntelligence.evaporate();
      } catch { /* swarm update is best-effort */ }

      this.emit('insights', { insights });

      // ── v2.1.0: Neural Mesh Broadcasting ────────────────────────────
      if (this.neuralMesh && this.neuralMesh.isRunning()) {
        // Broadcast high-priority insights to mesh
        for (const insight of insights.filter(i => i.priority === 'critical' || i.priority === 'high')) {
          this.neuralMesh.broadcastInsight(insight);
        }
        // Broadcast health score
        if (healthScore.overall !== undefined) {
          this.neuralMesh.broadcastHealth(healthScore.overall);
        }
        // Broadcast patterns from learning engine
        for (const insight of insights.filter(i => i.type === 'pattern')) {
          this.neuralMesh.broadcastPattern(insight.title, insight.type);
        }
      }

      // v4.0.0: Cross-agent broadcast + self-evolution meta-learning
      try {
        const boostPacket = {
          insights: insights.slice(0, 3),
          healthScore: healthScore.overall,
          contextSummary: changes.map(c => c.path).slice(0, 10).join(', '),
        };
        await this.crossAgentProtocol.broadcast('claude-code' as any, boostPacket);
      } catch { /* cross-agent broadcast is best-effort */ }

      try {
        for (const insight of insights) {
          this.selfEvolution.updateMetaLearning(
            `${insight.type}:${insight.priority}`,
            insight.priority !== 'low',
          );
        }
      } catch { /* self-evolution is best-effort */ }

      // ── v5.0.0: Infinite Intelligence Enhancements ──────────────────
      // Store all insights in HierarchicalMemory for infinite retention
      try {
        for (const insight of insights.filter(i => i.priority !== 'low')) {
          await this.hierarchicalMemory.store(
            `${insight.title}\n${insight.content || ''}`,
            insight.type || 'general',
            insight.priority === 'critical' ? 0.95 : insight.priority === 'high' ? 0.85 : 0.7,
            {
              type: insight.type,
              priority: insight.priority,
              files: insight.files || [],
            },
          );
        }
      } catch { /* hierarchical memory is best-effort */ }

      // Context-triggered associative recall — surface related past insights
      try {
        const now = new Date();
        const recallContext: import('../types.js').RecallContext = {
          currentFile: changes[0]?.path || '',
          currentCategory: insights[0]?.type || 'general',
          recentEdits: changes.slice(0, 5).map(c => c.path),
          projectType: 'auto',
          keywords: insights.slice(0, 5).flatMap(i => i.title.split(/\s+/).slice(0, 3)),
          timeOfDay: now.getHours(),
          dayOfWeek: now.getDay(),
        };
        const recalled = this.contextRecall.recall(recallContext, 5);
        if (recalled.length > 0) {
          for (const r of recalled.slice(0, 3)) {
            if (r.relevanceScore > 0.6) {
              insights.push({
                type: 'pattern',
                priority: 'info' as BrainInsight['priority'],
                title: `[recall] Related past insight: ${r.entry.content.slice(0, 80).replace(/\n/g, ' ')}`,
                content: `Previously discovered (tier: ${r.entry.tier}): ${r.entry.content.slice(0, 200)}`,
                files: (r.entry.metadata?.files as string[]) || [],
                timestamp: new Date(),
              });
            }
          }
        }
      } catch { /* context recall is best-effort */ }

      // Collective learning — propose high-confidence patterns as rules
      try {
        for (const insight of insights.filter(i =>
          i.priority === 'critical' || i.priority === 'high'
        ).slice(0, 5)) {
          this.collectiveLearning.proposeRule(
            `${insight.type}: ${insight.title}`,
            insight.type || 'general',
            'shadow-brain',
            insight.files || [],
          );
        }
      } catch { /* collective learning is best-effort */ }
    } catch (err: any) {
      this.emit('error', { error: err });
    } finally {
      this.analyzing = false;
    }
  }

  private async injectInsights(insights: BrainInsight[]): Promise<void> {
    for (const insight of insights) {
      for (const adapter of this.adapters) {
        try {
          const success = await adapter.injectContext(insight);
          this.emit('injection', { adapter: adapter.name, insight, success });
          if (success && this.currentSession) {
            this.currentSession.suggestionsInjected++;
          }
        } catch (err: any) {
          this.emit('injection', { adapter: adapter.name, insight, success: false });
        }
      }
    }
  }

  private async getGitChanges(): Promise<FileChange[]> {
    try {
      const state: GitState = await this.gitWatcher.getFullState();
      const changes: FileChange[] = [];

      // Parse staged diff
      if (state.stagedDiff) {
        changes.push(...this.parseDiff(state.stagedDiff));
      }

      // Parse unstaged diff
      if (state.unstagedDiff) {
        changes.push(...this.parseDiff(state.unstagedDiff));
      }

      return changes;
    } catch {
      return [];
    }
  }

  private parseDiff(diff: string): FileChange[] {
    const changes: FileChange[] = [];
    const lines = diff.split('\n');

    for (const line of lines) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        changes.push({
          path: match[2],
          type: match[1] === match[2] ? 'modify' : 'rename',
          diff: '',
          oldPath: match[1] !== match[2] ? match[1] : undefined,
        });
      }
    }

    // If no standard diff format, return single change
    if (changes.length === 0 && diff.trim()) {
      changes.push({
        path: 'unknown',
        type: 'modify',
        diff,
      });
    }

    return changes;
  }

  /** v4.0.0: Simple text-to-vector for TurboMemory compatibility */
  private textToVector(text: string, dimensions: number = 64): number[] {
    const vector = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      vector[Math.abs(hash) % dimensions] += 1;
    }
    const max = Math.max(...vector, 1);
    return vector.map(v => v / max);
  }
}
