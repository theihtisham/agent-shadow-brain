// src/brain/attention-heatmap.ts — Mechanistic interpretability for brain decisions
// v6.0.0 — Hive Mind Edition
//
// After any AI decision is made with brain input, show which memories influenced
// the output, with weighted attribution.
//
// Not a gradient-based attention (we don't have the model internals) — instead
// it's a RETRIEVAL-WEIGHTED attribution that approximates mechanistic attention
// via semantic similarity + explicit citation tracking.

import * as crypto from 'crypto';
import {
  AttentionReport,
  AttentionWeight,
  AgentTool,
  GlobalEntry,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

export class AttentionHeatmap {
  private brain: GlobalBrain;

  constructor() {
    this.brain = getGlobalBrain();
  }

  /**
   * Compute attention for a given decision. Inputs:
   *   - decisionText: the AI output we're attributing
   *   - candidateMemoryIds: memories that were visible to the agent
   */
  async compute(opts: {
    decisionText: string;
    candidateMemoryIds: string[];
    agentTool: AgentTool;
  }): Promise<AttentionReport> {
    await this.brain.init();
    const candidates = this.brain.recallByIds(opts.candidateMemoryIds);
    if (!candidates.length) {
      return {
        decisionId: this.genId(opts.decisionText),
        decisionText: opts.decisionText,
        agentTool: opts.agentTool,
        weights: [],
        totalMemoriesConsidered: 0,
        generatedAt: new Date(),
      };
    }

    const rawWeights = candidates.map(mem => ({
      mem,
      raw: this.similarity(opts.decisionText, mem.content) + mem.importance * 0.5,
    }));

    const total = rawWeights.reduce((sum, w) => sum + w.raw, 0) || 1;
    const weights: AttentionWeight[] = rawWeights
      .map(({ mem, raw }) => ({
        memoryId: mem.id,
        memoryContent: mem.content.slice(0, 160),
        weight: +(raw / total).toFixed(4),
        category: mem.category,
        reasoning: this.explain(opts.decisionText, mem),
      }))
      .sort((a, b) => b.weight - a.weight);

    return {
      decisionId: this.genId(opts.decisionText),
      decisionText: opts.decisionText,
      agentTool: opts.agentTool,
      weights,
      totalMemoriesConsidered: candidates.length,
      generatedAt: new Date(),
    };
  }

  /** Text-based heatmap rendered as a simple ASCII bar chart. */
  renderText(report: AttentionReport): string {
    const lines: string[] = [
      `Decision: ${report.decisionText.slice(0, 120)}`,
      `Agent: ${report.agentTool} · Memories considered: ${report.totalMemoriesConsidered}`,
      ``,
    ];
    const top = report.weights.slice(0, 8);
    for (const w of top) {
      const bar = '█'.repeat(Math.min(30, Math.round(w.weight * 50)));
      lines.push(`${(w.weight * 100).toFixed(1).padStart(5)}% ${bar} [${w.category}] ${w.memoryContent.slice(0, 60)}`);
    }
    return lines.join('\n');
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private genId(text: string): string {
    return 'dec-' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  }

  private similarity(a: string, b: string): number {
    // Token-set Jaccard (fast, no embedding deps)
    const setA = this.tokenSet(a);
    const setB = this.tokenSet(b);
    if (!setA.size || !setB.size) return 0.01;
    let intersect = 0;
    for (const t of setA) if (setB.has(t)) intersect++;
    const union = setA.size + setB.size - intersect;
    return union ? intersect / union : 0;
  }

  private tokenSet(s: string): Set<string> {
    const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'this', 'that']);
    return new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !stopwords.has(t)),
    );
  }

  private explain(_decision: string, mem: GlobalEntry): string {
    return `${mem.category} · importance ${Math.round(mem.importance * 100)}%`;
  }
}

let _instance: AttentionHeatmap | null = null;

export function getAttentionHeatmap(): AttentionHeatmap {
  if (!_instance) _instance = new AttentionHeatmap();
  return _instance;
}

export function resetAttentionHeatmapForTests(): void {
  _instance = null;
}
