// src/brain/brain-doppelganger.ts — Find similar developers/projects (viral)
// v6.0.2
//
// "Your codebase has a twin." Compare one project's brain to other brains
// (local replay logs + optional Brain Exchange packs) using a stat-vector
// cosine similarity built on BrainDnaStats. Emits a blurb + Tinder-style
// 1200x630 compatibility card as SVG.
//
// Pure stdlib + dynamic imports only. Defensive imports for brain-exchange.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrainDna, BrainDnaStats, getBrainDna, ArchetypeName } from './brain-dna.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type PoolKind = 'local' | 'exchange' | 'all';

export interface DoppelgangerMatch {
  otherProject: string;
  similarity: number;          // 0..1
  sharedArchetype: boolean;
  sharedEntities: string[];
  divergentEntities: string[];
  compatibilityScore: number;  // 0..1
  blurb: string;
  svg: string;
}

interface PoolEntry {
  project: string;
  stats: BrainDnaStats;
  source: 'local' | 'exchange';
}

const REPLAY_DIR = path.join(os.homedir(), '.shadow-brain', 'replay');

// Closed list of archetypes for one-hot. Keep in sync with brain-dna.ts.
const ARCHETYPE_LIST: ArchetypeName[] = [
  'The Debugger', 'The Architect', 'The Speedster', 'The Scholar',
  'The Cartographer', 'The Diplomat', 'The Sentinel', 'The Wanderer',
];

