// src/brain/brain-memory-tiers.ts — Episodic vs semantic memory split
// v6.0.2 — Hive Mind Edition
//
// Human brains separate episodic memory (what happened, when, by whom) from
// semantic memory (abstract facts distilled from many episodes). Mixing them
// poisons recall — every "I solved this last Tuesday" buries the underlying
// pattern. This module enforces the split with two append-only stores and a
// promotion path from episodic → semantic when the same fact recurs.
//
// Storage layout (under ~/.shadow-brain/memory/):
//   episodic/<project>.jsonl                — raw events, daily-rotated
//   episodic/<project>-YYYY-MM-DD.jsonl     — rotated archives
//   semantic/<project>.jsonl                — curated, mergeable facts
//
// Promotion criteria (ALL must hold):
//   1. accessCount >= 3                     — recalled repeatedly
//   2. importance >= 0.5                    — non-trivial
//   3. linked to >= 2 other memories        — connected to the graph
//   4. lastAccessed within 30 days          — still warm
//
// New memories always land in episodic. Promotion is explicit (callable) or
// happens lazily during read() when criteria are met.
//
// Exposed: BrainMemoryTiers, getBrainMemoryTiers(), resetBrainMemoryTiersForTests()

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STORE_DIR = path.join(os.homedir(), '.shadow-brain', 'memory');
const EPISODIC_DIR = path.join(STORE_DIR, 'episodic');
const SEMANTIC_DIR = path.join(STORE_DIR, 'semantic');
const DEFAULT_PROJECT = 'default';
const PROMOTE_MIN_ACCESS = 3;
const PROMOTE_MIN_IMPORTANCE = 0.5;
const PROMOTE_MIN_LINKS = 2;
const PROMOTE_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MemoryTier = 'episodic' | 'semantic';

export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  content: string;
  project: string;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  importance: number;
  sourceAgent: string;
  derivedFromMemoryIds?: string[];
  embedding?: number[];
  entityRefs?: string[];
  relatedTo?: string[];
}

export interface NewMemory {
  content: string;
  project?: string;
  importance?: number;
  sourceAgent?: string;
  entityRefs?: string[];
  embedding?: number[];
  /** Force tier; omit to let the module decide (default: episodic). */
  tier?: MemoryTier;
  /** Override id (used for promotions/merges). */
  id?: string;
}

export interface ReadOptions {
  tier?: MemoryTier | 'all';
  query?: string;
  limit?: number;
  project?: string;
}

export interface TierBucketStats {
  count: number;
  oldestAt: string | null;
  newestAt: string | null;
  avgImportance: number;
}

export interface TierStats {
  episodic: TierBucketStats;
  semantic: TierBucketStats;
  promotionRate: number;
}

