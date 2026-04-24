// src/brain/prompt-cache.ts — LRU cache for LLM responses
// v6.0.0 — Hive Mind Edition
//
// Wraps any async generate function with deterministic response caching.
// SHA-256 of (prompt + system + model) → response. Hit rate tracked for
// observability in the dashboard.

import * as crypto from 'crypto';

export interface PromptCacheEntry {
  key: string;
  response: any;
  storedAt: number;
  hits: number;
  lastAccessed: number;
  bytes: number;
}

export interface PromptCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  hitRate: number;
  savings: {
    estimatedTokensSaved: number;
    estimatedUsdSaved: number;
  };
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_BYTES_BUDGET = 32 * 1024 * 1024; // 32MB
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

export class PromptCache {
  private map: Map<string, PromptCacheEntry> = new Map();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private tokensSaved = 0;
  private usdSaved = 0;

  constructor(
    private maxEntries = DEFAULT_MAX_ENTRIES,
    private byteBudget = DEFAULT_BYTES_BUDGET,
    private ttlMs = DEFAULT_TTL_MS,
  ) {}

  private keyFor(inputs: { prompt: string; system?: string; model?: string; provider?: string }): string {
    return crypto.createHash('sha256').update(JSON.stringify({ p: inputs.prompt, s: inputs.system ?? '', m: inputs.model ?? '', v: inputs.provider ?? '' })).digest('hex');
  }

  /** Wrap a call. If cached and fresh, return cached. Otherwise call fn, store, return. */
  async wrap<T>(
    inputs: { prompt: string; system?: string; model?: string; provider?: string; estimatedTokens?: number; estimatedCostUsd?: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.keyFor(inputs);
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && now - hit.storedAt < this.ttlMs) {
      hit.hits++;
      hit.lastAccessed = now;
      this.hits++;
      this.tokensSaved += inputs.estimatedTokens ?? 0;
      this.usdSaved += inputs.estimatedCostUsd ?? 0;
      return hit.response as T;
    }
    this.misses++;
    const response = await fn();
    this.store(key, response, now);
    return response;
  }

  invalidate(inputs: { prompt: string; system?: string; model?: string; provider?: string }): boolean {
    const key = this.keyFor(inputs);
    const hit = this.map.get(key);
    if (!hit) return false;
    this.bytes -= hit.bytes;
    this.map.delete(key);
    return true;
  }

  stats(): PromptCacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      savings: { estimatedTokensSaved: this.tokensSaved, estimatedUsdSaved: +this.usdSaved.toFixed(4) },
    };
  }

  clear(): void {
    this.map.clear(); this.bytes = 0;
    this.hits = 0; this.misses = 0;
    this.tokensSaved = 0; this.usdSaved = 0;
  }

  // ── internals ────────────────────────────────────────────────────────

  private store(key: string, value: any, now: number): void {
    const serialized = JSON.stringify(value);
    const size = serialized.length * 2;
    while ((this.map.size >= this.maxEntries || this.bytes + size > this.byteBudget) && this.map.size > 0) {
      this.evictLRU();
    }
    const entry: PromptCacheEntry = { key, response: value, storedAt: now, hits: 0, lastAccessed: now, bytes: size };
    this.map.set(key, entry);
    this.bytes += size;
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of this.map) if (v.lastAccessed < oldestTime) { oldestTime = v.lastAccessed; oldestKey = k; }
    if (oldestKey) {
      const v = this.map.get(oldestKey)!;
      this.bytes -= v.bytes;
      this.map.delete(oldestKey);
    }
  }
}

let _instance: PromptCache | null = null;
export function getPromptCache(): PromptCache {
  if (!_instance) _instance = new PromptCache();
  return _instance;
}
export function resetPromptCacheForTests(): void { _instance = null; }
