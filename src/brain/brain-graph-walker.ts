// src/brain/brain-graph-walker.ts — Multi-hop entity graph traversal
// v6.0.2 — Hive Mind Edition
//
// Single-vector ANN gets you memories that are semantically NEAR the query,
// but it misses memories that are RELATED but worded differently. Walking
// the entity graph 2-3 hops bridges that gap: from a seed memory, we follow
// 5 edge types (similarity, causal, temporal, agent-handoff, co-occurrence)
// with priority-queue BFS and per-hop score decay so close hits keep their
// weight and distant hits fade gracefully.
//
// Edges (constructed online, lazily per edge type):
//   - similarity     : cosine ≥ 0.5 via embeddings-v2 (top-5 neighbors)
//   - causal         : dynamic-import causal-chains.ts, walk parents+children
//   - temporal       : memories in same project within 1 hour of each other
//   - agent-handoff  : memories created by sub-agent that inherited from parent
//   - co-occurrence  : shared entity references in metadata.entities[]
//
// Algorithm: priority-queue BFS. For each pop, expand by every enabled edge
// type, attach edges, push unseen targets with score *= decay. Stop at
// maxNodes (default 50) or maxHops (default 3). Final score per node is the
// max over all arrival paths so the most direct route wins.
//
// Convenience: relevantToQuery(query) embeds the query, picks top-3 ANN seeds,
// then walks. Used by the dashboard's "What does X relate to?" panel.
//
// Exposed: BrainGraphWalker, getBrainGraphWalker(), reset…ForTests().

import { GlobalEntry, AgentTool } from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

export type EdgeType = 'similarity' | 'causal' | 'temporal' | 'agent-handoff' | 'co-occurrence';

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_NODES = 50;
const DEFAULT_DECAY = 0.7;
const SIMILARITY_THRESHOLD = 0.5;
const SIMILARITY_TOP_K = 5;
const TEMPORAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const ALL_EDGE_TYPES: ReadonlyArray<EdgeType> = [
  'similarity', 'causal', 'temporal', 'agent-handoff', 'co-occurrence',
];

export interface WalkOptions {
  maxHops?: number;
  maxNodes?: number;
  scoreDecayPerHop?: number;
  edgeTypes?: EdgeType[];
}

export interface WalkEdgeRef {
  from: string;
  type: EdgeType;
  weight: number;
}

export interface WalkNode {
  memoryId: string;
  hopsFromSeed: number;
  scoreFromSeed: number;
  edgesIn: WalkEdgeRef[];
}

export interface WalkPath {
  seed: string;
  target: string;
  hops: Array<{ memoryId: string; edgeType: EdgeType }>;
  totalScore: number;
}

export interface WalkResult {
  seeds: string[];
  visited: WalkNode[];
  paths: WalkPath[];
  durationMs: number;
  hopHistogram: number[];
}

interface FrontierItem {
  memoryId: string;
  hops: number;
  score: number;
  parent: string | null;
  parentEdge: EdgeType | null;
}

interface InternalNode {
  ref: WalkNode;
  // Best parent for path reconstruction
  bestParent: string | null;
  bestParentEdge: EdgeType | null;
}

export class BrainGraphWalker {
  private readonly brain: GlobalBrain;
  private memoryCache: Map<string, GlobalEntry> | null = null;

  constructor(brain?: GlobalBrain) {
    this.brain = brain ?? getGlobalBrain();
  }

