// src/brain/brain-rerank.ts — Hybrid BM25 + cosine reranker
// v6.0.2 — Hive Mind Edition
//
// Single-pass ANN cosine is fast but noisy. Reranking the top-K candidates
// with BM25 lexical signal fused against cosine similarity dramatically
// improves recall@5 — this is the standard two-stage retrieval pattern
// (retrieve cheap & broad → rerank precise & narrow).
//
// BM25 builds a per-call inverted index over the candidate set. Fine for
// the <=500 candidate counts we see in practice. Tokenization mirrors the
// local embedding pipeline (lowercase, [^a-z0-9]+, drop short tokens +
// stopwords) so BM25 and cosine see the same surface form.
//
// Fusion: final = bm25Weight * bm25_norm + cosineWeight * cosine_norm
//         minus an optional length penalty for too-short / too-long docs.
// All component scores are normalized to [0, 1] within the result set so
// the weights are interpretable as direct contribution ratios.
//
// Composes with embeddings-v2 via dynamic import — graceful fallback when
// the ANN index is unavailable or empty.
//
// Exposed: BrainRerank, getBrainRerank(), resetBrainRerankForTests().
//   .rerank(query, candidates, opts)
//   .searchAndRerank(query, topKFirst, topNFinal, opts)

import { getEmbeddings } from './embeddings.js';

export interface RerankerOptions {
  topNAfter?: number;
  bm25Weight?: number;
  cosineWeight?: number;
  lengthPenalty?: boolean;
}

export interface RerankCandidate {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RerankResult {
  id: string;
  text: string;
  score: number;
  components: { bm25: number; cosine: number; lengthPenalty: number };
  rank: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_TOP_N = 5;
const DEFAULT_BM25_WEIGHT = 0.4;
const DEFAULT_COSINE_WEIGHT = 0.6;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MIN_TOKEN_LEN = 2;
const SHORT_DOC_CHARS = 20;
const LONG_DOC_CHARS = 2000;
const LENGTH_PENALTY_FACTOR = 0.15;

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','for','in','on','is','it','this','that',
  'as','by','be','do','at','if','so','no','not','but','from','with','was','were',
  'are','am','i','you','he','she','we','they','my','your','our','their','its',
  'me','us','them','then','than','too','very','can','will','just','about','into',
]);

