// src/brain/brain-working-memory.ts — Predictive prefetch LRU for brain recall
// v6.0.2 — Hive Mind Edition
//
// The "RAM" of the brain. A small hot cache of "what's about to be needed"
// keyed by query string. Predicts next likely queries from session context
// (active file, recent edits, agent type, recent queries) and pre-warms the
// embeddings index so in-context recall is sub-10ms on hit.
//
// Heuristics are deterministic (no LLM):
//   - File-pattern: auth.ts → "auth handling", "session", "login"
//   - Recent-query continuation: pulls related neighbors from the brain
//   - Agent-specific: Cursor leans completion-style; Claude Code diagnostic
//
// Persisted to ~/.shadow-brain/working-memory.json so warm survives restarts.
// LRU evictions are tracked; capacity auto-grows (256 → 1024) when hit rate
// drops below 0.5.
//
// Exposed: BrainWorkingMemory, getBrainWorkingMemory(),
//          resetBrainWorkingMemoryForTests().

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EmbeddingsV2, getEmbeddingsV2 } from './embeddings-v2.js';

const STORE_DIR = path.join(os.homedir(), '.shadow-brain');
const STORE_PATH = path.join(STORE_DIR, 'working-memory.json');
const CONFIG_PATH = path.join(STORE_DIR, 'config.json');

const DEFAULT_CAPACITY = 256;
const MAX_CAPACITY = 1024;
const GROW_THRESHOLD = 0.5;
const MIN_SAMPLES_BEFORE_GROW = 50;
const PERSIST_EVERY_N_WRITES = 10;

export interface SessionContext {
  project: string;
  activeFile?: string;
  recentFiles?: string[];
  recentEdits?: Array<{ file: string; type: string; ts: number }>;
  activeAgent?: string;
  recentQueries?: string[];
}

export interface CachedRecall {
  query: string;
  project: string;
  hits: Array<{ id: string; score: number; text: string }>;
  storedAt: number;
  source: 'prefetch' | 'observe' | 'direct';
}

export interface WorkingMemoryStats {
  capacity: number;
  used: number;
  hitRate: number;
  evictionsCount: number;
  prefetchHitRate: number;
}

interface LruEntry {
  key: string;
  value: CachedRecall;
}

interface PersistShape {
  schemaVersion: 1;
  capacity: number;
  entries: Array<{ key: string; value: CachedRecall }>;
  metrics: { hits: number; misses: number; prefetchHits: number; prefetchedTotal: number; evictionsCount: number };
}

const FILE_PATTERN_HINTS: Array<{ match: RegExp; queries: string[] }> = [
  { match: /auth/i, queries: ['auth handling', 'session', 'login', 'token', 'permissions'] },
  { match: /login|signin/i, queries: ['login flow', 'credentials', 'session', 'oauth'] },
  { match: /pay|billing|invoice|stripe/i, queries: ['payment', 'billing', 'invoice', 'refund'] },
  { match: /user|account|profile/i, queries: ['user model', 'profile', 'account settings'] },
  { match: /db|database|schema|migration|prisma|drizzle/i, queries: ['schema', 'migration', 'query', 'index'] },
  { match: /route|router|controller/i, queries: ['routing', 'endpoint', 'handler', 'middleware'] },
  { match: /test|spec/i, queries: ['testing', 'mock', 'fixture', 'coverage'] },
  { match: /config|env|settings/i, queries: ['configuration', 'environment', 'settings'] },
  { match: /cache|redis|memcache/i, queries: ['caching', 'ttl', 'eviction', 'hit rate'] },
  { match: /queue|worker|job/i, queries: ['background job', 'queue', 'worker', 'retry'] },
  { match: /api|client|fetch|axios/i, queries: ['api client', 'request', 'response', 'error handling'] },
  { match: /component|view|page/i, queries: ['component', 'render', 'state', 'props'] },
  { match: /style|css|theme/i, queries: ['styling', 'theme', 'css', 'responsive'] },
  { match: /security|crypt|hash/i, queries: ['security', 'encryption', 'hash', 'token'] },
  { match: /log|monitor|metric|trace/i, queries: ['logging', 'monitoring', 'metrics'] },
  { match: /websocket|socket|realtime|sse/i, queries: ['realtime', 'websocket', 'event stream'] },
  { match: /upload|file|media|image/i, queries: ['file upload', 'storage', 'media handling'] },
];

const AGENT_BIASES: Record<string, string[]> = {
  cursor: ['autocomplete context', 'symbol reference', 'usage example', 'inline doc'],
  'claude-code': ['root cause', 'why does', 'fix for', 'related test', 'recent change'],
  copilot: ['similar function', 'imports', 'type definition'],
  windsurf: ['workspace layout', 'related file', 'pattern reference'],
  cline: ['plan step', 'todo', 'next action'],
};

