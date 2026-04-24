// src/brain/token-economy.ts — Cross-agent token spend tracker + cost predictor
// v6.0.0 — Hive Mind Edition
//
// Tracks token usage across every connected agent. Predicts monthly spend,
// identifies savings opportunities (e.g., calls that could run on cheaper
// models), and exposes a simple "you saved $X" number for README badges.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  AgentTool,
  TokenEconomyStats,
  TokenSpendRecord,
} from '../types.js';

const SPEND_PATH = path.join(os.homedir(), '.shadow-brain', 'token-spend.jsonl');
const STATS_PATH = path.join(os.homedir(), '.shadow-brain', 'token-economy.json');

// Per-1M-tokens USD pricing (rough, for projection only)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gpt-5.4': { input: 10, output: 30 },
  'gpt-5.4-codex': { input: 10, output: 30 },
  'glm-5.1': { input: 0.5, output: 2 },
  'minimax-m2.7': { input: 0.6, output: 2.4 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'deepseek-671b': { input: 0, output: 0 }, // local/free
  'qwen2.5-coder:7b': { input: 0, output: 0 }, // local
  'local': { input: 0, output: 0 },
};

interface PersistShape {
  schemaVersion: 1;
  monthlyProjectionUsd: number;
  savingsOpportunitiesUsd: number;
  lastRecalculated: string;
}

