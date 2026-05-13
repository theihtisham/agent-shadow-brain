// src/brain/brain-contradictions.ts — Memory contradiction detector
// v6.0.2 — Hive Mind Edition
//
// Over time the brain accumulates contradicting memories — "always use bcrypt
// for passwords" then later "use scrypt for new code". These confuse recall
// because both surface for the same query and the agent has no signal which
// one is current. This module scans the brain, pairs semantically-similar
// memories that DIFFER on polarity markers, and surfaces them as actionable
// contradictions the user can resolve.
//
// Detection (deterministic, no LLM):
//   1. Pair memories with cosine similarity ≥ 0.6 (via dynamic embeddings-v2).
//   2. For each pair, scan polarity-marker pairs (use/don't use, always/never,
//      prefer/avoid, bcrypt/scrypt, etc. — 40+ pairs inline).
//   3. Detect numerical mismatches (timeout: 30s vs timeout: 60s).
//   4. Detect "v1"/"v2" markers and downgrade to a version annotation.
//   5. Score severity: high (never/always clash), medium (recommendation diff),
//      low (numerical or stylistic).
//
// Persistence: ~/.shadow-brain/contradictions/<project>.json holds the latest
// scan report plus the human-resolution suppression list so resolved pairs do
// not re-surface on every scan.
//
// Exposed: BrainContradictions, getBrainContradictions(), reset…ForTests().

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { GlobalEntry } from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const CONTRADICTIONS_DIR = path.join(os.homedir(), '.shadow-brain', 'contradictions');
const DEFAULT_THRESHOLD = 0.6;
const MAX_PAIRS_PER_SCAN = 5000;
const HISTORY_LIMIT = 25;

export type ContradictionSeverity = 'high' | 'medium' | 'low';
export type ResolutionChoice =
  | 'keep-newer'
  | 'keep-higher-importance'
  | 'merge'
  | 'mark-as-version'
  | 'human-review';

export interface ContradictionMemoryRef {
  id: string;
  content: string;
  importance: number;
  createdAt: Date;
}

export interface Contradiction {
  id: string;
  severity: ContradictionSeverity;
  memoryA: ContradictionMemoryRef;
  memoryB: ContradictionMemoryRef;
  similarity: number;
  contradictionEvidence: string;
  suggestedResolution: ResolutionChoice;
  detectedAt: Date;
  archetype?: string;
}

export interface ContradictionReport {
  scannedAt: Date;
  totalMemories: number;
  contradictions: Contradiction[];
  durationMs: number;
}

interface PersistShape {
  schemaVersion: 1;
  project: string;
  reports: SerializedReport[];
  suppressions: Array<{ pairKey: string; resolvedAt: number; choice: ResolutionChoice }>;
}

interface SerializedReport {
  scannedAt: number;
  totalMemories: number;
  durationMs: number;
  contradictions: Array<Omit<Contradiction, 'detectedAt' | 'memoryA' | 'memoryB'> & {
    detectedAt: number;
    memoryA: Omit<ContradictionMemoryRef, 'createdAt'> & { createdAt: number };
    memoryB: Omit<ContradictionMemoryRef, 'createdAt'> & { createdAt: number };
  }>;
}

/** Antonym/polarity pairs (46). Generic + domain-specific (crypto/web/tooling). */
const POLARITY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['use', "don't use"], ['use', 'avoid'], ['always', 'never'], ['prefer', 'avoid'],
  ['recommended', 'deprecated'], ['current', 'deprecated'], ['enable', 'disable'],
  ['allow', 'deny'], ['allow', 'forbid'], ['should', 'should not'], ['must', 'must not'],
  ['safe', 'unsafe'], ['secure', 'insecure'], ['valid', 'invalid'], ['correct', 'incorrect'],
  ['accept', 'reject'], ['include', 'exclude'], ['true', 'false'], ['on', 'off'], ['yes', 'no'],
  ['public', 'private'], ['sync', 'async'], ['mutable', 'immutable'], ['stable', 'unstable'],
  ['fast', 'slow'],
  // domain-specific antonyms — security / crypto / web / tooling
  ['bcrypt', 'scrypt'], ['bcrypt', 'argon2'], ['md5', 'sha256'], ['sha1', 'sha256'],
  ['http', 'https'], ['cookie', 'jwt'], ['session', 'jwt'], ['rest', 'graphql'],
  ['sql', 'nosql'], ['mysql', 'postgres'], ['npm', 'pnpm'], ['npm', 'yarn'],
  ['tabs', 'spaces'], ['var', 'let'], ['var', 'const'], ['promise', 'callback'],
  ['callback', 'async-await'], ['monolith', 'microservices'], ['client-side', 'server-side'],
  ['eager', 'lazy'], ['immutable', 'mutable'],
];

