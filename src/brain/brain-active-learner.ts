// src/brain/brain-active-learner.ts — learn from accept/reject feedback
// v6.0.2 — Hive Mind Edition
//
// The brain should not be static. When the user accepts recall result A and
// ignores B for a class of queries, the next similar query should bias toward
// A's region of the vector space. This module captures that signal and
// re-ranks candidates accordingly. No LLM, no online gradient descent — just
// log-odds bias on per-cluster acceptance ratios. Transparent and auditable.
//
// Storage layout (per project):
//   ~/.shadow-brain/active-learning/<project>.jsonl        — append-only feedback log
//   ~/.shadow-brain/active-learning/<project>-biases.json  — derived bias cache
//
// Bias model:
//   1. Cluster query embeddings into k=16 buckets via mini-batch k-means.
//      Falls back to word-bag clustering when the embeddings module isn't
//      available (e.g. tests, offline). Per-cluster counts of accepts/
//      rejects per memoryId.
//   2. bias(memoryId | cluster) = log((accepts + 1) / (rejects + 1)).
//      Add-one smoothing keeps cold cells well-behaved.
//   3. Decay older feedback exponentially: w = 0.95^(age_days / 30). Recent
//      corrections dominate, stale preferences fade.
//   4. score_biased = score * (1 + clamp(0.4 * bias, -0.3, 0.3)). The cap
//      keeps a bad cluster assignment from ever flipping the ranking by
//      more than 30%, so a noisy cluster can't drown out the actual
//      similarity signal.
//
// Biases are recomputed at most once per UTC day per project; in-memory
// values are reused for the rest of the day. Triggering a stats() or bias()
// call after midnight refreshes them.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT_DIR = path.join(os.homedir(), '.shadow-brain', 'active-learning');
const CLUSTER_K = 16;
const KMEANS_ITERS = 8;
const HALF_LIFE_DAYS = 30;
const DECAY_BASE = 0.95;
const BIAS_GAIN = 0.4;
const BIAS_CLAMP = 0.3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedbackKind = 'accepted' | 'rejected' | 'modified' | 'ignored';

export interface Feedback {
  queryText: string;
  resultId: string;
  kind: FeedbackKind;
  userAction?: string;
  project: string;
  ts?: number;
}

export interface ActiveLearnerStats {
  totalFeedback: number;
  acceptRate: number;
  topAccepted: Array<{ id: string; count: number }>;
  topRejected: Array<{ id: string; count: number }>;
  lastUpdated: number;
}

export interface BiasExport {
  feedback: Feedback[];
  biases: Record<string, number>;
}

interface BiasCache {
  // Flat bias per memoryId averaged across clusters that have evidence.
  byId: Record<string, number>;
  // Optional per-cluster bias for finer routing.
  byCluster: Record<string, Record<string, number>>;
  centroids: number[][];
  computedAt: number;
  feedbackCount: number;
}

interface ProjectState {
  feedback: Feedback[];
  biasCache: BiasCache | null;
  lastLoaded: number;
}

export class BrainActiveLearner {
  private state: Map<string, ProjectState> = new Map();
  private embedderPromise: Promise<((text: string) => Promise<number[]>) | null> | null = null;

  /** Record a single feedback event. Returns once persisted. */
  async recordFeedback(feedback: Feedback): Promise<void> {
    const fb: Feedback = { ...feedback, ts: feedback.ts ?? Date.now() };
    if (!fb.project) throw new Error('feedback.project is required');
    const st = await this.loadProject(fb.project);
    st.feedback.push(fb);
    // Invalidate cache so next bias()/stats() recomputes.
    st.biasCache = null;
    await this.append(fb);
  }

