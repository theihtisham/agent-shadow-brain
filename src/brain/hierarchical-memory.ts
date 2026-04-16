// src/brain/hierarchical-memory.ts — 4-Tier Infinite Memory Compression
// raw → summary → pattern → principle with drill-down capability
// v5.0.0 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { HierarchicalMemoryEntry, MemoryTier, HierarchicalMemoryStats } from '../types.js';

const STORE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.shadow-brain', 'hierarchical-memory'
);
const TIERS: MemoryTier[] = ['raw', 'summary', 'pattern', 'principle'];

/** Maximum entries per tier before forced compression upward */
const TIER_LIMITS: Record<MemoryTier, number> = {
  raw: 50000,
  summary: 10000,
  pattern: 2000,
  principle: 500,
};

/**
 * Hierarchical Memory — never forget, always compress.
 *
 * Tier 1 (raw): Full insight text, full context, full metadata. Retained for 7 days or until tier limit.
 * Tier 2 (summary): LLM-generated or algorithmic summary. Key facts, file references, category.
 * Tier 3 (pattern): Abstracted patterns extracted from multiple summaries. Reusable rules.
 * Tier 4 (principle): Fundamental truths / heuristics that survived many projects and sessions.
 *
 * Drill-down: Given a principle, trace back through patterns → summaries → raw entries.
 *
 * Compression: When a tier exceeds its limit, the oldest/least-accessed entries are
 * batch-compressed into the next tier up. Originals are archived (not deleted).
 */
export class HierarchicalMemory {
  private entries: Map<string, HierarchicalMemoryEntry> = new Map();
  private tierIndex: Map<MemoryTier, Set<string>> = new Map([
    ['raw', new Set()],
    ['summary', new Set()],
    ['pattern', new Set()],
    ['principle', new Set()],
  ]);
  private storeDir: string;

  constructor(customDir?: string) {
    this.storeDir = customDir || STORE_DIR;
    this.loadFromDisk();
  }

  // ── Core Operations ──────────────────────────────────────────────────────────

  /** Store a new memory at the raw tier */
  async store(
    content: string,
    category: string,
    confidence: number,
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const id = crypto.randomUUID();
    const vector = this.textToVector(content);

    const entry: HierarchicalMemoryEntry = {
      id,
      tier: 'raw',
      content,
      category,
      confidence,
      importance: this.calculateImportance(confidence, category, content),
      accessCount: 0,
      createdAt: new Date(),
      lastAccessed: new Date(),
      promotedAt: null,
      parentIds: [],
      childIds: [],
      vector,
      metadata,
      compressedSize: content.length,
      originalSize: content.length,
    };

    this.entries.set(id, entry);
    this.tierIndex.get('raw')!.add(id);

    // Check if tier needs compression
    await this.checkCompression('raw');
    await this.persist();

    return id;
  }

