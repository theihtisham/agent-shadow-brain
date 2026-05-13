// src/brain/brain-diff.ts — Brain Diff (viral feature)
// v6.0.2 — semantic diff between two brains
//
// "What did your brain learn that mine didn't?"
//
// Accepts either an in-memory BrainSnapshot or a path/capsuleId. Computes:
//   • onlyInA / onlyInB / bothShared / conflicting entities
//   • similarity score (cosine-mean over shared entity embeddings)
//   • narrative (2-3 sentence English summary)
//   • svg (Venn-diagram-style card, tweet-ready, 1200x600)
//
// Designed to coordinate with brain-time-capsule.ts via interfaces only — no
// hard import of capsule internals, so each module is independently testable.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';

export interface BrainEntity {
  id: string;
  category?: string;
  content: string;
  importance?: number;
  /** Optional precomputed embedding. If absent, we compute lazily. */
  vector?: number[];
  metadata?: Record<string, unknown>;
}

export interface BrainSnapshot {
  /** Optional friendly label ("brain-A", "January 2026", etc.) */
  label?: string;
  entities: BrainEntity[];
  source?: string;
}

export interface ConflictPair {
  a: BrainEntity;
  b: BrainEntity;
  reason: 'same-id-different-content' | 'high-similarity-different-position';
  similarity: number;
}

export interface BrainDiffReport {
  labelA: string;
  labelB: string;
  onlyInA: BrainEntity[];
  onlyInB: BrainEntity[];
  bothShared: BrainEntity[];
  conflicting: ConflictPair[];
  stats: {
    addedCount: number;
    removedCount: number;
    conflictCount: number;
    similarityScore: number;
    sizeA: number;
    sizeB: number;
  };
  narrative: string;
  svg: string;
}

export interface ApplyDiffOptions {
  strategy: 'mergeAll' | 'addOnly' | 'interactive';
  /** Called for each entity when strategy is 'interactive'. Return true to keep. */
  decide?: (entity: BrainEntity, from: 'A' | 'B') => boolean | Promise<boolean>;
}

const BRAIN_ROOT = path.join(os.homedir(), '.shadow-brain');

export class BrainDiff {
  /** Compute a semantic diff between two brains. */
  async diff(brainA: BrainSnapshot | string, brainB: BrainSnapshot | string): Promise<BrainDiffReport> {
    const a = await this.normalize(brainA, 'A');
    const b = await this.normalize(brainB, 'B');

    const byIdA = indexBy(a.entities, e => e.id);
    const byIdB = indexBy(b.entities, e => e.id);

    const onlyInA: BrainEntity[] = [];
    const onlyInB: BrainEntity[] = [];
    const bothShared: BrainEntity[] = [];
    const conflicting: ConflictPair[] = [];

    for (const e of a.entities) {
      const other = byIdB.get(e.id);
      if (!other) onlyInA.push(e);
      else if (sameContent(e, other)) bothShared.push(e);
      else {
        const sim = await this.cosine(e, other);
        conflicting.push({ a: e, b: other, reason: 'same-id-different-content', similarity: sim });
      }
    }
    for (const e of b.entities) {
      if (!byIdA.has(e.id)) onlyInB.push(e);
    }

    // Mean cosine of shared entities — defaults to 1 when no overlap (vacuously identical).
    const sharedSimilarities: number[] = [];
    for (const e of bothShared) {
      const other = byIdB.get(e.id);
      if (!other) continue;
      sharedSimilarities.push(await this.cosine(e, other));
    }
    const similarityScore = sharedSimilarities.length
      ? sharedSimilarities.reduce((s, x) => s + x, 0) / sharedSimilarities.length
      : (bothShared.length === 0 && (a.entities.length || b.entities.length) ? 0 : 1);

    const stats = {
      addedCount: onlyInB.length,
      removedCount: onlyInA.length,
      conflictCount: conflicting.length,
      similarityScore,
      sizeA: a.entities.length,
      sizeB: b.entities.length,
    };

    const narrative = this.narrate(a, b, onlyInA, onlyInB, bothShared, similarityScore);
    const svg = this.renderSvg(a.label ?? 'Brain A', b.label ?? 'Brain B', onlyInA, onlyInB, bothShared, stats);

    return {
      labelA: a.label ?? 'Brain A',
      labelB: b.label ?? 'Brain B',
      onlyInA, onlyInB, bothShared, conflicting,
      stats,
      narrative,
      svg,
    };
  }