  /**
   * Re-rank candidates using accumulated feedback for this project.
   * Returns a new array; does not mutate input. When there is no feedback
   * the candidates pass through unchanged with biasApplied=0.
   */
  async bias(
    query: string,
    candidates: Array<{ id: string; score: number }>,
    project: string,
  ): Promise<Array<{ id: string; score: number; biasApplied: number }>> {
    if (!candidates || candidates.length === 0) return [];
    const st = await this.loadProject(project);
    if (st.feedback.length === 0) {
      return candidates.map(c => ({ ...c, biasApplied: 0 }));
    }
    const cache = await this.ensureBiases(project, st);
    const cluster = await this.assignCluster(query, cache.centroids);
    const clusterBias = cache.byCluster[String(cluster)] ?? {};
    const out: Array<{ id: string; score: number; biasApplied: number }> = [];
    for (const c of candidates) {
      const b = (clusterBias[c.id] ?? cache.byId[c.id] ?? 0);
      const adj = clamp(BIAS_GAIN * b, -BIAS_CLAMP, BIAS_CLAMP);
      out.push({ id: c.id, score: c.score * (1 + adj), biasApplied: adj });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /** Return a summary for the given project. Empty stats when no feedback. */
  stats(project: string): ActiveLearnerStats {
    const st = this.state.get(project);
    if (!st || st.feedback.length === 0) {
      return { totalFeedback: 0, acceptRate: 0, topAccepted: [], topRejected: [], lastUpdated: 0 };
    }
    const accepts = new Map<string, number>();
    const rejects = new Map<string, number>();
    let acceptCount = 0;
    let lastUpdated = 0;
    for (const fb of st.feedback) {
      if (fb.ts && fb.ts > lastUpdated) lastUpdated = fb.ts;
      if (fb.kind === 'accepted' || fb.kind === 'modified') {
        accepts.set(fb.resultId, (accepts.get(fb.resultId) ?? 0) + 1);
        acceptCount++;
      } else if (fb.kind === 'rejected' || fb.kind === 'ignored') {
        rejects.set(fb.resultId, (rejects.get(fb.resultId) ?? 0) + 1);
      }
    }
    return {
      totalFeedback: st.feedback.length,
      acceptRate: st.feedback.length > 0 ? +(acceptCount / st.feedback.length).toFixed(3) : 0,
      topAccepted: topN(accepts, 5),
      topRejected: topN(rejects, 5),
      lastUpdated,
    };
  }

  /** Export feedback + derived biases for backup / inspection. */
  async export(project: string): Promise<BiasExport> {
    const st = await this.loadProject(project);
    const cache = await this.ensureBiases(project, st);
    return { feedback: st.feedback.slice(), biases: { ...cache.byId } };
  }

  /** Import feedback. Appends to existing file. Returns count imported. */
  async import(data: { feedback?: Feedback[] }, project: string): Promise<{ imported: number }> {
    if (!data || !Array.isArray(data.feedback)) return { imported: 0 };
    const st = await this.loadProject(project);
    let imported = 0;
    for (const fb of data.feedback) {
      if (!fb || typeof fb.queryText !== 'string' || typeof fb.resultId !== 'string') continue;
      const normalized: Feedback = {
        queryText: fb.queryText,
        resultId: fb.resultId,
        kind: fb.kind,
        userAction: fb.userAction,
        project: fb.project ?? project,
        ts: fb.ts ?? Date.now(),
      };
      st.feedback.push(normalized);
      await this.append(normalized);
      imported++;
    }
    st.biasCache = null;
    return { imported };
  }

  /** Wipe all feedback + bias cache for a project. */
  async reset(project: string): Promise<void> {
    this.state.delete(project);
    const files = [this.feedbackFile(project), this.biasFile(project)];
    for (const f of files) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* non-fatal */ }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private feedbackFile(project: string): string {
    return path.join(ROOT_DIR, `${safe(project)}.jsonl`);
  }
  private biasFile(project: string): string {
    return path.join(ROOT_DIR, `${safe(project)}-biases.json`);
  }

  private async loadProject(project: string): Promise<ProjectState> {
    let st = this.state.get(project);
    if (st) return st;
    fs.mkdirSync(ROOT_DIR, { recursive: true });
    const feedback: Feedback[] = [];
    const fbFile = this.feedbackFile(project);
    if (fs.existsSync(fbFile)) {
      const raw = fs.readFileSync(fbFile, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Feedback;
          if (parsed && parsed.resultId && parsed.kind) feedback.push(parsed);
        } catch { /* skip corrupt line */ }
      }
    }
    let biasCache: BiasCache | null = null;
    const bFile = this.biasFile(project);
    if (fs.existsSync(bFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(bFile, 'utf-8')) as BiasCache;
        if (parsed && parsed.centroids && parsed.byCluster) biasCache = parsed;
      } catch { /* skip */ }
    }
    st = { feedback, biasCache, lastLoaded: Date.now() };
    this.state.set(project, st);
    return st;
  }

