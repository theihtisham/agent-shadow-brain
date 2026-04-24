// src/brain/causal-chains.ts — Causal Memory Chains
// v6.0.0 — Hive Mind Edition
//
// Every other tool logs events. Shadow Brain tracks CAUSES.
//
// When a brain write happens, it can optionally record its "parent cause" — the
// prior memory/decision that led to this new one. Over time this builds a DAG
// where you can ask: "Why did Claude use bcrypt@12?" and get a rendered chain
// all the way back to the user's original prompt weeks earlier.
//
// Storage: ~/.shadow-brain/causal-chains.json
// Output: Graphviz DOT + JSON chain trees.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  CausalLink,
  CausalChain,
  CausalChainNode,
  AgentTool,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const CHAINS_PATH = path.join(os.homedir(), '.shadow-brain', 'causal-chains.json');

interface PersistShape {
  schemaVersion: 1;
  links: CausalLink[];
}

export class CausalChains {
  private brain: GlobalBrain;
  private links: Map<string, CausalLink> = new Map();
  private byEffect: Map<string, CausalLink[]> = new Map();
  private byCause: Map<string, CausalLink[]> = new Map();
  private initialized = false;

  constructor(brain?: GlobalBrain) {
    this.brain = brain ?? getGlobalBrain();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(CHAINS_PATH), { recursive: true });
    await this.brain.init();

    if (fs.existsSync(CHAINS_PATH)) {
      try {
        const raw = fs.readFileSync(CHAINS_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PersistShape;
        if (Array.isArray(parsed.links)) {
          for (const link of parsed.links) {
            const rehydrated: CausalLink = { ...link, createdAt: new Date(link.createdAt) };
            this.links.set(rehydrated.id, rehydrated);
            this.index(rehydrated);
          }
        }
      } catch {
        /* corrupt file — start fresh */
      }
    }
    this.initialized = true;
  }

  /** Record that `effectId` was caused by `causeId`. */
  async link(effectId: string, causeId: string, rationale?: string, strength = 1.0): Promise<CausalLink> {
    await this.init();
    const link: CausalLink = {
      id: `cl-${crypto.randomBytes(6).toString('hex')}`,
      effectId,
      causeId,
      rationale,
      strength: Math.max(0, Math.min(1, strength)),
      createdAt: new Date(),
    };
    this.links.set(link.id, link);
    this.index(link);
    await this.persist();
    return link;
  }

  /** Walk back from an effect to trace all ancestor causes. */
  async trace(effectId: string, opts: { maxDepth?: number } = {}): Promise<CausalChain> {
    await this.init();
    const maxDepth = opts.maxDepth ?? 8;
    const visited = new Set<string>();
    const nodesById = new Map<string, CausalChainNode>();
    const collectedLinks: CausalLink[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: effectId, depth: 0 }];
    let maxReachedDepth = 0;

    while (queue.length) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      maxReachedDepth = Math.max(maxReachedDepth, depth);

      const node = await this.nodeFromMemoryId(id, depth);
      nodesById.set(id, node);

      if (depth >= maxDepth) continue;