export class BrainWorkingMemory {
  private capacity = DEFAULT_CAPACITY;
  private lru: Map<string, CachedRecall> = new Map();
  private hits = 0;
  private misses = 0;
  private prefetchHits = 0;
  private prefetchedTotal = 0;
  private evictionsCount = 0;
  private prefetchedKeys: Set<string> = new Set();
  private writesSinceFlush = 0;
  private latestContext: SessionContext | null = null;
  private initialized = false;
  private readonly index: EmbeddingsV2;

  constructor(opts?: { index?: EmbeddingsV2 }) {
    this.index = opts?.index ?? getEmbeddingsV2();
  }

  /** Lazy init — loads persisted entries + config. Safe to call repeatedly. */
  private init(): void {
    if (this.initialized) return;
    try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch { /* non-fatal */ }
    this.loadConfig();
    this.loadStore();
    this.initialized = true;
  }

  /** Feed the latest session context. Used for predictions on next get/prefetch. */
  observe(context: SessionContext): void {
    this.init();
    this.latestContext = { ...context };
  }

  /** Sub-10ms fast path. Returns null if not cached. */
  async get(query: string): Promise<CachedRecall | null> {
    this.init();
    const key = this.keyOf(query, this.latestContext?.project);
    const entry = this.lru.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    // LRU touch — re-insert at end.
    this.lru.delete(key);
    this.lru.set(key, entry);
    this.hits++;
    if (this.prefetchedKeys.has(key)) {
      this.prefetchHits++;
      this.prefetchedKeys.delete(key);
    }
    this.maybeGrow();
    return entry;
  }

  /** Predict next likely queries from the latest context. Deterministic, no LLM. */
  async predictNext(opts?: { topK?: number }): Promise<string[]> {
    this.init();
    const topK = Math.max(1, Math.min(64, opts?.topK ?? 8));
    const ctx = this.latestContext;
    if (!ctx) return [];

    const scored: Map<string, number> = new Map();
    const bump = (q: string, w: number) => {
      const norm = q.trim().toLowerCase();
      if (!norm) return;
      scored.set(norm, (scored.get(norm) ?? 0) + w);
    };

    // File-pattern hints (active file weighs more than recent).
    if (ctx.activeFile) {
      for (const q of hintsForPath(ctx.activeFile)) bump(q, 3);
    }
    for (const rf of (ctx.recentFiles ?? []).slice(0, 5)) {
      for (const q of hintsForPath(rf)) bump(q, 1.5);
    }
    for (const e of (ctx.recentEdits ?? []).slice(0, 5)) {
      for (const q of hintsForPath(e.file)) bump(q, 2);
    }

    // Agent bias.
    const agentKey = (ctx.activeAgent ?? '').toLowerCase();
    const biases = AGENT_BIASES[agentKey] ?? AGENT_BIASES[agentKey.replace(/[^a-z]/g, '')] ?? [];
    for (const b of biases) bump(b, 1);

    // Recent-query continuation — pull neighbor candidates from the brain index.
    const recentQ = (ctx.recentQueries ?? []).slice(-3);
    for (const rq of recentQ) {
      bump(rq, 0.5); // baseline weight for the query itself
      try {
        const hits = await this.index.search(rq, 4);
        for (const h of hits) {
          // Use the first sentence of the brain text as a "follow-up" candidate query.
          const seed = firstSentence(h.text);
          if (seed) bump(seed, 0.6);
        }
      } catch { /* ignore index errors */ }
    }

    return Array.from(scored.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([q]) => q);
  }

  /** Fire-and-forget warm. Queries are embedded + searched, results cached. */
  async prefetch(queries: string[], project: string): Promise<{ prefetched: number; durationMs: number }> {
    this.init();
    const t0 = Date.now();
    let prefetched = 0;
    const unique = Array.from(new Set(queries.map(q => q.trim()).filter(Boolean)));
    for (const q of unique) {
      const key = this.keyOf(q, project);
      if (this.lru.has(key)) continue;
      try {
        const hits = await this.index.search(q, 10);
        const value: CachedRecall = {
          query: q,
          project,
          hits: hits.map(h => ({ id: h.id, score: h.score, text: h.text })),
          storedAt: Date.now(),
          source: 'prefetch',
        };
        this.putEntry(key, value);
        this.prefetchedKeys.add(key);
        prefetched++;
        this.prefetchedTotal++;
      } catch { /* skip on error */ }
    }
    return { prefetched, durationMs: Date.now() - t0 };
  }