export class BrainContradictions {
  private readonly brain: GlobalBrain;

  constructor(brain?: GlobalBrain) {
    this.brain = brain ?? getGlobalBrain();
  }

  /** Scan one project's memories and emit a report. */
  async scan(
    project: string,
    opts: { threshold?: number; includeArchetype?: boolean } = {},
  ): Promise<ContradictionReport> {
    const startedAt = Date.now();
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    await this.brain.init();
    const memories = this.brain.recall({ projectId: this.resolveProjectId(project), limit: 2000 });
    const make = (contradictions: Contradiction[]): ContradictionReport => ({
      scannedAt: new Date(),
      totalMemories: memories.length,
      contradictions,
      durationMs: Date.now() - startedAt,
    });
    if (memories.length < 2) {
      const empty = make([]);
      await this.appendHistory(project, empty);
      return empty;
    }
    const suppressed = await this.loadSuppressions(project);
    const pairs = await this.findSimilarPairs(memories, threshold);
    const contradictions: Contradiction[] = [];
    for (const { a, b, similarity } of pairs) {
      if (suppressed.has(pairKeyFor(a.id, b.id))) continue;
      const detected = this.detectContradiction(a, b, similarity, opts.includeArchetype);
      if (detected) contradictions.push(detected);
    }
    contradictions.sort((x, y) => severityRank(y.severity) - severityRank(x.severity));
    const report = make(contradictions);
    await this.appendHistory(project, report);
    return report;
  }

  /** Suggest a contradiction score + evidence for a specific memory pair. */
  async suggest(memoryAId: string, memoryBId: string): Promise<{ contradictionScore: number; evidence: string }> {
    await this.brain.init();
    const [a, b] = this.brain.recallByIds([memoryAId, memoryBId]);
    if (!a || !b) return { contradictionScore: 0, evidence: 'one or both memories not found' };
    const similarity = await this.cosineFor(a, b);
    const evidence = collectEvidence(a.content, b.content);
    const score = Math.min(1, Math.max(0, similarity) * 0.6 + (evidence.polarity ? 0.5 : 0) + (evidence.numerical ? 0.3 : 0));
    return { contradictionScore: +score.toFixed(3), evidence: renderEvidenceText(evidence, similarity) };
  }

  /** Resolve a contradiction by user choice. Persists the suppression so it does not re-surface. */
  async resolve(contradictionId: string, choice: ResolutionChoice): Promise<{ success: boolean; action: string }> {
    const hit = await this.findContradictionById(contradictionId);
    if (!hit) return { success: false, action: 'contradiction not found' };
    const { project, contradiction } = hit;
    const pairKey = pairKeyFor(contradiction.memoryA.id, contradiction.memoryB.id);
    const file = projectFilePath(project);
    const data = readPersist(file) ?? { schemaVersion: 1 as const, project, reports: [], suppressions: [] };
    data.suppressions = data.suppressions.filter(s => s.pairKey !== pairKey);
    data.suppressions.push({ pairKey, resolvedAt: Date.now(), choice });
    writePersist(file, data);
    return { success: true, action: describeAction(choice, contradiction) };
  }