  private async append(fb: Feedback): Promise<void> {
    fs.mkdirSync(ROOT_DIR, { recursive: true });
    await fs.promises.appendFile(this.feedbackFile(fb.project), JSON.stringify(fb) + '\n', 'utf-8');
  }

  private async writeBiasCache(project: string, cache: BiasCache): Promise<void> {
    fs.mkdirSync(ROOT_DIR, { recursive: true });
    const tmp = this.biasFile(project) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, this.biasFile(project));
  }

  // ── Bias computation ────────────────────────────────────────────────

  private async ensureBiases(project: string, st: ProjectState): Promise<BiasCache> {
    const now = Date.now();
    // Reuse if same day AND no new feedback since the cache was built.
    if (st.biasCache
        && sameUtcDay(st.biasCache.computedAt, now)
        && st.biasCache.feedbackCount === st.feedback.length) {
      return st.biasCache;
    }
    const cache = await this.computeBiases(st.feedback);
    st.biasCache = cache;
    this.writeBiasCache(project, cache).catch(() => { /* non-fatal */ });
    return cache;
  }

  private async computeBiases(feedback: Feedback[]): Promise<BiasCache> {
    const now = Date.now();
    if (feedback.length === 0) {
      return { byId: {}, byCluster: {}, centroids: [], computedAt: now, feedbackCount: 0 };
    }

    // Embed all queries (cheap because of the embeddings cache; falls back to
    // a hashing word-bag if the embeddings module is unavailable).
    const embedFn = await this.getEmbedder();
    const vectors: number[][] = [];
    for (const fb of feedback) {
      vectors.push(embedFn ? await embedFn(fb.queryText) : wordBag(fb.queryText));
    }
    const k = Math.min(CLUSTER_K, Math.max(1, feedback.length));
    const { centroids, assignments } = kmeans(vectors, k, KMEANS_ITERS);

    // Per-cluster {memoryId: {acceptsW, rejectsW}} with time decay.
    const byCluster: Record<string, Map<string, { a: number; r: number }>> = {};
    for (let i = 0; i < feedback.length; i++) {
      const fb = feedback[i];
      const cluster = String(assignments[i]);
      const ageDays = (now - (fb.ts ?? now)) / DAY_MS;
      const w = Math.pow(DECAY_BASE, ageDays / HALF_LIFE_DAYS);
      const bucket = byCluster[cluster] ?? (byCluster[cluster] = new Map());
      const row = bucket.get(fb.resultId) ?? { a: 0, r: 0 };
      if (fb.kind === 'accepted' || fb.kind === 'modified') row.a += w;
      else if (fb.kind === 'rejected' || fb.kind === 'ignored') row.r += w;
      bucket.set(fb.resultId, row);
    }

    const clusterBiasOut: Record<string, Record<string, number>> = {};
    const flatAccum = new Map<string, { sum: number; count: number }>();
    for (const [cluster, bucket] of Object.entries(byCluster)) {
      const row: Record<string, number> = {};
      for (const [id, { a, r }] of bucket) {
        const bias = Math.log((a + 1) / (r + 1));
        row[id] = bias;
        const acc = flatAccum.get(id) ?? { sum: 0, count: 0 };
        acc.sum += bias; acc.count++;
        flatAccum.set(id, acc);
      }
      clusterBiasOut[cluster] = row;
    }
    const byId: Record<string, number> = {};
    for (const [id, acc] of flatAccum) byId[id] = +(acc.sum / acc.count).toFixed(6);

    return {
      byId,
      byCluster: clusterBiasOut,
      centroids,
      computedAt: now,
      feedbackCount: feedback.length,
    };
  }

  private async assignCluster(query: string, centroids: number[][]): Promise<number> {
    if (!centroids || centroids.length === 0) return 0;
    const embedFn = await this.getEmbedder();
    const v = embedFn ? await embedFn(query) : wordBag(query);
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const d = euclidSq(v, centroids[i]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }

  /**
   * Dynamic import of embeddings module. If the import fails (e.g. test
   * environment without the module compiled), we fall back to a local word
   * bag — clustering still works, just with coarser query buckets.
   */
  private async getEmbedder(): Promise<((text: string) => Promise<number[]>) | null> {
    if (!this.embedderPromise) {
      this.embedderPromise = (async () => {
        try {
          const mod = await import('./embeddings.js');
          const emb = mod.getEmbeddings();
          await emb.init();
          return (t: string) => emb.embed(t);
        } catch { return null; }
      })();
    }
    return this.embedderPromise;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'default';
}

function topN(m: Map<string, number>, n: number): Array<{ id: string; count: number }> {
  return Array.from(m.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function sameUtcDay(a: number, b: number): boolean {
  return Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS);
}

function euclidSq(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - b[i]; d += x * x; }
  return d;
}

function wordBag(text: string, dim = 64): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    vec[(h >>> 0) % dim] += 1;
  }
  // L2 normalize so euclidean distance is comparable across query lengths.
  let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) || 1;
  return vec.map(x => x / n);
}

