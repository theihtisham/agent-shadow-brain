// src/brain/subagent-bridge.ts — Sub-Agent Brain Bridge (SABB)
// v6.0.0 — Hive Mind Edition
//
// When a parent agent (Claude Code Task, Cursor Composer, CrewAI, LangGraph, AutoGen)
// spawns a sub-agent, SABB:
//   1. Detects the spawn (via MCP handshake or CLI call)
//   2. Computes a context sliver — the 3–5% of the global brain relevant to THIS task
//   3. Formats it for injection into the sub-agent's spawn prompt
//   4. Quarantines new memories from the sub-agent until confidence ≥ 0.7
//   5. Graduates verified memories back into the global brain
//
// No other AI tool syncs memory to sub-agents. Every sub-agent framework today
// (Claude Task tool, CrewAI, LangGraph, AutoGen) starts sub-agents with zero
// shared memory. SABB is the first cross-framework brain bridge.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  SubAgentFramework,
  SubAgentSpawnRequest,
  ContextSliver,
  QuarantinedMemory,
  SABBStats,
  AgentTool,
  GlobalEntry,
} from '../types.js';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';

const SABB_DIR = path.join(os.homedir(), '.shadow-brain', 'sabb');
const QUARANTINE_PATH = path.join(SABB_DIR, 'quarantine.json');
const SPAWN_LOG_PATH = path.join(SABB_DIR, 'spawns.jsonl');

const DEFAULT_SLIVER_TOKEN_BUDGET = 300;
const DEFAULT_GRADUATION_THRESHOLD = 0.7;

interface PersistShape {
  schemaVersion: 1;
  quarantine: QuarantinedMemory[];
  stats: SABBStats;
}

function emptyStats(): SABBStats {
  return {
    totalSpawns: 0,
    totalSlivers: 0,
    quarantined: 0,
    graduated: 0,
    rejected: 0,
    avgSliverTokens: 0,
    avgGraduationMs: 0,
    byFramework: {
      'claude-code-task': 0,
      'cursor-composer': 0,
      'cline-substep': 0,
      'crewai': 0,
      'langgraph': 0,
      'autogen': 0,
      'generic': 0,
    },
    byParent: {},
  };
}

export class SubAgentBridge {
  private brain: GlobalBrain;
  private quarantine: Map<string, QuarantinedMemory> = new Map();
  private stats: SABBStats = emptyStats();
  private graduationThreshold: number;
  private initialized = false;