  /** Return the most recent scan reports for a project. */
  async history(project: string, limit = 10): Promise<ContradictionReport[]> {
    const data = readPersist(projectFilePath(project));
    if (!data) return [];
    return data.reports.slice(-limit).reverse().map(r => ({
      scannedAt: new Date(r.scannedAt),
      totalMemories: r.totalMemories,
      durationMs: r.durationMs,
      contradictions: r.contradictions.map(deserializeContradiction),
    }));
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private resolveProjectId(project: string): string {
    // Accept either a raw project id (hex16), a project name, or an absolute path.
    if (/^[0-9a-f]{16}$/.test(project)) return project;
    const stats = (this.brain as unknown as { projects?: Map<string, { rootDir: string; name: string }> }).projects;
    if (stats) {
      for (const p of stats.values()) {
        if (p.name === project || p.rootDir === project) return GlobalBrain.projectIdFor(p.rootDir);
      }
    }
    return GlobalBrain.projectIdFor(project);
  }

  private async findSimilarPairs(
    memories: GlobalEntry[], threshold: number,
  ): Promise<Array<{ a: GlobalEntry; b: GlobalEntry; similarity: number }>> {
    const out: Array<{ a: GlobalEntry; b: GlobalEntry; similarity: number }> = [];
    let v2: { search: (q: string, k: number) => Promise<Array<{ id: string; score: number }>> } | null = null;
    try { v2 = (await import('./embeddings-v2.js')).getEmbeddingsV2(); } catch { v2 = null; }

    if (v2 && memories.length > 80) {
      const memById = new Map(memories.map(m => [m.id, m]));
      let inspected = 0;
      for (const m of memories) {
        if (inspected++ >= MAX_PAIRS_PER_SCAN) break;
        const hits = await v2.search(m.content, 10);
        for (const h of hits) {
          if (h.id === m.id || h.score < threshold) continue;
          const peer = memById.get(h.id);
          if (!peer || peer.id < m.id) continue;
          out.push({ a: m, b: peer, similarity: h.score });
        }
      }
      return out;
    }

    // Fallback: tokenized Jaccard signature (no Ollama pulls).
    const sigCache = new Map<string, Set<string>>();
    const sigFor = (e: GlobalEntry): Set<string> => {
      const c = sigCache.get(e.id);
      if (c) return c;
      const s = signature(e.content);
      sigCache.set(e.id, s);
      return s;
    };
    const maxPairs = Math.min(memories.length * memories.length, MAX_PAIRS_PER_SCAN);
    let count = 0;
    for (let i = 0; i < memories.length && count < maxPairs; i++) {
      const sa = sigFor(memories[i]);
      for (let j = i + 1; j < memories.length && count < maxPairs; j++) {
        count++;
        const sim = jaccard(sa, sigFor(memories[j]));
        if (sim >= threshold) out.push({ a: memories[i], b: memories[j], similarity: sim });
      }
    }
    return out;
  }

  private async cosineFor(a: GlobalEntry, b: GlobalEntry): Promise<number> {
    try {
      const emb = (await import('./embeddings.js')).getEmbeddings();
      const va = await emb.embed(a.content);
      const vb = await emb.embed(b.content);
      let dot = 0;
      const n = Math.min(va.length, vb.length);
      for (let i = 0; i < n; i++) dot += va[i] * vb[i];
      return dot;
    } catch { return jaccard(signature(a.content), signature(b.content)); }
  }

  private detectContradiction(
    a: GlobalEntry, b: GlobalEntry, similarity: number, includeArchetype?: boolean,
  ): Contradiction | null {
    const evidence = collectEvidence(a.content, b.content);
    if (!evidence.polarity && !evidence.numerical) return null;
    if (evidence.version) {
      return buildContradiction(a, b, similarity, evidence, 'low', 'mark-as-version', includeArchetype);
    }
    const arch = evidence.polarity?.archetype;
    const highArchetype = arch === 'always/never' || arch === 'must/must not';
    let severity: ContradictionSeverity = 'low';
    let suggested: ResolutionChoice = 'human-review';
    if (highArchetype) {
      severity = 'high';
      suggested = a.createdAt.getTime() > b.createdAt.getTime() ? 'keep-newer' : 'keep-higher-importance';
    } else if (evidence.polarity) {
      severity = 'medium';
      suggested = pickResolution(a, b);
    } else if (evidence.numerical) {
      suggested = pickResolution(a, b);
    }
    return buildContradiction(a, b, similarity, evidence, severity, suggested, includeArchetype);
  }

  private async loadSuppressions(project: string): Promise<Set<string>> {
    const data = readPersist(projectFilePath(project));
    if (!data) return new Set();
    return new Set(data.suppressions.map(s => s.pairKey));
  }

  private async appendHistory(project: string, report: ContradictionReport): Promise<void> {
    const file = projectFilePath(project);
    const existing = readPersist(file) ?? { schemaVersion: 1 as const, project, reports: [], suppressions: [] };
    existing.reports.push(serializeReport(report));
    if (existing.reports.length > HISTORY_LIMIT) existing.reports = existing.reports.slice(-HISTORY_LIMIT);
    writePersist(file, existing);
  }

  private async findContradictionById(
    contradictionId: string,
  ): Promise<{ project: string; contradiction: Contradiction } | null> {
    if (!fs.existsSync(CONTRADICTIONS_DIR)) return null;
    for (const f of fs.readdirSync(CONTRADICTIONS_DIR).filter(x => x.endsWith('.json'))) {
      const data = readPersist(path.join(CONTRADICTIONS_DIR, f));
      if (!data) continue;
      for (const r of data.reports) {
        const hit = r.contradictions.find(c => c.id === contradictionId);
        if (!hit) continue;
        return { project: data.project, contradiction: deserializeContradiction(hit) };
      }
    }
    return null;
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

interface Evidence {
  polarity?: { left: string; right: string; archetype: string };
  numerical?: { aValue: number; bValue: number; unit?: string };
  version?: { aTag: string; bTag: string };
  sharedKeywords: string[];
}

function collectEvidence(textA: string, textB: string): Evidence {
  const a = textA.toLowerCase();
  const b = textB.toLowerCase();
  const evidence: Evidence = { sharedKeywords: sharedKeywords(a, b) };
  for (const [left, right] of POLARITY_PAIRS) {
    const al = containsWord(a, left), ar = containsWord(a, right);
    const bl = containsWord(b, left), br = containsWord(b, right);
    if ((al && br && !bl) || (ar && bl && !al)) {
      evidence.polarity = { left, right, archetype: `${left}/${right}` };
      break;
    }
  }
  const numA = extractFirstNumber(textA), numB = extractFirstNumber(textB);
  if (numA && numB && numA.unit === numB.unit && numA.value !== numB.value) {
    evidence.numerical = { aValue: numA.value, bValue: numB.value, unit: numA.unit };
  }
  const vA = /\bv\s?(\d+)\b/.exec(a), vB = /\bv\s?(\d+)\b/.exec(b);
  if (vA && vB && vA[1] !== vB[1]) evidence.version = { aTag: `v${vA[1]}`, bTag: `v${vB[1]}` };
  return evidence;
}

function renderEvidenceText(ev: Evidence, similarity: number): string {
  const parts: string[] = [`similarity=${similarity.toFixed(2)}`];
  if (ev.polarity) parts.push(`polarity:${ev.polarity.archetype}`);
  if (ev.numerical) parts.push(`numerical:${ev.numerical.aValue}${ev.numerical.unit ?? ''} vs ${ev.numerical.bValue}${ev.numerical.unit ?? ''}`);
  if (ev.version) parts.push(`version:${ev.version.aTag}/${ev.version.bTag}`);
  if (ev.sharedKeywords.length) parts.push(`shared:[${ev.sharedKeywords.slice(0, 4).join(',')}]`);
  return parts.join(' · ');
}

function buildContradiction(
  a: GlobalEntry, b: GlobalEntry, similarity: number, evidence: Evidence,
  severity: ContradictionSeverity, suggested: ResolutionChoice, includeArchetype?: boolean,
): Contradiction {
  return {
    id: `cd-${shortHash(a.id + '|' + b.id)}`,
    severity,
    similarity: +similarity.toFixed(3),
    contradictionEvidence: renderEvidenceText(evidence, similarity),
    suggestedResolution: suggested,
    detectedAt: new Date(),
    archetype: includeArchetype ? evidence.polarity?.archetype : undefined,
    memoryA: refOf(a),
    memoryB: refOf(b),
  };
}

function pickResolution(a: GlobalEntry, b: GlobalEntry): ResolutionChoice {
  if (Math.abs(a.importance - b.importance) > 0.2) return 'keep-higher-importance';
  if (Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) > 24 * 60 * 60 * 1000) return 'keep-newer';
  return 'merge';
}

function describeAction(choice: ResolutionChoice, c: Contradiction): string {
  if (choice === 'keep-newer') {
    const keep = c.memoryA.createdAt.getTime() > c.memoryB.createdAt.getTime() ? c.memoryA : c.memoryB;
    return `marked suppression; kept newer memory ${keep.id}`;
  }
  if (choice === 'keep-higher-importance') {
    const keep = c.memoryA.importance >= c.memoryB.importance ? c.memoryA : c.memoryB;
    return `marked suppression; kept higher-importance memory ${keep.id}`;
  }
  if (choice === 'merge') return `marked suppression; merge ${c.memoryA.id} and ${c.memoryB.id} manually`;
  if (choice === 'mark-as-version') return `marked suppression as version pair (${c.memoryA.id} ↔ ${c.memoryB.id})`;
  if (choice === 'human-review') return `escalated for human review (${c.id})`;
  return 'no-op';
}

function refOf(e: GlobalEntry): ContradictionMemoryRef {
  return { id: e.id, content: e.content, importance: e.importance, createdAt: e.createdAt };
}

function serializeReport(r: ContradictionReport): SerializedReport {
  return {
    scannedAt: r.scannedAt.getTime(),
    totalMemories: r.totalMemories,
    durationMs: r.durationMs,
    contradictions: r.contradictions.map(c => ({
      ...c,
      detectedAt: c.detectedAt.getTime(),
      memoryA: { ...c.memoryA, createdAt: c.memoryA.createdAt.getTime() },
      memoryB: { ...c.memoryB, createdAt: c.memoryB.createdAt.getTime() },
    })),
  };
}

function deserializeContradiction(c: SerializedReport['contradictions'][number]): Contradiction {
  return {
    ...c,
    detectedAt: new Date(c.detectedAt),
    memoryA: { ...c.memoryA, createdAt: new Date(c.memoryA.createdAt) },
    memoryB: { ...c.memoryB, createdAt: new Date(c.memoryB.createdAt) },
  };
}

function projectFilePath(project: string): string {
  fs.mkdirSync(CONTRADICTIONS_DIR, { recursive: true });
  const safe = project.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'default';
  return path.join(CONTRADICTIONS_DIR, `${safe}.json`);
}

function readPersist(file: string): PersistShape | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PersistShape;
    if (!Array.isArray(parsed.reports)) parsed.reports = [];
    if (!Array.isArray(parsed.suppressions)) parsed.suppressions = [];
    return parsed;
  } catch { return null; }
}

