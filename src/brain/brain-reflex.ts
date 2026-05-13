// src/brain/brain-reflex.ts — Local-model inline completion service
// v6.0.2 — Multimodal Edition
//
// "Cursor Tab, but from your brain — locally, free."
//
// Pulls the top brain memories for the current prefix, then asks a small local
// model (Ollama qwen2.5-coder:1.5b / deepseek-coder:1.3b) to continue the code.
// If Ollama is unavailable, falls back to brain-only mode: prepends the top
// memory verbatim with a "// Suggested from brain memory" prefix.
//
// Exposed: complete(), streamComplete(), precache()

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STATS_DIR = path.join(os.homedir(), '.shadow-brain', 'reflex');
const STATS_PATH = path.join(STATS_DIR, 'stats.jsonl');
const OLLAMA_DEFAULT = 'http://127.0.0.1:11434';
const PREFERRED_MODELS = ['qwen2.5-coder:1.5b', 'qwen2.5-coder', 'deepseek-coder:1.3b', 'deepseek-coder'];
const DEFAULT_MAX_TOKENS = 96;

export interface CompletionContext {
  prefix: string;
  language?: string;
  fileName?: string;
  project?: string;
}

export interface CompletionOpts {
  maxTokens?: number;
  useOllama?: boolean;
}

export interface CompletionResult {
  completion: string;
  source: 'ollama' | 'brain' | 'hybrid';
  latencyMs: number;
  citations: string[];
}

interface BrainMemory {
  id: string;
  text: string;
  score: number;
}

