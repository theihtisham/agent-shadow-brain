// src/brain/embeddings-v2.ts — Indexed ANN vector store on top of Embeddings
// v6.0.2 — Hive Mind Edition
//
// Composes the v1 `Embeddings` class (hashing / Ollama dense vectors) with an
// in-memory hand-rolled HNSW-like graph index. Avoids the O(n) flat scan of
// the v1 cache for larger corpora — target <100ms recall over 10k vectors.
//
// Why hand-rolled and not hnswlib-node? Zero-dep constraint, must compile
// clean on Windows without prebuilt natives. A simplified hierarchical small-
// world graph with greedy descent + a single-layer ef-search is plenty for
// the corpus sizes a single developer's brain stores (typically <50k items).
//
// Persistence: sharded JSON files under ~/.shadow-brain/embeddings/.
// Each shard caps at ~5MB; new docs roll over to a fresh shard.
//
// Auto-pull: if Ollama is reachable but no embedding model is installed,
// POSTs to /api/pull (stream=true) for `nomic-embed-text` and emits progress
// events so callers can show a spinner. Falls back to hashing if Ollama is
// unreachable so this class is always usable offline.
//
// Exposed: EmbeddingsV2, getEmbeddingsV2(), resetEmbeddingsV2ForTests().
//   .addDocument(id, text, metadata?)
//   .search(query, topK)
//   .delete(id)
//   .count()
//   .stats()
//   on('pull-progress' | 'pull-complete' | 'pull-error', cb)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Embeddings, getEmbeddings } from './embeddings.js';

const INDEX_DIR = path.join(os.homedir(), '.shadow-brain', 'embeddings');
const SHARD_MAX_BYTES = 5 * 1024 * 1024;
const SHARD_PREFIX = 'index-v2.';
const DEFAULT_EF_SEARCH = 32;
const DEFAULT_EF_CONSTRUCT = 16;
const DEFAULT_M = 8;
const PULL_MODEL = 'nomic-embed-text';

interface IndexedDoc {
  id: string;
  text: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  neighbors: string[];
  shard: number;
}

interface ShardPayload {
  schemaVersion: 1;
  shard: number;
  docs: Array<Omit<IndexedDoc, 'shard'>>;
}

export interface SearchHit {
  id: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface IndexStats {
  count: number;
  shards: number;
  avgNeighbors: number;
  ollamaModel: string | null;
  ollamaPullState: 'idle' | 'pulling' | 'complete' | 'failed';
  approxBytes: number;
}

export class EmbeddingsV2 extends EventEmitter {
  private docs: Map<string, IndexedDoc> = new Map();
  private entryPoint: string | null = null;
  private nextShard = 0;
  private currentShardBytes = 0;
  private initialized = false;
  private pullState: IndexStats['ollamaPullState'] = 'idle';
  private readonly embeddings: Embeddings;
  private readonly M: number;
  private readonly efConstruct: number;
  private readonly efSearch: number;

  constructor(opts?: { embeddings?: Embeddings; M?: number; efConstruct?: number; efSearch?: number }) {
    super();
    this.embeddings = opts?.embeddings ?? getEmbeddings();
    this.M = opts?.M ?? DEFAULT_M;
    this.efConstruct = opts?.efConstruct ?? DEFAULT_EF_CONSTRUCT;
    this.efSearch = opts?.efSearch ?? DEFAULT_EF_SEARCH;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    await this.embeddings.init();
    this.loadShards();
    this.maybeAutoPull().catch(err => this.emit('pull-error', err));
    this.initialized = true;
  }

  /** Index a document. Replaces any prior doc with the same id. */
  async addDocument(id: string, text: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.init();
    const vector = await this.embeddings.embed(text);
    if (this.docs.has(id)) this.detachNode(id);

    const doc: IndexedDoc = {
      id,
      text,
      vector,
      metadata,
      neighbors: [],
      shard: this.pickShardFor(text),
    };
    this.docs.set(id, doc);
    this.linkNode(doc);
    if (!this.entryPoint) this.entryPoint = id;
    await this.persistShard(doc.shard);
  }