  /** Walk the graph starting from seedMemoryIds. */
  async walk(seedMemoryIds: string[], opts: WalkOptions = {}): Promise<WalkResult> {
    const startedAt = Date.now();
    await this.brain.init();
    this.memoryCache = null;

    const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    const decay = clamp(opts.scoreDecayPerHop ?? DEFAULT_DECAY, 0.05, 1);
    const edgeTypes = (opts.edgeTypes && opts.edgeTypes.length > 0)
      ? Array.from(new Set(opts.edgeTypes))
      : Array.from(ALL_EDGE_TYPES);

    const memById = this.memories();
    const validSeeds = seedMemoryIds.filter(id => memById.has(id));
    if (validSeeds.length === 0) {
      return emptyResult(seedMemoryIds, Date.now() - startedAt);
    }

    const nodes = new Map<string, InternalNode>();
    const frontier: FrontierItem[] = validSeeds.map(id => ({
      memoryId: id, hops: 0, score: 1, parent: null, parentEdge: null,
    }));
    const seedSet = new Set(validSeeds);

    while (frontier.length > 0 && nodes.size < maxNodes) {
      // Priority by score (max-heap via sort — corpus is small)
      frontier.sort((a, b) => b.score - a.score);
      const cur = frontier.shift()!;
      const existing = nodes.get(cur.memoryId);

      if (!existing) {
        nodes.set(cur.memoryId, {
          ref: {
            memoryId: cur.memoryId,
            hopsFromSeed: cur.hops,
            scoreFromSeed: cur.score,
            edgesIn: cur.parent && cur.parentEdge
              ? [{ from: cur.parent, type: cur.parentEdge, weight: cur.score }]
              : [],
          },
          bestParent: cur.parent,
          bestParentEdge: cur.parentEdge,
        });
      } else {
        // Update if we found a higher-scoring arrival
        if (cur.score > existing.ref.scoreFromSeed) {
          existing.ref.scoreFromSeed = cur.score;
          existing.ref.hopsFromSeed = cur.hops;
          existing.bestParent = cur.parent;
          existing.bestParentEdge = cur.parentEdge;
        }
        if (cur.parent && cur.parentEdge) {
          const dup = existing.ref.edgesIn.find(e => e.from === cur.parent && e.type === cur.parentEdge);
          if (!dup) existing.ref.edgesIn.push({ from: cur.parent, type: cur.parentEdge, weight: cur.score });
        }
        continue; // already expanded
      }

      if (cur.hops >= maxHops) continue;

      for (const et of edgeTypes) {
        const neighbors = await this.edgesFrom(cur.memoryId, et);
        for (const n of neighbors) {
          if (n.targetId === cur.memoryId) continue;
          const nextScore = cur.score * decay * Math.min(1, n.weight);
          frontier.push({
            memoryId: n.targetId,
            hops: cur.hops + 1,
            score: nextScore,
            parent: cur.memoryId,
            parentEdge: et,
          });
        }
      }
    }

    const visited = Array.from(nodes.values()).map(n => n.ref);
    visited.sort((a, b) => b.scoreFromSeed - a.scoreFromSeed);
    const paths = buildPaths(nodes, seedSet);
    const histogram = histogramByHops(visited, maxHops);

    return {
      seeds: validSeeds,
      visited,
      paths,
      durationMs: Date.now() - startedAt,
      hopHistogram: histogram,
    };
  }

  /** Embed the query, pick the top-3 ANN seeds, then walk. */
  async relevantToQuery(query: string, opts: WalkOptions = {}): Promise<WalkResult> {
    const startedAt = Date.now();
    let seedIds: string[] = [];
    try {
      const v2 = (await import('./embeddings-v2.js')).getEmbeddingsV2();
      const hits = await v2.search(query, 3);
      seedIds = hits.map(h => h.id);
    } catch {
      seedIds = [];
    }
    if (seedIds.length === 0) {
      // Fallback: rank memories by keyword overlap with the query
      const memories = Array.from(this.memories().values());
      const qTokens = tokenize(query);
      if (qTokens.size === 0) return emptyResult([], Date.now() - startedAt);
      const scored = memories.map(m => ({ id: m.id, score: keywordOverlap(qTokens, m.content) }));
      scored.sort((a, b) => b.score - a.score);
      seedIds = scored.slice(0, 3).filter(s => s.score > 0).map(s => s.id);
    }
    return this.walk(seedIds, opts);
  }

  // ── Edges ──────────────────────────────────────────────────────────────

  private async edgesFrom(memoryId: string, type: EdgeType): Promise<Array<{ targetId: string; weight: number }>> {
    const all = this.memories();
    const me = all.get(memoryId);
    if (!me) return [];
    if (type === 'similarity') return this.similarityEdges(me);
    if (type === 'causal') return this.causalEdges(memoryId);
    if (type === 'temporal') return this.temporalEdges(me, all);
    if (type === 'agent-handoff') return this.handoffEdges(me, all);
    if (type === 'co-occurrence') return this.coOccurrenceEdges(me, all);
    return [];
  }

  private async similarityEdges(me: GlobalEntry): Promise<Array<{ targetId: string; weight: number }>> {
    try {
      const v2 = (await import('./embeddings-v2.js')).getEmbeddingsV2();
      const hits = await v2.search(me.content, SIMILARITY_TOP_K + 1);
      const out: Array<{ targetId: string; weight: number }> = [];
      for (const h of hits) {
        if (h.id === me.id) continue;
        if (h.score < SIMILARITY_THRESHOLD) continue;
        out.push({ targetId: h.id, weight: h.score });
        if (out.length >= SIMILARITY_TOP_K) break;
      }
      return out;
    } catch { return []; }
  }