// Closed list of common languages for one-hot. Unknown languages collapse to "other".
const LANGUAGE_LIST = [
  'typescript', 'javascript', 'python', 'rust', 'go', 'java',
  'csharp', 'cpp', 'ruby', 'php', 'swift', 'kotlin', 'shell', 'sql',
];

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainDoppelganger {
  private dna: BrainDna;

  constructor(dna?: BrainDna) {
    this.dna = dna ?? getBrainDna();
  }

  /** Find similar brains across the chosen pool. */
  async findMatches(
    project: string,
    opts: { pool?: PoolKind; topK?: number; minSimilarity?: number } = {},
  ): Promise<DoppelgangerMatch[]> {
    const pool = opts.pool ?? 'all';
    const topK = opts.topK ?? 5;
    const minSimilarity = opts.minSimilarity ?? 0.4;

    const myStats = this.dna.computeStats(project);
    const candidates = await this.collectPool(pool, project);

    if (candidates.length === 0) {
      return [{
        otherProject: '—',
        similarity: 0,
        sharedArchetype: false,
        sharedEntities: [],
        divergentEntities: [],
        compatibilityScore: 0,
        blurb: 'No other brains found in local pool — try `brain-exchange import` first.',
        svg: emptySvg(project),
      }];
    }

    const myVec = statsVector(myStats);
    const scored = candidates.map(c => {
      const otherVec = statsVector(c.stats);
      const sim = cosine(myVec, otherVec);
      const sharedArchetype = c.stats.archetype === myStats.archetype;
      const shared = intersect(myStats.topEntities, c.stats.topEntities);
      const divergent = symDiff(myStats.topEntities, c.stats.topEntities).slice(0, 6);
      const compat = compatibility(sim, sharedArchetype, shared.length, c.stats, myStats);
      return { entry: c, sim, sharedArchetype, shared, divergent, compat };
    });

    const filtered = scored.filter(s => s.sim >= minSimilarity);
    filtered.sort((a, b) => b.sim - a.sim);
    const picked = filtered.slice(0, topK);

    if (picked.length === 0) {
      return [{
        otherProject: '—',
        similarity: 0,
        sharedArchetype: false,
        sharedEntities: [],
        divergentEntities: [],
        compatibilityScore: 0,
        blurb: `Compared ${candidates.length} brains, none above similarity threshold ${minSimilarity}.`,
        svg: emptySvg(project),
      }];
    }

    const out: DoppelgangerMatch[] = [];
    for (const s of picked) {
      const blurb = renderBlurb(project, s.entry.project, s.sim, s.sharedArchetype, s.shared, myStats, s.entry.stats);
      const card = renderCompatibilityCard(project, myStats, s.entry.project, s.entry.stats, s.sim, s.shared, s.divergent);
      out.push({
        otherProject: s.entry.project,
        similarity: round3(s.sim),
        sharedArchetype: s.sharedArchetype,
        sharedEntities: s.shared,
        divergentEntities: s.divergent,
        compatibilityScore: round3(s.compat),
        blurb,
        svg: card,
      });
    }
    return out;
  }

  /** Render a 1200x630 horizontal compatibility card for two projects. */
  async compatibilityCard(myProject: string, otherProject: string): Promise<{ svg: string }> {
    const a = this.dna.computeStats(myProject);
    const b = this.dna.computeStats(otherProject);
    const myVec = statsVector(a);
    const otherVec = statsVector(b);
    const sim = cosine(myVec, otherVec);
    const shared = intersect(a.topEntities, b.topEntities);
    const divergent = symDiff(a.topEntities, b.topEntities).slice(0, 6);
    return { svg: renderCompatibilityCard(myProject, a, otherProject, b, sim, shared, divergent) };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async collectPool(pool: PoolKind, selfProject: string): Promise<PoolEntry[]> {
    const out: PoolEntry[] = [];
    const selfBasename = path.basename(path.resolve(selfProject));

    if (pool === 'local' || pool === 'all') {
      out.push(...this.collectLocal(selfProject, selfBasename));
    }
    if (pool === 'exchange' || pool === 'all') {
      out.push(...await this.collectExchange());
    }
    return out;
  }

  private collectLocal(selfProject: string, selfBasename: string): PoolEntry[] {
    const out: PoolEntry[] = [];
    if (!fs.existsSync(REPLAY_DIR)) return out;

    let files: string[] = [];
    try { files = fs.readdirSync(REPLAY_DIR); }
    catch { return out; }

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fullPath = path.join(REPLAY_DIR, f);
      const projectKey = inferProjectFromReplay(fullPath, f.replace(/\.jsonl$/, ''));
      if (!projectKey) continue;
      if (path.basename(path.resolve(projectKey)) === selfBasename) continue;
      try {
        const stats = this.dna.computeStats(projectKey);
        if (stats.totalMemories === 0 && stats.totalEntities === 0) continue;
        out.push({ project: projectKey, stats, source: 'local' });
      } catch { /* skip unreadable replay */ }
    }
    return out;
  }

  private async collectExchange(): Promise<PoolEntry[]> {
    try {
      const mod = await import('./brain-exchange.js').catch(() => null);
      const getter = (mod as { getBrainExchange?: () => { listLocal: () => Array<{ name: string; categories: string[]; tags: string[]; memoryCount: number; createdAt: Date; author: string; memories?: Array<{ content: string; category: string; importance: number }> }> } } | null)?.getBrainExchange;
      if (!getter) return [];
      const exchange = getter();
      const packs = exchange.listLocal();
      return packs.map(pkg => ({
        project: `exchange:${pkg.name}`,
        stats: statsFromExchangePack(pkg),
        source: 'exchange' as const,
      }));
    } catch {
      return [];
    }
  }
}

// ── Pool helpers ─────────────────────────────────────────────────────────────

function inferProjectFromReplay(jsonlPath: string, fallback: string): string | null {
  // Read the first valid line and extract its `project` field. Streaming-friendly:
  // we only need a tiny chunk from the head.
  try {
    const fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(8 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, n).toString('utf-8');
    const firstLine = head.split('\n').find(l => l.trim().length > 0);
    if (firstLine) {
      const ev = JSON.parse(firstLine) as { project?: string };
      if (ev.project && typeof ev.project === 'string') return ev.project;
    }
  } catch { /* fall through */ }
  return fallback;
}

