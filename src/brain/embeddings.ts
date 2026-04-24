// src/brain/embeddings.ts — Lightweight embeddings + semantic search
// v6.0.0 — Hive Mind Edition
//
// Uses a local hashing-based embedding (tfidf + char n-grams) for zero-dep
// semantic recall. If Ollama is available with an embedding model
// (nomic-embed-text, mxbai-embed-large, all-minilm), upgrades to real
// dense embeddings automatically.
//
// Exposed: embed(text), cosineSim(a,b), semanticSearch(query, candidates)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getModelRegistry } from './model-registry.js';

const CACHE_DIR = path.join(os.homedir(), '.shadow-brain', 'embeddings');
const CACHE_PATH = path.join(CACHE_DIR, 'vectors.json');
const EMB_DIM = 128;

type Cache = { schemaVersion: 1; vectors: Record<string, number[]>; lastProvider: 'local' | 'ollama' };

export class Embeddings {
  private cache: Map<string, number[]> = new Map();
  private ollamaModel: string | null = null;
  private ollamaBaseUrl: string = 'http://127.0.0.1:11434';
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (fs.existsSync(CACHE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as Cache;
        for (const [k, v] of Object.entries(parsed.vectors ?? {})) this.cache.set(k, v);
      } catch { /* skip */ }
    }

    // Probe for Ollama embedding model
    try {
      const reg = getModelRegistry();
      await reg.init();
      const ollama = reg.getProvider('ollama');
      if (ollama?.enabled) {
        this.ollamaBaseUrl = ollama.baseUrl;
        const res = await fetch(this.ollamaBaseUrl + '/api/tags', { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const json = await res.json() as { models?: Array<{ name: string }> };
          const preferred = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm'];
          for (const pref of preferred) {
            const match = json.models?.find(m => m.name.startsWith(pref));
            if (match) { this.ollamaModel = match.name; break; }
          }
        }
      }
    } catch { /* no ollama */ }

    this.initialized = true;
  }

  /** Embed a string — returns a unit-norm vector. Uses cache when available. */
  async embed(text: string): Promise<number[]> {
    await this.init();
    const trimmed = (text || '').slice(0, 8000);
    const cached = this.cache.get(trimmed);
    if (cached) return cached;

    let vec: number[] | null = null;
    if (this.ollamaModel) vec = await this.embedOllama(trimmed).catch(() => null);
    if (!vec) vec = this.embedLocal(trimmed);

    this.cache.set(trimmed, vec);
    if (this.cache.size % 25 === 0) this.persist().catch(() => {});
    return vec;
  }

  /** Cosine similarity between two same-length vectors (L2-normalized assumed). */
  static cosine(a: number[], b: number[]): number {
    let dot = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) dot += a[i] * b[i];
    return dot;
  }

  /** Rank candidates by cosine similarity to the query embedding. */
  async semanticSearch(query: string, candidates: Array<{ id: string; text: string }>, topK = 20): Promise<Array<{ id: string; score: number }>> {
    await this.init();
    const q = await this.embed(query);
    const scored: Array<{ id: string; score: number }> = [];
    for (const c of candidates) {
      const v = await this.embed(c.text);
      scored.push({ id: c.id, score: Embeddings.cosine(q, v) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async flush(): Promise<void> { await this.persist(); }

  // ── Internals ─────────────────────────────────────────────────────────

  private async embedOllama(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(this.ollamaBaseUrl + '/api/embeddings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.ollamaModel, prompt: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const json = await res.json() as { embedding?: number[] };
      if (!json.embedding || !json.embedding.length) return null;
      // L2 normalize
      return normalize(json.embedding);
    } catch { return null; }
  }

  /** Zero-dep local embedding: char tri-grams → hashed bag → dim 128 → TF weighting → L2 normalize. */
  private embedLocal(text: string): number[] {
    const vec = new Array<number>(EMB_DIM).fill(0);
    const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    // word unigrams
    const tokens = norm.split(/\s+/).filter(t => t.length > 1);
    const stopwords = new Set(['the','a','an','and','or','of','to','for','in','on','is','it','this','that','as','by','be','do']);
    for (const t of tokens) {
      if (stopwords.has(t)) continue;
      const h = hash32(t) % EMB_DIM;
      vec[h] += 1 + Math.log(t.length);
    }
    // char tri-grams for fuzzy matching
    for (let i = 0; i <= norm.length - 3; i++) {
      const tri = norm.slice(i, i + 3);
      if (!/\S/.test(tri)) continue;
      const h = (hash32(tri) * 17) % EMB_DIM;
      vec[h] += 0.3;
    }
    return normalize(vec);
  }

  private async persist(): Promise<void> {
    try {
      const shape: Cache = {
        schemaVersion: 1,
        vectors: Object.fromEntries(this.cache.entries()),
        lastProvider: this.ollamaModel ? 'ollama' : 'local',
      };
      const tmp = CACHE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(shape));
      fs.renameSync(tmp, CACHE_PATH);
    } catch { /* non-fatal */ }
  }
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

let _instance: Embeddings | null = null;
export function getEmbeddings(): Embeddings {
  if (!_instance) _instance = new Embeddings();
  return _instance;
}
export function resetEmbeddingsForTests(): void { _instance = null; }