export class BrainReflex {
  private ollamaUrl: string = OLLAMA_DEFAULT;
  private ollamaModel: string | null = null;
  private probed = false;
  private precachedMemories: BrainMemory[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  /** One-shot completion. */
  async complete(context: CompletionContext, opts: CompletionOpts = {}): Promise<CompletionResult> {
    const start = Date.now();
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const useOllama = opts.useOllama !== false;

    const memories = await this.fetchMemories(context);
    const usedCache = memories.length > 0 && this.precachedMemories.length > 0;
    if (usedCache) this.cacheHits++; else this.cacheMisses++;

    if (useOllama) {
      await this.probeOllama();
      if (this.ollamaModel) {
        const prompt = this.buildPrompt(context, memories);
        const text = await this.callOllama(prompt, maxTokens).catch(() => null);
        if (text && text.trim().length) {
          const result: CompletionResult = {
            completion: cleanCompletion(text),
            source: memories.length ? 'hybrid' : 'ollama',
            latencyMs: Date.now() - start,
            citations: memories.map(m => m.id),
          };
          await this.logStat(context, result, maxTokens);
          return result;
        }
      }
    }

    // Brain-only fallback
    const fallback = this.brainOnlyCompletion(context, memories);
    const result: CompletionResult = {
      completion: fallback,
      source: 'brain',
      latencyMs: Date.now() - start,
      citations: memories.map(m => m.id),
    };
    await this.logStat(context, result, maxTokens);
    return result;
  }

  /** Streaming completion. Yields tokens as they arrive. */
  async *streamComplete(context: CompletionContext, opts: CompletionOpts = {}): AsyncIterable<{ delta: string; done: boolean }> {
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const useOllama = opts.useOllama !== false;
    const memories = await this.fetchMemories(context);

    if (useOllama) {
      await this.probeOllama();
      if (this.ollamaModel) {
        const prompt = this.buildPrompt(context, memories);
        try {
          for await (const chunk of this.streamOllama(prompt, maxTokens)) {
            yield { delta: chunk, done: false };
          }
          yield { delta: '', done: true };
          return;
        } catch { /* fall through */ }
      }
    }

    // Fallback — emit the brain-only completion in one shot
    const fallback = this.brainOnlyCompletion(context, memories);
    const chunks = fallback.match(/.{1,32}/gs) ?? [fallback];
    for (const c of chunks) yield { delta: c, done: false };
    yield { delta: '', done: true };
  }

  /** Warm up the brain's relevant memories before a session starts. */
  async precache(project: string, files: string[]): Promise<{ cached: number; durationMs: number }> {
    const start = Date.now();
    const seeds: string[] = [];
    for (const f of files.slice(0, 24)) {
      try {
        const full = path.isAbsolute(f) ? f : path.join(project, f);
        if (fs.existsSync(full)) {
          const buf = fs.readFileSync(full, 'utf-8');
          seeds.push(buf.slice(0, 800));
        }
      } catch { /* skip */ }
    }
    if (seeds.length === 0) seeds.push(project);

    const aggregate: BrainMemory[] = [];
    for (const seed of seeds) {
      const mems = await this.recallFromBrain(seed, project).catch(() => []);
      for (const m of mems) {
        if (!aggregate.find(a => a.id === m.id)) aggregate.push(m);
      }
      if (aggregate.length >= 24) break;
    }
    this.precachedMemories = aggregate;
    return { cached: aggregate.length, durationMs: Date.now() - start };
  }

  /** Stats accessor — for telemetry. */
  getStats(): { cacheHits: number; cacheMisses: number; precachedCount: number; ollamaModel: string | null } {
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      precachedCount: this.precachedMemories.length,
      ollamaModel: this.ollamaModel,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async fetchMemories(context: CompletionContext): Promise<BrainMemory[]> {
    // Prefer precached when prefix is small (high signal-to-noise from a seed)
    if (this.precachedMemories.length && context.prefix.length < 200) {
      return this.precachedMemories.slice(0, 5);
    }
    const seed = (context.fileName ? context.fileName + '\n' : '') + context.prefix.slice(-1500);
    return this.recallFromBrain(seed, context.project ?? '').catch(() => []);
  }

  private async recallFromBrain(seed: string, project: string): Promise<BrainMemory[]> {
    // Prefer embeddings-v2 if available, then embeddings, then hierarchical-memory search
    const ev2 = await tryImport('./embeddings-v2.js');
    if (ev2 && typeof ev2.getEmbeddingsV2 === 'function') {
      const inst = ev2.getEmbeddingsV2();
      const candidates = await this.candidatePool(project);
      if (candidates.length && typeof inst.semanticSearch === 'function') {
        const ranked = await inst.semanticSearch(seed, candidates, 5).catch(() => null);
        if (Array.isArray(ranked) && ranked.length) {
          const map = new Map(candidates.map((c: any) => [c.id, c.text]));
          return ranked.map((r: any) => ({ id: r.id, text: String(map.get(r.id) ?? ''), score: r.score ?? 0 }));
        }
      }
    }

    const ev1 = await tryImport('./embeddings.js');
    if (ev1 && typeof ev1.getEmbeddings === 'function') {
      const inst = ev1.getEmbeddings();
      const candidates = await this.candidatePool(project);
      if (candidates.length && typeof inst.semanticSearch === 'function') {
        const ranked = await inst.semanticSearch(seed, candidates, 5).catch(() => null);
        if (Array.isArray(ranked) && ranked.length) {
          const map = new Map(candidates.map((c: any) => [c.id, c.text]));
          return ranked.map((r: any) => ({ id: r.id, text: String(map.get(r.id) ?? ''), score: r.score ?? 0 }));
        }
      }
    }

    const hm = await tryImport('./hierarchical-memory.js');
    if (hm && typeof hm.getHierarchicalMemory === 'function') {
      const inst = hm.getHierarchicalMemory();
      if (typeof inst.search === 'function') {
        const results = await inst.search({ query: seed, project, limit: 5 }).catch(() => null);
        if (Array.isArray(results) && results.length) {
          return results.map((r: any, idx: number) => ({
            id: String(r.id ?? r.memoryId ?? `mem_${idx}`),
            text: String(r.snippet ?? r.content ?? r.text ?? ''),
            score: typeof r.score === 'number' ? r.score : 0,
          }));
        }
      }
    }
    return [];
  }

  private async candidatePool(project: string): Promise<Array<{ id: string; text: string }>> {
    const hm = await tryImport('./hierarchical-memory.js');
    if (!hm || typeof hm.getHierarchicalMemory !== 'function') return [];
    const inst = hm.getHierarchicalMemory();
    if (typeof inst.list === 'function') {
      const items = await inst.list({ project, limit: 200 }).catch(() => null);
      if (Array.isArray(items)) {
        return items.map((it: any, idx: number) => ({
          id: String(it.id ?? it.memoryId ?? `mem_${idx}`),
          text: String(it.snippet ?? it.content ?? it.text ?? ''),
        }));
      }
    }
    return [];
  }

  private buildPrompt(context: CompletionContext, memories: BrainMemory[]): string {
    const lang = context.language ? `Language: ${context.language}\n` : '';
    const file = context.fileName ? `File: ${context.fileName}\n` : '';
    const memBlock = memories.length
      ? memories.map((m, idx) => `[mem ${idx + 1} ${m.id}]\n${truncate(m.text, 400)}`).join('\n\n')
      : '(no relevant memories — use idiomatic style)';
    return [
      'Continue the following code. Use these conventions from this codebase:',
      '',
      memBlock,
      '',
      lang + file + 'Code:',
      context.prefix,
      'Completion:',
    ].join('\n');
  }

  private async probeOllama(): Promise<void> {
    if (this.probed) return;
    this.probed = true;
    try {
      const reg = await tryImport('./model-registry.js');
      if (reg && typeof reg.getModelRegistry === 'function') {
        const r = reg.getModelRegistry();
        await r.init?.();
        const ollama = r.getProvider?.('ollama');
        if (ollama?.enabled && ollama.baseUrl) this.ollamaUrl = ollama.baseUrl;
      }
    } catch { /* keep default url */ }

    try {
      const res = await fetch(this.ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return;
      const json = await res.json() as { models?: Array<{ name: string }> };
      for (const pref of PREFERRED_MODELS) {
        const match = json.models?.find(m => m.name.startsWith(pref));
        if (match) { this.ollamaModel = match.name; return; }
      }
    } catch { /* no ollama */ }
  }

  private async callOllama(prompt: string, maxTokens: number): Promise<string | null> {
    try {
      const res = await fetch(this.ollamaUrl + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: { num_predict: maxTokens, temperature: 0.2, stop: ['\nCompletion:', '\n\n\n'] },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const json = await res.json() as { response?: string };
      return json.response ?? null;
    } catch { return null; }
  }

  private async *streamOllama(prompt: string, maxTokens: number): AsyncIterable<string> {
    const res = await fetch(this.ollamaUrl + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt,
        stream: true,
        options: { num_predict: maxTokens, temperature: 0.2, stop: ['\nCompletion:', '\n\n\n'] },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) return;
    const reader = (res.body as any).getReader();
    const dec = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        try {
          const json = JSON.parse(line) as { response?: string; done?: boolean };
          if (json.response) yield json.response;
          if (json.done) return;
        } catch { /* skip malformed line */ }
      }
    }
  }

  private brainOnlyCompletion(context: CompletionContext, memories: BrainMemory[]): string {
    if (memories.length === 0) {
      return '// Suggested from brain memory: no relevant memories cached. Run precache() first or write more brain entries.';
    }
    const top = memories[0];
    const snippet = truncate(top.text, 480);
    const cite = ` (mem: ${top.id})`;
    return `// Suggested from brain memory${cite}\n// ${snippet.split('\n').join('\n// ')}`;
  }

  private async logStat(context: CompletionContext, result: CompletionResult, maxTokens: number): Promise<void> {
    try {
      fs.mkdirSync(STATS_DIR, { recursive: true });
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        project: context.project ?? null,
        fileName: context.fileName ?? null,
        language: context.language ?? null,
        prefixLen: context.prefix.length,
        completionLen: result.completion.length,
        source: result.source,
        latencyMs: result.latencyMs,
        citationCount: result.citations.length,
        maxTokens,
        ollamaModel: this.ollamaModel,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
      }) + '\n';
      fs.appendFileSync(STATS_PATH, line);
    } catch { /* non-fatal */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function cleanCompletion(s: string): string {
  // Trim Ollama's stop-token bleed and leading whitespace artifacts
  return s.replace(/^\s*Completion:\s*/i, '').replace(/\n*Completion:\s*$/i, '').trimEnd();
}

async function tryImport(spec: string): Promise<any> {
  try {
    return await import(spec).catch(() => null);
  } catch {
    return null;
  }
}

let _instance: BrainReflex | null = null;
export function getBrainReflex(): BrainReflex {
  if (!_instance) _instance = new BrainReflex();
  return _instance;
}
export function resetBrainReflexForTests(): void { _instance = null; }