function statsFromExchangePack(pkg: {
  name: string;
  categories: string[];
  tags?: string[];
  memoryCount: number;
  createdAt: Date;
  author: string;
  memories?: Array<{ content: string; category: string; importance: number }>;
}): BrainDnaStats {
  // Approximate stats from a public Brain Exchange pack. Archetype is inferred
  // by category mix (lossy but workable).
  const cats = pkg.categories.map(c => c.toLowerCase());
  let archetype: ArchetypeName = 'The Scholar';
  if (cats.some(c => /decision|adr|architecture/.test(c))) archetype = 'The Architect';
  else if (cats.some(c => /bug|fix|debug/.test(c))) archetype = 'The Debugger';
  else if (cats.some(c => /security|audit/.test(c))) archetype = 'The Sentinel';
  else if (cats.some(c => /perf|speed|cache/.test(c))) archetype = 'The Speedster';

  const ageDays = Math.max(0, (Date.now() - new Date(pkg.createdAt).getTime()) / 86_400_000);
  const topLanguages = (pkg.tags ?? [])
    .map(t => t.toLowerCase())
    .filter(t => LANGUAGE_LIST.includes(t));

  return {
    topEntities: (pkg.memories ?? []).slice(0, 5).map(m => shortLabel(m.content)),
    dominantPatterns: pkg.categories.slice(0, 5),
    agentContributions: [{ agent: pkg.author || 'unknown', count: pkg.memoryCount }],
    totalMemories: pkg.memoryCount,
    totalEntities: pkg.memoryCount,
    ageDays,
    topLanguages,
    hallucinationsCaught: 0,
    archetype,
    archetypeTagline: '',
    cacheHitRate: undefined,
    decisionsRecorded: cats.filter(c => /decision/.test(c)).length,
    collisionsDetected: 0,
  };
}

// ── Vector + similarity ──────────────────────────────────────────────────────

function statsVector(s: BrainDnaStats): number[] {
  // [archetype-onehot(8)] + [language-onehot(14 + "other")] + [agentSpread(1)] + [log(totalMemories+1)] + [log(ageDays+1)]
  const vec: number[] = [];
  for (const a of ARCHETYPE_LIST) vec.push(s.archetype === a ? 1 : 0);

  const langSet = new Set(s.topLanguages.map(l => l.toLowerCase()));
  let unknown = 0;
  for (const l of LANGUAGE_LIST) vec.push(langSet.has(l) ? 1 : 0);
  for (const l of langSet) if (!LANGUAGE_LIST.includes(l)) unknown = 1;
  vec.push(unknown);

  // Agent spread (how many distinct agents contributed): scaled 0..1
  const agentSpread = Math.min(1, s.agentContributions.length / 5);
  vec.push(agentSpread);

  // log-scaled memory volume and age
  vec.push(Math.log10(Math.max(1, s.totalMemories) + 1));
  vec.push(Math.log10(Math.max(0.1, s.ageDays) + 1));

  return l2normalize(vec);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return v.slice();
  return v.map(x => x / n);
}

function compatibility(
  sim: number,
  sharedArchetype: boolean,
  sharedEntityCount: number,
  other: BrainDnaStats,
  mine: BrainDnaStats,
): number {
  // Bonus for shared archetype, shared top entities, complementary agent variety.
  let score = sim;
  if (sharedArchetype) score += 0.08;
  score += Math.min(0.1, sharedEntityCount * 0.02);
  const ageDelta = Math.abs(Math.log10(Math.max(0.1, other.ageDays) + 1) - Math.log10(Math.max(0.1, mine.ageDays) + 1));
  score -= Math.min(0.05, ageDelta * 0.05);
  return Math.max(0, Math.min(1, score));
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b.map(s => s.toLowerCase()));
  return a.filter(s => setB.has(s.toLowerCase()));
}