      const parents = this.byEffect.get(id) ?? [];
      for (const link of parents) {
        collectedLinks.push(link);
        queue.push({ id: link.causeId, depth: depth + 1 });
      }
    }

    // Fill parents/children
    for (const link of collectedLinks) {
      const effect = nodesById.get(link.effectId);
      const cause = nodesById.get(link.causeId);
      if (effect && !effect.parents.includes(link.causeId)) effect.parents.push(link.causeId);
      if (cause && !cause.children.includes(link.effectId)) cause.children.push(link.effectId);
    }

    const nodes = Array.from(nodesById.values());
    return {
      rootId: effectId,
      nodes,
      links: collectedLinks,
      maxDepth: maxReachedDepth,
      generatedAt: new Date(),
      dot: this.renderDot(nodes, collectedLinks),
    };
  }

  /** Walk forward from a cause to find all effects it influenced. */
  async influence(causeId: string, opts: { maxDepth?: number } = {}): Promise<CausalChain> {
    await this.init();
    const maxDepth = opts.maxDepth ?? 8;
    const visited = new Set<string>();
    const nodesById = new Map<string, CausalChainNode>();
    const collectedLinks: CausalLink[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: causeId, depth: 0 }];
    let maxReachedDepth = 0;

    while (queue.length) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      maxReachedDepth = Math.max(maxReachedDepth, depth);

      const node = await this.nodeFromMemoryId(id, depth);
      nodesById.set(id, node);

      if (depth >= maxDepth) continue;

      const children = this.byCause.get(id) ?? [];
      for (const link of children) {
        collectedLinks.push(link);
        queue.push({ id: link.effectId, depth: depth + 1 });
      }
    }

    for (const link of collectedLinks) {
      const effect = nodesById.get(link.effectId);
      const cause = nodesById.get(link.causeId);
      if (effect && !effect.parents.includes(link.causeId)) effect.parents.push(link.causeId);
      if (cause && !cause.children.includes(link.effectId)) cause.children.push(link.effectId);
    }

    const nodes = Array.from(nodesById.values());
    return {
      rootId: causeId,
      nodes,
      links: collectedLinks,
      maxDepth: maxReachedDepth,
      generatedAt: new Date(),
      dot: this.renderDot(nodes, collectedLinks),
    };
  }

  /** Simple stats for dashboards. */
  stats(): { totalLinks: number; effects: number; causes: number } {
    return {
      totalLinks: this.links.size,
      effects: this.byEffect.size,
      causes: this.byCause.size,
    };
  }

  /** Remove a single link. */
  async unlink(linkId: string): Promise<boolean> {
    await this.init();
    const link = this.links.get(linkId);
    if (!link) return false;
    this.links.delete(linkId);
    this.rebuildIndexes();
    await this.persist();
    return true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private index(link: CausalLink): void {
    const effects = this.byEffect.get(link.effectId) ?? [];
    effects.push(link);
    this.byEffect.set(link.effectId, effects);
    const causes = this.byCause.get(link.causeId) ?? [];
    causes.push(link);
    this.byCause.set(link.causeId, causes);
  }

  private rebuildIndexes(): void {
    this.byEffect.clear();
    this.byCause.clear();
    for (const link of this.links.values()) this.index(link);
  }

  private async nodeFromMemoryId(id: string, depth: number): Promise<CausalChainNode> {
    const entries = this.brain.recallByIds([id]);
    const entry = entries[0];
    if (entry) {
      return {
        id,
        content: entry.content,
        agentTool: entry.agentTool,
        category: entry.category,
        createdAt: entry.createdAt,
        parents: [],
        children: [],
        depth,
      };
    }
    return {
      id,
      content: `(memory ${id.slice(0, 8)} not found in global brain)`,
      agentTool: 'claude-code' as AgentTool,
      category: 'unknown',
      createdAt: new Date(0),
      parents: [],
      children: [],
      depth,
    };
  }

  private renderDot(nodes: CausalChainNode[], links: CausalLink[]): string {
    const lines: string[] = ['digraph CausalChain {', '  rankdir=LR;', '  node [shape=box, style=rounded];'];
    for (const node of nodes) {
      const label = `${node.agentTool}\\n[${node.category}]\\n${node.content.slice(0, 60).replace(/"/g, "'")}`;
      lines.push(`  "${node.id}" [label="${label}"];`);
    }
    for (const link of links) {
      const rationale = link.rationale ? ` [label="${link.rationale.slice(0, 20).replace(/"/g, "'")}"]` : '';
      lines.push(`  "${link.causeId}" -> "${link.effectId}"${rationale};`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        links: Array.from(this.links.values()),
      };
      const tmp = CHAINS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, CHAINS_PATH);
    } catch {
      /* persistence non-fatal */
    }
  }
}

let _instance: CausalChains | null = null;

export function getCausalChains(): CausalChains {
  if (!_instance) _instance = new CausalChains();
  return _instance;
}

export function resetCausalChainsForTests(): void {
  _instance = null;
}
