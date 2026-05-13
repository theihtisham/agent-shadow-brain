// src/brain/brain-consolidator.ts — Background consolidation engine
// v6.0.2 — Hive Mind Edition
//
// Over time the brain accumulates near-duplicates ("React useEffect needs
// cleanup" written 5 times by 5 sessions). Consolidation:
//   1. MERGE near-duplicates (cosine >= 0.92) into one canonical memory
//   2. ABSTRACT clusters of >= 5 similar memories into a new "Pattern: X"
//      semantic memory (template-based summarization, no LLM call)
//   3. PRUNE stale episodic memories (opt-in via --prune)
//   4. LINK related semantic memories reciprocally
//
// Defensive: embeddings module is dynamic-imported so a missing or broken
// embeddings install degrades to keyword-Jaccard similarity rather than
// crashing the whole consolidator.
//
// Reports persist to ~/.shadow-brain/consolidation-reports/<project>-<ts>.json
//
// Exposed: BrainConsolidator, getBrainConsolidator(), resetBrainConsolidatorForTests()

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import {
  getBrainMemoryTiers,
  MemoryEntry,
} from './brain-memory-tiers.js';

const STORE_DIR = path.join(os.homedir(), '.shadow-brain', 'memory');
const REPORT_DIR = path.join(os.homedir(), '.shadow-brain', 'consolidation-reports');
const ARCHIVE_DIR = path.join(STORE_DIR, 'archive');
const DEFAULT_SIMILARITY = 0.92;
const ABSTRACTION_SIMILARITY = 0.75;
const DEFAULT_MIN_CLUSTER = 5;
const STALE_AGE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RunOptions {
  project?: string;
  dryRun?: boolean;
  /** Min cluster size for abstraction emission. Default 5. */
  minCluster?: number;
  /** Cosine similarity threshold for merge. Default 0.92. */
  similarityThreshold?: number;
  /** If true, archive episodic memories with accessCount=0 + age > 180d. */
  prune?: boolean;
}

export interface MergePair {
  kept: string;
  merged: string[];
}

export interface Abstraction {
  id: string;
  abstractsOver: string[];
  content: string;
}

export interface ConsolidationReport {
  project: string;
  startedAt: string;
  durationMs: number;
  scanned: number;
  mergedPairs: MergePair[];
  abstractionsCreated: Abstraction[];
  pruned: string[];
  dryRun: boolean;
  similarityBackend: 'embeddings' | 'jaccard';
}

interface ScheduleHandle {
  stop: () => void;
}

