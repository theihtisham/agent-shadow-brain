// src/brain/cost-aware-spawner.ts — Spawn sub-agents cost-aware
// v6.0.0 — Hive Mind Edition
//
// Before Shadow Brain spawns a sub-agent, estimate token cost and compare
// against the value of the decision. Route to a cheaper model (or local) when
// the trivial-task heuristic matches.

import { SpawnCostEstimate, SubAgentSpawnRequest } from '../types.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gpt-5.4': { input: 10, output: 30 },
  'gpt-5.4-codex': { input: 10, output: 30 },
  'glm-5.1': { input: 0.5, output: 2 },
  'minimax-m2.7': { input: 0.6, output: 2.4 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'qwen2.5-coder:7b': { input: 0, output: 0 },
  'local': { input: 0, output: 0 },
};

const CHEAP_KEYWORDS = new Set([
  'typo', 'rename', 'format', 'lint', 'comment', 'docs',
  'readme', 'style', 'indent', 'whitespace', 'todo',
]);

const EXPENSIVE_KEYWORDS = new Set([
  'architecture', 'security', 'migration', 'refactor',
  'auth', 'payment', 'crypto', 'billing', 'compliance',
]);

export class CostAwareSpawner {
  /** Estimate cost + recommendation for a planned sub-agent spawn. */
  estimate(req: SubAgentSpawnRequest, desiredModel = 'claude-opus-4-7'): SpawnCostEstimate {
    const tokenBudget = req.tokenBudget ?? 4000;
    const estimatedInput = tokenBudget;
    const estimatedOutput = Math.floor(tokenBudget * 0.4);
    const pricing = MODEL_PRICING[desiredModel] ?? MODEL_PRICING['claude-opus-4-7'];
    const cost = (estimatedInput * pricing.input + estimatedOutput * pricing.output) / 1_000_000;

    const taskLower = req.taskDescription.toLowerCase();
    const cheapHit = Array.from(CHEAP_KEYWORDS).some(k => taskLower.includes(k));
    const expensiveHit = Array.from(EXPENSIVE_KEYWORDS).some(k => taskLower.includes(k));

    let cheaperAlternative: SpawnCostEstimate['cheaperAlternative'] = null;
    let recommendation: SpawnCostEstimate['recommendation'] = 'proceed';
    let rationale = `Estimated $${cost.toFixed(4)} (${estimatedInput}+${estimatedOutput} tokens on ${desiredModel}).`;

    if (cheapHit && !expensiveHit) {
      const altPricing = MODEL_PRICING['qwen2.5-coder:7b'];
      const altCost = (estimatedInput * altPricing.input + estimatedOutput * altPricing.output) / 1_000_000;
      cheaperAlternative = { model: 'qwen2.5-coder:7b', costUsd: +altCost.toFixed(4) };
      recommendation = 'use-alternative';
      rationale = `Trivial task — route to local model (free) instead of ${desiredModel} ($${cost.toFixed(4)}).`;
    } else if (expensiveHit) {
      recommendation = 'proceed';
      rationale = `Critical task — ${desiredModel} is appropriate. Estimated $${cost.toFixed(4)}.`;
    } else if (cost > 0.05 && tokenBudget < 2000) {
      const altPricing = MODEL_PRICING['claude-haiku-4-5'];
      const altCost = (estimatedInput * altPricing.input + estimatedOutput * altPricing.output) / 1_000_000;
      cheaperAlternative = { model: 'claude-haiku-4-5', costUsd: +altCost.toFixed(4) };
      recommendation = 'use-alternative';
      rationale = `Small task at $${cost.toFixed(4)} — Haiku can handle for ~$${altCost.toFixed(4)}.`;
    }

    return {
      subAgentModel: desiredModel,
      estimatedInputTokens: estimatedInput,
      estimatedOutputTokens: estimatedOutput,
      estimatedCostUsd: +cost.toFixed(4),
      expectedValueScore: expensiveHit ? 1.0 : cheapHit ? 0.2 : 0.5,
      cheaperAlternative,
      recommendation,
      rationale,
    };
  }
}

let _instance: CostAwareSpawner | null = null;

export function getCostAwareSpawner(): CostAwareSpawner {
  if (!_instance) _instance = new CostAwareSpawner();
  return _instance;
}
