// src/brain/dream-engine.ts — Dream Engine (background reflection)
// v6.0.0 — Hive Mind Edition
//
// LLMs are always reactive. Shadow Brain is the first dev tool with a
// REFLECTIVE IDLE LOOP. When no agent is active for `idleThresholdMs`, the
// Dream Engine wakes up and:
//   - Re-reads recent decisions with fresh context
//   - Runs counterfactual analysis ("what if X instead of Y?")
//   - Strengthens validated patterns, weakens falsified ones
//   - Drops "dream insights" into the brain, flagged for next session
//
// Uses Local LLM (Ollama) by default — 100% local, free, offline-capable.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  DreamInsight,
  DreamType,
  DreamEngineConfig,
  DreamEngineStats,
  GlobalEntry,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';
import { getLocalLLM, LocalLLM } from './local-llm.js';
import { getModelRegistry } from './model-registry.js';
import { getPromptCache } from './prompt-cache.js';
import { generateJson, z } from './json-output.js';

const DREAMS_PATH = path.join(os.homedir(), '.shadow-brain', 'dreams.json');

const DEFAULT_CONFIG: DreamEngineConfig = {
  enabled: true,
  idleThresholdMs: 5 * 60 * 1000,
  maxDreamsPerCycle: 5,
  useLocalLLM: true,
  dreamIntervalMs: 10 * 60 * 1000,
};

interface PersistShape {
  schemaVersion: 1;
  dreams: DreamInsight[];
  stats: DreamEngineStats;
  lastActivityAt: number;
}

function emptyStats(): DreamEngineStats {
  return {
    totalDreams: 0,
    byType: { revisit: 0, counterfactual: 0, consolidation: 0, contradiction: 0, 'pattern-discovery': 0 },
    avgConfidence: 0,
    actionableCount: 0,
    acknowledgedCount: 0,
    lastDreamAt: null,
    totalDreamTimeMs: 0,
  };
}

export class DreamEngine {
  private brain: GlobalBrain;
  private llm: LocalLLM;
  private config: DreamEngineConfig;
  private dreams: Map<string, DreamInsight> = new Map();
  private stats: DreamEngineStats = emptyStats();
  private lastActivityAt: number = Date.now();
  private cycleTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(opts: Partial<DreamEngineConfig> = {}) {
    this.brain = getGlobalBrain();
    this.llm = getLocalLLM();
    this.config = { ...DEFAULT_CONFIG, ...opts };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(DREAMS_PATH), { recursive: true });
    await this.brain.init();

    if (fs.existsSync(DREAMS_PATH)) {
      try {
        const raw = fs.readFileSync(DREAMS_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PersistShape;
        for (const d of parsed.dreams ?? []) {
          this.dreams.set(d.id, { ...d, generatedAt: new Date(d.generatedAt) });
        }
        if (parsed.stats) {
          this.stats = {
            ...emptyStats(),
            ...parsed.stats,
            lastDreamAt: parsed.stats.lastDreamAt ? new Date(parsed.stats.lastDreamAt) : null,
          };
        }
        this.lastActivityAt = parsed.lastActivityAt ?? Date.now();
      } catch {
        /* corrupt — fresh */
      }
    }
    this.initialized = true;
  }

  /** Record that SOMETHING happened (agent activity). Resets idle timer. */
  noteActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /** Start background reflection loop. Safe to call once; no-op if already running. */
  async start(): Promise<void> {
    await this.init();
    if (!this.config.enabled) return;
    if (this.cycleTimer) return;
    this.cycleTimer = setInterval(() => this.tick().catch(() => {}), this.config.dreamIntervalMs);
    // Avoid preventing the process from exiting
    this.cycleTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = null;
    await this.persist();
  }

  /** Run a single reflection pass. Exposed for tests + manual triggering. */
  async dreamOnce(): Promise<DreamInsight[]> {
    await this.init();
    const since = Date.now() - this.config.idleThresholdMs;
    if (Date.now() - this.lastActivityAt < this.config.idleThresholdMs) {
      return []; // not idle yet
    }

    const start = Date.now();
    const recent = this.brain.recall({ limit: 40 });
    if (recent.length < 3) return [];
    void since;

    const newDreams: DreamInsight[] = [];
    const available = await this.llm.isAvailable();

    for (const type of (['revisit', 'counterfactual', 'consolidation', 'contradiction', 'pattern-discovery'] as DreamType[])) {
      if (newDreams.length >= this.config.maxDreamsPerCycle) break;
      const dream = await this.generate(type, recent, available);
      if (dream) {
        this.dreams.set(dream.id, dream);
        this.stats.totalDreams++;
        this.stats.byType[type]++;
        if (dream.actOnNextSession) this.stats.actionableCount++;
        const n = this.stats.totalDreams;
        this.stats.avgConfidence = this.stats.avgConfidence + (dream.confidence - this.stats.avgConfidence) / n;
        newDreams.push(dream);
      }
    }

    this.stats.lastDreamAt = new Date();
    this.stats.totalDreamTimeMs += Date.now() - start;
    await this.persist();
    return newDreams;
  }