export class TokenEconomy {
  private records: TokenSpendRecord[] = [];
  private savingsOpportunitiesUsd: number = 0;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(SPEND_PATH), { recursive: true });

    if (fs.existsSync(SPEND_PATH)) {
      try {
        const raw = fs.readFileSync(SPEND_PATH, 'utf-8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          const r = JSON.parse(line) as TokenSpendRecord;
          this.records.push({ ...r, timestamp: new Date(r.timestamp) });
        }
      } catch {
        /* skip */
      }
    }

    if (fs.existsSync(STATS_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8')) as PersistShape;
        this.savingsOpportunitiesUsd = parsed.savingsOpportunitiesUsd ?? 0;
      } catch {
        /* skip */
      }
    }

    this.initialized = true;
  }

  /** Record a token spend event. */
  async record(input: {
    agentTool: AgentTool;
    model: string;
    inputTokens: number;
    outputTokens: number;
    taskCategory?: string;
  }): Promise<TokenSpendRecord> {
    await this.init();
    const model = input.model || 'local';
    const pricing = MODEL_PRICING[model] ?? { input: 1, output: 3 };
    const cost =
      (input.inputTokens * pricing.input + input.outputTokens * pricing.output) / 1_000_000;

    const record: TokenSpendRecord = {
      id: `spend-${crypto.randomBytes(6).toString('hex')}`,
      agentTool: input.agentTool,
      model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostUsd: +cost.toFixed(6),
      taskCategory: input.taskCategory ?? 'general',
      timestamp: new Date(),
    };

    this.records.push(record);
    try {
      fs.appendFileSync(SPEND_PATH, JSON.stringify(record) + '\n');
    } catch {
      /* non-fatal */
    }
    return record;
  }

  /** Report aggregate spend + projections + savings opportunities. */
  async report(): Promise<TokenEconomyStats> {
    await this.init();
    const byAgent: TokenEconomyStats['byAgent'] = {};
    const byModel: TokenEconomyStats['byModel'] = {};
    const byCategory: TokenEconomyStats['byCategory'] = {};

    let totalSpend = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const r of this.records) {
      totalSpend += r.estimatedCostUsd;
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;

      byAgent[r.agentTool] = byAgent[r.agentTool] ?? { spendUsd: 0, calls: 0 };
      byAgent[r.agentTool].spendUsd += r.estimatedCostUsd;
      byAgent[r.agentTool].calls++;

      byModel[r.model] = byModel[r.model] ?? { spendUsd: 0, calls: 0 };
      byModel[r.model].spendUsd += r.estimatedCostUsd;
      byModel[r.model].calls++;

      byCategory[r.taskCategory] = byCategory[r.taskCategory] ?? { spendUsd: 0, calls: 0 };
      byCategory[r.taskCategory].spendUsd += r.estimatedCostUsd;
      byCategory[r.taskCategory].calls++;
    }

    // Project monthly spend from last 7 days
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = this.records.filter(r => r.timestamp.getTime() >= weekAgo);
    const weeklySpend = recent.reduce((acc, r) => acc + r.estimatedCostUsd, 0);
    const monthlyProjectionUsd = +(weeklySpend * (30 / 7)).toFixed(2);

    const { savings, suggestions } = this.computeSavings(recent);
    this.savingsOpportunitiesUsd = savings;
    await this.persistStats(monthlyProjectionUsd, savings);

    return {
      totalSpendUsd: +totalSpend.toFixed(4),
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      byAgent,
      byModel,
      byCategory,
      monthlyProjectionUsd,
      savingsOpportunitiesUsd: +savings.toFixed(2),
      suggestions,
    };
  }

  /** Total saved by routing to cheaper models (returned as tweetable USD). */
  getSavingsUsd(): number {
    return +this.savingsOpportunitiesUsd.toFixed(2);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private computeSavings(records: TokenSpendRecord[]): { savings: number; suggestions: string[] } {
    const suggestions: string[] = [];
    let savings = 0;

    // Opus calls that could pass with Haiku (heuristic: small tasks = general/category)
    const opusCalls = records.filter(r => r.model.includes('opus'));
    if (opusCalls.length) {
      const opusSpend = opusCalls.reduce((acc, r) => acc + r.estimatedCostUsd, 0);
      const haikuPricing = MODEL_PRICING['claude-haiku-4-5'];
      const opusPricing = MODEL_PRICING['claude-opus-4-7'];
      const ratio = (haikuPricing.input + haikuPricing.output) / (opusPricing.input + opusPricing.output);
      const potentialSave = opusSpend * (1 - ratio) * 0.43; // assume 43% are Haiku-able
      savings += potentialSave;
      suggestions.push(`~43% of Opus calls ($${opusSpend.toFixed(2)}) could route to Haiku → ~$${potentialSave.toFixed(2)} saved.`);
    }

    // Calls >1500 tokens → consider MiniMax/GLM
    const bigCalls = records.filter(r => r.inputTokens > 1500 && r.model.includes('gpt'));
    if (bigCalls.length) {
      const bigSpend = bigCalls.reduce((acc, r) => acc + r.estimatedCostUsd, 0);
      const potentialSave = bigSpend * 0.35;
      savings += potentialSave;
      suggestions.push(`${bigCalls.length} GPT calls exceed 1500 input tokens — route large-context to MiniMax/GLM for ~$${potentialSave.toFixed(2)} saved.`);
    }

    // Redundant calls (identical input within 1h) → cache
    const cacheable = this.detectRedundantCalls(records);
    if (cacheable.savings > 0) {
      savings += cacheable.savings;
      suggestions.push(`${cacheable.count} redundant calls detected — Shadow Brain cache could save ~$${cacheable.savings.toFixed(2)}.`);
    }

    if (!suggestions.length) suggestions.push('No obvious routing wins. Running lean already.');

    return { savings, suggestions };
  }

  private detectRedundantCalls(records: TokenSpendRecord[]): { count: number; savings: number } {
    // Simple approximation: calls within 60 min on same agent+category+model
    const buckets = new Map<string, TokenSpendRecord[]>();
    for (const r of records) {
      const key = `${r.agentTool}::${r.model}::${r.taskCategory}`;
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }
    let redundant = 0;
    let savings = 0;
    for (const list of buckets.values()) {
      list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].timestamp.getTime() - list[i - 1].timestamp.getTime();
        if (gap < 60 * 60 * 1000) {
          redundant++;
          savings += list[i].estimatedCostUsd * 0.4;
        }
      }
    }
    return { count: redundant, savings };
  }

  private async persistStats(monthly: number, savings: number): Promise<void> {
    try {
      const shape: PersistShape = {
        schemaVersion: 1,
        monthlyProjectionUsd: monthly,
        savingsOpportunitiesUsd: savings,
        lastRecalculated: new Date().toISOString(),
      };
      const tmp = STATS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(shape, null, 2));
      fs.renameSync(tmp, STATS_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: TokenEconomy | null = null;

export function getTokenEconomy(): TokenEconomy {
  if (!_instance) _instance = new TokenEconomy();
  return _instance;
}

export function resetTokenEconomyForTests(): void {
  _instance = null;
}
