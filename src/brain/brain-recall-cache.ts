// src/brain/brain-recall-cache.ts — Bloom-prefiltered, context-aware recall cache
// v6.0.2 — Hive Mind Edition
//
// General-purpose cache for ANY brain query (working-memory is the "in-context"
// fast tier; this is the broader cache). Architecture:
//
//   1. Bloom filter (65536 bits, 4 hash strategies: FNV-1a, djb2, sdbm, xor-roll)
//      → instantly rejects obvious misses before paying the ANN cost.
//   2. LRU map (2048 entries, doubly-linked-list + Map for O(1) ops)
//      keyed by hash(query) + contextHash. Bumping contextHash invalidates a
//      whole brain-version generation.
//   3. Smart invalidation on writes: reverse index memoryId → cachedKeys.
//      When `observeWrite(memId)` fires, only the affected entries are pruned.
//
// Stats (not contents) are persisted to ~/.shadow-brain/recall-cache.stats.json
// so reset-on-restart doesn't lose long-running hit-rate observability.
//
// Exposed: BrainRecallCache, getBrainRecallCache(),
//          resetBrainRecallCacheForTests().

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STATS_DIR = path.join(os.homedir(), '.shadow-brain');
const STATS_PATH = path.join(STATS_DIR, 'recall-cache.stats.json');
const CONFIG_PATH = path.join(STATS_DIR, 'config.json');

const DEFAULT_LRU_CAPACITY = 2048;
const MAX_LRU_CAPACITY = 16384;
const BLOOM_BITS = 65536; // 8 KB
const BLOOM_HASH_FUNCTIONS = 4;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30m
const STATS_PERSIST_EVERY = 50;

export interface CachedResult {
  result: unknown;
  storedAt: number;
  ttlMs: number;
  contextHash: string;
  /** Memory ids referenced by this cached result (for smart invalidation). */
  memoryIds: string[];
  /** Optional project tag for project-scoped invalidation. */
  project?: string;
}

export interface RecallCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  bloomFP: number;
  evictions: number;
  size: number;
}

export interface InvalidateOpts {
  key?: string;
  contextHash?: string;
  project?: string;
  /** Invalidate entries stored before this timestamp (ms). */
  before?: number;
}

export interface PutOpts {
  memoryIds?: string[];
  project?: string;
}

// ── Internal node for the doubly-linked list ─────────────────────────────────

interface Node {
  key: string;
  value: CachedResult;
  prev: Node | null;
  next: Node | null;
}

// ── Bloom filter ─────────────────────────────────────────────────────────────

class BloomFilter {
  readonly bits: Uint8Array;
  readonly numBits: number;
  readonly k: number;
  private inserted = 0;

  constructor(numBits = BLOOM_BITS, k = BLOOM_HASH_FUNCTIONS) {
    this.numBits = numBits;
    this.k = k;
    this.bits = new Uint8Array(numBits >>> 3);
  }

  add(key: string): void {
    for (const idx of this.indices(key)) this.setBit(idx);
    this.inserted++;
  }

  /** True if the key *might* be present. False = definitely not. */
  has(key: string): boolean {
    for (const idx of this.indices(key)) if (!this.getBit(idx)) return false;
    return true;
  }

  clear(): void {
    this.bits.fill(0);
    this.inserted = 0;
  }

  /** Approximate false-positive probability given current load. */
  fpRate(): number {
    if (this.inserted === 0) return 0;
    // (1 - e^(-k*n/m))^k
    const ratio = (this.k * this.inserted) / this.numBits;
    const p = Math.pow(1 - Math.exp(-ratio), this.k);
    return +p.toFixed(5);
  }

  private indices(key: string): number[] {
    // 4 independent hashes — strategies are intentionally different so
    // correlated keys spread out.
    const h1 = hashFnv1a(key) % this.numBits;
    const h2 = hashDjb2(key) % this.numBits;
    const h3 = hashSdbm(key) % this.numBits;
    const h4 = hashXorRoll(key) % this.numBits;
    return [h1, h2, h3, h4].slice(0, this.k);
  }

  private setBit(idx: number): void {
    const byte = idx >>> 3;
    const bit = idx & 7;
    this.bits[byte] |= (1 << bit);
  }