function writePersist(file: string, data: PersistShape): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch { /* non-fatal */ }
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return re.test(haystack);
}

function extractFirstNumber(text: string): { value: number; unit?: string } | null {
  const re = /(-?\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|min|minutes?|h|hours?|kb|mb|gb|%|px|em|rem|x)?/i;
  const m = re.exec(text);
  if (!m) return null;
  const value = parseFloat(m[1]);
  return Number.isFinite(value) ? { value, unit: m[2]?.toLowerCase() } : null;
}

function signature(text: string): Set<string> {
  const norm = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const out = new Set<string>();
  for (const tok of norm.split(/\s+/)) if (tok.length >= 3) out.add(tok);
  for (let i = 0; i <= norm.length - 3; i++) {
    const tri = norm.slice(i, i + 3);
    if (/\S/.test(tri)) out.add('#' + tri);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of smaller) if (larger.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function sharedKeywords(a: string, b: string): string[] {
  const tokA = new Set(a.split(/[^a-z0-9]+/).filter(t => t.length > 3));
  const out: string[] = [];
  for (const t of b.split(/[^a-z0-9]+/)) if (t.length > 3 && tokA.has(t)) out.push(t);
  return out.slice(0, 8);
}

function severityRank(s: ContradictionSeverity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function shortHash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

let _instance: BrainContradictions | null = null;
export function getBrainContradictions(): BrainContradictions {
  if (!_instance) _instance = new BrainContradictions();
  return _instance;
}
export function resetBrainContradictionsForTests(): void { _instance = null; }
