// src/brain/orchestrator.ts — Central brain loop: watchers → analyzer → adapters

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { LLMClient } from './llm-client.js';
import { ProjectContextBuilder } from './project-context.js';
import { Analyzer } from './analyzer.js';
import { PatternMemory } from './pattern-memory.js';
import { FileWatcher } from '../watchers/file-watcher.js';
import { GitWatcher, GitState } from '../watchers/git-watcher.js';
import { createAdapter, detectRunningAgents } from '../adapters/index.js';
import { BaseAdapter } from '../adapters/base-adapter.js';
import {
  BrainConfig, BrainInsight, BrainSession, AgentTool, FileChange, AgentAdapter,
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
  private running = false;
  private analyzing = false;
  private pendingChanges: FileChange[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentSession: BrainSession | null = null;
  private startTime = 0;

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
    this.fileWatcher = new FileWatcher(config.projectDir);
    this.gitWatcher = new GitWatcher(config.projectDir);
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Load pattern memory
    await this.patternMemory.load();

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

    const insights = await this.analyzer.analyze({
      changes,
      context,
      activity: activities,
      agentMemory,
    });

    // Add metadata
    for (const insight of insights) {
      insight.timestamp = new Date();
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

  getSession(): BrainSession | null {
    return this.currentSession;
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

      const insights = await this.analyzer.analyze({
        changes,
        context,
        activity: activities,
        agentMemory,
      });

      // Enhance with pattern memory insights
      const patternInsights = this.patternMemory.getPatternInsights(changes);
      insights.push(...patternInsights);

      // Record patterns
      this.patternMemory.recordFileCorrelation(changes);
      this.patternMemory.recordChangeFrequency(changes);
      for (const insight of insights) {
        this.patternMemory.recordErrorPattern(insight);
      }

      for (const insight of insights) {
        insight.timestamp = new Date();
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