  private getBit(idx: number): boolean {
    const byte = idx >>> 3;
    const bit = idx & 7;
    return (this.bits[byte] & (1 << bit)) !== 0;
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────

export class BrainRecallCache {
  private capacity = DEFAULT_LRU_CAPACITY;
  private map: Map<string, Node> = new Map();
  private head: Node | null = null; // most recent
  private tail: Node | null = null; // least recent

  private bloom = new BloomFilter();

  /** memoryId → set of cache keys that referenced it. */
  private memToKeys: Map<string, Set<string>> = new Map();
  /** project → set of cache keys (for project-scoped invalidation). */
  private projectToKeys: Map<string, Set<string>> = new Map();

  private hits = 0;
  private misses = 0;
  private bloomNegatives = 0;
  /** Count where bloom said "maybe" but LRU said "no" → false positive. */
  private bloomFalsePositives = 0;
  private evictions = 0;
  private writesSincePersist = 0;
  private initialized = false;

  private init(): void {
    if (this.initialized) return;
    try { fs.mkdirSync(STATS_DIR, { recursive: true }); } catch { /* non-fatal */ }
    this.loadConfig();
    this.loadStats();
    this.initialized = true;
  }

  /** Look up a cached entry. contextHash filters by brain state version. */
  lookup(key: string, contextHash?: string): CachedResult | null {
    this.init();
    const ck = composeKey(key, contextHash);
    if (!this.bloom.has(ck)) {
      this.misses++;
      this.bloomNegatives++;
      return null;
    }
    const node = this.map.get(ck);
    if (!node) {
      // Bloom said maybe, LRU said no — counted as a bloom FP.
      this.misses++;
      this.bloomFalsePositives++;
      return null;
    }
    // TTL check.
    const v = node.value;
    if (v.ttlMs > 0 && Date.now() - v.storedAt > v.ttlMs) {
      this.removeNode(node);
      this.map.delete(ck);
      this.untrackKey(ck, v);
      this.misses++;
      return null;
    }
    // ContextHash mismatch is impossible by construction (it's in the key),
    // but double-check for safety.
    if (contextHash !== undefined && v.contextHash !== contextHash) {
      this.misses++;
      return null;
    }
    this.touch(node);
    this.hits++;
    return v;
  }

  put(key: string, contextHash: string, result: unknown, ttlMs?: number, opts?: PutOpts): void {
    this.init();
    const ck = composeKey(key, contextHash);
    const value: CachedResult = {
      result,
      storedAt: Date.now(),
      ttlMs: ttlMs ?? DEFAULT_TTL_MS,
      contextHash,
      memoryIds: opts?.memoryIds ? Array.from(new Set(opts.memoryIds)) : [],
      project: opts?.project,
    };
    const existing = this.map.get(ck);
    if (existing) {
      this.untrackKey(ck, existing.value);
      existing.value = value;
      this.touch(existing);
    } else {
      const node: Node = { key: ck, value, prev: null, next: null };
      this.map.set(ck, node);
      this.addToFront(node);
      this.bloom.add(ck);
      while (this.map.size > this.capacity) this.evictLru();
    }
    this.trackKey(ck, value);
    this.writesSincePersist++;
    if (this.writesSincePersist >= STATS_PERSIST_EVERY) {
      this.writesSincePersist = 0;
      this.persistStats().catch(() => {});
    }
  }

  invalidate(opts: InvalidateOpts): { invalidated: number } {
    this.init();
    let count = 0;
    const drop = (k: string) => {
      const n = this.map.get(k);
      if (!n) return;
      this.removeNode(n);
      this.map.delete(k);
      this.untrackKey(k, n.value);
      count++;
    };

    if (opts.key !== undefined && opts.contextHash !== undefined) {
      drop(composeKey(opts.key, opts.contextHash));
    } else if (opts.key !== undefined) {
      // Drop all entries whose raw key matches, across any contextHash.
      for (const k of Array.from(this.map.keys())) {
        if (k.startsWith(opts.key + '|')) drop(k);
      }
    } else if (opts.contextHash !== undefined) {
      for (const k of Array.from(this.map.keys())) {
        if (k.endsWith('|' + opts.contextHash)) drop(k);
      }
    } else if (opts.project !== undefined) {
      const keys = this.projectToKeys.get(opts.project);
      if (keys) for (const k of Array.from(keys)) drop(k);
    } else if (opts.before !== undefined) {
      for (const k of Array.from(this.map.keys())) {
        const n = this.map.get(k);
        if (n && n.value.storedAt < opts.before) drop(k);
      }
    }

    // If we cleared a meaningful chunk, rebuild bloom from remaining keys.
    if (count > 0 && (count > 8 || this.map.size === 0)) this.rebuildBloom();
    return { invalidated: count };
  }

  /** Call when a brain memory is added/updated → prune any cached top-N that referenced it. */
  observeWrite(memoryId: string): void {
    this.init();
    const keys = this.memToKeys.get(memoryId);
    if (!keys || keys.size === 0) return;
    let removed = 0;
    for (const k of Array.from(keys)) {
      const n = this.map.get(k);
      if (!n) continue;
      this.removeNode(n);
      this.map.delete(k);
      this.untrackKey(k, n.value);
      removed++;
    }
    this.memToKeys.delete(memoryId);
    if (removed > 8) this.rebuildBloom();
  }

  stats(): RecallCacheStats {
    this.init();
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? +(this.hits / total).toFixed(4) : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate,
      bloomFP: this.bloom.fpRate(),
      evictions: this.evictions,
      size: this.map.size,
    };
  }

  /** Wipe contents and metrics. Stats file is removed. */
  reset(): void {
    this.map.clear();
    this.memToKeys.clear();
    this.projectToKeys.clear();
    this.bloom.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
    this.bloomNegatives = 0;
    this.bloomFalsePositives = 0;
    this.evictions = 0;
    this.writesSincePersist = 0;
    try { if (fs.existsSync(STATS_PATH)) fs.unlinkSync(STATS_PATH); } catch { /* non-fatal */ }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private trackKey(ck: string, value: CachedResult): void {
    for (const mid of value.memoryIds) {
      let set = this.memToKeys.get(mid);
      if (!set) { set = new Set(); this.memToKeys.set(mid, set); }
      set.add(ck);
    }
    if (value.project) {
      let set = this.projectToKeys.get(value.project);
      if (!set) { set = new Set(); this.projectToKeys.set(value.project, set); }
      set.add(ck);
    }
  }

  private untrackKey(ck: string, value: CachedResult): void {
    for (const mid of value.memoryIds) {
      const set = this.memToKeys.get(mid);
      if (set) {
        set.delete(ck);
        if (set.size === 0) this.memToKeys.delete(mid);
      }
    }
    if (value.project) {
      const set = this.projectToKeys.get(value.project);
      if (set) {
        set.delete(ck);
        if (set.size === 0) this.projectToKeys.delete(value.project);
      }
    }
  }

  private evictLru(): void {
    const lru = this.tail;
    if (!lru) return;
    this.removeNode(lru);
    this.map.delete(lru.key);
    this.untrackKey(lru.key, lru.value);
    this.evictions++;
  }

  private touch(node: Node): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToFront(node);
  }

  private addToFront(node: Node): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: Node): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private rebuildBloom(): void {
    this.bloom.clear();
    for (const k of this.map.keys()) this.bloom.add(k);
  }

