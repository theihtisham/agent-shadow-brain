// src/brain/smart-cache.ts — Intelligent multi-tier caching with predictive prefetch
// v6.0.0 — Zero-dependency adaptive cache

import * as crypto from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  tier: 'hot' | 'warm' | 'cold';
  createdAt: number;
  lastAccess: number;
  accessCount: number;
  ttl: number;
  size: number;
  compressed: boolean;
  tags: string[];
}

export interface CacheConfig {
  maxHotEntries: number;
  maxWarmEntries: number;
  maxColdEntries: number;
  defaultTTL: number;
  hotPromotionThreshold: number;
  coldDemotionThreshold: number;
  compressionThreshold: number;
  enablePrefetch: boolean;
  maxMemoryMB: number;
}

export interface CacheStats {
  hotEntries: number;
  warmEntries: number;
  coldEntries: number;
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  promotions: number;
  demotions: number;
  memoryUsageMB: number;
  prefetchHits: number;
  avgAccessTime: number;
}

export interface PrefetchHint {
  key: string;
  probability: number;
  basedOn: string[];
}

// ── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CacheConfig = {
  maxHotEntries: 200,
  maxWarmEntries: 1000,
  maxColdEntries: 5000,
  defaultTTL: 300_000, // 5 minutes
  hotPromotionThreshold: 5,
  coldDemotionThreshold: 60_000, // 1 minute without access
  compressionThreshold: 10_000, // bytes
  enablePrefetch: true,
  maxMemoryMB: 100,
};

// ── Smart Cache ────────────────────────────────────────────────────────────

export class SmartCache {
  private hot: Map<string, CacheEntry> = new Map();
  private warm: Map<string, CacheEntry> = new Map();
  private cold: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private accessLog: Array<{ key: string; time: number }> = [];
  private prefetchGraph: Map<string, Map<string, number>> = new Map(); // key -> {co-accessed key -> count}

  // Stats
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private promotions = 0;
  private demotions = 0;
  private prefetchHits = 0;
  private totalAccessTime = 0;
  private accessTimeCount = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Core Operations ─────────────────────────────────────────────────

  get<T = unknown>(key: string): T | undefined {
    const startTime = Date.now();

    // Check hot tier first (fastest)
    let entry = this.hot.get(key);
    if (entry && !this.isExpired(entry)) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.hits++;
      this.trackAccess(key);
      this.recordAccessTime(startTime);
      return entry.value as T;
    }

    // Check warm tier
    entry = this.warm.get(key);
    if (entry && !this.isExpired(entry)) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.hits++;
      this.trackAccess(key);

