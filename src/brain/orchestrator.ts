// src/brain/orchestrator.ts — Central brain loop: watchers → analyzer → adapters

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
import { FileWatcher } from '../watchers/file-watcher.js';
import { GitWatcher, GitState } from '../watchers/git-watcher.js';
import { createAdapter, detectRunningAgents } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base-adapter.js';
import {
  BrainConfig, BrainInsight, BrainSession, AgentTool, FileChange, AgentAdapter,
  CodeMetrics, VulnResult, CustomRule, ProjectConfig,
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
  private running = false;
  private analyzing = false;
  private pendingChanges: FileChange[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentSession: BrainSession | null = null;
  private startTime = 0;
  private lastHealthScore: HealthScore | null = null;
  private lastFixes: FixSuggestion[] = [];
  private lastMetrics: CodeMetrics | null = null;
  private lastVulns: VulnResult[] = [];
  private updateCheck: UpdateCheck | null = null;

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

  getStatus() {
    return {
      running: this.running,
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
      const patternInsights = this.patternMemory.getPatternInsights(changes);
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

      this.emit('insights', { insights });
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
}