  private async causalEdges(memoryId: string): Promise<Array<{ targetId: string; weight: number }>> {
    try {
      const mod = await import('./causal-chains.js');
      const cc: {
        trace: (id: string, opts?: { maxDepth?: number }) => Promise<{ links: Array<{ effectId: string; causeId: string; strength: number }> }>;
        influence: (id: string, opts?: { maxDepth?: number }) => Promise<{ links: Array<{ effectId: string; causeId: string; strength: number }> }>;
      } = (mod as unknown as { getCausalChains: () => unknown }).getCausalChains
        ? ((mod as unknown as { getCausalChains: () => never }).getCausalChains())
        : new (mod as unknown as { CausalChains: new () => never }).CausalChains();
      const trace = await cc.trace(memoryId, { maxDepth: 1 });
      const inflow = await cc.influence(memoryId, { maxDepth: 1 });
      const out: Array<{ targetId: string; weight: number }> = [];
      for (const link of trace.links) {
        const other = link.effectId === memoryId ? link.causeId : link.effectId;
        if (other !== memoryId) out.push({ targetId: other, weight: link.strength });
      }
      for (const link of inflow.links) {
        const other = link.causeId === memoryId ? link.effectId : link.causeId;
        if (other !== memoryId) out.push({ targetId: other, weight: link.strength });
      }
      return dedupeEdges(out);
    } catch { return []; }
  }

