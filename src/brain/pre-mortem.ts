// src/brain/pre-mortem.ts — Pre-Mortem Assistant
// v6.0.0 — Hive Mind Edition
//
// Before any significant task, surface past failures from THIS project as a
// pre-flight checklist. Inspired by Karpathy's red-team pillar — codified as
// brain infrastructure.
//
// Query: "Adding payment processing"
// Answer: "Here are 3 ways this could fail, each with a memory citation."

import * as path from 'path';
import * as crypto from 'crypto';
import {
  PreMortemFailure,
  PreMortemReport,
  GlobalEntry,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';
import { getLocalLLM, LocalLLM } from './local-llm.js';
import { getEmbeddings } from './embeddings.js';
import { generateJson, z } from './json-output.js';

const FAILURE_CATEGORIES = new Set([
  'incident', 'bug', 'failure', 'regression', 'rollback',
  'outage', 'pitfall', 'warning', 'security',
]);

export class PreMortem {
  private brain: GlobalBrain;
  private llm: LocalLLM;

  constructor() {
    this.brain = getGlobalBrain();
    this.llm = getLocalLLM();
  }

  /** Run a pre-mortem on an upcoming task. */
  async run(taskDescription: string, projectDir: string, opts: { limit?: number } = {}): Promise<PreMortemReport> {
    await this.brain.init();

    const projectId = GlobalBrain.projectIdFor(projectDir);
    const terms = this.extractTerms(taskDescription);

    // Broad initial recall — we re-rank semantically next
    const projectPool = this.brain.recall({ projectId, limit: 120 })
      .filter(e => FAILURE_CATEGORIES.has(e.category.toLowerCase()));
    const crossPool = this.brain.recall({ limit: 120, minImportance: 0.5 })
      .filter(e => FAILURE_CATEGORIES.has(e.category.toLowerCase()) && e.projectId !== projectId);

    // Semantic re-rank using embeddings for sharper failure retrieval
    const pastFailures = await this.semanticRerank(taskDescription, projectPool, 10);
    const crossProject = await this.semanticRerank(taskDescription, crossPool, 6);
    void terms; // retained for future keyword fallback

    const failures: PreMortemFailure[] = [];

    for (const entry of pastFailures.slice(0, opts.limit ?? 5)) {
      failures.push({
        id: `pm-${crypto.randomBytes(4).toString('hex')}`,
        description: entry.content.slice(0, 220),
        source: 'past-incident',
        probability: this.estimateProbability(entry),
        severity: this.mapImportanceToSeverity(entry.importance),
        mitigation: this.deriveMitigation(entry),
        relatedMemoryIds: [entry.id],
      });
    }

    for (const entry of crossProject.slice(0, 3)) {
      failures.push({
        id: `pm-${crypto.randomBytes(4).toString('hex')}`,
        description: `(similar project ${entry.projectName}) ${entry.content.slice(0, 180)}`,
        source: 'similar-project',
        probability: 0.35,
        severity: this.mapImportanceToSeverity(entry.importance),
        mitigation: this.deriveMitigation(entry),
        relatedMemoryIds: [entry.id],
      });
    }

    // LLM-predicted failures (best-effort, local-first)
    if (failures.length < 3) {
      const predicted = await this.llmPredictions(taskDescription, 3 - failures.length);
      failures.push(...predicted);
    }

    const riskScore = this.scoreRisk(failures);
    return {
      taskDescription,
      generatedAt: new Date(),
      failures,
      riskScore,
      summary: this.summarize(taskDescription, failures, riskScore),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async semanticRerank(query: string, candidates: GlobalEntry[], topK: number): Promise<GlobalEntry[]> {
    if (!candidates.length) return [];
    try {
      const emb = getEmbeddings();
      await emb.init();
      const ranked = await emb.semanticSearch(
        query,
        candidates.map(c => ({ id: c.id, text: `${c.category}: ${c.content}` })),
        topK,
      );
      const byId = new Map(candidates.map(c => [c.id, c]));
      return ranked.map(r => byId.get(r.id)).filter((c): c is GlobalEntry => !!c);
    } catch {
      // Fall back to naive importance ordering
      return candidates.slice(0, topK);
    }
  }

  private extractTerms(task: string): string[] {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);
  }

  private estimateProbability(entry: GlobalEntry): number {
    // Heuristic: recent + high-access failures are more likely to recur
    const ageDays = (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0.2, 1 - ageDays / 180);
    const accessBoost = Math.min(0.6, entry.accessCount * 0.05);
    return Math.min(0.9, 0.2 + recencyBoost * 0.5 + accessBoost);
  }

  private mapImportanceToSeverity(imp: number): PreMortemFailure['severity'] {
    if (imp >= 0.85) return 'critical';
    if (imp >= 0.7) return 'high';
    if (imp >= 0.4) return 'medium';
    return 'low';
  }

  private deriveMitigation(entry: GlobalEntry): string {
    const mitigationHint = (entry.metadata?.mitigation as string | undefined)
      ?? (entry.metadata?.fix as string | undefined)
      ?? null;
    if (mitigationHint) return mitigationHint.slice(0, 200);
    return `Review "${entry.content.slice(0, 80)}" before this task; the same pitfall happened on ${new Date(entry.createdAt).toDateString()}.`;
  }

  private scoreRisk(failures: PreMortemFailure[]): number {
    if (!failures.length) return 0.05;
    const severityWeights = { critical: 1, high: 0.7, medium: 0.4, low: 0.15 };
    let score = 0;
    for (const f of failures) {
      score = Math.max(score, f.probability * severityWeights[f.severity]);
    }
    return Math.min(1, score);
  }

  private summarize(task: string, failures: PreMortemFailure[], risk: number): string {
    if (!failures.length) {
      return `No relevant past failures found for "${task.slice(0, 60)}". Proceed with standard best-practices.`;
    }
    const pct = Math.round(risk * 100);
    return `${failures.length} failure modes surfaced (risk ${pct}%). Top: "${failures[0].description.slice(0, 120)}".`;
  }

  private async llmPredictions(task: string, n: number): Promise<PreMortemFailure[]> {
    if (n <= 0) return [];

    // Use structured JSON output via ModelRegistry for reliability
    const FailureSchema = z.object({
      failures: z.array(z.object({
        description: z.string().min(4).max(280),
        probability: z.number().min(0).max(1),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        mitigation: z.string().min(4).max(260),
      })).max(6),
    });

    try {
      const result = await generateJson(
        `Task to pre-mortem: "${task}"\n\nList up to ${n} realistic ways this task could fail, each with severity, probability, and a one-sentence mitigation. Return JSON: {"failures": [{"description": "...", "probability": 0.0-1.0, "severity": "low|medium|high|critical", "mitigation": "..."}]}`,
        FailureSchema,
        {
          system: 'You are a skeptical senior engineer running a pre-mortem. Be concrete, never generic. Output JSON only.',
          featureName: 'pre-mortem',
          maxTokens: 500,
          fallback: { failures: [] },
        },
      );
      return result.value.failures.slice(0, n).map(f => ({
        id: `pm-${crypto.randomBytes(4).toString('hex')}`,
        description: f.description,
        source: 'llm-predicted' as const,
        probability: f.probability,
        severity: f.severity,
        mitigation: f.mitigation,
        relatedMemoryIds: [],
      }));
    } catch {
      // Fall back to LocalLLM free-text parsing
      try {
        const prompt = `Task: ${task}\n\nList up to ${n} ways this task could realistically fail. For each give: 1) failure 2) mitigation.`;
        const res = await this.llm.generate(prompt, 'You are a skeptical engineer.');
        const text = res.text.trim();
        if (!text) return [];
        const failures: PreMortemFailure[] = [];
        const blocks = text.split(/\n(?=\d+\.)/).slice(0, n);
        for (const block of blocks) {
          const clean = block.replace(/^\d+\.\s*/, '').trim();
          if (!clean) continue;
          const [fail, mit = ''] = clean.split(/Mitigation[:\-]\s*|mitigation[:\-]\s*|\n/).filter(Boolean);
          failures.push({
            id: `pm-${crypto.randomBytes(4).toString('hex')}`,
            description: (fail ?? '').slice(0, 220),
            source: 'llm-predicted',
            probability: 0.3, severity: 'medium',
            mitigation: (mit || 'Add validation/defensive logging.').slice(0, 200),
            relatedMemoryIds: [],
          });
        }
        return failures;
      } catch { return []; }
    }
  }
}

let _instance: PreMortem | null = null;

export function getPreMortem(): PreMortem {
  if (!_instance) _instance = new PreMortem();
  return _instance;
}

export function resetPreMortemForTests(): void {
  _instance = null;
}