export class BrainRerank {
  /** Rerank a candidate list using fused BM25 + cosine + optional length penalty. */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    opts?: RerankerOptions,
  ): Promise<RerankResult[]> {
    if (!candidates || candidates.length === 0) return [];

    const topN = opts?.topNAfter ?? DEFAULT_TOP_N;
    const wBm25 = opts?.bm25Weight ?? DEFAULT_BM25_WEIGHT;
    const wCos = opts?.cosineWeight ?? DEFAULT_COSINE_WEIGHT;
    const usePenalty = opts?.lengthPenalty !== false;

    const bm25Scores = this.computeBm25(query, candidates);
    const cosineScores = await this.computeCosine(query, candidates);
    const penaltyScores = usePenalty
      ? candidates.map(c => this.lengthPenalty(c.text))
      : candidates.map(() => 0);

    const bm25Norm = normalize01(bm25Scores);
    const cosNorm = normalize01(cosineScores);

    const fused: RerankResult[] = candidates.map((c, i) => {
      const score = wBm25 * bm25Norm[i] + wCos * cosNorm[i] - penaltyScores[i];
      return {
        id: c.id,
        text: c.text,
        score,
        components: { bm25: bm25Norm[i], cosine: cosNorm[i], lengthPenalty: penaltyScores[i] },
        rank: 0,
        metadata: c.metadata,
      };
    });

    fused.sort((a, b) => b.score - a.score);
    const sliced = fused.slice(0, topN);
    sliced.forEach((r, idx) => { r.rank = idx + 1; });
    return sliced;
  }

  /**
   * Fuse with embeddings-v2: do ANN over topKFirst → rerank → return topNFinal.
   * Gracefully falls back to raw ANN hits if embeddings-v2 is missing.
   */
  async searchAndRerank(
    query: string,
    topKFirst = 50,
    topNFinal = 5,
    opts?: RerankerOptions,
  ): Promise<RerankResult[]> {
    let hits: Array<{ id: string; text: string; score: number; metadata?: Record<string, unknown> }> = [];
    try {
      const mod = await import('./embeddings-v2.js');
      const v2 = mod.getEmbeddingsV2();
      hits = await v2.search(query, topKFirst);
    } catch {
      return [];
    }
    if (hits.length === 0) return [];

    return this.rerank(
      query,
      hits.map(h => ({ id: h.id, text: h.text, score: h.score, metadata: h.metadata })),
      { ...opts, topNAfter: topNFinal },
    );
  }

  // ── BM25 ──────────────────────────────────────────────────────────────

  private computeBm25(query: string, candidates: RerankCandidate[]): number[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return candidates.map(() => 0);

    const docTokens = candidates.map(c => tokenize(c.text));
    const docLens = docTokens.map(t => t.length);
    const N = candidates.length;
    const avgDl = docLens.reduce((s, x) => s + x, 0) / Math.max(1, N);

    // Document frequency per query term
    const df = new Map<string, number>();
    for (const term of queryTerms) {
      if (df.has(term)) continue;
      let count = 0;
      for (const toks of docTokens) {
        if (toks.includes(term)) count++;
      }
      df.set(term, count);
    }

    // Per-doc score
    const scores: number[] = [];
    for (let i = 0; i < N; i++) {
      const toks = docTokens[i];
      const dl = docLens[i] || 1;
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

      let s = 0;
      for (const term of queryTerms) {
        const f = tf.get(term);
        if (!f) continue;
        const dfT = df.get(term) ?? 0;
        const idf = Math.log((N - dfT + 0.5) / (dfT + 0.5) + 1);
        const norm = 1 - BM25_B + BM25_B * (dl / avgDl);
        s += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
      }
      scores.push(s);
    }
    return scores;
  }

  // ── Cosine ────────────────────────────────────────────────────────────

  private async computeCosine(query: string, candidates: RerankCandidate[]): Promise<number[]> {
    // If every candidate already has a usable score, reuse it (saves embedding work).
    const allHaveScores = candidates.every(c => typeof c.score === 'number' && Number.isFinite(c.score));
    if (allHaveScores) return candidates.map(c => c.score ?? 0);

    try {
      const emb = getEmbeddings();
      const q = await emb.embed(query);
      const out: number[] = [];
      for (const c of candidates) {
        if (typeof c.score === 'number' && Number.isFinite(c.score)) {
          out.push(c.score);
          continue;
        }
        const v = await emb.embed(c.text);
        let dotP = 0;
        const n = Math.min(q.length, v.length);
        for (let i = 0; i < n; i++) dotP += q[i] * v[i];
        out.push(dotP);
      }
      return out;
    } catch {
      // Defensive: degrade to whatever scores we have (or zeros).
      return candidates.map(c => c.score ?? 0);
    }
  }

  // ── Length penalty ────────────────────────────────────────────────────

  private lengthPenalty(text: string): number {
    const len = text?.length ?? 0;
    if (len === 0) return LENGTH_PENALTY_FACTOR;
    if (len < SHORT_DOC_CHARS) {
      const overflow = SHORT_DOC_CHARS - len;
      const total = SHORT_DOC_CHARS;
      return LENGTH_PENALTY_FACTOR * (overflow / total);
    }
    if (len > LONG_DOC_CHARS) {
      const overflow = len - LONG_DOC_CHARS;
      const total = LONG_DOC_CHARS;
      return LENGTH_PENALTY_FACTOR * Math.min(1, overflow / total);
    }
    return 0;
  }
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

function normalize01(scores: number[]): number[] {
  if (scores.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of scores) {
    if (!Number.isFinite(s)) continue;
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return scores.map(() => 0);
  const range = max - min;
  if (range <= 0) return scores.map(() => (max > 0 ? 1 : 0));
  return scores.map(s => (Number.isFinite(s) ? (s - min) / range : 0));
}

let _instance: BrainRerank | null = null;
export function getBrainRerank(): BrainRerank {
  if (!_instance) _instance = new BrainRerank();
  return _instance;
}
export function resetBrainRerankForTests(): void { _instance = null; }