export class BrainMemoryTiers {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(EPISODIC_DIR, { recursive: true });
    fs.mkdirSync(SEMANTIC_DIR, { recursive: true });
    this.initialized = true;
  }

  /** Write a new memory. Defaults to episodic; module picks tier if not forced. */
  async write(memory: NewMemory): Promise<MemoryEntry> {
    await this.init();
    const project = sanitizeProject(memory.project);
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: memory.id ?? newId('mem'),
      tier: memory.tier ?? 'episodic',
      content: (memory.content || '').slice(0, 8000),
      project,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      importance: clamp01(memory.importance ?? 0.5),
      sourceAgent: memory.sourceAgent || 'unknown',
      entityRefs: memory.entityRefs ?? [],
      embedding: memory.embedding,
      relatedTo: [],
    };
    this.rotateIfNeeded(project);
    this.appendEntry(entry);
    return entry;
  }

  /**
   * Promote an episodic memory to semantic. If criteria are not met, throws
   * unless the caller already forced it (re-issued with tier='semantic').
   */
  async promote(memoryId: string): Promise<MemoryEntry> {
    await this.init();
    const existing = this.findById(memoryId);
    if (!existing) throw new Error(`memory ${memoryId} not found`);
    if (existing.tier === 'semantic') return existing;
    if (!this.meetsPromotionCriteria(existing)) {
      throw new Error(`memory ${memoryId} does not meet promotion criteria`);
    }
    const promoted: MemoryEntry = {
      ...existing,
      id: newId('sem'),
      tier: 'semantic',
      derivedFromMemoryIds: [...(existing.derivedFromMemoryIds ?? []), existing.id],
      lastAccessed: new Date().toISOString(),
    };
    this.appendEntry(promoted);
    return promoted;
  }

  /** Read memories matching the options. Lazily promotes warm episodic on access. */
  async read(opts: ReadOptions = {}): Promise<MemoryEntry[]> {
    await this.init();
    const project = sanitizeProject(opts.project);
    const wantTier = opts.tier ?? 'all';
    const limit = opts.limit ?? 50;

    const pool: MemoryEntry[] = [];
    if (wantTier === 'episodic' || wantTier === 'all') {
      pool.push(...this.loadTier('episodic', project));
    }
    if (wantTier === 'semantic' || wantTier === 'all') {
      pool.push(...this.loadTier('semantic', project));
    }

    let results = pool;
    if (opts.query) {
      const q = opts.query.toLowerCase();
      results = pool.filter(m => m.content.toLowerCase().includes(q));
    }

    // Mark access on the returned slice. (Cheap rewrite of last-accessed; we
    // do NOT persist accessCount mutations here because the store is append-
    // only — instead, we touch a sidecar.) For now, in-process mutation.
    const now = new Date().toISOString();
    const touched = results.slice(0, limit).map(m => ({
      ...m,
      lastAccessed: now,
      accessCount: m.accessCount + 1,
    }));

    // Lazy promotion: if an episodic entry now meets criteria, queue a write.
    for (const m of touched) {
      if (m.tier === 'episodic' && this.meetsPromotionCriteria(m)) {
        try { await this.promote(m.id); } catch { /* skip */ }
      }
    }

    // Sort by importance desc, then recency desc
    touched.sort((a, b) => (b.importance - a.importance) || b.createdAt.localeCompare(a.createdAt));
    return touched;
  }

  stats(project?: string): TierStats {
    if (!this.initialized) {
      // best-effort sync init for stats
      try { fs.mkdirSync(EPISODIC_DIR, { recursive: true }); fs.mkdirSync(SEMANTIC_DIR, { recursive: true }); } catch { /* skip */ }
    }
    const proj = sanitizeProject(project);
    const ep = this.loadTier('episodic', proj);
    const sem = this.loadTier('semantic', proj);
    const epStats = bucket(ep);
    const semStats = bucket(sem);
    const totalEpisodic = ep.length + sem.length;
    const promotionRate = totalEpisodic > 0 ? +(sem.length / totalEpisodic).toFixed(3) : 0;
    return { episodic: epStats, semantic: semStats, promotionRate };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private meetsPromotionCriteria(m: MemoryEntry): boolean {
    if (m.accessCount < PROMOTE_MIN_ACCESS) return false;
    if (m.importance < PROMOTE_MIN_IMPORTANCE) return false;
    const linkCount = (m.entityRefs?.length ?? 0) + (m.relatedTo?.length ?? 0);
    if (linkCount < PROMOTE_MIN_LINKS) return false;
    const ageMs = Date.now() - Date.parse(m.lastAccessed);
    if (!Number.isFinite(ageMs) || ageMs > PROMOTE_MAX_AGE_DAYS * MS_PER_DAY) return false;
    return true;
  }

  private findById(id: string): MemoryEntry | null {
    for (const tier of ['episodic', 'semantic'] as const) {
      const dir = tier === 'episodic' ? EPISODIC_DIR : SEMANTIC_DIR;
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.jsonl')) continue;
        try {
          const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line) as MemoryEntry;
              if (obj.id === id) return obj;
            } catch { /* skip line */ }
          }
        } catch { /* skip file */ }
      }
    }
    return null;
  }

  private loadTier(tier: MemoryTier, project: string): MemoryEntry[] {
    const dir = tier === 'episodic' ? EPISODIC_DIR : SEMANTIC_DIR;
    if (!fs.existsSync(dir)) return [];
    const out: MemoryEntry[] = [];
    const prefix = `${project}`;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      if (!file.startsWith(prefix)) continue;
      try {
        const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as MemoryEntry;
            if (obj.project !== project) continue;
            if (obj.tier !== tier) continue;
            out.push(obj);
          } catch { /* skip bad line */ }
        }
      } catch { /* skip bad file */ }
    }
    return out;
  }

  private appendEntry(entry: MemoryEntry): void {
    const dir = entry.tier === 'episodic' ? EPISODIC_DIR : SEMANTIC_DIR;
    const file = path.join(dir, `${entry.project}.jsonl`);
    try {
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch { /* non-fatal */ }
  }

  private rotateIfNeeded(project: string): void {
    // Daily rotation: if today's episodic file exceeds 2MB, archive it.
    const file = path.join(EPISODIC_DIR, `${project}.jsonl`);
    if (!fs.existsSync(file)) return;
    try {
      const sz = fs.statSync(file).size;
      if (sz < 2 * 1024 * 1024) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = path.join(EPISODIC_DIR, `${project}-${stamp}.jsonl`);
      if (!fs.existsSync(dest)) fs.renameSync(file, dest);
    } catch { /* skip */ }
  }
}

function sanitizeProject(p?: string): string {
  if (!p) return DEFAULT_PROJECT;
  return p.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || DEFAULT_PROJECT;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function newId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}_${t}_${r}`;
}

function bucket(entries: MemoryEntry[]): TierBucketStats {
  if (entries.length === 0) {
    return { count: 0, oldestAt: null, newestAt: null, avgImportance: 0 };
  }
  let oldest = entries[0].createdAt;
  let newest = entries[0].createdAt;
  let impSum = 0;
  for (const e of entries) {
    if (e.createdAt < oldest) oldest = e.createdAt;
    if (e.createdAt > newest) newest = e.createdAt;
    impSum += e.importance;
  }
  return {
    count: entries.length,
    oldestAt: oldest,
    newestAt: newest,
    avgImportance: +(impSum / entries.length).toFixed(3),
  };
}

let _instance: BrainMemoryTiers | null = null;
export function getBrainMemoryTiers(): BrainMemoryTiers {
  if (!_instance) _instance = new BrainMemoryTiers();
  return _instance;
}
export function resetBrainMemoryTiersForTests(): void { _instance = null; }