  /**
   * Apply a diff back into a target brain snapshot. Returns the merged entities.
   * Caller is responsible for persisting them.
   */
  async applyDiff(targetBrain: BrainSnapshot, diff: BrainDiffReport, opts: ApplyDiffOptions): Promise<BrainEntity[]> {
    const merged = new Map<string, BrainEntity>();
    for (const e of targetBrain.entities) merged.set(e.id, e);

    const consider = async (entities: BrainEntity[], from: 'A' | 'B') => {
      for (const e of entities) {
        if (opts.strategy === 'addOnly' && merged.has(e.id)) continue;
        if (opts.strategy === 'interactive') {
          const keep = opts.decide ? await opts.decide(e, from) : true;
          if (!keep) continue;
        }
        merged.set(e.id, e);
      }
    };

    // mergeAll: pull from both onlyInA + onlyInB + winning side of conflicts (use B as "newer").
    if (opts.strategy === 'mergeAll' || opts.strategy === 'addOnly' || opts.strategy === 'interactive') {
      await consider(diff.onlyInA, 'A');
      await consider(diff.onlyInB, 'B');
      if (opts.strategy === 'mergeAll') {
        for (const c of diff.conflicting) merged.set(c.b.id, c.b);
      } else if (opts.strategy === 'interactive') {
        for (const c of diff.conflicting) {
          const keepB = opts.decide ? await opts.decide(c.b, 'B') : true;
          if (keepB) merged.set(c.b.id, c.b);
        }
      }
    }

    return Array.from(merged.values());
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async normalize(input: BrainSnapshot | string, fallbackLabel: string): Promise<BrainSnapshot> {
    if (typeof input !== 'string') {
      return { ...input, label: input.label ?? `Brain ${fallbackLabel}`, entities: input.entities ?? [] };
    }
    // Treat string as a path / capsuleId.
    const snapshot = await loadFromPathOrCapsule(input);
    if (snapshot.entities.length === 0) snapshot.entities = [];
    snapshot.label = snapshot.label ?? path.basename(input) ?? `Brain ${fallbackLabel}`;
    return snapshot;
  }

  /** Cosine similarity between two entities. Embeds lazily if needed. */
  private async cosine(a: BrainEntity, b: BrainEntity): Promise<number> {
    const va = await ensureVector(a);
    const vb = await ensureVector(b);
    if (!va || !vb) return contentSimilarity(a.content, b.content);
    const n = Math.min(va.length, vb.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += va[i] * vb[i];
    return dot;
  }

  private narrate(a: BrainSnapshot, b: BrainSnapshot, onlyA: BrainEntity[], onlyB: BrainEntity[], shared: BrainEntity[], sim: number): string {
    const topA = topCategories(onlyA);
    const topB = topCategories(onlyB);
    const sharedTop = topCategories(shared);
    const labelA = a.label ?? 'Brain A';
    const labelB = b.label ?? 'Brain B';

    const sentences: string[] = [];
    if (topA.length) {
      sentences.push(`${labelA} focuses heavily on ${describeTop(topA)}.`);
    } else if (onlyA.length === 0) {
      sentences.push(`${labelA} has no entities unique to it.`);
    }
    if (topB.length) {
      sentences.push(`${labelB} is ${describeTop(topB)}-heavy.`);
    } else if (onlyB.length === 0) {
      sentences.push(`${labelB} has no entities unique to it.`);
    }
    if (sharedTop.length) {
      sentences.push(`Both share strong ${describeTop(sharedTop)} patterns (similarity ${(sim * 100).toFixed(0)}%).`);
    }
    const ratio = b.entities.length > 0 ? a.entities.length / b.entities.length : 1;
    if (ratio !== 1 && Math.abs(ratio - 1) > 0.05 && a.entities.length && b.entities.length) {
      const pct = Math.abs(ratio - 1) * 100;
      const which = ratio > 1 ? labelA : labelB;
      sentences.push(`${which} is ${pct.toFixed(0)}% larger.`);
    }
    return sentences.slice(0, 4).join(' ');
  }

  private renderSvg(labelA: string, labelB: string, onlyA: BrainEntity[], onlyB: BrainEntity[], shared: BrainEntity[], stats: BrainDiffReport['stats']): string {
    const W = 1200, H = 600;
    const cx1 = 420, cx2 = 780, cy = 320, r = 240;

    const topA = topEntities(onlyA, 5);
    const topB = topEntities(onlyB, 5);
    const topShared = topEntities(shared, 5);

    const renderList = (items: BrainEntity[], x: number, anchor: 'start' | 'middle' | 'end') => items.map((e, i) => {
      const text = escapeXml(shortLabel(e));
      return `      <text x="${x}" y="${cy - 30 + i * 18}" font-size="13" fill="#e8ecf4" text-anchor="${anchor}">• ${text}</text>`;
    }).join('\n');

    const safeA = escapeXml(labelA.length > 30 ? labelA.slice(0, 29) + '…' : labelA);
    const safeB = escapeXml(labelB.length > 30 ? labelB.slice(0, 29) + '…' : labelB);
    const simPct = (stats.similarityScore * 100).toFixed(0);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Brain Diff card">
  <defs>
    <radialGradient id="bdA" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#18ffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#18ffff" stop-opacity="0.10"/>
    </radialGradient>
    <radialGradient id="bdB" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ec4899" stop-opacity="0.10"/>
    </radialGradient>
    <linearGradient id="bdBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#030509"/>
      <stop offset="100%" stop-color="#10152a"/>
    </linearGradient>
    <linearGradient id="bdShared" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#18ffff"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bdBg)"/>
  <text x="40" y="44" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="700" fill="#18ffff">Brain Diff</text>
  <text x="40" y="68" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" fill="#a4afc4">${safeA} vs ${safeB} · similarity ${simPct}%</text>
  <circle cx="${cx1}" cy="${cy}" r="${r}" fill="url(#bdA)" stroke="#18ffff" stroke-opacity="0.55"/>
  <circle cx="${cx2}" cy="${cy}" r="${r}" fill="url(#bdB)" stroke="#ec4899" stroke-opacity="0.55"/>
  <text x="${cx1 - r + 30}" y="${cy - r + 20}" font-size="16" font-weight="700" fill="#18ffff">${safeA}</text>
  <text x="${cx1 - r + 30}" y="${cy - r + 42}" font-size="12" fill="#a4afc4">${onlyA.length} unique · ${stats.sizeA} total</text>
${renderList(topA, cx1 - r + 30, 'start')}
  <text x="${cx2 + r - 30}" y="${cy - r + 20}" font-size="16" font-weight="700" fill="#ec4899" text-anchor="end">${safeB}</text>
  <text x="${cx2 + r - 30}" y="${cy - r + 42}" font-size="12" fill="#a4afc4" text-anchor="end">${onlyB.length} unique · ${stats.sizeB} total</text>
${renderList(topB, cx2 + r - 30, 'end')}
  <text x="${(cx1 + cx2) / 2}" y="${cy - r + 20}" font-size="14" font-weight="700" fill="url(#bdShared)" text-anchor="middle">SHARED</text>
  <text x="${(cx1 + cx2) / 2}" y="${cy - r + 42}" font-size="12" fill="#a855f7" text-anchor="middle">${shared.length} entities</text>
${renderList(topShared, (cx1 + cx2) / 2, 'middle')}
  <text x="40" y="${H - 12}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#3e4762">agent-shadow-brain · brain diff</text>
</svg>`;
  }
}

// ── Snapshot loader: capsule-aware, but tolerant when capsule module isn't loaded ──

async function loadFromPathOrCapsule(input: string): Promise<BrainSnapshot> {
  // Case 1: literal JSON file path on disk.
  if (input.endsWith('.json') && fs.existsSync(input)) {
    try {
      const raw = JSON.parse(fs.readFileSync(input, 'utf-8'));
      return coerceSnapshot(raw, input);
    } catch { /* fall through */ }
  }

  // Case 2: capsule directory or capsule id under ~/.shadow-brain/time-capsules.
  const capsulePath = resolveCapsulePath(input);
  if (capsulePath) {
    return await loadCapsuleSnapshot(capsulePath);
  }

  // Case 3: input is a directory containing brain-state files (live brain root).
  if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
    return loadLiveBrainSnapshot(input);
  }

  // Empty fallback — graceful.
  return { label: path.basename(input) || 'unknown', entities: [], source: input };
}

function resolveCapsulePath(input: string): string | null {
  if (path.isAbsolute(input) && fs.existsSync(input) && fs.existsSync(path.join(input, 'manifest.json'))) {
    return input;
  }
  const capsuleRoot = path.join(BRAIN_ROOT, 'time-capsules');
  if (!fs.existsSync(capsuleRoot)) return null;
  for (const project of fs.readdirSync(capsuleRoot)) {
    const projectDir = path.join(capsuleRoot, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    const direct = path.join(projectDir, input.endsWith('.tcz') ? input : `${input}.tcz`);
    if (fs.existsSync(direct)) return direct;
  }
  return null;
}

async function loadCapsuleSnapshot(capsuleDir: string): Promise<BrainSnapshot> {
  const manifestPath = path.join(capsuleDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { label: path.basename(capsuleDir), entities: [], source: capsuleDir };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { label?: string; project?: string; files?: Array<{ rel: string }> };
  const entities: BrainEntity[] = [];
  for (const f of manifest.files ?? []) {
    try {
      const gz = fs.readFileSync(path.join(capsuleDir, 'content', f.rel + '.gz'));
      const raw = zlib.gunzipSync(gz).toString('utf-8');
      extractEntitiesFrom(f.rel, raw, entities);
    } catch { /* skip */ }
  }
  return { label: manifest.label ?? manifest.project ?? path.basename(capsuleDir), entities, source: capsuleDir };
}

function loadLiveBrainSnapshot(dir: string): BrainSnapshot {
  const entities: BrainEntity[] = [];
  walkBrain(dir, dir, entities);
  return { label: path.basename(dir), entities, source: dir };
}

function walkBrain(absRoot: string, abs: string, out: BrainEntity[], depth = 0): void {
  if (depth > 5) return;
  let stat: fs.Stats;
  try { stat = fs.statSync(abs); } catch { return; }
  if (stat.isFile() && abs.endsWith('.json')) {
    try {
      const raw = fs.readFileSync(abs, 'utf-8');
      const rel = path.relative(absRoot, abs).replace(/\\/g, '/');
      extractEntitiesFrom(rel, raw, out);
    } catch { /* skip */ }
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(abs)) {
      if (entry.startsWith('.')) continue;
      walkBrain(absRoot, path.join(abs, entry), out, depth + 1);
    }
  }
}

function extractEntitiesFrom(rel: string, raw: string, out: BrainEntity[]): void {
  try {
    const parsed = JSON.parse(raw);
    // Common shapes: { entries: [...] }, { memories: [...] }, [...]
    const candidates: unknown[] =
      Array.isArray(parsed) ? parsed :
      Array.isArray((parsed as Record<string, unknown>).entries) ? (parsed as { entries: unknown[] }).entries :
      Array.isArray((parsed as Record<string, unknown>).memories) ? (parsed as { memories: unknown[] }).memories :
      Array.isArray((parsed as Record<string, unknown>).items) ? (parsed as { items: unknown[] }).items :
      [];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      const id = String(rec.id ?? rec.key ?? `${rel}:${out.length}`);
      const content = String(rec.content ?? rec.text ?? rec.body ?? rec.summary ?? '').slice(0, 1200);
      if (!content) continue;
      out.push({
        id,
        category: typeof rec.category === 'string' ? rec.category : (typeof rec.type === 'string' ? rec.type : undefined),
        content,
        importance: typeof rec.importance === 'number' ? rec.importance : undefined,
        vector: Array.isArray(rec.vector) ? rec.vector as number[] : undefined,
        metadata: typeof rec.metadata === 'object' && rec.metadata ? rec.metadata as Record<string, unknown> : undefined,
      });
    }
  } catch { /* skip non-JSON */ }
}

function coerceSnapshot(raw: unknown, source: string): BrainSnapshot {
  if (!raw || typeof raw !== 'object') return { label: path.basename(source), entities: [], source };
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.entities)) {
    return { label: typeof rec.label === 'string' ? rec.label : path.basename(source), entities: rec.entities as BrainEntity[], source };
  }
  const entities: BrainEntity[] = [];
  extractEntitiesFrom(source, JSON.stringify(raw), entities);
  return { label: path.basename(source), entities, source };
}

// ── Vector / similarity helpers ──

async function ensureVector(e: BrainEntity): Promise<number[] | null> {
  if (e.vector && e.vector.length) return e.vector;
  // Try embeddings module dynamically. Defensive: fall back to local hash if not loaded.
  try {
    const mod = await import('./embeddings.js').catch(() => null);
    if (mod && typeof (mod as any).getEmbeddings === 'function') {
      const emb = (mod as any).getEmbeddings();
      const v = await emb.embed(e.content);
      if (Array.isArray(v) && v.length) { e.vector = v; return v; }
    }
  } catch { /* fall through */ }
  // Local hash vector as last resort — keeps cosine math meaningful.
  e.vector = hashVector(e.content, 128);
  return e.vector;
}

function hashVector(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = norm.split(/\s+/).filter(t => t.length > 1);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    v[(h >>> 0) % dim] += 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) v[i] = v[i] / n;
  return v;
}

function contentSimilarity(a: string, b: string): number {
  // Jaccard on token sets — fast fallback.
  const sa = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const sb = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter || 1);
}

function sameContent(a: BrainEntity, b: BrainEntity): boolean {
  return a.content === b.content && (a.category ?? '') === (b.category ?? '');
}

function indexBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(keyFn(it), it);
  return m;
}

function topCategories(entities: BrainEntity[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of entities) {
    const c = e.category ?? 'general';
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 3);
}

function describeTop(top: Array<{ category: string; count: number }>): string {
  if (top.length === 0) return 'general topics';
  if (top.length === 1) return `${top[0].category} (${top[0].count})`;
  return `${top[0].category} (${top[0].count})`;
}

function topEntities(entities: BrainEntity[], k: number): BrainEntity[] {
  return [...entities]
    .sort((a, b) => (b.importance ?? 0.5) - (a.importance ?? 0.5) || b.content.length - a.content.length)
    .slice(0, k);
}

function shortLabel(e: BrainEntity): string {
  const cat = e.category ? `[${e.category}] ` : '';
  const body = e.content.replace(/\s+/g, ' ').trim();
  const label = cat + (body.length > 36 ? body.slice(0, 35) + '…' : body);
  return label.slice(0, 44);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

let _instance: BrainDiff | null = null;
export function getBrainDiff(): BrainDiff {
  if (!_instance) _instance = new BrainDiff();
  return _instance;
}
export function resetBrainDiffForTests(): void { _instance = null; }