  constructor(brain?: GlobalBrain, opts: { graduationThreshold?: number } = {}) {
    this.brain = brain ?? getGlobalBrain();
    this.graduationThreshold = opts.graduationThreshold ?? DEFAULT_GRADUATION_THRESHOLD;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(SABB_DIR, { recursive: true });
    await this.brain.init();

    if (fs.existsSync(QUARANTINE_PATH)) {
      try {
        const raw = fs.readFileSync(QUARANTINE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PersistShape;
        if (Array.isArray(parsed.quarantine)) {
          for (const q of parsed.quarantine) {
            this.quarantine.set(q.id, {
              ...q,
              createdAt: new Date(q.createdAt),
              graduatedAt: q.graduatedAt ? new Date(q.graduatedAt) : null,
            });
          }
        }
        if (parsed.stats) this.stats = { ...emptyStats(), ...parsed.stats };
      } catch {
        // Corrupt file — start fresh
      }
    }
    this.initialized = true;
  }

  /** Register a sub-agent spawn. Returns a spawn ID used for later memory quarantine. */
  async registerSpawn(req: Omit<SubAgentSpawnRequest, 'spawnTime'> & { spawnTime?: Date }): Promise<SubAgentSpawnRequest> {
    await this.init();

    const spawn: SubAgentSpawnRequest = {
      ...req,
      spawnTime: req.spawnTime ?? new Date(),
    };

    this.stats.totalSpawns++;
    this.stats.byFramework[spawn.framework]++;
    this.stats.byParent[spawn.parentAgent] = (this.stats.byParent[spawn.parentAgent] ?? 0) + 1;

    // Append to spawn log
    try {
      fs.appendFileSync(SPAWN_LOG_PATH, JSON.stringify(spawn) + '\n');
    } catch {
      // Log failures are non-fatal
    }

    await this.flush();
    return spawn;
  }

  /**
   * Compute a context sliver for a sub-agent. Returns a concise, task-focused
   * briefing (default budget: 300 tokens) extracted from the global brain.
   */
  async computeSliver(req: SubAgentSpawnRequest, opts: { tokenBudget?: number } = {}): Promise<ContextSliver> {
    await this.init();

    const budget = opts.tokenBudget ?? req.tokenBudget ?? DEFAULT_SLIVER_TOKEN_BUDGET;
    const projectId = GlobalBrain.projectIdFor(req.projectDir);
    const taskTerms = this.extractKeyTerms(req.taskDescription);

    // Pull recent project memories + keyword-match anything with high importance
    const candidates = this.brain.recall({
      projectId,
      keywords: taskTerms,
      limit: 40,
      minImportance: 0.4,
    });

    const scored = candidates
      .map(entry => ({
        entry,
        score: this.scoreRelevance(entry, taskTerms, req.taskDescription),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const selected: ContextSliver['memories'] = [];
    let tokenCount = 0;

    for (const { entry, score } of scored) {
      const tokens = this.estimateTokens(entry.content);
      if (tokenCount + tokens > budget) continue;
      selected.push({
        id: entry.id,
        content: entry.content,
        category: entry.category,
        relevance: Math.min(1, score / 10),
      });
      tokenCount += tokens;
      if (selected.length >= 12) break;
    }

    const warnings = this.extractWarnings(candidates);
    const markdown = this.formatSliverMarkdown(req, selected, warnings);

    this.stats.totalSlivers++;
    this.stats.avgSliverTokens = this.rollingAvg(this.stats.avgSliverTokens, tokenCount, this.stats.totalSlivers);

    return {
      subAgentId: req.subAgentId,
      parentAgent: req.parentAgent,
      taskDescription: req.taskDescription,
      memories: selected,
      warnings,
      tokenCount,
      markdown,
      generatedAt: new Date(),
    };
  }

  /** Store a memory from a sub-agent in quarantine. */
  async quarantineMemory(
    subAgentId: string,
    parentAgent: AgentTool,
    content: string,
    category: string,
    confidence: number,
    evidence: string[] = [],
  ): Promise<QuarantinedMemory> {
    await this.init();

    const entry: QuarantinedMemory = {
      id: `quar-${crypto.randomBytes(6).toString('hex')}`,
      subAgentId,
      parentAgent,
      content,
      category,
      confidence,
      graduatedAt: null,
      verdict: 'pending',
      evidence,
      createdAt: new Date(),
    };

    this.quarantine.set(entry.id, entry);
    this.stats.quarantined++;
    await this.flush();

    // Auto-graduate if confidence already passes threshold
    if (confidence >= this.graduationThreshold) {
      await this.graduate(entry.id);
    }

    return entry;
  }

  /** Graduate a quarantined memory into the global brain. */
  async graduate(memoryId: string, overrides: Partial<GlobalEntry> = {}): Promise<boolean> {
    await this.init();
    const entry = this.quarantine.get(memoryId);
    if (!entry) return false;
    if (entry.verdict !== 'pending') return false;

    const start = Date.now();
    const projectMatch = await this.findProjectForSubAgent(entry.subAgentId);

    this.brain.writeSync({
      projectId: projectMatch?.projectId ?? 'unknown-project',
      projectName: projectMatch?.projectName ?? 'unknown',
      agentTool: overrides.agentTool ?? entry.parentAgent,
      category: entry.category,
      content: entry.content,
      importance: Math.min(1, entry.confidence),
      metadata: {
        ...(overrides.metadata ?? {}),
        origin: 'subagent',
        subAgentId: entry.subAgentId,
        parentAgent: entry.parentAgent,
        quarantineId: entry.id,
      },
    });

    entry.verdict = 'graduated';
    entry.graduatedAt = new Date();
    this.stats.graduated++;
    this.stats.quarantined = Math.max(0, this.stats.quarantined - 1);
    this.stats.avgGraduationMs = this.rollingAvg(this.stats.avgGraduationMs, Date.now() - start, this.stats.graduated);
    await this.flush();
    return true;
  }

  /** Reject a quarantined memory (hallucination, low confidence). */
  async reject(memoryId: string, reason = 'rejected'): Promise<boolean> {
    await this.init();
    const entry = this.quarantine.get(memoryId);
    if (!entry) return false;
    entry.verdict = 'rejected';
    entry.evidence = [...entry.evidence, reason];
    this.stats.rejected++;
    this.stats.quarantined = Math.max(0, this.stats.quarantined - 1);
    await this.flush();
    return true;
  }

  /** List pending quarantined memories. */
  listQuarantine(subAgentId?: string): QuarantinedMemory[] {
    return Array.from(this.quarantine.values())
      .filter(q => q.verdict === 'pending' && (!subAgentId || q.subAgentId === subAgentId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getStats(): SABBStats {
    return JSON.parse(JSON.stringify(this.stats));
  }

  /** Parse a spawn log into an array of SubAgentSpawnRequest. Useful for auditing. */
  readSpawnLog(limit = 50): SubAgentSpawnRequest[] {
    if (!fs.existsSync(SPAWN_LOG_PATH)) return [];
    try {
      const raw = fs.readFileSync(SPAWN_LOG_PATH, 'utf-8');
      return raw
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map(line => {
          const parsed = JSON.parse(line);
          return { ...parsed, spawnTime: new Date(parsed.spawnTime) };
        });
    } catch {
      return [];
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private extractKeyTerms(task: string): string[] {
    const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'is', 'it', 'this', 'that', 'with', 'as', 'from', 'by', 'be', 'do', 'can', 'will', 'should', 'would', 'could', 'i', 'you', 'we', 'they', 'my', 'your']);
    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w))
      .slice(0, 12);
  }

  private scoreRelevance(entry: GlobalEntry, terms: string[], task: string): number {
    let score = 0;
    const content = entry.content.toLowerCase();
    for (const term of terms) {
      if (content.includes(term)) score += 2;
    }
    // Recency boost: newer entries up-ranked slightly
    const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 2 - ageDays / 30);
    // Importance
    score += entry.importance * 3;
    // Category match boost
    const taskLower = task.toLowerCase();
    if (taskLower.includes(entry.category.toLowerCase())) score += 2;
    return score;
  }

  private extractWarnings(entries: GlobalEntry[]): string[] {
    const warningCategories = new Set(['warning', 'pitfall', 'security', 'bug', 'incident', 'failure']);
    const warnings: string[] = [];
    for (const e of entries) {
      if (warningCategories.has(e.category.toLowerCase())) {
        warnings.push(`[${e.category}] ${e.content.slice(0, 140)}`);
      }
      if (warnings.length >= 5) break;
    }
    return warnings;
  }

  private estimateTokens(text: string): number {
    // Rough tokens-per-char heuristic for English: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  private formatSliverMarkdown(req: SubAgentSpawnRequest, memories: ContextSliver['memories'], warnings: string[]): string {
    const lines: string[] = [
      `## Shadow Brain Context Sliver`,
      ``,
      `**Parent:** ${req.parentAgent} · **Framework:** ${req.framework}`,
      `**Task:** ${req.taskDescription}`,
      ``,
      `### What you should know before starting`,
    ];
    if (memories.length === 0) {
      lines.push('_No relevant project memories found. Proceed with general best practices._');
    } else {
      for (const m of memories) {
        lines.push(`- **[${m.category}]** ${m.content.slice(0, 220)}${m.content.length > 220 ? '…' : ''}`);
      }
    }
    if (warnings.length) {
      lines.push('', `### Warnings from past work`);
      for (const w of warnings) lines.push(`- ${w}`);
    }
    lines.push(
      '',
      `### Rules for this sub-agent`,
      '- Use project-specific memory over generic assumptions.',
      '- Any new learning will be quarantined until confidence ≥ 0.7.',
      '- Do not access secrets or run destructive commands without explicit approval.',
      '',
    );
    return lines.join('\n');
  }

  private async findProjectForSubAgent(_subAgentId: string): Promise<{ projectId: string; projectName: string } | null> {
    // Derive project from most recent spawn record for this sub-agent
    const spawns = this.readSpawnLog(200).reverse();
    const match = spawns.find(s => s.subAgentId === _subAgentId);
    if (!match) return null;
    return {
      projectId: GlobalBrain.projectIdFor(match.projectDir),
      projectName: path.basename(match.projectDir),
    };
  }

  private rollingAvg(currentAvg: number, newValue: number, count: number): number {
    if (count <= 1) return newValue;
    return currentAvg + (newValue - currentAvg) / count;
  }

  private async flush(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        quarantine: Array.from(this.quarantine.values()),
        stats: this.stats,
      };
      const tmp = QUARANTINE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, QUARANTINE_PATH);
    } catch {
      // Persistence failures are non-fatal in v6.0; quarantine lives in-memory
    }
  }
}

// Singleton helper — consistent with other v5.2 brain modules
let _instance: SubAgentBridge | null = null;

export function getSubAgentBridge(): SubAgentBridge {
  if (!_instance) _instance = new SubAgentBridge();
  return _instance;
}

export function resetSubAgentBridgeForTests(): void {
  _instance = null;
}