function kmeans(vectors: number[][], k: number, iters: number): { centroids: number[][]; assignments: number[] } {
  if (vectors.length === 0) return { centroids: [], assignments: [] };
  const dim = vectors[0].length;
  // k-means++ seeding for stable initial centroids.
  const centroids: number[][] = [];
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  centroids.push(vectors[Math.floor(rand() * vectors.length)].slice());
  while (centroids.length < k) {
    const dists = vectors.map(v => {
      let best = Infinity;
      for (const c of centroids) { const d = euclidSq(v, c); if (d < best) best = d; }
      return best;
    });
    const total = dists.reduce((s, d) => s + d, 0) || 1;
    let target = rand() * total;
    let idx = 0;
    for (; idx < dists.length - 1; idx++) { target -= dists[idx]; if (target <= 0) break; }
    centroids.push(vectors[idx].slice());
  }

  const assignments = new Array<number>(vectors.length).fill(0);
  for (let iter = 0; iter < iters; iter++) {
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      let bestI = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = euclidSq(vectors[i], centroids[c]);
        if (d < bestD) { bestD = d; bestI = c; }
      }
      if (assignments[i] !== bestI) { assignments[i] = bestI; changed = true; }
    }
    if (!changed && iter > 0) break;

    // Recompute centroids as the mean of assigned vectors.
    const sums: number[][] = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      const v = vectors[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += v[j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue; // keep empty centroid as-is
      for (let j = 0; j < dim; j++) sums[c][j] /= counts[c];
      centroids[c] = sums[c];
    }
  }
  return { centroids, assignments };
}

let _instance: BrainActiveLearner | null = null;
export function getBrainActiveLearner(): BrainActiveLearner {
  if (!_instance) _instance = new BrainActiveLearner();
  return _instance;
}
export function resetBrainActiveLearnerForTests(): void { _instance = null; }
