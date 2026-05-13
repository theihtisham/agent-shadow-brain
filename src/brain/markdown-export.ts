// src/brain/markdown-export.ts — Git-trackable Markdown export/import for the brain
// v6.0.2 — Multimodal Edition
//
// Complements brain-portability.ts (JSON, opaque) with a human-readable
// .shadow-brain.md so brain state can be diffed, PR-reviewed, and hand-edited.
// Format: YAML-ish frontmatter + H2 sections (Memories/Patterns/Decisions/
// Entities/Rules) + H3 entities with bullet-list fields.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STORE_DIR = path.join(os.homedir(), '.shadow-brain');
const VERSION = '6.0.2';

export type Section = 'memories' | 'patterns' | 'decisions' | 'entities' | 'rules';
const ALL_SECTIONS: Section[] = ['memories', 'patterns', 'decisions', 'entities', 'rules'];

const SECTION_DIRS: Record<Section, string> = {
  memories: 'hierarchical-memory',
  patterns: 'patterns',
  decisions: 'decisions',
  entities: 'knowledge-graph',
  rules: 'custom-rules',
};

const SECTION_TITLES: Record<Section, string> = {
  memories: 'Memories',
  patterns: 'Patterns',
  decisions: 'Decisions',
  entities: 'Entities',
  rules: 'Rules',
};

export interface BrainEntity {
  id: string;
  type?: string;
  created?: string;
  importance?: number;
  content?: string;
  [k: string]: unknown;
}

export interface ExportResult {
  path: string;
  sizeBytes: number;
  sectionCounts: Record<Section, number>;
}

export interface ImportResult {
  added: number;
  modified: number;
  skipped: number;
  errors: string[];
}

export interface DiffResult {
  willAdd: string[];
  willModify: string[];
  willSkip: string[];
}

