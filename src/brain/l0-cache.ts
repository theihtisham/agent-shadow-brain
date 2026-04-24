// src/brain/l0-cache.ts — L0 In-Memory Hot Tier (v5.2.0)
//
// Sub-millisecond recall for the hottest brain entries. Sits in front of the
// global JSON brain. Map-based, LRU-evicted, byte-budget-bounded.
//
// Design:
//   - Pure JavaScript Map (insertion-ordered → easy LRU)
//   - Byte budget (default 64MB) prevents memory bloat
//   - Tracks hit/miss for adaptive prefetch decisions
//   - Auto-evict least-recently-accessed when budget exceeded

import { L0CacheEntry, L0CacheStats } from '../types.js';

const DEFAULT_BYTES_LIMIT = 64 * 1024 * 1024; // 64MB

export interface L0CacheOptions {
  bytesLimit?: number;
  /** Estimate bytes for a value when computing budget */
  byteEstimator?: (value: unknown) => number;
}

/** Default byte estimator — works for strings, objects, arrays */
function defaultByteEstimator(value: unknown): number {
  if (value == null) return 8;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (value instanceof Uint8Array) return value.byteLength;
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 64;
  }
}

/** Generic L0 cache. Construct one per logical namespace (recall, vectors, etc.) */
export class L0Cache<T = unknown> {
  private map: Map<string, L0CacheEntry<T>> = new Map();
  private bytesUsed = 0;
  private bytesLimit: number;
  private byteEstimator: (value: unknown) => number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private accessTimingsNs: number[] = [];

  constructor(opts: L0CacheOptions = {}) {
    this.bytesLimit = opts.bytesLimit ?? DEFAULT_BYTES_LIMIT;
    this.byteEstimator = opts.byteEstimator ?? defaultByteEstimator;
  }

  /** Get a value from the cache — sub-microsecond on hit */
  get(key: string): T | undefined {
    const start = process.hrtime.bigint();
    const entry = this.map.get(key);

    if (!entry) {
      this.misses++;
      this.recordTiming(start);
      return undefined;
    }

    // LRU touch — re-insert at end of map
    this.map.delete(key);
    entry.hits++;
    entry.lastAccessed = Date.now();
    this.map.set(key, entry);

    this.hits++;
    this.recordTiming(start);
    return entry.value;
  }

  /** Set a value — evicts LRU entries if over budget */
  set(key: string, value: T): void {
    const bytes = this.byteEstimator(value);

    // If key already exists, subtract its bytes first
    const existing = this.map.get(key);
    if (existing) {
      this.bytesUsed -= existing.bytes;
      this.map.delete(key);
    }

    // Make room
    while (this.bytesUsed + bytes > this.bytesLimit && this.map.size > 0) {
      this.evictOldest();
    }

    const entry: L0CacheEntry<T> = {
      key,
      value,
      hits: 0,
      insertedAt: Date.now(),
      lastAccessed: Date.now(),
      bytes,
    };

    this.map.set(key, entry);
    this.bytesUsed += bytes;
  }

  /** Check existence without touching LRU */
  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Remove a single entry */
  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.bytesUsed -= entry.bytes;
    return this.map.delete(key);
  }

  /** Clear all entries */
  clear(): void {
    this.map.clear();
    this.bytesUsed = 0;
  }

  /** Get cache stats */
  getStats(): L0CacheStats {
    const total = this.hits + this.misses;
    const avgAccessNs = this.accessTimingsNs.length
      ? this.accessTimingsNs.reduce((a, b) => a + b, 0) / this.accessTimingsNs.length
      : 0;

    // Top 10 most-hit keys
    const topKeys = Array.from(this.map.values())
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10)
      .map(e => ({ key: e.key, hits: e.hits }));

    return {
      entries: this.map.size,
      bytesUsed: this.bytesUsed,
      bytesLimit: this.bytesLimit,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      evictions: this.evictions,
      avgAccessNs,
      topKeys,
    };
  }

  /** Iterate entries (for warm-restart persistence) */
  entries(): IterableIterator<[string, L0CacheEntry<T>]> {
    return this.map.entries();
  }

  /** Resize the byte budget — evicts if shrinking */
  resize(newBytesLimit: number): void {
    this.bytesLimit = newBytesLimit;
    while (this.bytesUsed > this.bytesLimit && this.map.size > 0) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    // First entry in Map = oldest by insertion (and we re-insert on touch → LRU)
    const oldest = this.map.keys().next().value;
    if (oldest === undefined) return;
    const entry = this.map.get(oldest);
    if (entry) this.bytesUsed -= entry.bytes;
    this.map.delete(oldest);
    this.evictions++;
  }

  private recordTiming(startNs: bigint): void {
    const elapsedNs = Number(process.hrtime.bigint() - startNs);
    this.accessTimingsNs.push(elapsedNs);
    if (this.accessTimingsNs.length > 1000) {
      this.accessTimingsNs.shift();
    }
  }
}

/** Process-wide singleton caches — one per logical namespace */
const caches = new Map<string, L0Cache<any>>();

export function getCache<T = unknown>(namespace: string, opts?: L0CacheOptions): L0Cache<T> {
  let cache = caches.get(namespace);
  if (!cache) {
    cache = new L0Cache<T>(opts);
    caches.set(namespace, cache);
  }
  return cache as L0Cache<T>;
}

export function getAllCacheStats(): Record<string, L0CacheStats> {
  const out: Record<string, L0CacheStats> = {};
  for (const [name, cache] of caches.entries()) {
    out[name] = cache.getStats();
  }
  return out;
}

export function clearAllCaches(): void {
  for (const cache of caches.values()) cache.clear();
}