  private loadConfig(): void {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as { recallCache?: { capacity?: number } };
      const cap = raw.recallCache?.capacity;
      if (typeof cap === 'number' && cap > 0 && cap <= MAX_LRU_CAPACITY) this.capacity = Math.floor(cap);
    } catch { /* defaults */ }
  }

  private loadStats(): void {
    try {
      if (!fs.existsSync(STATS_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8')) as Partial<RecallCacheStats> & {
        bloomNegatives?: number;
        bloomFalsePositives?: number;
      };
      this.hits = raw.hits ?? 0;
      this.misses = raw.misses ?? 0;
      this.evictions = raw.evictions ?? 0;
      this.bloomNegatives = raw.bloomNegatives ?? 0;
      this.bloomFalsePositives = raw.bloomFalsePositives ?? 0;
    } catch { /* skip */ }
  }

  private async persistStats(): Promise<void> {
    try {
      const total = this.hits + this.misses;
      const payload = {
        hits: this.hits,
        misses: this.misses,
        hitRate: total > 0 ? +(this.hits / total).toFixed(4) : 0,
        bloomFP: this.bloom.fpRate(),
        bloomNegatives: this.bloomNegatives,
        bloomFalsePositives: this.bloomFalsePositives,
        evictions: this.evictions,
        size: this.map.size,
        savedAt: Date.now(),
      };
      const tmp = STATS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, STATS_PATH);
    } catch { /* non-fatal */ }
  }
}

// ── Key + Hashes ────────────────────────────────────────────────────────────

function composeKey(key: string, contextHash?: string): string {
  const ch = (contextHash ?? '').trim();
  return key + '|' + ch;
}

function hashFnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hashDjb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function hashSdbm(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (s.charCodeAt(i) + (h << 6) + (h << 16) - h) | 0;
  return h >>> 0;
}

function hashXorRoll(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) | (h >>> 27)) ^ s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let _instance: BrainRecallCache | null = null;
export function getBrainRecallCache(): BrainRecallCache {
  if (!_instance) _instance = new BrainRecallCache();
  return _instance;
}
export function resetBrainRecallCacheForTests(): void { _instance = null; }