  stats(): WorkingMemoryStats {
    this.init();
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? +(this.hits / total).toFixed(4) : 0;
    const prefetchHitRate = this.prefetchedTotal > 0
      ? +(this.prefetchHits / this.prefetchedTotal).toFixed(4)
      : 0;
    return {
      capacity: this.capacity,
      used: this.lru.size,
      hitRate,
      evictionsCount: this.evictionsCount,
      prefetchHitRate,
    };
  }

  /** Persist current contents to disk. */
  async flush(): Promise<void> {
    this.init();
    await this.persist();
  }

  /** Wipe contents + metrics. Persistence is cleared. */
  reset(): void {
    this.lru.clear();
    this.prefetchedKeys.clear();
    this.hits = 0;
    this.misses = 0;
    this.prefetchHits = 0;
    this.prefetchedTotal = 0;
    this.evictionsCount = 0;
    this.writesSinceFlush = 0;
    try { if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH); } catch { /* non-fatal */ }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private putEntry(key: string, value: CachedRecall): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, value);
    while (this.lru.size > this.capacity) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
      this.prefetchedKeys.delete(oldest);
      this.evictionsCount++;
    }
    this.writesSinceFlush++;
    if (this.writesSinceFlush >= PERSIST_EVERY_N_WRITES) {
      this.writesSinceFlush = 0;
      this.persist().catch(() => {});
    }
  }

  private maybeGrow(): void {
    const total = this.hits + this.misses;
    if (total < MIN_SAMPLES_BEFORE_GROW) return;
    if (this.capacity >= MAX_CAPACITY) return;
    const hitRate = this.hits / total;
    if (hitRate < GROW_THRESHOLD) {
      this.capacity = Math.min(MAX_CAPACITY, Math.max(this.capacity * 2, this.capacity + 64));
      this.persistConfig().catch(() => {});
    }
  }

  private keyOf(query: string, project?: string): string {
    const p = (project ?? '').trim().toLowerCase();
    const q = query.trim().toLowerCase();
    return p + '' + q;
  }

  private loadConfig(): void {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as { workingMemory?: { capacity?: number } };
      const cap = raw.workingMemory?.capacity;
      if (typeof cap === 'number' && cap > 0 && cap <= MAX_CAPACITY) this.capacity = Math.floor(cap);
    } catch { /* fall back to defaults */ }
  }

  private async persistConfig(): Promise<void> {
    try {
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(CONFIG_PATH)) {
        try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>; }
        catch { existing = {}; }
      }
      existing.workingMemory = { capacity: this.capacity };
      const tmp = CONFIG_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
      fs.renameSync(tmp, CONFIG_PATH);
    } catch { /* non-fatal */ }
  }

  private loadStore(): void {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as PersistShape;
      if (parsed.schemaVersion !== 1) return;
      this.capacity = Math.min(MAX_CAPACITY, Math.max(parsed.capacity || DEFAULT_CAPACITY, 1));
      this.hits = parsed.metrics?.hits ?? 0;
      this.misses = parsed.metrics?.misses ?? 0;
      this.prefetchHits = parsed.metrics?.prefetchHits ?? 0;
      this.prefetchedTotal = parsed.metrics?.prefetchedTotal ?? 0;
      this.evictionsCount = parsed.metrics?.evictionsCount ?? 0;
      for (const { key, value } of parsed.entries ?? []) {
        this.lru.set(key, value);
        if (this.lru.size > this.capacity) {
          const oldest = this.lru.keys().next().value;
          if (oldest !== undefined) this.lru.delete(oldest);
        }
      }
    } catch { /* skip corrupt store */ }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        capacity: this.capacity,
        entries: Array.from(this.lru.entries()).map(([key, value]) => ({ key, value })),
        metrics: {
          hits: this.hits,
          misses: this.misses,
          prefetchHits: this.prefetchHits,
          prefetchedTotal: this.prefetchedTotal,
          evictionsCount: this.evictionsCount,
        },
      };
      const tmp = STORE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, STORE_PATH);
    } catch { /* non-fatal */ }
  }
}

function hintsForPath(filePath: string): string[] {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const out: string[] = [];
  for (const rule of FILE_PATTERN_HINTS) {
    if (rule.match.test(base) || rule.match.test(filePath)) {
      for (const q of rule.queries) out.push(q);
    }
  }
  // Also seed a query from the bare module name (auth.ts → "auth").
  const stem = base.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
  if (stem && stem.length <= 40) out.push(stem);
  return out;
}

function firstSentence(text: string): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  const cut = t.search(/[.!?]\s/);
  const seed = cut > 0 ? t.slice(0, cut) : t.slice(0, 80);
  return seed.length > 4 ? seed : '';
}

let _instance: BrainWorkingMemory | null = null;
export function getBrainWorkingMemory(): BrainWorkingMemory {
  if (!_instance) _instance = new BrainWorkingMemory();
  return _instance;
}
export function resetBrainWorkingMemoryForTests(): void { _instance = null; }
