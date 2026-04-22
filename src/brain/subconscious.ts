// src/brain/subconscious.ts — Subconscious Engine (v5.2.0)
//
// On every new agent session, the Subconscious proactively injects a tight
// briefing of relevant context — recent decisions, similar past work, project
// state, cross-agent insights — so the agent doesn't have to ask.
//
// "Subconscious" because the agent doesn't actively retrieve this — the brain
// makes it available implicitly. Like human intuition: the relevant memory
// surfaces before you consciously look for it.
//
// Token budget: hard-capped (default 2000) to never bloat the agent's context.
// Relevance ranked: each section competes for budget by importance × recency.

import {
  AgentTool,
  SubconsciousConfig,
  SubconsciousBriefing,
  SubconsciousStats,
  GlobalEntry,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';
import { getCache } from './l0-cache.js';
import * as crypto from 'crypto';

const DEFAULT_CONFIG: SubconsciousConfig = {
  enabled: true,
  tokenBudget: 2000,
  lookbackHours: 24,
  relevanceThreshold: 0.3,
  alwaysInclude: ['decision', 'pattern', 'warning'],
  enabledAgents: [],
};

/** ~4 chars per token (rough English heuristic) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class SubconsciousEngine {
  private config: SubconsciousConfig;
  private brain: GlobalBrain;
  private stats: SubconsciousStats;

  constructor(config: Partial<SubconsciousConfig> = {}, brain?: GlobalBrain) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.brain = brain ?? getGlobalBrain();
    this.stats = {
      totalBriefings: 0,
      avgTokenCount: 0,
      avgGenerationMs: 0,
      acceptedRate: 1,
      byAgent: {},
      lastBriefing: null,
    };
  }

  /** Generate a session-start briefing for the agent — proactive context injection */
  async generateBriefing(opts: {
    agentTool: AgentTool;
    projectDir: string;
    projectId?: string;
    projectName?: string;
    currentTask?: string;
  }): Promise<SubconsciousBriefing> {
    const start = Date.now();
    const sessionId = crypto.randomUUID();
    const projectId = opts.projectId ?? GlobalBrain.projectIdFor(opts.projectDir);
    const projectName = opts.projectName ?? opts.projectDir.split(/[/\\]/).pop() ?? 'unknown';

    // L0 cache check — if we briefed this agent for this project recently, reuse
    const cacheKey = `subconscious:${opts.agentTool}:${projectId}`;
    const cache = getCache<SubconsciousBriefing>('subconscious');
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt.getTime() < 60_000) {
      return cached;
    }

    // Skip if disabled or agent not in enabled list
    if (!this.config.enabled || (this.config.enabledAgents.length > 0 && !this.config.enabledAgents.includes(opts.agentTool))) {
      return this.emptyBriefing(opts.agentTool, opts.projectDir, sessionId);
    }

    if (!('init' in this.brain)) {
      return this.emptyBriefing(opts.agentTool, opts.projectDir, sessionId);
    }
    try { await (this.brain as any).init(); } catch { /* already initialized */ }

    // Build sections within budget
    const lookbackMs = this.config.lookbackHours * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    const recentDecisions = this.fetchSection(projectId, ['decision'], cutoff, 5);
    const activeTasks = this.fetchSection(projectId, ['task', 'todo'], cutoff, 5);
    const projectState = this.fetchProjectStateSummary(projectId);
    const crossAgentInsights = this.fetchCrossAgentInsights(projectId, opts.agentTool, cutoff, 5);
    const warnings = this.fetchSection(projectId, ['warning', 'critical', 'security'], cutoff, 3);
    const similarPastWork = opts.currentTask
      ? this.fetchSimilarWork(opts.currentTask, opts.agentTool, 3)
      : this.fetchTopPatterns(projectId, 3);

    const briefing: SubconsciousBriefing = {
      agentTool: opts.agentTool,
      projectDir: opts.projectDir,
      sessionId,
      generatedAt: new Date(),
      tokenCount: 0,
      sections: {
        recentDecisions: recentDecisions.map(e => this.formatEntry(e)),
        activeTasks: activeTasks.map(e => this.formatEntry(e)),
        similarPastWork: similarPastWork.map(e => this.formatEntry(e)),
        projectState,
        crossAgentInsights: crossAgentInsights.map(e => `[${e.agentTool}] ${this.formatEntry(e)}`),
        warnings: warnings.map(e => this.formatEntry(e)),
      },
      fullText: '',
    };

    briefing.fullText = this.assembleBriefing(briefing, projectName);
    briefing.tokenCount = estimateTokens(briefing.fullText);

    // Trim if over budget — drop lowest-priority sections first
    if (briefing.tokenCount > this.config.tokenBudget) {
      briefing.fullText = this.trimToBudget(briefing, projectName);
      briefing.tokenCount = estimateTokens(briefing.fullText);
    }

    // Cache it
    cache.set(cacheKey, briefing);

    // Update stats
    this.stats.totalBriefings++;
    this.stats.avgTokenCount = this.runningAvg(this.stats.avgTokenCount, briefing.tokenCount, this.stats.totalBriefings);
    this.stats.avgGenerationMs = this.runningAvg(this.stats.avgGenerationMs, Date.now() - start, this.stats.totalBriefings);
    this.stats.byAgent[opts.agentTool] = (this.stats.byAgent[opts.agentTool] ?? 0) + 1;
    this.stats.lastBriefing = new Date();

    return briefing;
  }

  /** Get current stats */
  getStats(): SubconsciousStats {
    return { ...this.stats };
  }

  /** Update config at runtime */
  configure(patch: Partial<SubconsciousConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): SubconsciousConfig {
    return { ...this.config };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private fetchSection(projectId: string, categories: string[], cutoffMs: number, limit: number): GlobalEntry[] {
    const results: GlobalEntry[] = [];
    for (const category of categories) {
      const entries = this.brain.recall({
        projectId,
        category,
        limit,
        minImportance: this.config.relevanceThreshold,
      });
      for (const e of entries) {
        if (e.lastAccessed.getTime() >= cutoffMs || e.createdAt.getTime() >= cutoffMs) {
          results.push(e);
        }
      }
    }
    return results
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  private fetchCrossAgentInsights(projectId: string, currentAgent: AgentTool, cutoffMs: number, limit: number): GlobalEntry[] {
    const all = this.brain.recall({
      projectId,
      limit: limit * 3,
      minImportance: this.config.relevanceThreshold,
    });
    return all
      .filter(e => e.agentTool !== currentAgent && (e.lastAccessed.getTime() >= cutoffMs || e.createdAt.getTime() >= cutoffMs))
      .slice(0, limit);
  }

  private fetchProjectStateSummary(projectId: string): string {
    const recent = this.brain.recall({ projectId, category: 'state', limit: 1 });
    if (recent.length) return recent[0].content.slice(0, 300);
    const top = this.brain.recall({ projectId, limit: 3 });
    if (!top.length) return '';
    return top.map(e => `${e.category}: ${e.content.slice(0, 80)}`).join('; ');
  }

  private fetchSimilarWork(taskHint: string, agentTool: AgentTool, limit: number): GlobalEntry[] {
    const keywords = this.extractKeywords(taskHint);
    if (!keywords.length) return [];
    return this.brain.recall({
      keywords,
      limit,
      minImportance: this.config.relevanceThreshold,
    });
  }

  private fetchTopPatterns(projectId: string, limit: number): GlobalEntry[] {
    return this.brain.recall({ projectId, category: 'pattern', limit });
  }

  private extractKeywords(text: string): string[] {
    const stop = new Set(['the', 'and', 'or', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that']);
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3 && !stop.has(w))
      .slice(0, 5);
  }

  private formatEntry(entry: GlobalEntry): string {
    const content = entry.content.length > 200 ? entry.content.slice(0, 197) + '...' : entry.content;
    return content;
  }

  private assembleBriefing(briefing: SubconsciousBriefing, projectName: string): string {
    const parts: string[] = [];

    parts.push(`# 🧠 Shadow Brain — Subconscious Briefing`);
    parts.push(`_Project: ${projectName} | Agent: ${briefing.agentTool} | Auto-generated by Shadow Brain v5.2.0_`);
    parts.push('');

    if (briefing.sections.warnings.length) {
      parts.push(`## ⚠️ Warnings`);
      for (const w of briefing.sections.warnings) parts.push(`- ${w}`);
      parts.push('');
    }

    if (briefing.sections.recentDecisions.length) {
      parts.push(`## Recent Decisions`);
      for (const d of briefing.sections.recentDecisions) parts.push(`- ${d}`);
      parts.push('');
    }

    if (briefing.sections.activeTasks.length) {
      parts.push(`## Active Tasks`);
      for (const t of briefing.sections.activeTasks) parts.push(`- ${t}`);
      parts.push('');
    }

    if (briefing.sections.projectState) {
      parts.push(`## Project State`);
      parts.push(briefing.sections.projectState);
      parts.push('');
    }

    if (briefing.sections.crossAgentInsights.length) {
      parts.push(`## Cross-Agent Insights`);
      for (const i of briefing.sections.crossAgentInsights) parts.push(`- ${i}`);
      parts.push('');
    }

    if (briefing.sections.similarPastWork.length) {
      parts.push(`## Similar Past Work`);
      for (const s of briefing.sections.similarPastWork) parts.push(`- ${s}`);
      parts.push('');
    }

    return parts.join('\n').trim();
  }

  private trimToBudget(briefing: SubconsciousBriefing, projectName: string): string {
    // Drop sections in this priority order until under budget:
    // similarPastWork → crossAgentInsights → activeTasks → recentDecisions → warnings (warnings last)
    const trimmedSections = { ...briefing.sections };
    const dropOrder: Array<keyof typeof trimmedSections> = ['similarPastWork', 'crossAgentInsights', 'activeTasks', 'recentDecisions'];

    for (const key of dropOrder) {
      let text = this.assembleBriefing({ ...briefing, sections: trimmedSections }, projectName);
      if (estimateTokens(text) <= this.config.tokenBudget) return text;
      const arr = trimmedSections[key];
      if (Array.isArray(arr)) {
        (trimmedSections as any)[key] = [];
      } else {
        (trimmedSections as any)[key] = '';
      }
    }
    return this.assembleBriefing({ ...briefing, sections: trimmedSections }, projectName);
  }

  private emptyBriefing(agentTool: AgentTool, projectDir: string, sessionId: string): SubconsciousBriefing {
    return {
      agentTool,
      projectDir,
      sessionId,
      generatedAt: new Date(),
      tokenCount: 0,
      sections: {
        recentDecisions: [],
        activeTasks: [],
        similarPastWork: [],
        projectState: '',
        crossAgentInsights: [],
        warnings: [],
      },
      fullText: '',
    };
  }

  private runningAvg(prev: number, next: number, n: number): number {
    return prev + (next - prev) / n;
  }
}

let defaultEngine: SubconsciousEngine | null = null;

export function getSubconscious(config?: Partial<SubconsciousConfig>): SubconsciousEngine {
  if (!defaultEngine) defaultEngine = new SubconsciousEngine(config);
  else if (config) defaultEngine.configure(config);
  return defaultEngine;
}