      // Promote to hot if accessed enough
      if (entry.accessCount >= this.config.hotPromotionThreshold) {
        this.promote(key, entry);
      }
      this.recordAccessTime(startTime);
      return entry.value as T;
    }

    // Check cold tier
    entry = this.cold.get(key);
    if (entry && !this.isExpired(entry)) {
      entry.lastAccess = Date.now();
      entry.accessCount++;
      this.hits++;
      this.trackAccess(key);

      // Promote to warm
      this.cold.delete(key);
      entry.tier = 'warm';
      entry.compressed = false;
      this.warm.set(key, entry);
      this.promotions++;
      this.enforceWarmLimit();
      this.recordAccessTime(startTime);
      return entry.value as T;
    }

    this.misses++;
    this.recordAccessTime(startTime);

    // Trigger prefetch if enabled
    if (this.config.enablePrefetch) {
      this.triggerPrefetch(key);
    }

    return undefined;
  }

  set<T = unknown>(key: string, value: T, options?: { ttl?: number; tags?: string[]; tier?: 'hot' | 'warm' }): void {
    const serialized = JSON.stringify(value);
    const size = serialized.length;
    const tier = options?.tier || (size > this.config.compressionThreshold ? 'warm' : 'hot');

    const entry: CacheEntry<T> = {
      key,
      value,
      tier,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      accessCount: 1,
      ttl: options?.ttl || this.config.defaultTTL,
      size,
      compressed: false,
      tags: options?.tags || [],
    };

    if (tier === 'hot') {
      this.hot.set(key, entry as CacheEntry);
      this.enforceHotLimit();
    } else {
      this.warm.set(key, entry as CacheEntry);
      this.enforceWarmLimit();
    }

    this.trackAccess(key);
  }

  delete(key: string): boolean {
    return this.hot.delete(key) || this.warm.delete(key) || this.cold.delete(key);
  }

  has(key: string): boolean {
    return (this.hot.has(key) && !this.isExpired(this.hot.get(key)!)) ||
           (this.warm.has(key) && !this.isExpired(this.warm.get(key)!)) ||
           (this.cold.has(key) && !this.isExpired(this.cold.get(key)!));
  }

  clear(): void {
    this.hot.clear();
    this.warm.clear();
    this.cold.clear();
    this.accessLog = [];
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.promotions = 0;
    this.demotions = 0;
  }

  // ── Batch Operations ────────────────────────────────────────────────

  getMany<T = unknown>(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = this.get<T>(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  setMany<T = unknown>(entries: Array<{ key: string; value: T; ttl?: number }>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.value, { ttl: entry.ttl });
    }
  }

  // ── Tag-Based Operations ────────────────────────────────────────────

  getByTag<T = unknown>(tag: string): Map<string, T> {
    const result = new Map<string, T>();

    for (const [key, entry] of this.hot) {
      if (entry.tags.includes(tag) && !this.isExpired(entry)) {
        result.set(key, entry.value as T);
      }
    }
    for (const [key, entry] of this.warm) {
      if (entry.tags.includes(tag) && !this.isExpired(entry)) {
        result.set(key, entry.value as T);
      }
    }
    for (const [key, entry] of this.cold) {
      if (entry.tags.includes(tag) && !this.isExpired(entry)) {
        result.set(key, entry.value as T);
      }
    }

    return result;
  }

  invalidateByTag(tag: string): number {
    let count = 0;

    for (const [key, entry] of this.hot) {
      if (entry.tags.includes(tag)) { this.hot.delete(key); count++; }
    }
    for (const [key, entry] of this.warm) {
      if (entry.tags.includes(tag)) { this.warm.delete(key); count++; }
    }
    for (const [key, entry] of this.cold) {
      if (entry.tags.includes(tag)) { this.cold.delete(key); count++; }
    }

    return count;
  }

  // ── Computed Cache (memoization) ────────────────────────────────────

  async getOrCompute<T>(key: string, compute: () => T | Promise<T>, options?: { ttl?: number; tags?: string[] }): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await compute();
    this.set(key, value, options);
    return value;
  }

  // ── Tier Management ─────────────────────────────────────────────────

  private promote(key: string, entry: CacheEntry): void {
    this.warm.delete(key);
    entry.tier = 'hot';
    this.hot.set(key, entry);
    this.promotions++;
    this.enforceHotLimit();
  }

  private enforceHotLimit(): void {
    while (this.hot.size > this.config.maxHotEntries) {
      const coldest = this.findLeastRecentlyUsed(this.hot);
      if (!coldest) break;

      const entry = this.hot.get(coldest)!;
      this.hot.delete(coldest);
      entry.tier = 'warm';
      this.warm.set(coldest, entry);
      this.demotions++;
    }
    this.enforceWarmLimit();
  }

  private enforceWarmLimit(): void {
    while (this.warm.size > this.config.maxWarmEntries) {
      const coldest = this.findLeastRecentlyUsed(this.warm);
      if (!coldest) break;

      const entry = this.warm.get(coldest)!;
      this.warm.delete(coldest);
      entry.tier = 'cold';
      entry.compressed = true;
      this.cold.set(coldest, entry);
      this.demotions++;
    }
    this.enforceColdLimit();
  }

  private enforceColdLimit(): void {
    while (this.cold.size > this.config.maxColdEntries) {
      const coldest = this.findLeastRecentlyUsed(this.cold);
      if (!coldest) break;
      this.cold.delete(coldest);
      this.evictions++;
    }
  }

  private findLeastRecentlyUsed(tier: Map<string, CacheEntry>): string | null {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of tier) {
      // Factor in access count: frequently used items survive longer
      const effectiveTime = entry.lastAccess + (entry.accessCount * 1000);
      if (effectiveTime < lruTime) {
        lruTime = effectiveTime;
        lruKey = key;
      }
    }

    return lruKey;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > entry.ttl;
  }

  // ── Predictive Prefetch ─────────────────────────────────────────────

  private trackAccess(key: string): void {
    const now = Date.now();
    this.accessLog.push({ key, time: now });

    // Keep recent access log manageable
    if (this.accessLog.length > 5000) {
      this.accessLog = this.accessLog.slice(-3000);
    }

    // Build co-access graph (keys accessed within 5 seconds of each other)
    const recentWindow = 5000;
    const recentAccesses = this.accessLog.filter(a => now - a.time < recentWindow && a.key !== key);

    if (!this.prefetchGraph.has(key)) {
      this.prefetchGraph.set(key, new Map());
    }

    const coAccess = this.prefetchGraph.get(key)!;
    for (const access of recentAccesses) {
      coAccess.set(access.key, (coAccess.get(access.key) || 0) + 1);
    }

    // Limit prefetch graph size
    if (this.prefetchGraph.size > 2000) {
      const entries = Array.from(this.prefetchGraph.entries());
      entries.sort((a, b) => b[1].size - a[1].size);
      this.prefetchGraph = new Map(entries.slice(0, 1500));
    }
  }

  private triggerPrefetch(missedKey: string): void {
    // When we miss a key, check if other frequently co-accessed keys need to be warmed
    const coAccess = this.prefetchGraph.get(missedKey);
    if (!coAccess) return;

    for (const [coKey, count] of coAccess) {
      if (count >= 3) {
        // Check if co-accessed key is in cold tier and promote
        const coldEntry = this.cold.get(coKey);
        if (coldEntry && !this.isExpired(coldEntry)) {
          this.cold.delete(coKey);
          coldEntry.tier = 'warm';
          coldEntry.compressed = false;
          this.warm.set(coKey, coldEntry);
          this.prefetchHits++;
        }
      }
    }
  }

  getPrefetchHints(key: string, limit: number = 5): PrefetchHint[] {
    const coAccess = this.prefetchGraph.get(key);
    if (!coAccess) return [];

    const totalAccesses = Array.from(coAccess.values()).reduce((s, v) => s + v, 0);

    return Array.from(coAccess.entries())
      .map(([k, count]) => ({
        key: k,
        probability: totalAccesses > 0 ? count / totalAccesses : 0,
        basedOn: [key],
      }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, limit);
  }

  // ── Maintenance ─────────────────────────────────────────────────────

  cleanup(): number {
    let cleaned = 0;

    for (const [key, entry] of this.hot) {
      if (this.isExpired(entry)) { this.hot.delete(key); cleaned++; }
    }
    for (const [key, entry] of this.warm) {
      if (this.isExpired(entry)) { this.warm.delete(key); cleaned++; }
    }
    for (const [key, entry] of this.cold) {
      if (this.isExpired(entry)) { this.cold.delete(key); cleaned++; }
    }

    return cleaned;
  }

  demoteStale(): number {
    const now = Date.now();
    let demoted = 0;

    // Hot → Warm: entries not accessed recently
    for (const [key, entry] of this.hot) {
      if (now - entry.lastAccess > this.config.coldDemotionThreshold * 2) {
        this.hot.delete(key);
        entry.tier = 'warm';
        this.warm.set(key, entry);
        demoted++;
        this.demotions++;
      }
    }

    // Warm → Cold: entries not accessed recently
    for (const [key, entry] of this.warm) {
      if (now - entry.lastAccess > this.config.coldDemotionThreshold * 5) {
        this.warm.delete(key);
        entry.tier = 'cold';
        entry.compressed = true;
        this.cold.set(key, entry);
        demoted++;
        this.demotions++;
      }
    }

    this.enforceColdLimit();
    return demoted;
  }

  // ── Stats ────────────────────────────────────────────────────────────

  private recordAccessTime(startTime: number): void {
    this.totalAccessTime += Date.now() - startTime;
    this.accessTimeCount++;
  }

  stats(): CacheStats {
    const totalSize = this.estimateMemory();

    return {
      hotEntries: this.hot.size,
      warmEntries: this.warm.size,
      coldEntries: this.cold.size,
      totalEntries: this.hot.size + this.warm.size + this.cold.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
      evictions: this.evictions,
      promotions: this.promotions,
      demotions: this.demotions,
      memoryUsageMB: Number((totalSize / (1024 * 1024)).toFixed(2)),
      prefetchHits: this.prefetchHits,
      avgAccessTime: this.accessTimeCount > 0 ? this.totalAccessTime / this.accessTimeCount : 0,
    };
  }

  private estimateMemory(): number {
    let total = 0;
    for (const entry of this.hot.values()) total += entry.size;
    for (const entry of this.warm.values()) total += entry.size;
    for (const entry of this.cold.values()) total += entry.compressed ? entry.size * 0.3 : entry.size;
    return total;
  }

  // ── Utility ──────────────────────────────────────────────────────────

  keys(): string[] {
    return [
      ...Array.from(this.hot.keys()),
      ...Array.from(this.warm.keys()),
      ...Array.from(this.cold.keys()),
    ];
  }

  size(): number {
    return this.hot.size + this.warm.size + this.cold.size;
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
