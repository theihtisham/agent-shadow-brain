// src/brain/local-llm.ts — Local-First LLM Adapter
// v6.0.0 — Hive Mind Edition
//
// All "AI features" in Shadow Brain (Dream Engine, Swarm Debate, Pre-Mortem
// Assistant, Voice Mode) default to Ollama local inference. No API key needed,
// $0 to run, works offline, no code ever leaves the machine.
//
// Remote providers remain available as an opt-in upgrade.

import { LocalLLMConfig, LocalLLMProvider, LocalLLMResponse } from '../types.js';

const DEFAULT_CONFIG: LocalLLMConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  endpoint: 'http://127.0.0.1:11434',
  timeoutMs: 45_000,
  maxTokens: 1024,
  temperature: 0.4,
};

export class LocalLLM {
  private config: LocalLLMConfig;

  constructor(config: Partial<LocalLLMConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if the local provider is reachable. */
  async isAvailable(): Promise<boolean> {
    if (this.config.provider === 'none') return false;
    try {
      const res = await fetch(`${this.config.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Generate text locally. Falls back to deterministic stub when unreachable. */
  async generate(prompt: string, system?: string): Promise<LocalLLMResponse> {
    const start = Date.now();

    if (this.config.provider === 'ollama') {
      const response = await this.generateOllama(prompt, system).catch(() => null);
      if (response) {
        return {
          text: response.text,
          provider: 'ollama',
          model: this.config.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: Date.now() - start,
          local: true,
        };
      }
    }

    // Graceful fallback — zero-LLM deterministic response. Keeps Shadow Brain
    // useful even without any local model installed.
    return this.fallback(prompt, system, Date.now() - start);
  }

  /** Rough per-call cost in USD for a local model — effectively zero (electricity). */
  static estimatedCostUsd(_tokens: number): number {
    return 0;
  }

  getConfig(): LocalLLMConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<LocalLLMConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async generateOllama(prompt: string, system?: string): Promise<{ text: string; inputTokens: number; outputTokens: number } | null> {
    try {
      const body = {
        model: this.config.model,
        prompt,
        system,
        stream: false,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.maxTokens,
        },
      };
      const res = await fetch(`${this.config.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!res.ok) return null;
      const json = await res.json() as { response?: string; prompt_eval_count?: number; eval_count?: number };
      return {
        text: json.response ?? '',
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
      };
    } catch {
      return null;
    }
  }

  private fallback(prompt: string, _system: string | undefined, durationMs: number): LocalLLMResponse {
    // Heuristic response — extracts the question and summarises the prompt so
    // features continue working even without a local LLM installed.
    const firstLine = prompt.split('\n').find(l => l.trim().length) ?? prompt.slice(0, 160);
    const text = `[local-fallback] ${firstLine.slice(0, 220)}`;
    return {
      text,
      provider: 'none',
      model: 'fallback',
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      durationMs,
      local: true,
    };
  }
}

let _instance: LocalLLM | null = null;

export function getLocalLLM(config?: Partial<LocalLLMConfig>): LocalLLM {
  if (!_instance) _instance = new LocalLLM(config);
  else if (config) _instance.setConfig(config);
  return _instance;
}

export function resetLocalLLMForTests(): void {
  _instance = null;
}

/** Map a generic provider preference to a LocalLLMProvider. */
export function preferredLocalProvider(pref?: string): LocalLLMProvider {
  if (pref === 'ollama' || pref === 'llamacpp' || pref === 'lmstudio') return pref;
  return 'ollama';
}
