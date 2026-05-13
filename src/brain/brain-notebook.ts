// src/brain/brain-notebook.ts — Jupyter-style interactive brain explorer
// v6.0.2 — Multimodal Edition
//
// A .shadow-brain.notebook.md file format that mixes markdown narrative with
// executable "brain query" cells. Pure Markdown with HTML comments delimiting
// cell boundaries — renders cleanly on GitHub, diffable, and PR-reviewable.
//
// Cell kinds: markdown · query (recall|search|dna|replay|archetype|stats) · code
//
// Exposed: createNotebook, parse, runCell, runAll, save, toMarkdown

import * as fs from 'fs';
import * as path from 'path';

const BRAIN_VERSION = '6.0.2';
const DEFAULT_DIR = '.shadow-brain/notebooks';

export type QueryType = 'recall' | 'search' | 'dna' | 'replay' | 'archetype' | 'stats';

export type Cell =
  | { kind: 'markdown'; source: string }
  | { kind: 'query'; queryType: QueryType; source: string; lastResult?: string; lastRun?: string }
  | { kind: 'code'; language: 'ts' | 'py' | 'sh'; source: string };

export interface NotebookMetadata {
  project: string;
  created: string;
  modified: string;
  brain_version: string;
}

export interface Notebook {
  title: string;
  cells: Cell[];
  metadata: NotebookMetadata;
}

export interface NotebookRunResult {
  cells: Array<{ index: number; kind: Cell['kind']; result?: string; durationMs?: number; error?: string }>;
  totalDurationMs: number;
  ranAt: string;
}