function symDiff(a: string[], b: string[]): string[] {
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  const out: string[] = [];
  for (const s of a) if (!setB.has(s.toLowerCase())) out.push(s);
  for (const s of b) if (!setA.has(s.toLowerCase())) out.push(s);
  return out;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBlurb(
  myProject: string,
  otherProject: string,
  sim: number,
  sharedArchetype: boolean,
  sharedEntities: string[],
  mine: BrainDnaStats,
  other: BrainDnaStats,
): string {
  const myName = path.basename(path.resolve(myProject)) || 'your project';
  const otherName = otherProject.startsWith('exchange:')
    ? otherProject.slice('exchange:'.length)
    : path.basename(path.resolve(otherProject)) || 'unknown';
  const pct = Math.round(sim * 100);

  const archetypePhrase = sharedArchetype
    ? `both ${mine.archetype}s`
    : `a ${mine.archetype} meeting a ${other.archetype}`;

  const lang = mine.topLanguages[0] && other.topLanguages[0] && mine.topLanguages[0] === other.topLanguages[0]
    ? `strong ${mine.topLanguages[0]} fluency on both sides`
    : (mine.topLanguages[0] && other.topLanguages[0]
        ? `${mine.topLanguages[0]} on one side, ${other.topLanguages[0]} on the other`
        : 'overlapping toolchains');

  const sharedNote = sharedEntities.length > 0
    ? `shared concepts: ${sharedEntities.slice(0, 3).join(', ')}`
    : 'distinct top entities — complementary not redundant';

  const verdict = sim >= 0.75
    ? `You'd probably enjoy each other's PR style.`
    : sim >= 0.55
      ? `Worth a cross-pollination chat.`
      : `Different orbits, but a few lessons to swap.`;

  return `${myName}'s brain has ${pct}% overlap with '${otherName}' — ${archetypePhrase}, with ${lang}. ${capitalize(sharedNote)}. ${verdict}`;
}

function renderCompatibilityCard(
  pA: string,
  sA: BrainDnaStats,
  pB: string,
  sB: BrainDnaStats,
  similarity: number,
  shared: string[],
  divergent: string[],
): string {
  const W = 1200, H = 630;
  const aName = path.basename(path.resolve(pA)) || 'project-a';
  const bName = pB.startsWith('exchange:') ? pB.slice('exchange:'.length) : (path.basename(path.resolve(pB)) || 'project-b');
  const pct = Math.round(similarity * 100);

  const halfW = W / 2;
  const sharedItems = shared.slice(0, 3).map((s, i) => `<text x="${W/2}" y="${430 + i * 22}" fill="#fbbf24" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle">* ${esc(shortLabel(s))}</text>`).join('');
  const divergentItems = divergent.slice(0, 3).map((s, i) => `<text x="${W/2}" y="${510 + i * 22}" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.7">- ${esc(shortLabel(s))}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Brain Doppelganger compatibility card v6.0.2 -->
  <defs>
    <linearGradient id="dg-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#030509"/>
      <stop offset="0.5" stop-color="#0a1628"/>
      <stop offset="1" stop-color="#10152a"/>
    </linearGradient>
    <radialGradient id="dg-halo-a" cx="0.25" cy="0.4" r="0.45">
      <stop offset="0" stop-color="#18ffff" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#18ffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dg-halo-b" cx="0.75" cy="0.4" r="0.45">
      <stop offset="0" stop-color="#a855f7" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="dg-banner" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ec4899"/>
      <stop offset="1" stop-color="#18ffff"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#dg-bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dg-halo-a)"/>
  <rect width="${W}" height="${H}" fill="url(#dg-halo-b)"/>

  <!-- Header strip -->
  <text x="${W/2}" y="46" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="4">BRAIN COMPATIBILITY &middot; v6.0.2</text>

  <!-- Left half: project A -->
  <g transform="translate(40,90)">
    <text x="0" y="0" fill="#18ffff" font-size="14" font-family="ui-monospace,monospace" letter-spacing="3">YOU</text>
    <text x="0" y="40" fill="#e2f5ff" font-size="32" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(aName)}</text>
    <text x="0" y="80" fill="#18ffff" font-size="22" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(sA.archetype)}</text>
    <text x="0" y="120" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">${sA.totalMemories} memories &middot; ${sA.ageDays.toFixed(1)}d</text>
    <text x="0" y="148" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">lang: ${esc((sA.topLanguages[0] ?? 'mixed').slice(0, 14))}</text>
    <text x="0" y="176" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">agent: ${esc((sA.agentContributions[0]?.agent ?? '-').slice(0, 14))}</text>
  </g>

  <!-- Right half: project B -->
  <g transform="translate(${halfW + 40},90)">
    <text x="0" y="0" fill="#a855f7" font-size="14" font-family="ui-monospace,monospace" letter-spacing="3">TWIN</text>
    <text x="0" y="40" fill="#e2f5ff" font-size="32" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(bName)}</text>
    <text x="0" y="80" fill="#a855f7" font-size="22" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(sB.archetype)}</text>
    <text x="0" y="120" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">${sB.totalMemories} memories &middot; ${sB.ageDays.toFixed(1)}d</text>
    <text x="0" y="148" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">lang: ${esc((sB.topLanguages[0] ?? 'mixed').slice(0, 14))}</text>
    <text x="0" y="176" fill="#cfe9ff" font-size="13" font-family="ui-monospace,monospace" opacity="0.7">agent: ${esc((sB.agentContributions[0]?.agent ?? '-').slice(0, 14))}</text>
  </g>

  <!-- Center divider -->
  <line x1="${halfW}" y1="80" x2="${halfW}" y2="${H - 40}" stroke="#1a3a5a" stroke-width="1" stroke-dasharray="4,6"/>

  <!-- Center similarity banner -->
  <g transform="translate(${W/2},310)">
    <circle cx="0" cy="0" r="72" fill="#030509" stroke="url(#dg-banner)" stroke-width="3"/>
    <text x="0" y="-6" fill="url(#dg-banner)" font-size="42" font-family="ui-monospace,monospace" font-weight="800" text-anchor="middle">${pct}%</text>
    <text x="0" y="22" fill="#7dd3fc" font-size="11" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="3">MATCH</text>
  </g>

  <!-- Shared traits -->
  <text x="${W/2}" y="410" fill="#fbbf24" font-size="12" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="3">SHARED TRAITS</text>
  ${sharedItems || `<text x="${W/2}" y="430" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.5">(none in top-5)</text>`}

  <!-- Divergent traits -->
  <text x="${W/2}" y="490" fill="#7dd3fc" font-size="12" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="3" opacity="0.7">DIVERGENT</text>
  ${divergentItems || `<text x="${W/2}" y="510" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.4">(perfect overlap)</text>`}

  <text x="${W/2}" y="${H - 28}" fill="#7dd3fc" font-size="12" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.6">npm i -g @theihtisham/agent-shadow-brain &middot; brain-doppelganger</text>
</svg>`;
}

function emptySvg(project: string): string {
  const myName = path.basename(path.resolve(project)) || 'project';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><linearGradient id="empty-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#030509"/><stop offset="1" stop-color="#10152a"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#empty-bg)"/>
  <text x="600" y="280" fill="#7dd3fc" font-size="18" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="4">NO DOPPELGANGERS FOUND</text>
  <text x="600" y="320" fill="#e2f5ff" font-size="28" font-family="ui-sans-serif,system-ui" text-anchor="middle">${esc(myName)} walks alone (for now)</text>
  <text x="600" y="360" fill="#cfe9ff" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.65">Run \`brain-exchange import\` to load other brains.</text>
</svg>`;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function shortLabel(s: string): string {
  const clean = (s || '').replace(/\s+/g, ' ').trim();
  return clean.length > 36 ? clean.slice(0, 33) + '...' : (clean || 'untitled');
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: BrainDoppelganger | null = null;
export function getBrainDoppelganger(): BrainDoppelganger {
  if (!_instance) _instance = new BrainDoppelganger();
  return _instance;
}
export function resetBrainDoppelgangerForTests(): void { _instance = null; }
