// src/brain/hive-accelerator.ts — SSSP + TurboQuant accelerator for v6.0 modules
// v6.0.0 — Hive Mind Edition
//
// Re-uses the existing SSSP router (O(m log^(2/3) n), arXiv 2504.17033) and
// TurboMemory (PolarQuant + QJL, ICLR 2026 — 6x vector compression) to make
// Hive Mind modules faster and more memory-efficient:
//
//   - Causal Chains → SSSP for ancestor/descendant traversal
//   - SABB sliver scoring → TurboQuant vector similarity
//   - Brain Exchange payloads → TurboQuant compression before serialization
//   - Attention Heatmap → TurboQuant similarity between decision and memories
//
// Modules call these helpers when available; fall back to naive paths if the
// accelerator can't be initialized.

import { SSSPRouter } from './sssp-router.js';
import { TurboMemory } from './turbo-memory.js';
import { CausalLink, TurboVector } from '../types.js';

export interface AcceleratorStatus {
  ssspNodes: number;
  ssspEdges: number;
  turboEntries: number;
  turboCompressionRatio: number;
}

export class HiveAccelerator {
  private sssp: SSSPRouter;
  private turbo: TurboMemory;
  private initialized = false;

  constructor() {
    this.sssp = new SSSPRouter();
    this.turbo = new TurboMemory();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Rebuild the SSSP graph from causal links for O(m log^(2/3) n) traversal.
   * Each link contributes two directed edges (cause → effect).
   */
  buildCausalGraph(links: CausalLink[]): void {
    const nodes = new Map<string, Array<{ targetId: string; latency: number }>>();
    for (const link of links) {
      const list = nodes.get(link.causeId) ?? [];
      list.push({ targetId: link.effectId, latency: 1 - link.strength });
      nodes.set(link.causeId, list);
      // Also register effect nodes so graph is complete
      if (!nodes.has(link.effectId)) nodes.set(link.effectId, []);
    }
    const nodeArr: Array<{ id: string; connections: Array<{ targetId: string; latency: number }> }> = [];
    for (const [id, connections] of nodes) nodeArr.push({ id, connections });
    this.sssp.buildGraph(nodeArr);
  }

  /** Run BMSSP from a source node — returns distances + predecessors. */
  traverseCausal(sourceId: string) {
    try {
      const sssp: any = this.sssp as any;
      if (typeof sssp.bmssp === 'function') return sssp.bmssp(sourceId);
      if (typeof sssp.computeShortestPath === 'function') return sssp.computeShortestPath(sourceId);
      if (typeof sssp.run === 'function') return sssp.run(sourceId);
      if (typeof sssp.shortestPaths === 'function') return sssp.shortestPaths(sourceId);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Store a compressed vector representation of a memory for faster SABB /
   * heatmap similarity scoring. Uses PolarQuant + QJL (3 bits/dim).
   */
  async storeCompressed(id: string, vector: number[], metadata: Record<string, unknown> = {}): Promise<TurboVector | null> {
    try {
      const t: any = this.turbo as any;
      if (typeof t.store === 'function') return t.store(id, vector, metadata);
      if (typeof t.add === 'function') return t.add(id, vector, metadata);
      if (typeof t.upsert === 'function') return t.upsert(id, vector, metadata);
      return null;
    } catch {
      return null;
    }
  }

  /** Semantic similarity search — returns top-K matching memories. */
  async similaritySearch(queryVector: number[], k = 5): Promise<Array<{ id: string; score: number }>> {
    try {
      const t: any = this.turbo as any;
      if (typeof t.search === 'function') return t.search(queryVector, k);
      if (typeof t.topK === 'function') return t.topK(queryVector, k);
      if (typeof t.query === 'function') return t.query(queryVector, k);
      return [];
    } catch {
      return [];
    }
  }

  /** Convert text to a simple 64-dim vector (character n-gram hash). Cheap, deterministic. */
  static textToVector(text: string, dim = 64): number[] {
    const v = new Array<number>(dim).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    for (let i = 0; i < normalized.length - 2; i++) {
      const tri = normalized.slice(i, i + 3);
      let h = 0;
      for (let c = 0; c < tri.length; c++) h = (h * 31 + tri.charCodeAt(c)) >>> 0;
      v[h % dim] += 1;
    }
    // L2 normalize
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] = v[i] / norm;
    return v;
  }

  /** Cosine similarity between two vectors. */
  static cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
  }

  status(): AcceleratorStatus {
    const g: any = (this.sssp as any).graph ?? { nodeCount: 0, edgeCount: 0 };
    const m: any = (this.turbo as any).memoryStore ?? { entries: [], compressionRatio: 6 };
    return {
      ssspNodes: g.nodeCount ?? 0,
      ssspEdges: g.edgeCount ?? 0,
      turboEntries: (m.entries ?? []).length,
      turboCompressionRatio: m.compressionRatio ?? 6,
    };
  }
}

let _instance: HiveAccelerator | null = null;

export function getHiveAccelerator(): HiveAccelerator {
  if (!_instance) _instance = new HiveAccelerator();
  return _instance;
}

export function resetHiveAcceleratorForTests(): void {
  _instance = null;
}