  private temporalEdges(me: GlobalEntry, all: Map<string, GlobalEntry>): Array<{ targetId: string; weight: number }> {
    const out: Array<{ targetId: string; weight: number }> = [];
    const t0 = me.createdAt.getTime();
    for (const other of all.values()) {
      if (other.id === me.id) continue;
      if (other.projectId !== me.projectId) continue;
      const dt = Math.abs(other.createdAt.getTime() - t0);
      if (dt <= TEMPORAL_WINDOW_MS) {
        const weight = 1 - dt / TEMPORAL_WINDOW_MS;
        out.push({ targetId: other.id, weight: Math.max(0.1, weight) });
      }
    }
    // Keep the strongest 8 temporal neighbors per node
    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, 8);
  }

  private handoffEdges(me: GlobalEntry, all: Map<string, GlobalEntry>): Array<{ targetId: string; weight: number }> {
    const out: Array<{ targetId: string; weight: number }> = [];
    const meta = (me.metadata ?? {}) as { parentAgent?: AgentTool; childAgent?: AgentTool; handoffOf?: string };
    const parentId = meta.handoffOf;
    if (parentId && all.has(parentId)) out.push({ targetId: parentId, weight: 0.9 });

    // Find children: any memory whose metadata.handoffOf === me.id
    for (const other of all.values()) {
      if (other.id === me.id) continue;
      const om = (other.metadata ?? {}) as { handoffOf?: string };
      if (om.handoffOf === me.id) out.push({ targetId: other.id, weight: 0.9 });
    }

    // Same-project agent transitions in close temporal window
    const myAgent = me.agentTool;
    const t0 = me.createdAt.getTime();
    for (const other of all.values()) {
      if (other.id === me.id) continue;
      if (other.projectId !== me.projectId) continue;
      if (other.agentTool === myAgent) continue;
      const dt = Math.abs(other.createdAt.getTime() - t0);
      if (dt <= TEMPORAL_WINDOW_MS / 2) out.push({ targetId: other.id, weight: 0.5 });
    }
    return dedupeEdges(out).slice(0, 6);
  }

  private coOccurrenceEdges(me: GlobalEntry, all: Map<string, GlobalEntry>): Array<{ targetId: string; weight: number }> {
    const meta = (me.metadata ?? {}) as { entities?: unknown };
    const myEntities = collectEntities(meta);
    if (myEntities.size === 0) return [];
    const out: Array<{ targetId: string; weight: number }> = [];
    for (const other of all.values()) {
      if (other.id === me.id) continue;
      const otherEntities = collectEntities((other.metadata ?? {}) as { entities?: unknown });
      if (otherEntities.size === 0) continue;
      let shared = 0;
      const smaller = myEntities.size <= otherEntities.size ? myEntities : otherEntities;
      const larger = myEntities.size <= otherEntities.size ? otherEntities : myEntities;
      for (const e of smaller) if (larger.has(e)) shared++;
      if (shared === 0) continue;
      const denom = myEntities.size + otherEntities.size - shared;
      const weight = denom > 0 ? shared / denom : 0;
      if (weight > 0) out.push({ targetId: other.id, weight: Math.min(1, weight) });
    }
    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, 6);
  }

  // ── Memory access ──────────────────────────────────────────────────────

  private memories(): Map<string, GlobalEntry> {
    if (this.memoryCache) return this.memoryCache;
    const internal = (this.brain as unknown as { entries?: Map<string, GlobalEntry> }).entries;
    if (internal) {
      this.memoryCache = internal;
      return internal;
    }
    // Fallback: pull via public recall
    const list = this.brain.recall({ limit: 10_000 });
    const map = new Map<string, GlobalEntry>();
    for (const m of list) map.set(m.id, m);
    this.memoryCache = map;
    return map;
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────

function emptyResult(seeds: string[], durationMs: number): WalkResult {
  return { seeds, visited: [], paths: [], durationMs, hopHistogram: [0] };
}

function dedupeEdges(edges: Array<{ targetId: string; weight: number }>): Array<{ targetId: string; weight: number }> {
  const best = new Map<string, number>();
  for (const e of edges) {
    const prev = best.get(e.targetId);
    if (prev === undefined || e.weight > prev) best.set(e.targetId, e.weight);
  }
  return Array.from(best.entries()).map(([targetId, weight]) => ({ targetId, weight }));
}

function collectEntities(meta: { entities?: unknown }): Set<string> {
  const out = new Set<string>();
  const arr = meta.entities;
  if (Array.isArray(arr)) {
    for (const x of arr) {
      if (typeof x === 'string' && x.length > 1) out.add(x.toLowerCase());
      else if (x && typeof x === 'object' && typeof (x as { name?: string }).name === 'string') {
        out.add(((x as { name: string }).name).toLowerCase());
      }
    }
  } else if (typeof arr === 'string') {
    for (const t of arr.split(/[,;\s]+/)) if (t.length > 1) out.add(t.toLowerCase());
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function tokenize(text: string): Set<string> {
  return new Set(
    (text || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2),
  );
}

function keywordOverlap(qTokens: Set<string>, text: string): number {
  if (qTokens.size === 0) return 0;
  const t = tokenize(text);
  if (t.size === 0) return 0;
  let inter = 0;
  for (const q of qTokens) if (t.has(q)) inter++;
  return inter / Math.max(1, qTokens.size);
}

function histogramByHops(nodes: WalkNode[], maxHops: number): number[] {
  const buckets = new Array<number>(maxHops + 1).fill(0);
  for (const n of nodes) {
    const idx = Math.min(n.hopsFromSeed, maxHops);
    buckets[idx]++;
  }
  return buckets;
}

function buildPaths(nodes: Map<string, InternalNode>, seeds: Set<string>): WalkPath[] {
  const paths: WalkPath[] = [];
  for (const node of nodes.values()) {
    if (seeds.has(node.ref.memoryId)) continue;
    const path = reconstructPath(nodes, node.ref.memoryId, seeds);
    if (!path) continue;
    paths.push(path);
  }
  paths.sort((a, b) => b.totalScore - a.totalScore);
  return paths;
}

function reconstructPath(nodes: Map<string, InternalNode>, target: string, seeds: Set<string>): WalkPath | null {
  const hops: Array<{ memoryId: string; edgeType: EdgeType }> = [];
  let cur: string | null = target;
  const guard = new Set<string>();
  while (cur && !seeds.has(cur)) {
    if (guard.has(cur)) return null; // cycle protection
    guard.add(cur);
    const node = nodes.get(cur);
    if (!node || !node.bestParent || !node.bestParentEdge) return null;
    hops.unshift({ memoryId: cur, edgeType: node.bestParentEdge });
    cur = node.bestParent;
  }
  if (!cur) return null;
  const targetNode = nodes.get(target);
  return {
    seed: cur,
    target,
    hops,
    totalScore: targetNode?.ref.scoreFromSeed ?? 0,
  };
}

let _instance: BrainGraphWalker | null = null;
export function getBrainGraphWalker(): BrainGraphWalker {
  if (!_instance) _instance = new BrainGraphWalker();
  return _instance;
}
export function resetBrainGraphWalkerForTests(): void { _instance = null; }