  /** Approximate top-K nearest neighbors by cosine similarity. */
  async search(query: string, topK = 10): Promise<SearchHit[]> {
    await this.init();
    if (this.docs.size === 0 || !this.entryPoint) return [];
    const qVec = await this.embeddings.embed(query);
    const candidates = this.greedySearch(qVec, Math.max(topK, this.efSearch));
    const hits: SearchHit[] = [];
    for (const c of candidates.slice(0, topK)) {
      const doc = this.docs.get(c.id);
      if (!doc) continue;
      hits.push({ id: c.id, score: c.score, text: doc.text, metadata: doc.metadata });
    }
    return hits;
  }

  /** Remove a document from the index. */
  async delete(id: string): Promise<boolean> {
    await this.init();
    const doc = this.docs.get(id);
    if (!doc) return false;
    this.detachNode(id);
    this.docs.delete(id);
    if (this.entryPoint === id) this.entryPoint = this.docs.keys().next().value ?? null;
    await this.persistShard(doc.shard);
    return true;
  }

  count(): number { return this.docs.size; }

  stats(): IndexStats {
    const neighborSum = Array.from(this.docs.values()).reduce((s, d) => s + d.neighbors.length, 0);
    const shards = new Set(Array.from(this.docs.values()).map(d => d.shard)).size;
    return {
      count: this.docs.size,
      shards,
      avgNeighbors: this.docs.size ? +(neighborSum / this.docs.size).toFixed(2) : 0,
      ollamaModel: (this.embeddings as unknown as { ollamaModel?: string }).ollamaModel ?? null,
      ollamaPullState: this.pullState,
      approxBytes: this.approxBytes(),
    };
  }

  async flush(): Promise<void> {
    const dirtyShards = new Set(Array.from(this.docs.values()).map(d => d.shard));
    for (const s of dirtyShards) await this.persistShard(s);
  }

  // -- Index core ----------------------------------------------------------

  private linkNode(doc: IndexedDoc): void {
    if (!this.entryPoint || this.docs.size === 1) return;
    const candidates = this.greedySearch(doc.vector, this.efConstruct);
    const selected = candidates.slice(0, this.M);
    doc.neighbors = selected.map(c => c.id);
    for (const c of selected) {
      const peer = this.docs.get(c.id);
      if (!peer) continue;
      if (!peer.neighbors.includes(doc.id)) {
        peer.neighbors.push(doc.id);
        // Cap peer fan-out so the graph stays small-world. Keep the M nearest.
        if (peer.neighbors.length > this.M * 2) {
          const scored = peer.neighbors
            .map(nid => ({ id: nid, score: this.dotById(peer.vector, nid) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, this.M * 2);
          peer.neighbors = scored.map(s => s.id);
        }
      }
    }
  }

  private detachNode(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const peerId of doc.neighbors) {
      const peer = this.docs.get(peerId);
      if (!peer) continue;
      peer.neighbors = peer.neighbors.filter(n => n !== id);
    }
  }

  private greedySearch(query: number[], ef: number): Array<{ id: string; score: number }> {
    const visited = new Set<string>();
    const start = this.entryPoint!;
    const startDoc = this.docs.get(start);
    if (!startDoc) return [];

    const frontier: Array<{ id: string; score: number }> = [
      { id: start, score: dot(query, startDoc.vector) },
    ];
    const best: Array<{ id: string; score: number }> = [...frontier];
    visited.add(start);

    while (frontier.length) {
      frontier.sort((a, b) => b.score - a.score);
      const current = frontier.shift()!;
      // Stop if our worst kept best is still better than this candidate.
      if (best.length >= ef && current.score < best[best.length - 1].score) break;
      const doc = this.docs.get(current.id);
      if (!doc) continue;
      for (const nid of doc.neighbors) {
        if (visited.has(nid)) continue;
        visited.add(nid);
        const peer = this.docs.get(nid);
        if (!peer) continue;
        const s = dot(query, peer.vector);
        frontier.push({ id: nid, score: s });
        best.push({ id: nid, score: s });
        best.sort((a, b) => b.score - a.score);
        if (best.length > ef) best.pop();
      }
    }
    return best;
  }

  private dotById(query: number[], id: string): number {
    const doc = this.docs.get(id);
    return doc ? dot(query, doc.vector) : -Infinity;
  }

  // -- Persistence ---------------------------------------------------------

  private loadShards(): void {
    const files = fs.existsSync(INDEX_DIR)
      ? fs.readdirSync(INDEX_DIR).filter(f => f.startsWith(SHARD_PREFIX) && f.endsWith('.json'))
      : [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(INDEX_DIR, file), 'utf-8');
        const payload = JSON.parse(raw) as ShardPayload;
        for (const d of payload.docs ?? []) {
          this.docs.set(d.id, { ...d, shard: payload.shard });
        }
        this.nextShard = Math.max(this.nextShard, payload.shard + 1);
      } catch { /* skip corrupt shard */ }
    }
    this.entryPoint = this.docs.keys().next().value ?? null;
    this.currentShardBytes = this.shardBytes(Math.max(0, this.nextShard - 1));
  }