  listDreams(opts: { type?: DreamType; unacknowledgedOnly?: boolean; limit?: number } = {}): DreamInsight[] {
    const all = Array.from(this.dreams.values()).sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    return all
      .filter(d => !opts.type || d.type === opts.type)
      .filter(d => !opts.unacknowledgedOnly || !d.acknowledged)
      .slice(0, opts.limit ?? 20);
  }

  async acknowledge(dreamId: string): Promise<boolean> {
    await this.init();
    const d = this.dreams.get(dreamId);
    if (!d) return false;
    d.acknowledged = true;
    this.stats.acknowledgedCount++;
    await this.persist();
    return true;
  }

  getStats(): DreamEngineStats {
    return JSON.parse(JSON.stringify(this.stats));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.config.enabled) return;
    if (Date.now() - this.lastActivityAt < this.config.idleThresholdMs) return;
    await this.dreamOnce().catch(() => {});
  }

  private async generate(type: DreamType, recent: GlobalEntry[], llmAvailable: boolean): Promise<DreamInsight | null> {
    const seeds = recent.slice(0, 6);
    const sourceIds = seeds.map(s => s.id);
    const bullets = seeds.map((s, i) => `${i + 1}. [${s.category}] ${s.content.slice(0, 160)}`).join('\n');

    let content: string;
    let confidence = 0.55;
    let actionable = false;

    // Prefer ModelRegistry (respects user's lead provider + caching) — fall back to LocalLLM
    const DreamSchema = z.object({
      content: z.string().min(4).max(900),
      confidence: z.number().min(0).max(1),
      actionable: z.boolean().optional(),
    });

    try {
      const registry = getModelRegistry();
      await registry.init();
      const intel = registry.getIntelligence();
      const canUseRegistry = intel.leadProvider !== 'none' && llmAvailable;
      if (canUseRegistry) {
        const prompt = this.promptForType(type, bullets) + '\n\nReply as JSON: {"content": "<insight>", "confidence": 0.0-1.0, "actionable": true|false}';
        const result = await generateJson(prompt, DreamSchema, {
          system: 'You are Shadow Brain\'s reflective dream engine. Be terse. Output JSON only.',
          featureName: 'dream-engine',
          maxTokens: 300,
          fallback: { content: this.syntheticDream(type, seeds), confidence: 0.4 },
        });
        content = result.value.content.slice(0, 600);
        confidence = Math.max(0.3, Math.min(1, result.value.confidence));
        actionable = !!result.value.actionable;
      } else if (llmAvailable) {
        // LocalLLM free-text fallback
        const prompt = this.promptForType(type, bullets);
        const res = await this.llm.generate(prompt, 'You are a reflective assistant inside Shadow Brain. Speak tersely.');
        content = res.text.trim();
        confidence = res.provider === 'none' ? 0.4 : 0.7;
      } else {
        content = this.syntheticDream(type, seeds);
      }
    } catch {
      content = this.syntheticDream(type, seeds);
    }

    if (!content) return null;

    return {
      id: `dream-${crypto.randomBytes(6).toString('hex')}`,
      type,
      content: content.slice(0, 600),
      sourceMemoryIds: sourceIds,
      confidence,
      generatedAt: new Date(),
      actOnNextSession: actionable || (confidence >= 0.6 && (type === 'contradiction' || type === 'pattern-discovery')),
      acknowledged: false,
    };
  }

  private promptForType(type: DreamType, bullets: string): string {
    switch (type) {
      case 'revisit':
        return `Revisit these recent decisions and note anything you would change with fresh eyes. Reply in two sentences max.\n\n${bullets}`;
      case 'counterfactual':
        return `Pick the single riskiest decision below and describe in two sentences a counterfactual — what if we had chosen differently?\n\n${bullets}`;
      case 'consolidation':
        return `Extract at most one generalizable pattern from these decisions, in one sentence.\n\n${bullets}`;
      case 'contradiction':
        return `Are any of these decisions in tension with each other? If yes, name the tension in two sentences. If no, say "none".\n\n${bullets}`;
      case 'pattern-discovery':
        return `Find one repeating theme across these items that could become a project principle. Reply with one short sentence.\n\n${bullets}`;
    }
  }

  private syntheticDream(type: DreamType, seeds: GlobalEntry[]): string {
    const cat = seeds[0]?.category ?? 'general';
    switch (type) {
      case 'revisit':
        return `Reviewed ${seeds.length} recent ${cat} decisions; no fresh counter-evidence detected.`;
      case 'counterfactual':
        return `Counterfactual on recent ${cat}: the inverse choice would have traded simplicity for control.`;
      case 'consolidation':
        return `Recurring ${cat} theme: prefer explicit contracts over implicit state.`;
      case 'contradiction':
        return `No hard contradictions found across recent ${cat} decisions.`;
      case 'pattern-discovery':
        return `Emerging ${cat} principle: invariants belong at the edges, not the middle.`;
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        dreams: Array.from(this.dreams.values()),
        stats: this.stats,
        lastActivityAt: this.lastActivityAt,
      };
      const tmp = DREAMS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, DREAMS_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: DreamEngine | null = null;

export function getDreamEngine(opts?: Partial<DreamEngineConfig>): DreamEngine {
  if (!_instance) _instance = new DreamEngine(opts);
  return _instance;
}

export function resetDreamEngineForTests(): void {
  _instance = null;
}
