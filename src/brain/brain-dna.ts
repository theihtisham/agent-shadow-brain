// src/brain/brain-dna.ts — Brain DNA (viral feature)
// v6.0.2
//
// Spotify-Wrapped-style shareable card for a brain's "personality". Reads the
// Global Brain (and the Replay log when present) to compute archetypes + a
// one-page SVG card optimized for Instagram / Twitter / LinkedIn sharing.
//
// Pure-SVG, zero new npm deps. Graceful when the brain has zero events.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrainDnaStats {
  topEntities: string[];
  dominantPatterns: string[];
  agentContributions: Array<{ agent: string; count: number }>;
  totalMemories: number;
  totalEntities: number;
  ageDays: number;
  topLanguages: string[];
  hallucinationsCaught: number;
  archetype: ArchetypeName;
  archetypeTagline: string;
  cacheHitRate?: number;
  decisionsRecorded: number;
  collisionsDetected: number;
}

export type ArchetypeName =
  | 'The Debugger'
  | 'The Architect'
  | 'The Speedster'
  | 'The Scholar'
  | 'The Cartographer'
  | 'The Diplomat'
  | 'The Sentinel'
  | 'The Wanderer';

export interface ArchetypeDef {
  name: ArchetypeName;
  tagline: string;
  accent: string;
  glyph: string;
}