export class BrainNotebook {
  /** Create a starter notebook on disk and return its path. */
  async createNotebook(project: string, title: string): Promise<{ path: string }> {
    const now = new Date().toISOString();
    const slug = slugify(title);
    const dir = path.join(project, DEFAULT_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${slug}.md`);

    const nb: Notebook = {
      title,
      cells: starterCells(),
      metadata: { project, created: now, modified: now, brain_version: BRAIN_VERSION },
    };
    await this.save(nb, filePath);
    return { path: filePath };
  }

  /** Parse a notebook from disk. */
  async parse(filePath: string): Promise<Notebook> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return this.parseString(raw, filePath);
  }

  /** Parse a notebook from a raw string (useful for tests). */
  parseString(raw: string, source = 'unknown'): Notebook {
    const lines = raw.split(/\r?\n/);
    let i = 0;

    // Title — first H1 (or the file basename as a fallback)
    let title = path.basename(source, path.extname(source));
    while (i < lines.length && !/^#\s+/.test(lines[i])) i++;
    if (i < lines.length) {
      title = lines[i].replace(/^#\s+/, '').trim();
      i++;
    }

    // Optional metadata block — <!-- meta: { ... } -->
    let metadata: NotebookMetadata = {
      project: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      brain_version: BRAIN_VERSION,
    };
    while (i < lines.length && lines[i].trim() === '') i++;
    const metaMatch = i < lines.length ? lines[i].match(/^<!--\s*meta:\s*(\{.*\})\s*-->\s*$/) : null;
    if (metaMatch) {
      try {
        const parsed = JSON.parse(metaMatch[1]) as Partial<NotebookMetadata>;
        metadata = { ...metadata, ...parsed };
      } catch { /* ignore corrupt meta */ }
      i++;
    }

    const cells: Cell[] = [];
    let buffer: string[] = [];
    let current: { kind: 'markdown' } | { kind: 'query'; queryType: QueryType } | { kind: 'code'; language: 'ts' | 'py' | 'sh' } | null = null;
    let pendingResult: { lastRun: string; lines: string[] } | null = null;

    const flush = () => {
      if (!current) {
        // implicit markdown until first cell marker
        const md = buffer.join('\n').trim();
        if (md) cells.push({ kind: 'markdown', source: md });
        buffer = [];
        return;
      }
      if (current.kind === 'markdown') {
        const src = buffer.join('\n').trim();
        if (src) cells.push({ kind: 'markdown', source: src });
      } else if (current.kind === 'query') {
        const src = buffer.join('\n').trim();
        const cell: Cell = { kind: 'query', queryType: current.queryType, source: src };
        if (pendingResult) {
          cell.lastRun = pendingResult.lastRun;
          cell.lastResult = pendingResult.lines.join('\n').trim();
          pendingResult = null;
        }
        cells.push(cell);
      } else if (current.kind === 'code') {
        const src = buffer.join('\n').trim();
        cells.push({ kind: 'code', language: current.language, source: stripCodeFence(src) });
      }
      buffer = [];
    };

    for (; i < lines.length; i++) {
      const line = lines[i];
      const cellMatch = line.match(/^<!--\s*cell:(markdown|query|code)(?:\s+([^>]*?))?\s*-->\s*$/);
      const resultMatch = line.match(/^<!--\s*cell:query-result(?:\s+run=([^\s>]+))?\s*-->\s*$/);
      const endMatch = line.match(/^<!--\s*\/cell:query-result\s*-->\s*$/);

      if (resultMatch) {
        // capture lines until matching end (or next cell marker)
        const runTs = resultMatch[1] ?? new Date().toISOString();
        const resLines: string[] = [];
        i++;
        while (i < lines.length) {
          const ln = lines[i];
          if (/^<!--\s*\/cell:query-result\s*-->\s*$/.test(ln)) break;
          if (/^<!--\s*cell:(markdown|query|code)/.test(ln)) { i--; break; }
          resLines.push(ln);
          i++;
        }
        pendingResult = { lastRun: runTs, lines: resLines };
        continue;
      }

      if (endMatch) continue;

      if (cellMatch) {
        flush();
        const kind = cellMatch[1] as 'markdown' | 'query' | 'code';
        const attrs = parseAttrs(cellMatch[2] ?? '');
        if (kind === 'query') {
          const qt = (attrs.type as QueryType) || 'recall';
          current = { kind: 'query', queryType: qt };
        } else if (kind === 'code') {
          const lang = (attrs.language as 'ts' | 'py' | 'sh') || (attrs.lang as 'ts' | 'py' | 'sh') || 'ts';
          current = { kind: 'code', language: lang };
        } else {
          current = { kind: 'markdown' };
        }
        continue;
      }
      buffer.push(line);
    }
    flush();

    return { title, cells, metadata };
  }

  /** Run a single cell. Markdown cells are no-ops; code cells echo with a TODO. */
  async runCell(notebook: Notebook, cellIndex: number): Promise<{ result: string; durationMs: number }> {
    const cell = notebook.cells[cellIndex];
    if (!cell) throw new Error(`No cell at index ${cellIndex}`);
    const start = Date.now();
    let result = '';

    if (cell.kind === 'markdown') {
      result = '_(markdown cell — nothing to run)_';
    } else if (cell.kind === 'code') {
      result = `_(code cell — execution sandboxed)_\n\nLanguage: ${cell.language}\nTODO: wire up a sandboxed runner.\n\n\`\`\`${cell.language}\n${cell.source}\n\`\`\``;
    } else {
      result = await this.executeQuery(cell, notebook.metadata.project);
      cell.lastResult = result;
      cell.lastRun = new Date().toISOString();
    }
    return { result, durationMs: Date.now() - start };
  }

