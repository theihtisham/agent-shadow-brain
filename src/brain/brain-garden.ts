// src/brain/brain-garden.ts — Aesthetic brain-as-garden visualizer data source
// v6.0.0 — Hive Mind Edition
//
// Returns a GardenNode[] snapshot of the brain state formatted for a D3 /
// three.js / Canvas visualization. Memories "bloom" based on strength; links
// become "vines" between them. Decaying memories dim. It's a living
// constellation.

import {
  GardenNode,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';
import { getForgettingCurve, ForgettingCurve } from './forgetting-curve.js';
import { getCausalChains, CausalChains } from './causal-chains.js';

export class BrainGarden {
  private brain: GlobalBrain;
  private forgetting: ForgettingCurve;
  private causal: CausalChains;

  constructor() {
    this.brain = getGlobalBrain();
    this.forgetting = getForgettingCurve();
    this.causal = getCausalChains();
  }

  async snapshot(limit = 200): Promise<GardenNode[]> {
    await this.brain.init();
    await this.forgetting.init();
    await this.causal.init();

    const timeline = this.brain.timeline({ limit });
    const nodes: GardenNode[] = [];

    for (const event of timeline) {
      const state = this.forgetting.getState(event.id);
      const strength = state?.currentStrength ?? event.importance;
      const ageMs = Date.now() - event.createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      nodes.push({
        id: event.id,
        kind: this.kindFromCategory(event.category),
        label: event.content.slice(0, 80),
        age: +ageDays.toFixed(1),
        strength: +strength.toFixed(3),
        connections: [],
        bloom: Math.max(0.1, Math.min(1, strength * (1 - Math.min(1, ageDays / 90)))),
      });
    }

    // Enrich connections from causal chains (fire-and-forget — keep cheap)
    for (const node of nodes) {
      try {
        const chain = await this.causal.trace(node.id, { maxDepth: 2 });
        node.connections = chain.nodes
          .filter(n => n.id !== node.id)
          .slice(0, 6)
          .map(n => n.id);
      } catch {
        node.connections = [];
      }
    }

    return nodes;
  }

  /** Compact stats used by the dashboard widget. */
  async stats(): Promise<{ nodes: number; avgBloom: number; linkedFraction: number }> {
    const nodes = await this.snapshot(150);
    if (!nodes.length) return { nodes: 0, avgBloom: 0, linkedFraction: 0 };
    const avg = nodes.reduce((a, n) => a + n.bloom, 0) / nodes.length;
    const linked = nodes.filter(n => n.connections.length > 0).length / nodes.length;
    return { nodes: nodes.length, avgBloom: +avg.toFixed(3), linkedFraction: +linked.toFixed(3) };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private kindFromCategory(category: string): GardenNode['kind'] {
    const c = category.toLowerCase();
    if (c.includes('decision') || c.includes('adr')) return 'decision';
    if (c.includes('pattern')) return 'pattern';
    return 'memory';
  }
}

let _instance: BrainGarden | null = null;

export function getBrainGarden(): BrainGarden {
  if (!_instance) _instance = new BrainGarden();
  return _instance;
}

export function resetBrainGardenForTests(): void {
  _instance = null;
}