const ARCHETYPES: ArchetypeDef[] = [
  { name: 'The Debugger',     tagline: 'Hunts root causes through collision chains.', accent: '#ff6b8a', glyph: 'DBG' },
  { name: 'The Architect',    tagline: 'Builds decisions into living blueprints.',    accent: '#a78bfa', glyph: 'ARC' },
  { name: 'The Speedster',    tagline: 'Sub-millisecond recall, every single call.',  accent: '#00ffd5', glyph: 'SPD' },
  { name: 'The Scholar',      tagline: 'Reads more than it writes. Knows why.',       accent: '#fbbf24', glyph: 'SCH' },
  { name: 'The Cartographer', tagline: 'Maps every dependency, every drift.',         accent: '#34d399', glyph: 'CTG' },
  { name: 'The Diplomat',     tagline: 'Negotiates handoffs between agents.',         accent: '#60a5fa', glyph: 'DIP' },
  { name: 'The Sentinel',     tagline: 'Quarantines hallucinations before they ship.', accent: '#f87171', glyph: 'SEN' },
  { name: 'The Wanderer',     tagline: 'Young brain, vast horizons, no fixed star.',  accent: '#7dd3fc', glyph: 'WND' },
];

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainDna {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  /** Generate a DNA card for a project. Returns SVG string + computed stats. */
  generate(project: string, opts: { style?: 'card' | 'poster' | 'banner' } = {}): { svg: string; stats: BrainDnaStats } {
    const stats = this.computeStats(project);
    const style = opts.style ?? 'card';
    const svg = style === 'banner'
      ? this.renderBanner(project, stats)
      : style === 'poster'
        ? this.renderPoster(project, stats)
        : this.renderCard(project, stats);
    return { svg, stats };
  }

  /** Side-by-side comparison of two projects. */
  compareCards(projectA: string, projectB: string): { svg: string } {
    const a = this.computeStats(projectA);
    const b = this.computeStats(projectB);
    const left = this.renderCard(projectA, a, { half: 'left' });
    const right = this.renderCard(projectB, b, { half: 'right' });
    return { svg: this.composeSideBySide(projectA, a, projectB, b, left, right) };
  }

  /** Names of all defined archetypes. */
  topArchetypes(): string[] { return ARCHETYPES.map(a => a.name); }

  /** Compute the raw stats (no rendering). Public for tooling/tests. */
  computeStats(project: string): BrainDnaStats {
    this.safeInit();
    const projectId = this.resolveProjectId(project);
    const entries = this.brain.recall({ projectId, limit: 5000 });

    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    const entitySet = new Set<string>();
    const agentCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    let firstSeen = Number.POSITIVE_INFINITY;
    let lastSeen = 0;

    for (const e of entries) {
      const t = e.createdAt instanceof Date ? e.createdAt.getTime() : Number(e.createdAt);
      if (t < firstSeen) firstSeen = t;
      if (t > lastSeen) lastSeen = t;
      agentCounts.set(e.agentTool, (agentCounts.get(e.agentTool) ?? 0) + 1);
      categoryCounts.set(e.category, (categoryCounts.get(e.category) ?? 0) + 1);
      entitySet.add(e.id);
      const lang = (e.metadata?.language as string | undefined) ?? (e.metadata?.lang as string | undefined);
      if (lang) languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
    }

    for (const ev of events) {
      const key = (ev.payload as { id?: string; entity?: string } | null)?.entity
        ?? (ev.payload as { id?: string } | null)?.id;
      if (key) entitySet.add(key);
      if (ev.agent) agentCounts.set(ev.agent, (agentCounts.get(ev.agent) ?? 0) + 1);
      if (ev.ts < firstSeen) firstSeen = ev.ts;
      if (ev.ts > lastSeen) lastSeen = ev.ts;
    }

    const hasData = entries.length > 0 || events.length > 0;
    const ageDays = hasData && isFinite(firstSeen)
      ? Math.max(0, (lastSeen - firstSeen) / (24 * 60 * 60 * 1000))
      : 0;

    const collisions = events.filter(e => e.type.includes('collision')).length;
    const decisions = entries.filter(e => /decision|adr|architecture/i.test(e.category)).length
      + events.filter(e => e.type.includes('decision') || e.type.includes('adr')).length;
    const hallucinations = events.filter(e => e.type.includes('hallucination') || e.type.includes('quarantine')).length;
    const totalMemories = entries.length
      + events.filter(e => e.type === 'memory.write' || e.type === 'brain.remember').length;
    const cacheHits = events.filter(e => e.type === 'cache.hit').length;
    const cacheMisses = events.filter(e => e.type === 'cache.miss').length;
    const cacheTotal = cacheHits + cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? cacheHits / cacheTotal : undefined;

    const archetype = this.pickArchetype({
      collisions, decisions, cacheHitRate, hallucinations,
      totalMemories, ageDays,
      agentVariety: agentCounts.size,
      eventCount: events.length,
    });
    const arc = ARCHETYPES.find(a => a.name === archetype)!;

    return {
      topEntities: Array.from(entitySet).slice(0, 5),
      dominantPatterns: topN(categoryCounts, 5),
      agentContributions: Array.from(agentCounts.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([agent, count]) => ({ agent, count })),
      totalMemories,
      totalEntities: entitySet.size,
      ageDays: Math.round(ageDays * 10) / 10,
      topLanguages: topN(languageCounts, 3),
      hallucinationsCaught: hallucinations,
      archetype,
      archetypeTagline: arc.tagline,
      cacheHitRate,
      decisionsRecorded: decisions,
      collisionsDetected: collisions,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private safeInit(): void {
    // Brain may be uninitialized; calling recall pre-init returns []. We avoid
    // forcing init() because callers in test contexts may construct mocks.
    try { void this.brain.getStats(); } catch { /* swallow */ }
  }

  private resolveProjectId(project: string): string {
    try { return GlobalBrain.projectIdFor(project); } catch { return ''; }
  }

  private pickArchetype(s: {
    collisions: number; decisions: number; cacheHitRate?: number; hallucinations: number;
    totalMemories: number; ageDays: number; agentVariety: number; eventCount: number;
  }): ArchetypeName {
    if (s.eventCount === 0 && s.totalMemories === 0) return 'The Wanderer';
    if (s.collisions >= 5 && s.collisions > s.decisions) return 'The Debugger';
    if (s.decisions >= 5) return 'The Architect';
    if ((s.cacheHitRate ?? 0) >= 0.8) return 'The Speedster';
    if (s.hallucinations >= 3) return 'The Sentinel';
    if (s.agentVariety >= 3) return 'The Diplomat';
    if (s.totalMemories >= 200) return 'The Scholar';
    if (s.ageDays >= 30) return 'The Cartographer';
    return 'The Wanderer';
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private renderCard(project: string, stats: BrainDnaStats, opts: { half?: 'left' | 'right' } = {}): string {
    const W = 1080, H = 1080, P = 64;
    const arc = ARCHETYPES.find(a => a.name === stats.archetype)!;
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';

    const metrics = this.metricGrid(stats);

    const gridStartY = 540;
    const grid: string[] = [];
    const cols = 3;
    const cellW = (W - P * 2) / cols;
    const cellH = 130;
    metrics.forEach((m, i) => {
      const x = P + (i % cols) * cellW;
      const y = gridStartY + Math.floor(i / cols) * cellH;
      grid.push(`<g transform="translate(${x},${y})">
    <text x="0" y="22" fill="#7dd3fc" font-size="13" font-family="ui-sans-serif,system-ui" opacity="0.75">${esc(m.label)}</text>
    <text x="0" y="64" fill="#e2f5ff" font-size="34" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-weight="700">${esc(m.value)}</text>
    <text x="0" y="86" fill="#7dd3fc" font-size="11" font-family="ui-monospace,monospace" opacity="0.55">${esc(m.sub)}</text>
  </g>`);
    });

    const halfTag = opts.half ? ` data-half="${opts.half}"` : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"${halfTag}>
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    <linearGradient id="card-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#061224"/>
      <stop offset="0.5" stop-color="#0a1628"/>
      <stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.32" r="0.55">
      <stop offset="0" stop-color="${arc.accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${arc.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${arc.accent}"/>
      <stop offset="1" stop-color="#00ffd5"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#card-bg)"/>
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  <text x="${P}" y="96" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="3">BRAIN DNA · v6.0.2</text>
  <text x="${P}" y="140" fill="#e2f5ff" font-size="38" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <text x="${P}" y="170" fill="#7dd3fc" font-size="16" font-family="ui-monospace,monospace" opacity="0.7">${stats.ageDays.toFixed(1)} days alive</text>

  <g transform="translate(${P},${260})">
    <text x="0" y="0" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" opacity="0.75" letter-spacing="2">PERSONALITY ARCHETYPE</text>
    <text x="0" y="80" fill="url(#hero)" font-size="84" font-family="ui-sans-serif,system-ui" font-weight="800">${esc(stats.archetype)}</text>
    <text x="0" y="120" fill="#cfe9ff" font-size="20" font-family="ui-sans-serif,system-ui" opacity="0.85">${esc(stats.archetypeTagline)}</text>
    <rect x="0" y="150" width="120" height="3" fill="${arc.accent}"/>
  </g>

  ${grid.join('\n  ')}

  <text x="${P}" y="${H - 76}" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" opacity="0.8">Powered by @shadow-brain</text>
  <text x="${P}" y="${H - 52}" fill="#cfe9ff" font-size="14" font-family="ui-monospace,monospace">npm i -g @theihtisham/agent-shadow-brain</text>
  <text x="${W - P}" y="${H - 52}" fill="${arc.accent}" font-size="16" font-family="ui-monospace,monospace" text-anchor="end" font-weight="700">${arc.glyph}</text>
</svg>`;
  }

  private renderBanner(project: string, stats: BrainDnaStats): string {
    const W = 1500, H = 500;
    const arc = ARCHETYPES.find(a => a.name === stats.archetype)!;
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    <linearGradient id="b-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#061224"/><stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <linearGradient id="b-hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${arc.accent}"/><stop offset="1" stop-color="#00ffd5"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#b-bg)"/>
  <text x="48" y="80" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="3">BRAIN DNA</text>
  <text x="48" y="160" fill="#e2f5ff" font-size="48" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <text x="48" y="280" fill="url(#b-hero)" font-size="96" font-family="ui-sans-serif,system-ui" font-weight="800">${esc(stats.archetype)}</text>
  <text x="48" y="320" fill="#cfe9ff" font-size="20" font-family="ui-sans-serif,system-ui" opacity="0.85">${esc(stats.archetypeTagline)}</text>
  <text x="48" y="${H - 40}" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace">npm i -g @theihtisham/agent-shadow-brain</text>
  <text x="${W - 48}" y="${H - 40}" fill="${arc.accent}" font-size="18" font-family="ui-monospace,monospace" text-anchor="end" font-weight="700">${stats.totalMemories} memories · ${stats.totalEntities} entities · ${stats.ageDays}d</text>
</svg>`;
  }

  private renderPoster(project: string, stats: BrainDnaStats): string {
    // Poster = vertical 1080x1920 (Story-shaped)
    const W = 1080, H = 1920, P = 72;
    const arc = ARCHETYPES.find(a => a.name === stats.archetype)!;
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    const metrics = this.metricGrid(stats);
    const items = metrics.map((m, i) => `<g transform="translate(${P},${720 + i * 130})">
    <text x="0" y="0" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" opacity="0.7">${esc(m.label)}</text>
    <text x="0" y="48" fill="#e2f5ff" font-size="40" font-family="ui-monospace,monospace" font-weight="700">${esc(m.value)}</text>
    <text x="0" y="74" fill="#7dd3fc" font-size="12" font-family="ui-monospace,monospace" opacity="0.55">${esc(m.sub)}</text>
  </g>`).join('\n  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    <linearGradient id="p-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#061224"/><stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <linearGradient id="p-hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${arc.accent}"/><stop offset="1" stop-color="#00ffd5"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#p-bg)"/>
  <text x="${P}" y="160" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">BRAIN DNA · v6.0.2</text>
  <text x="${P}" y="230" fill="#e2f5ff" font-size="56" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <text x="${P}" y="460" fill="url(#p-hero)" font-size="110" font-family="ui-sans-serif,system-ui" font-weight="800">${esc(stats.archetype)}</text>
  <text x="${P}" y="500" fill="#cfe9ff" font-size="22" font-family="ui-sans-serif,system-ui" opacity="0.85">${esc(stats.archetypeTagline)}</text>
  ${items}
  <text x="${P}" y="${H - 80}" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace">npm i -g @theihtisham/agent-shadow-brain</text>
</svg>`;
  }

  private composeSideBySide(
    pA: string, sA: BrainDnaStats,
    pB: string, sB: BrainDnaStats,
    _leftSvg: string, _rightSvg: string,
  ): string {
    // Compose a fresh side-by-side instead of nesting two large SVGs.
    const W = 2200, H = 1080, gap = 40;
    const inner = (this.renderCard(pA, sA, { half: 'left' }))
      .replace(/^<svg[^>]+>/, '').replace(/<\/svg>\s*$/, '');
    const inner2 = (this.renderCard(pB, sB, { half: 'right' }))
      .replace(/^<svg[^>]+>/, '').replace(/<\/svg>\s*$/, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#020812"/>
  <g transform="translate(0,0)">${inner}</g>
  <g transform="translate(${1080 + gap},0)">${inner2}</g>
  <line x1="${1080 + gap / 2}" y1="40" x2="${1080 + gap / 2}" y2="${H - 40}" stroke="#1a3a5a" stroke-width="1"/>
</svg>`;
  }

  private metricGrid(stats: BrainDnaStats): Array<{ label: string; value: string; sub: string }> {
    const topAgent = stats.agentContributions[0];
    const topLang = stats.topLanguages[0] ?? '—';
    return [
      { label: 'MEMORIES',      value: fmt(stats.totalMemories),       sub: 'recorded thoughts' },
      { label: 'ENTITIES',      value: fmt(stats.totalEntities),       sub: 'tracked symbols' },
      { label: 'DAYS ALIVE',    value: stats.ageDays.toFixed(1),       sub: 'since first event' },
      { label: 'TOP LANGUAGE',  value: topLang.toUpperCase().slice(0, 12), sub: 'most-tagged' },
      { label: 'TOP AGENT',     value: (topAgent?.agent ?? 'none').slice(0, 14), sub: `${topAgent?.count ?? 0} contributions` },
      { label: 'HALLUCINATIONS', value: fmt(stats.hallucinationsCaught), sub: 'caught + quarantined' },
    ];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function topN(m: Map<string, number>, n: number): string[] {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// PNG rasterization: only enable if `node-canvas` is present at runtime. Guarded
// behind a try-import-shaped helper. SVG is always produced.
export async function rasterizeToPng(_svg: string): Promise<Buffer | null> {
  // TODO: detect node-canvas at runtime via createRequire and rasterize.
  // Currently returns null — callers should treat PNG as opt-in.
  void _svg;
  void os;
  void fs;
  return null;
}

let _instance: BrainDna | null = null;
export function getBrainDna(): BrainDna {
  if (!_instance) _instance = new BrainDna();
  return _instance;
}
export function resetBrainDnaForTests(): void { _instance = null; }