  /** Run every query cell in order. */
  async runAll(notebook: Notebook): Promise<NotebookRunResult> {
    const start = Date.now();
    const out: NotebookRunResult['cells'] = [];
    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];
      if (cell.kind !== 'query') {
        out.push({ index: i, kind: cell.kind });
        continue;
      }
      try {
        const r = await this.runCell(notebook, i);
        out.push({ index: i, kind: cell.kind, result: r.result, durationMs: r.durationMs });
      } catch (e) {
        out.push({ index: i, kind: cell.kind, error: String((e as Error).message ?? e) });
      }
    }
    return { cells: out, totalDurationMs: Date.now() - start, ranAt: new Date().toISOString() };
  }

  /** Write the notebook back to disk with the latest run results inlined. */
  async save(notebook: Notebook, filePath: string): Promise<void> {
    notebook.metadata.modified = new Date().toISOString();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, this.toMarkdown(notebook));
    fs.renameSync(tmp, filePath);
  }

  /** Render the notebook as a plain Markdown document. */
  toMarkdown(notebook: Notebook): string {
    const parts: string[] = [];
    parts.push(`# ${notebook.title}`, '');
    parts.push(`<!-- meta: ${JSON.stringify(notebook.metadata)} -->`, '');

    for (const cell of notebook.cells) {
      if (cell.kind === 'markdown') {
        parts.push('<!-- cell:markdown -->');
        parts.push(cell.source, '');
      } else if (cell.kind === 'query') {
        parts.push(`<!-- cell:query type=${cell.queryType} -->`);
        parts.push(cell.source, '');
        if (cell.lastResult) {
          parts.push(`<!-- cell:query-result run=${cell.lastRun ?? new Date().toISOString()} -->`);
          parts.push(cell.lastResult);
          parts.push('<!-- /cell:query-result -->', '');
        }
      } else {
        parts.push(`<!-- cell:code language=${cell.language} -->`);
        parts.push('```' + cell.language, cell.source, '```', '');
      }
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // ── Query execution ──────────────────────────────────────────────────────

  private async executeQuery(cell: Extract<Cell, { kind: 'query' }>, project: string): Promise<string> {
    const q = cell.source.trim();
    if (!q) return '_(empty query — add a search term and re-run)_';

    try {
      switch (cell.queryType) {
        case 'recall':
        case 'search':
          return await this.runRecall(q, project);
        case 'dna':
          return await this.runDna(q || project);
        case 'replay':
          return await this.runReplay(q);
        case 'archetype':
          return await this.runArchetype(q || project);
        case 'stats':
          return await this.runStats();
        default:
          return `_(unknown query type: ${cell.queryType})_`;
      }
    } catch (e) {
      return `_(query failed: ${(e as Error).message ?? e})_`;
    }
  }

  private async runRecall(query: string, project: string): Promise<string> {
    const mod = await tryImport('./hierarchical-memory.js');
    if (!mod) return this.fallbackResult('hierarchical-memory module not loaded — install brain core to enable recall.');
    const hm = typeof mod.getHierarchicalMemory === 'function' ? mod.getHierarchicalMemory() : null;
    if (!hm || typeof hm.search !== 'function') return this.fallbackResult('hierarchical-memory has no search() method available.');
    const results = await hm.search({ query, project, limit: 10 }).catch(() => null);
    if (!results || !Array.isArray(results) || results.length === 0) return '_(no matching memories)_';
    return results
      .map((r: any, idx: number) => {
        const id = r.id ?? r.memoryId ?? `mem_${idx}`;
        const snippet = (r.snippet ?? r.content ?? r.text ?? '').toString().slice(0, 240);
        const score = typeof r.score === 'number' ? ` _(score: ${r.score.toFixed(3)})_` : '';
        return `${idx + 1}. \`${id}\`${score} — ${snippet}`;
      })
      .join('\n');
  }

  private async runDna(project: string): Promise<string> {
    const mod = await tryImport('./brain-dna.js');
    if (!mod) return this.fallbackResult('brain-dna module not loaded.');
    const dna = typeof mod.getBrainDna === 'function' ? mod.getBrainDna() : null;
    if (!dna || typeof dna.snapshot !== 'function') return this.fallbackResult('brain-dna has no snapshot() method available.');
    const snap = await dna.snapshot(project).catch(() => null);
    if (!snap) return '_(no DNA snapshot available)_';
    return '```json\n' + JSON.stringify(snap, null, 2).slice(0, 4000) + '\n```';
  }

  private async runReplay(target: string): Promise<string> {
    const mod = await tryImport('./brain-replay.js');
    if (!mod) return this.fallbackResult('brain-replay module not loaded.');
    const replay = typeof mod.getBrainReplay === 'function' ? mod.getBrainReplay() : null;
    if (!replay || typeof replay.list !== 'function') return this.fallbackResult('brain-replay has no list() method available.');
    const sessions = await replay.list({ target, limit: 10 }).catch(() => null);
    if (!sessions || !Array.isArray(sessions) || sessions.length === 0) return '_(no replay sessions found)_';
    return sessions.map((s: any, idx: number) => `${idx + 1}. \`${s.id ?? idx}\` — ${s.title ?? s.description ?? 'session'} (${s.startedAt ?? 'unknown'})`).join('\n');
  }

  private async runArchetype(project: string): Promise<string> {
    const mod = await tryImport('./brain-archetypes.js');
    if (!mod) return this.fallbackResult('brain-archetypes module not loaded.');
    const arch = typeof mod.getBrainArchetypes === 'function' ? mod.getBrainArchetypes() : null;
    if (!arch || typeof arch.classify !== 'function') return this.fallbackResult('brain-archetypes has no classify() method available.');
    const result = await arch.classify(project).catch(() => null);
    if (!result) return '_(no archetype available)_';
    return '```json\n' + JSON.stringify(result, null, 2).slice(0, 2000) + '\n```';
  }

  private async runStats(): Promise<string> {
    const mod = await tryImport('./hierarchical-memory.js');
    if (!mod) return this.fallbackResult('hierarchical-memory module not loaded.');
    const hm = typeof mod.getHierarchicalMemory === 'function' ? mod.getHierarchicalMemory() : null;
    if (!hm || typeof hm.stats !== 'function') return this.fallbackResult('hierarchical-memory has no stats() method available.');
    const stats = await hm.stats().catch(() => null);
    if (!stats) return '_(no stats available)_';
    return '```json\n' + JSON.stringify(stats, null, 2).slice(0, 2000) + '\n```';
  }

  private fallbackResult(reason: string): string {
    return `_(empty-state: ${reason})_\n\nThis cell will populate once the brain core is wired up. The notebook itself is fully functional — re-run when modules become available.`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'notebook';
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rx = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s)) !== null) {
    out[m[1]] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

function stripCodeFence(src: string): string {
  const m = src.match(/^```\w*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : src;
}

async function tryImport(spec: string): Promise<any> {
  try {
    return await import(spec).catch(() => null);
  } catch {
    return null;
  }
}

function starterCells(): Cell[] {
  return [
    {
      kind: 'markdown',
      source: 'This is a **Shadow Brain notebook** — a Jupyter-style explorer for your project memory.\n\nEach `query` cell below runs against your local brain. Edit the source, then re-run to refresh the inlined result.',
    },
    { kind: 'query', queryType: 'stats', source: '(no input — returns brain-wide stats)' },
    {
      kind: 'markdown',
      source: '## Try a recall\n\nReplace the query below with anything you want to investigate.',
    },
    { kind: 'query', queryType: 'recall', source: 'recent decisions in this project' },
    {
      kind: 'markdown',
      source: '## Check the project archetype\n\nWhat kind of project does the brain think this is?',
    },
    { kind: 'query', queryType: 'archetype', source: 'default project' },
    {
      kind: 'markdown',
      source: '## Notes\n\nWrite anything here — this is a normal Markdown document. Add a `<!-- cell:code language=ts -->` block to keep code snippets near your investigation.',
    },
    {
      kind: 'code',
      language: 'ts',
      source: '// Example snippet — wire your own thoughts here.\nconst summary = "this notebook is git-trackable and PR-reviewable";',
    },
  ];
}

let _instance: BrainNotebook | null = null;
export function getBrainNotebook(): BrainNotebook {
  if (!_instance) _instance = new BrainNotebook();
  return _instance;
}
export function resetBrainNotebookForTests(): void { _instance = null; }