export class MarkdownExport {
  /** Export selected brain sections to a single .shadow-brain.md file. */
  async exportBrain(
    project: string,
    opts?: { sections?: Section[]; outPath?: string }
  ): Promise<ExportResult> {
    const sections = opts?.sections && opts.sections.length > 0 ? opts.sections : ALL_SECTIONS;
    const counts: Record<Section, number> = { memories: 0, patterns: 0, decisions: 0, entities: 0, rules: 0 };

    const entitiesBySection: Record<Section, BrainEntity[]> = {
      memories: [], patterns: [], decisions: [], entities: [], rules: [],
    };

    for (const sec of sections) {
      const ents = this.loadSection(sec, project);
      entitiesBySection[sec] = ents;
      counts[sec] = ents.length;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const md = this.renderMarkdown(project, total, sections, entitiesBySection);
    const outPath = opts?.outPath || path.join(process.cwd(), '.shadow-brain.md');

    try {
      const tmp = outPath + '.tmp';
      fs.writeFileSync(tmp, md, 'utf-8');
      fs.renameSync(tmp, outPath);
    } catch (err) {
      return {
        path: outPath,
        sizeBytes: 0,
        sectionCounts: counts,
      };
    }

    return {
      path: outPath,
      sizeBytes: Buffer.byteLength(md, 'utf-8'),
      sectionCounts: counts,
    };
  }

  /** Parse a .shadow-brain.md and write entities back into the brain store. */
  async importBrain(
    mdPath: string,
    opts?: { merge?: 'replace' | 'addNew' | 'overwrite' }
  ): Promise<ImportResult> {
    const mode = opts?.merge || 'addNew';
    const result: ImportResult = { added: 0, modified: 0, skipped: 0, errors: [] };

    if (!fs.existsSync(mdPath)) {
      result.errors.push(`File not found: ${mdPath}`);
      return result;
    }

    let raw: string;
    try { raw = fs.readFileSync(mdPath, 'utf-8'); }
    catch (err) {
      result.errors.push(`Read failed: ${err instanceof Error ? err.message : String(err)}`);
      return result;
    }

    const parsed = this.parseMarkdown(raw);
    const project = parsed.frontmatter.project || 'default';

    for (const [sec, ents] of Object.entries(parsed.sections) as Array<[Section, BrainEntity[]]>) {
      if (mode === 'replace') {
        try { this.clearSection(sec, project); }
        catch (err) { result.errors.push(`clear ${sec}: ${err instanceof Error ? err.message : String(err)}`); }
      }
      for (const ent of ents) {
        try {
          const action = this.writeEntity(sec, project, ent, mode);
          if (action === 'added') result.added++;
          else if (action === 'modified') result.modified++;
          else result.skipped++;
        } catch (err) {
          result.errors.push(`${sec}/${ent.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return result;
  }

  /** Preview what an import will do, without writing anything. */
  async diff(mdPath: string): Promise<DiffResult> {
    const out: DiffResult = { willAdd: [], willModify: [], willSkip: [] };
    if (!fs.existsSync(mdPath)) return out;

    let raw: string;
    try { raw = fs.readFileSync(mdPath, 'utf-8'); } catch { return out; }
    const parsed = this.parseMarkdown(raw);
    const project = parsed.frontmatter.project || 'default';

    for (const [sec, ents] of Object.entries(parsed.sections) as Array<[Section, BrainEntity[]]>) {
      for (const ent of ents) {
        const existing = this.readEntity(sec, project, ent.id);
        if (!existing) { out.willAdd.push(`${sec}/${ent.id}`); continue; }
        if (JSON.stringify(existing) === JSON.stringify(ent)) out.willSkip.push(`${sec}/${ent.id}`);
        else out.willModify.push(`${sec}/${ent.id}`);
      }
    }
    return out;
  }

  // ── Render ───────────────────────────────────────────────────────────

  private renderMarkdown(
    project: string, total: number, sections: Section[],
    entities: Record<Section, BrainEntity[]>
  ): string {
    const lines: string[] = [
      '---',
      `project: ${project}`,
      `exported_at: ${new Date().toISOString()}`,
      `total_entities: ${total}`,
      `shadow_brain_version: ${VERSION}`,
      '---', '',
    ];
    const builtin = new Set(['id', 'type', 'created', 'importance', 'content']);
    for (const sec of sections) {
      lines.push(`## ${SECTION_TITLES[sec]}`, '');
      const ents = entities[sec];
      if (ents.length === 0) { lines.push('_(none)_', ''); continue; }
      for (const ent of ents) {
        lines.push(`### ${ent.id}`);
        if (ent.type !== undefined) lines.push(`- **type**: ${formatValue(ent.type)}`);
        if (ent.created !== undefined) lines.push(`- **created**: ${formatValue(ent.created)}`);
        if (ent.importance !== undefined) lines.push(`- **importance**: ${formatValue(ent.importance)}`);
        for (const [k, v] of Object.entries(ent)) {
          if (builtin.has(k) || v === null || v === undefined) continue;
          lines.push(`- **${k}**: ${formatValue(v)}`);
        }
        if (ent.content !== undefined) lines.push(`- **content**: ${escapeContent(String(ent.content))}`);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  // ── Parse ────────────────────────────────────────────────────────────

  private parseMarkdown(raw: string): {
    frontmatter: Record<string, string>;
    sections: Partial<Record<Section, BrainEntity[]>>;
  } {
    const frontmatter: Record<string, string> = {};
    const sections: Partial<Record<Section, BrainEntity[]>> = {};

    let body = raw;
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
        if (m) frontmatter[m[1]] = m[2].trim();
      }
      body = raw.slice(fmMatch[0].length);
    }

    // Find each ## Section block
    const sectionRegex = /^## +(.+?)\s*$/gm;
    const sectionStarts: Array<{ name: string; start: number; end: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(body)) !== null) {
      sectionStarts.push({ name: match[1].trim(), start: match.index + match[0].length, end: body.length });
    }
    for (let i = 0; i < sectionStarts.length - 1; i++) {
      sectionStarts[i].end = sectionStarts[i + 1].start - 2; // back up over the next ## line
    }

    for (const sec of sectionStarts) {
      const secId = titleToSection(sec.name);
      if (!secId) continue;
      const block = body.slice(sec.start, sec.end);
      sections[secId] = this.parseEntities(block);
    }
    return { frontmatter, sections };
  }

  private parseEntities(block: string): BrainEntity[] {
    const out: BrainEntity[] = [];
    const entityRegex = /^### +(.+?)\s*$/gm;
    const starts: Array<{ id: string; start: number; end: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = entityRegex.exec(block)) !== null) {
      starts.push({ id: match[1].trim(), start: match.index + match[0].length, end: block.length });
    }
    for (let i = 0; i < starts.length - 1; i++) starts[i].end = starts[i + 1].start - 4;

    for (const s of starts) {
      const body = block.slice(s.start, s.end);
      const ent: BrainEntity = { id: s.id };
      const bullet = /^- +\*\*([a-zA-Z_][a-zA-Z0-9_]*)\*\*:\s*([\s\S]*?)(?=(?:\n- +\*\*)|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = bullet.exec(body)) !== null) {
        const key = m[1];
        const val = m[2].trim();
        ent[key] = coerceValue(val);
      }
      out.push(ent);
    }
    return out;
  }

  // ── Storage I/O ──────────────────────────────────────────────────────

  private loadSection(sec: Section, project: string): BrainEntity[] {
    const dir = path.join(STORE_DIR, SECTION_DIRS[sec]);
    if (!fs.existsSync(dir)) return [];
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); }
    catch { return []; }
    const out: BrainEntity[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        for (const ent of flattenToEntities(raw, project)) out.push(ent);
      } catch { /* skip */ }
    }
    return out;
  }

  private readEntity(sec: Section, project: string, id: string): BrainEntity | null {
    const all = this.loadSection(sec, project);
    return all.find(e => e.id === id) || null;
  }

  private writeEntity(
    sec: Section, project: string, ent: BrainEntity, mode: 'replace' | 'addNew' | 'overwrite'
  ): 'added' | 'modified' | 'skipped' {
    const dir = path.join(STORE_DIR, SECTION_DIRS[sec]);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${sanitizeFile(ent.id)}.json`);
    const exists = fs.existsSync(filePath);
    if (exists && mode === 'addNew') return 'skipped';
    const enriched = { ...ent, project, _imported_at: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(enriched, null, 2));
    return exists ? 'modified' : 'added';
  }

  private clearSection(sec: Section, _project: string): void {
    const dir = path.join(STORE_DIR, SECTION_DIRS[sec]);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function titleToSection(title: string): Section | null {
  const t = title.toLowerCase();
  for (const sec of ALL_SECTIONS) if (SECTION_TITLES[sec].toLowerCase() === t) return sec;
  return null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function escapeContent(s: string): string {
  // Collapse newlines so the bullet stays a single logical line; preserve readability
  return s.replace(/\r?\n/g, ' ').trim();
}

function coerceValue(v: string): unknown {
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { return JSON.parse(v); } catch { /* keep as string */ }
  }
  return v;
}

function sanitizeFile(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'entity';
}

function flattenToEntities(raw: unknown, project: string): BrainEntity[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(x => x && typeof x === 'object')
      .map((x, i) => normalizeEntity(x as Record<string, unknown>, project, i));
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // Detect "entries" array shape used by some modules
    for (const key of ['entries', 'items', 'patterns', 'memories', 'decisions', 'rules']) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[])
          .filter(x => x && typeof x === 'object')
          .map((x, i) => normalizeEntity(x as Record<string, unknown>, project, i));
      }
    }
    // Single entity
    return [normalizeEntity(obj, project, 0)];
  }
  return [];
}

function normalizeEntity(obj: Record<string, unknown>, project: string, fallbackIdx: number): BrainEntity {
  const id = String(obj.id ?? obj.key ?? `${project}_${fallbackIdx}`);
  const ent: BrainEntity = { id };
  if (obj.type !== undefined) ent.type = String(obj.type);
  if (obj.created !== undefined) ent.created = String(obj.created);
  else if (obj.createdAt !== undefined) ent.created = String(obj.createdAt);
  else if (obj.lastSeen !== undefined) ent.created = String(obj.lastSeen);
  if (typeof obj.importance === 'number') ent.importance = obj.importance;
  if (obj.content !== undefined) ent.content = String(obj.content);
  else if (obj.pattern !== undefined) ent.content = String(obj.pattern);
  else if (obj.text !== undefined) ent.content = String(obj.text);
  // Preserve a couple of helpful scalars
  for (const k of ['tags', 'occurrences', 'project']) {
    if (obj[k] !== undefined) (ent as Record<string, unknown>)[k] = obj[k];
  }
  return ent;
}

let _instance: MarkdownExport | null = null;
export function getMarkdownExport(): MarkdownExport {
  if (!_instance) _instance = new MarkdownExport();
  return _instance;
}
export function resetMarkdownExportForTests(): void { _instance = null; }