  /** Retrieve a specific entry by ID */
  get(id: string): HierarchicalMemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessed = new Date();
    }
    return entry;
  }

  /** Drill down from a higher-tier entry to its source entries */
  drillDown(id: string, maxDepth: number = 10): HierarchicalMemoryEntry[][] {
    const result: HierarchicalMemoryEntry[][] = [];
    let currentIds = [id];
    let depth = 0;

    while (currentIds.length > 0 && depth < maxDepth) {
      const level: HierarchicalMemoryEntry[] = [];
      const nextIds: string[] = [];

      for (const cid of currentIds) {
        const entry = this.entries.get(cid);
        if (entry) {
          level.push(entry);
          // Follow parent links (entries this was compressed FROM)
          for (const parentId of entry.parentIds) {
            if (!nextIds.includes(parentId)) {
              nextIds.push(parentId);
            }
          }
        }
      }

      if (level.length > 0) {
        result.push(level);
      }
      currentIds = nextIds;
      depth++;
    }

    return result;
  }

  /** Drill up from a raw entry to see what principles it contributed to */
  drillUp(id: string, maxDepth: number = 10): HierarchicalMemoryEntry[][] {
    const result: HierarchicalMemoryEntry[][] = [];
    let currentIds = [id];
    let depth = 0;

    while (currentIds.length > 0 && depth < maxDepth) {
      const level: HierarchicalMemoryEntry[] = [];
      const nextIds: string[] = [];

      for (const cid of currentIds) {
        const entry = this.entries.get(cid);
        if (entry) {
          level.push(entry);
          for (const childId of entry.childIds) {
            if (!nextIds.includes(childId)) {
              nextIds.push(childId);
            }
          }
        }
      }

      if (level.length > 0) {
        result.push(level);
      }
      currentIds = nextIds;
      depth++;
    }

    return result;
  }

  /** Get all entries at a specific tier */
  getByTier(tier: MemoryTier): HierarchicalMemoryEntry[] {
    const ids = this.tierIndex.get(tier);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.entries.get(id))
      .filter((e): e is HierarchicalMemoryEntry => e !== undefined);
  }

  /** Search across all tiers by content or category */
  search(query: string, topK: number = 20): HierarchicalMemoryEntry[] {
    const queryLower = query.toLowerCase();
    const queryVector = this.textToVector(query);
    const candidates: Array<{ entry: HierarchicalMemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;

      // Text match
      if (entry.content.toLowerCase().includes(queryLower)) {
        score += 0.4;
      }
      if (entry.category.toLowerCase().includes(queryLower)) {
        score += 0.2;
      }

      // Semantic similarity
      const similarity = this.cosineSimilarity(queryVector, entry.vector);
      score += similarity * 0.3;

      // Importance and tier boost
      score += entry.importance * 0.1;

      // Higher tiers get a relevance boost (principles are more valuable)
      const tierBoost: Record<MemoryTier, number> = { raw: 0, summary: 0.05, pattern: 0.1, principle: 0.15 };
      score += tierBoost[entry.tier];

      if (score > 0.1) {
        candidates.push({ entry, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK).map(c => c.entry);
  }

  /** Manually promote an entry to a higher tier */
  async promote(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const currentIdx = TIERS.indexOf(entry.tier);
    if (currentIdx >= TIERS.length - 1) return false; // Already at top

    const newTier = TIERS[currentIdx + 1];
    this.tierIndex.get(entry.tier)!.delete(id);
    entry.tier = newTier;
    entry.promotedAt = new Date();
    this.tierIndex.get(newTier)!.add(id);

    await this.persist();
    return true;
  }

  // ── Compression Engine ───────────────────────────────────────────────────────

  private async checkCompression(tier: MemoryTier): Promise<void> {
    const ids = this.tierIndex.get(tier)!;
    if (ids.size < TIER_LIMITS[tier]) return;

    const tierIdx = TIERS.indexOf(tier);
    if (tierIdx >= TIERS.length - 1) return; // Can't compress above principle

    const nextTier = TIERS[tierIdx + 1];

    // Sort by (importance * recency * accessCount) ascending — compress least valuable first
    const sorted = Array.from(ids)
      .map(id => this.entries.get(id)!)
      .filter(Boolean)
      .sort((a, b) => {
        const scoreA = a.importance * this.recencyFactor(a) * (a.accessCount + 1);
        const scoreB = b.importance * this.recencyFactor(b) * (b.accessCount + 1);
        return scoreA - scoreB;
      });

    // Batch compress the bottom 50% into summaries for the next tier
    const toCompress = sorted.slice(0, Math.floor(sorted.length * 0.5));
    if (toCompress.length < 2) return;

    // Group by category for better compression
    const byCategory = new Map<string, HierarchicalMemoryEntry[]>();
    for (const entry of toCompress) {
      const cat = entry.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(entry);
    }

    for (const [category, entries] of byCategory) {
      const compressedContent = this.compressContent(entries, nextTier);
      const compressedId = crypto.randomUUID();
      const compressedVector = this.textToVector(compressedContent);

      const parentIds = entries.map(e => e.id);
      const totalImportance = entries.reduce((s, e) => s + e.importance, 0) / entries.length;
      const totalConfidence = entries.reduce((s, e) => s + e.confidence, 0) / entries.length;

      const compressedEntry: HierarchicalMemoryEntry = {
        id: compressedId,
        tier: nextTier,
        content: compressedContent,
        category,
        confidence: totalConfidence,
        importance: Math.min(1, totalImportance * 1.1), // slight boost on promotion
        accessCount: 0,
        createdAt: entries[0].createdAt,
        lastAccessed: new Date(),
        promotedAt: new Date(),
        parentIds,
        childIds: [],
        vector: compressedVector,
        metadata: {
          compressedFrom: entries.length,
          sourceTier: tier,
          compressionDate: new Date().toISOString(),
        },
        compressedSize: compressedContent.length,
        originalSize: entries.reduce((s, e) => s + e.originalSize, 0),
      };

      // Update parent entries to link to compressed child
      for (const parent of entries) {
        parent.childIds.push(compressedId);
      }

      this.entries.set(compressedId, compressedEntry);
      this.tierIndex.get(nextTier)!.add(compressedId);
    }

    // Remove compressed entries from their tier index (but keep in entries map for drill-down)
    for (const entry of toCompress) {
      this.tierIndex.get(tier)!.delete(entry.id);
    }

    // Recursively check if next tier also needs compression
    await this.checkCompression(nextTier);
  }

  /** Compress multiple entries into a single higher-tier entry */
  private compressContent(entries: HierarchicalMemoryEntry[], targetTier: MemoryTier): string {
    if (targetTier === 'summary') {
      // Summary: key facts from raw entries
      const facts = entries.map(e => {
        const firstLine = e.content.split('\n')[0];
        return firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine;
      });
      return `Summary of ${entries.length} observations in ${entries[0].category}:\n` +
        facts.map((f, i) => `${i + 1}. ${f}`).join('\n') +
        `\nConfidence range: ${(Math.min(...entries.map(e => e.confidence)) * 100).toFixed(0)}%-${(Math.max(...entries.map(e => e.confidence)) * 100).toFixed(0)}%`;
    }

    if (targetTier === 'pattern') {
      // Pattern: abstracted rules from summaries
      const contents = entries.map(e => e.content);
      const commonTerms = this.extractCommonTerms(contents);
      return `Pattern detected across ${entries.length} summaries (${entries[0].category}):\n` +
        `Common themes: ${commonTerms.join(', ')}\n` +
        `Observed in: ${entries.flatMap(e => e.parentIds).length} source entries\n` +
        `Reliability: ${(entries.reduce((s, e) => s + e.confidence, 0) / entries.length * 100).toFixed(0)}%`;
    }

    if (targetTier === 'principle') {
      // Principle: fundamental truth from patterns
      const allContents = entries.map(e => e.content).join(' ');
      const keyPhrases = this.extractKeyPhrases(allContents);
      return `Established principle (${entries[0].category}):\n` +
        `${keyPhrases[0] || 'Consistent pattern across multiple projects'}\n` +
        `Validated by ${entries.length} patterns, ${entries.flatMap(e => e.parentIds).length} observations\n` +
        `Trust level: ${(entries.reduce((s, e) => s + e.confidence, 0) / entries.length * 100).toFixed(0)}%`;
    }

    return entries.map(e => e.content).join('\n---\n');
  }

  // ── Utility Functions ────────────────────────────────────────────────────────

  private calculateImportance(confidence: number, category: string, content: string): number {
    let importance = confidence * 0.5;

    // High-impact categories
    const highImpact = ['security', 'architecture', 'performance'];
    if (highImpact.includes(category)) importance += 0.15;

    // Content length heuristics (longer = more detailed = potentially more important)
    if (content.length > 500) importance += 0.1;
    if (content.length > 1000) importance += 0.05;

    // Code-related content
    if (content.includes('function') || content.includes('class') || content.includes('interface')) {
      importance += 0.1;
    }

    return Math.min(1, importance);
  }

  private recencyFactor(entry: HierarchicalMemoryEntry): number {
    const ageMs = Date.now() - entry.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return 1 / (1 + ageDays * 0.1); // Decay over time
  }

  /** Simple text-to-vector using character frequency and word hashing */
  private textToVector(text: string, dim: number = 64): number[] {
    const vector = new Array(dim).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = ((hash << 5) - hash + word.charCodeAt(j)) | 0;
      }
      const idx = Math.abs(hash) % dim;
      vector[idx] += 1;

      // Bigram features
      if (i > 0) {
        const bigram = words[i - 1] + '_' + word;
        let bhash = 0;
        for (let j = 0; j < bigram.length; j++) {
          bhash = ((bhash << 5) - bhash + bigram.charCodeAt(j)) | 0;
        }
        const bidx = Math.abs(bhash) % dim;
        vector[bidx] += 0.5;
      }
    }

    // Normalize
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
      for (let i = 0; i < dim; i++) vector[i] /= mag;
    }
    return vector;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom > 0 ? dot / denom : 0;
  }

  private extractCommonTerms(texts: string[]): string[] {
    const termFreq = new Map<string, number>();
    for (const text of texts) {
      const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      for (const word of words) {
        termFreq.set(word, (termFreq.get(word) || 0) + 1);
      }
    }
    return Array.from(termFreq.entries())
      .filter(([, count]) => count >= Math.max(2, texts.length * 0.3))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term);
  }

  private extractKeyPhrases(text: string): string[] {
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    return sentences.slice(0, 3);
  }

  // ── Statistics ───────────────────────────────────────────────────────────────

  stats(): HierarchicalMemoryStats {
    const rawCount = this.tierIndex.get('raw')!.size;
    const summaryCount = this.tierIndex.get('summary')!.size;
    const patternCount = this.tierIndex.get('pattern')!.size;
    const principleCount = this.tierIndex.get('principle')!.size;

    let totalSize = 0;
    let totalOriginal = 0;
    for (const entry of this.entries.values()) {
      totalSize += entry.compressedSize;
      totalOriginal += entry.originalSize;
    }

    return {
      rawCount,
      summaryCount,
      patternCount,
      principleCount,
      totalEntries: this.entries.size,
      totalSizeMB: totalSize / (1024 * 1024),
      compressionRatio: totalOriginal > 0 ? totalSize / totalOriginal : 1,
      promotionRate: this.calculatePromotionRate(),
      retentionDays: Infinity,
      drillDownDepth: 4,
    };
  }

  private calculatePromotionRate(): number {
    let promoted = 0;
    for (const entry of this.entries.values()) {
      if (entry.promotedAt) promoted++;
    }
    return promoted;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }

      const data = Array.from(this.entries.values()).map(entry => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        lastAccessed: entry.lastAccessed.toISOString(),
        promotedAt: entry.promotedAt?.toISOString() || null,
      }));

      fs.writeFileSync(
        path.join(this.storeDir, 'hierarchy.json'),
        JSON.stringify(data)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      const file = path.join(this.storeDir, 'hierarchy.json');
      if (!fs.existsSync(file)) return;

      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const raw of data) {
        const entry: HierarchicalMemoryEntry = {
          ...raw,
          createdAt: new Date(raw.createdAt),
          lastAccessed: new Date(raw.lastAccessed),
          promotedAt: raw.promotedAt ? new Date(raw.promotedAt) : null,
        };
        this.entries.set(entry.id, entry);
        this.tierIndex.get(entry.tier)!.add(entry.id);
      }
    } catch {
      // Fresh start
    }
  }
}