  private pickShardFor(text: string): number {
    const approx = text.length * 4 + 256; // text bytes + vector + neighbors overhead
    if (this.currentShardBytes + approx > SHARD_MAX_BYTES) {
      this.nextShard = Math.max(this.nextShard, this.shardCount());
      this.currentShardBytes = 0;
      return this.nextShard++;
    }
    this.currentShardBytes += approx;
    return Math.max(0, this.nextShard - 1);
  }

  private shardCount(): number {
    return new Set(Array.from(this.docs.values()).map(d => d.shard)).size;
  }

  private async persistShard(shard: number): Promise<void> {
    try {
      const docs = Array.from(this.docs.values()).filter(d => d.shard === shard);
      const payload: ShardPayload = {
        schemaVersion: 1,
        shard,
        docs: docs.map(({ shard: _s, ...rest }) => rest),
      };
      const file = path.join(INDEX_DIR, `${SHARD_PREFIX}${shard}.json`);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, file);
    } catch { /* non-fatal */ }
  }

  private shardBytes(shard: number): number {
    try {
      const file = path.join(INDEX_DIR, `${SHARD_PREFIX}${shard}.json`);
      return fs.existsSync(file) ? fs.statSync(file).size : 0;
    } catch { return 0; }
  }

  private approxBytes(): number {
    let total = 0;
    if (!fs.existsSync(INDEX_DIR)) return 0;
    for (const f of fs.readdirSync(INDEX_DIR)) {
      if (!f.startsWith(SHARD_PREFIX)) continue;
      try { total += fs.statSync(path.join(INDEX_DIR, f)).size; } catch { /* skip */ }
    }
    return total;
  }

  // -- Ollama auto-pull ----------------------------------------------------

  private async maybeAutoPull(): Promise<void> {
    const emb = this.embeddings as unknown as { ollamaModel?: string | null; ollamaBaseUrl?: string };
    if (emb.ollamaModel) return; // already have a model
    const baseUrl = emb.ollamaBaseUrl ?? 'http://127.0.0.1:11434';
    try {
      const probe = await fetch(baseUrl + '/api/tags', { signal: AbortSignal.timeout(2000) });
      if (!probe.ok) return; // no Ollama, stay on hashing fallback
    } catch { return; }

    this.pullState = 'pulling';
    this.emit('pull-progress', { model: PULL_MODEL, status: 'starting', percent: 0 });
    try {
      const res = await fetch(baseUrl + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: PULL_MODEL, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`pull failed: ${res.status}`);
      const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as { status?: string; total?: number; completed?: number };
            const percent = obj.total && obj.completed ? +(obj.completed / obj.total * 100).toFixed(1) : 0;
            this.emit('pull-progress', { model: PULL_MODEL, status: obj.status ?? 'pulling', percent });
          } catch { /* skip non-JSON line */ }
        }
      }
      this.pullState = 'complete';
      this.emit('pull-complete', { model: PULL_MODEL });
    } catch (err) {
      this.pullState = 'failed';
      this.emit('pull-error', err);
    }
  }
}

function dot(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

let _instance: EmbeddingsV2 | null = null;
export function getEmbeddingsV2(): EmbeddingsV2 {
  if (!_instance) _instance = new EmbeddingsV2();
  return _instance;
}
export function resetEmbeddingsV2ForTests(): void { _instance = null; }
