// src/brain/json-output.ts — Structured JSON output helper
// v6.0.0 — Hive Mind Edition
//
// Wraps ModelRegistry.generate with strict JSON schema enforcement and retry.
// If the model returns free text or malformed JSON, extract → parse → validate
// against a Zod schema; retry up to N times with a repair prompt; fall back to
// a safe default if all retries fail.

import { z, ZodSchema } from 'zod';
import { getModelRegistry } from './model-registry.js';
import { getPromptCache } from './prompt-cache.js';

export interface JsonOutputOptions<T> {
  system?: string;
  maxTokens?: number;
  maxRetries?: number;
  featureName?: string;
  fallback?: T;
  /** Extra instruction to append — e.g. "Respond ONLY with JSON matching {...}". */
  schemaHint?: string;
  /** Cache identical requests (default: true). */
  useCache?: boolean;
}

/**
 * Ask the LLM for JSON that satisfies a Zod schema.
 * Returns parsed T, or opts.fallback if every retry failed.
 */
export async function generateJson<T>(
  prompt: string,
  schema: ZodSchema<T>,
  opts: JsonOutputOptions<T> = {},
): Promise<{ value: T; provider: string; model: string; attempts: number; cached?: boolean }> {
  const registry = getModelRegistry();
  await registry.init();
  const cache = getPromptCache();
  const maxRetries = opts.maxRetries ?? 2;
  const hint = opts.schemaHint ?? 'Respond ONLY with a single valid JSON object. No markdown, no prose, no code fences.';
  const fullPrompt = `${prompt}\n\n${hint}`;

  let lastText = '';
  let lastProvider = 'none';
  let lastModel = 'fallback';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const repairSuffix = attempt > 0
      ? `\n\nYour previous response was invalid or did not match the schema. Your previous output was:\n${lastText.slice(0, 400)}\n\nReturn valid JSON only.`
      : '';

    const effectivePrompt = fullPrompt + repairSuffix;

    const doGenerate = () => registry.generate(effectivePrompt, {
      system: opts.system,
      maxTokens: opts.maxTokens ?? 800,
      featureName: opts.featureName,
    });

    const response = opts.useCache === false
      ? await doGenerate()
      : await cache.wrap(
          { prompt: effectivePrompt, system: opts.system, provider: 'lead', model: 'lead', estimatedTokens: Math.ceil(effectivePrompt.length / 4) + (opts.maxTokens ?? 800), estimatedCostUsd: 0.002 },
          doGenerate,
        );

    lastText = response.text || '';
    lastProvider = response.provider;
    lastModel = response.model;

    const extracted = extractJson(lastText);
    if (extracted !== null) {
      const parsed = schema.safeParse(extracted);
      if (parsed.success) {
        return { value: parsed.data, provider: lastProvider, model: lastModel, attempts: attempt + 1 };
      }
    }
    // try again
  }

  if (opts.fallback !== undefined) {
    return { value: opts.fallback, provider: lastProvider, model: lastModel, attempts: maxRetries + 1 };
  }
  throw new Error('Failed to extract valid JSON after ' + (maxRetries + 1) + ' attempts. Last text: ' + lastText.slice(0, 200));
}

/**
 * Attempt to extract a JSON object from a blob of text. Tolerates code fences,
 * leading/trailing prose, unbalanced whitespace.
 */
function extractJson(text: string): any {
  if (!text) return null;
  const clean = text.replace(/```json\s*|```\s*/g, '');
  try { return JSON.parse(clean); } catch { /* try harder */ }

  // Find the largest balanced {...} or [...] substring
  const firstBrace = clean.search(/[{[]/);
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < clean.length; i++) {
    const c = clean[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        const candidate = clean.slice(firstBrace, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}

/** Re-export Zod for downstream brain modules that want to define schemas. */
export { z };