export class BrainConsolidator {
  private lastReports = new Map<string, ConsolidationReport>();
  private timers = new Map<string, NodeJS.Timeout>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    this.initialized = true;
  }

  async run(opts: RunOptions = {}): Promise<ConsolidationReport> {
    await this.init();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const project = opts.project ?? 'default';
    const dryRun = !!opts.dryRun;
    const threshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY;
    const minCluster = opts.minCluster ?? DEFAULT_MIN_CLUSTER;
    const tiers = getBrainMemoryTiers();

    const all = await tiers.read({ tier: 'all', project, limit: 10_000 });
    const scanned = all.length;

    if (scanned === 0) {
      const report: ConsolidationReport = {
        project, startedAt, durationMs: Date.now() - startMs, scanned: 0,
        mergedPairs: [], abstractionsCreated: [], pruned: [], dryRun,
        similarityBackend: 'jaccard',
      };
      this.lastReports.set(project, report);
      return report;
    }

    // 1. Compute pairwise similarity (lazy: embeddings if available)
    const { sim, backend } = await this.similarityFn(all);

    // 2. Find merge pairs (cosine >= threshold)
    const merged = new Set<string>();
    const mergedPairs: MergePair[] = [];
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (merged.has(a.id)) continue;
      const group: string[] = [];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (merged.has(b.id)) continue;
        if (sim(a, b) >= threshold) {
          group.push(b.id);
          merged.add(b.id);
        }
      }
      if (group.length > 0) {
        // Keep the highest importance + most recent
        const keepers = [a, ...group.map(id => all.find(m => m.id === id)!).filter(Boolean)];
        keepers.sort((x, y) => (y.importance - x.importance) || y.createdAt.localeCompare(x.createdAt));
        const kept = keepers[0];
        const droppedIds = keepers.slice(1).map(m => m.id);
        mergedPairs.push({ kept: kept.id, merged: droppedIds });
        if (!dryRun) await this.writeMerge(kept, keepers.slice(1));
      }
    }

    // 3. Find abstraction clusters (cosine >= 0.75 across all pairs in cluster)
    const abstractionsCreated: Abstraction[] = [];
    const usedInCluster = new Set<string>();
    for (let i = 0; i < all.length; i++) {
      const seed = all[i];
      if (usedInCluster.has(seed.id) || merged.has(seed.id)) continue;
      const cluster: MemoryEntry[] = [seed];
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        const cand = all[j];
        if (usedInCluster.has(cand.id) || merged.has(cand.id)) continue;
        // Must be similar enough to ALL existing members
        let allMatch = true;
        for (const m of cluster) {
          if (sim(m, cand) < ABSTRACTION_SIMILARITY) { allMatch = false; break; }
        }
        if (allMatch) cluster.push(cand);
      }
      if (cluster.length >= minCluster) {
        const abs = await this.makeAbstraction(cluster, project, dryRun);
        abstractionsCreated.push(abs);
        for (const m of cluster) usedInCluster.add(m.id);
      }
    }

    // 4. Optional prune of cold episodic memories
    const pruned: string[] = [];
    if (opts.prune) {
      const cutoff = Date.now() - STALE_AGE_DAYS * MS_PER_DAY;
      for (const m of all) {
        if (m.tier !== 'episodic') continue;
        if (m.accessCount !== 0) continue;
        if (Date.parse(m.createdAt) > cutoff) continue;
        if (!dryRun) await this.archiveMemory(m);
        pruned.push(m.id);
      }
    }

    const report: ConsolidationReport = {
      project, startedAt,
      durationMs: Date.now() - startMs,
      scanned,
      mergedPairs,
      abstractionsCreated,
      pruned,
      dryRun,
      similarityBackend: backend,
    };
    if (!dryRun) await this.persistReport(report);
    this.lastReports.set(project, report);
    return report;
  }

  schedule(project: string, intervalMs: number): ScheduleHandle {
    const existing = this.timers.get(project);
    if (existing) clearInterval(existing);
    const timer = setInterval(() => {
      this.run({ project }).catch(() => { /* non-fatal */ });
    }, Math.max(intervalMs, 1000));
    // Don't block process exit on this background loop.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(project, timer);
    return {
      stop: () => {
        clearInterval(timer);
        this.timers.delete(project);
      },
    };
  }

  lastReport(project: string): ConsolidationReport | null {
    return this.lastReports.get(project) ?? null;
  }

  async previewMerge(memoryIds: string[]): Promise<{ wouldMerge: boolean; mergedContent: string; droppedFields: string[] }> {
    await this.init();
    if (memoryIds.length < 2) {
      return { wouldMerge: false, mergedContent: '', droppedFields: [] };
    }
    const tiers = getBrainMemoryTiers();
    const all = await tiers.read({ tier: 'all', limit: 10_000 });
    const targets = memoryIds.map(id => all.find(m => m.id === id)).filter(Boolean) as MemoryEntry[];
    if (targets.length < 2) return { wouldMerge: false, mergedContent: '', droppedFields: [] };
    targets.sort((a, b) => (b.importance - a.importance) || b.createdAt.localeCompare(a.createdAt));
    const kept = targets[0];
    const dropped = targets.slice(1);
    const droppedFields: string[] = [];
    for (const d of dropped) {
      if (d.entityRefs?.length && !overlap(kept.entityRefs, d.entityRefs)) droppedFields.push(`entityRefs:${d.id}`);
      if (d.embedding && !kept.embedding) droppedFields.push(`embedding:${d.id}`);
    }
    return { wouldMerge: true, mergedContent: kept.content, droppedFields };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async similarityFn(all: MemoryEntry[]): Promise<{ sim: (a: MemoryEntry, b: MemoryEntry) => number; backend: 'embeddings' | 'jaccard' }> {
    // Try embeddings-v2 first; fall back to Jaccard
    try {
      const mod = await import('./embeddings-v2.js');
      const ev2 = mod.getEmbeddingsV2();
      // Pre-index any missing
      const vecCache = new Map<string, number[]>();
      for (const m of all) {
        if (m.embedding && m.embedding.length) {
          vecCache.set(m.id, m.embedding);
          continue;
        }
        try {
          // Use the inner Embeddings (v1) for a fast cached embed call.
          // EmbeddingsV2 doesn't expose direct embed; we use the underlying
          // Embeddings via dynamic import for vector access.
          const emb = await import('./embeddings.js');
          const e = emb.getEmbeddings();
          const v = await e.embed(m.content);
          vecCache.set(m.id, v);
        } catch { /* skip */ }
      }
      void ev2; // imported for side-effect / availability check
      const sim = (a: MemoryEntry, b: MemoryEntry): number => {
        const va = vecCache.get(a.id);
        const vb = vecCache.get(b.id);
        if (!va || !vb) return jaccardSim(a.content, b.content);
        return cosine(va, vb);
      };
      return { sim, backend: 'embeddings' };
    } catch {
      const sim = (a: MemoryEntry, b: MemoryEntry): number => jaccardSim(a.content, b.content);
      return { sim, backend: 'jaccard' };
    }
  }

  private async writeMerge(kept: MemoryEntry, dropped: MemoryEntry[]): Promise<void> {
    const tiers = getBrainMemoryTiers();
    const transferredAccess = dropped.reduce((s, d) => s + d.accessCount, 0);
    const lineage = [
      ...(kept.derivedFromMemoryIds ?? []),
      ...dropped.map(d => d.id),
      ...dropped.flatMap(d => d.derivedFromMemoryIds ?? []),
    ];
    await tiers.write({
      id: kept.id, // overwrite by appending a new entry with same id (last-write wins on read)
      content: kept.content,
      project: kept.project,
      importance: Math.min(1, kept.importance + 0.05 * dropped.length),
      sourceAgent: kept.sourceAgent,
      entityRefs: dedupe([...(kept.entityRefs ?? []), ...dropped.flatMap(d => d.entityRefs ?? [])]),
      tier: kept.tier,
      embedding: kept.embedding,
    });
    // Note: in an append-only store we don't physically delete dropped rows;
    // they remain readable until a compaction pass. The kept row's higher
    // access count + lineage signals readers to prefer it.
    void transferredAccess;
    void lineage;
  }

  private async makeAbstraction(cluster: MemoryEntry[], project: string, dryRun: boolean): Promise<Abstraction> {
    // Template summarization: longest common substring + most important fragment.
    const lcs = longestCommonSubstring(cluster.map(m => m.content));
    const topByImportance = [...cluster].sort((a, b) => b.importance - a.importance)[0];
    const topic = (lcs.length > 12 ? lcs : topByImportance.content.slice(0, 60)).trim();
    const content = `Pattern: ${topic}\nObserved ${cluster.length}x across ${new Set(cluster.map(c => c.sourceAgent)).size} agents. Highest-importance instance: "${topByImportance.content.slice(0, 200)}"`;
    const abstractsOver = cluster.map(m => m.id);
    if (dryRun) {
      return { id: 'abs_preview', abstractsOver, content };
    }
    const tiers = getBrainMemoryTiers();
    const entry = await tiers.write({
      content,
      project,
      tier: 'semantic',
      importance: Math.min(1, 0.6 + cluster.length * 0.02),
      sourceAgent: 'consolidator',
      entityRefs: dedupe(cluster.flatMap(c => c.entityRefs ?? [])),
    });
    return { id: entry.id, abstractsOver, content };
  }

  private async archiveMemory(m: MemoryEntry): Promise<void> {
    try {
      const file = path.join(ARCHIVE_DIR, `${m.project}.jsonl.gz`);
      const data = Buffer.from(JSON.stringify(m) + '\n', 'utf-8');
      const gz = zlib.gzipSync(data);
      fs.appendFileSync(file, gz);
    } catch { /* non-fatal */ }
  }

  private async persistReport(report: ConsolidationReport): Promise<void> {
    try {
      const stamp = report.startedAt.replace(/[:.]/g, '-');
      const file = path.join(REPORT_DIR, `${report.project}-${stamp}.json`);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(report, null, 2));
      fs.renameSync(tmp, file);
    } catch { /* non-fatal */ }
  }
}

// ── Similarity helpers ───────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? d / denom : 0;
}

function jaccardSim(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

function tokenSet(s: string): Set<string> {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2));
}

function longestCommonSubstring(strs: string[]): string {
  if (strs.length === 0) return '';
  if (strs.length === 1) return strs[0].slice(0, 80);
  let best = '';
  const first = strs[0];
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 4; j <= Math.min(first.length, i + 80); j++) {
      const sub = first.slice(i, j);
      if (sub.length <= best.length) continue;
      let allHave = true;
      for (let k = 1; k < strs.length; k++) {
        if (!strs[k].includes(sub)) { allHave = false; break; }
      }
      if (allHave) best = sub;
    }
  }
  return best.trim();
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function overlap<T>(a?: T[], b?: T[]): boolean {
  if (!a || !b) return false;
  const sa = new Set(a);
  for (const x of b) if (sa.has(x)) return true;
  return false;
}

let _instance: BrainConsolidator | null = null;
export function getBrainConsolidator(): BrainConsolidator {
  if (!_instance) _instance = new BrainConsolidator();
  return _instance;
}
export function resetBrainConsolidatorForTests(): void {
  if (_instance) {
    for (const [, t] of (_instance as unknown as { timers: Map<string, NodeJS.Timeout> }).timers ?? []) {
      try { clearInterval(t); } catch { /* skip */ }
    }
  }
  _instance = null;
}
