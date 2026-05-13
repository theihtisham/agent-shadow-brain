// src/brain/brain-holiday-card.ts — Brain Wrapped (viral feature)
// v6.0.2
//
// Spotify-Wrapped-style year-in-review SVG. The annual viral moment for a
// brain. Reads the Replay log + Global Brain to compute a year manifest, then
// renders one of three styles: wrapped (bold), classic (editorial), minimalist
// (mono accent). Default canvas: 1080x1920 (Stories). Square 1080x1080 option.
//
// Persistence: ~/.shadow-brain/holiday-cards/<project>-<year>.svg
// Zero new npm deps. Stdlib only. Graceful when the brain has no year data.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';
import { BrainDna, getBrainDna, ArchetypeName } from './brain-dna.js';

const HOLIDAY_DIR = path.join(os.homedir(), '.shadow-brain', 'holiday-cards');

// ── Types ────────────────────────────────────────────────────────────────────

export type HolidayStyle = 'wrapped' | 'classic' | 'minimalist';

export interface HolidayManifest {
  year: number;
  totalEvents: number;
  topMonth: string;
  topAgent: string;
  topMemoryType: string;
  longestStreak: number;
  archetypeEvolution: Array<{ month: string; archetype: ArchetypeName }>;
  biggestMilestone: string;
  hours_saved_estimate: number;
  top_quote: string;
}

export interface HolidayResult {
  svg: string;
  manifest: HolidayManifest;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Style palettes — distinct per option but all share the brand neon vibe
const PALETTES: Record<HolidayStyle, { bg: string[]; accent: string; accent2: string; ink: string; muted: string }> = {
  wrapped:     { bg: ['#1a0833', '#3d1a5b', '#ff5fdc'], accent: '#fbbf24', accent2: '#00ffd5', ink: '#ffffff', muted: '#e5d8ff' },
  classic:     { bg: ['#0a1628', '#0d2540'],            accent: '#7dd3fc', accent2: '#cfe9ff', ink: '#e2f5ff', muted: '#7dd3fc' },
  minimalist:  { bg: ['#0a0a0a', '#1a1a1a'],            accent: '#00ffd5', accent2: '#00ffd5', ink: '#fafafa', muted: '#888888' },
};

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainHolidayCard {
  private brain: GlobalBrain;
  private replay: BrainReplay;
  private dna: BrainDna;

  constructor(brain?: GlobalBrain, replay?: BrainReplay, dna?: BrainDna) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
    this.dna = dna ?? getBrainDna();
    try { fs.mkdirSync(HOLIDAY_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  /** Generate a year-in-review card. Returns SVG + the underlying manifest. */
  async generate(project: string, opts: { year?: number; style?: HolidayStyle } = {}): Promise<HolidayResult> {
    const year = opts.year ?? new Date().getFullYear();
    const style = opts.style ?? 'wrapped';
    const manifest = this.computeManifest(project, year);
    const svg = manifest.totalEvents === 0
      ? this.renderEmpty(project, year, style)
      : this.render(project, manifest, style);
    this.persist(project, year, svg);
    return { svg, manifest };
  }

  /** Pure manifest (no rendering). Useful for tests/tooling. */
  computeManifest(project: string, year: number): HolidayManifest {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);

    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project, { from: start, to: end }); } catch { /* empty */ }

    const monthCounts = new Array<number>(12).fill(0);
    const agentCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const dayBuckets = new Map<string, number>();
    const monthArchetypes = new Map<number, Map<ArchetypeName, number>>();

    for (const ev of events) {
      const d = new Date(ev.ts);
      if (d.getUTCFullYear() !== year) continue;
      const m = d.getUTCMonth();
      monthCounts[m]++;
      if (ev.agent) agentCounts.set(ev.agent, (agentCounts.get(ev.agent) ?? 0) + 1);
      const mt = this.memoryTypeOf(ev);
      typeCounts.set(mt, (typeCounts.get(mt) ?? 0) + 1);
      const dayKey = new Date(ev.ts).toISOString().slice(0, 10);
      dayBuckets.set(dayKey, (dayBuckets.get(dayKey) ?? 0) + 1);

      const arc = this.archetypeFromEvent(ev);
      if (arc) {
        let inner = monthArchetypes.get(m);
        if (!inner) { inner = new Map(); monthArchetypes.set(m, inner); }
        inner.set(arc, (inner.get(arc) ?? 0) + 1);
      }
    }

    const topMonthIdx = monthCounts.indexOf(Math.max(...monthCounts));
    const topMonth = monthCounts[topMonthIdx] > 0 ? `${MONTHS[topMonthIdx]} ${year}` : '—';
    const topAgent = topKey(agentCounts) ?? '—';
    const topMemoryType = topKey(typeCounts) ?? '—';
    const longestStreak = this.computeLongestStreak(Array.from(dayBuckets.keys()));

    const archetypeEvolution: Array<{ month: string; archetype: ArchetypeName }> = [];
    let lastArc: ArchetypeName = 'The Wanderer';
    for (let i = 0; i < 12; i++) {
      const inner = monthArchetypes.get(i);
      const arc = inner ? topKey(inner) as ArchetypeName | undefined : undefined;
      if (arc) lastArc = arc;
      archetypeEvolution.push({ month: MONTHS[i], archetype: lastArc });
    }

    const biggestMilestone = this.pickBiggestMilestone(events);
    const hours_saved_estimate = Math.round(events.length * 0.05 * 10) / 10;
    const top_quote = this.pickTopQuote(project, events);

    return {
      year,
      totalEvents: events.length,
      topMonth,
      topAgent,
      topMemoryType,
      longestStreak,
      archetypeEvolution,
      biggestMilestone,
      hours_saved_estimate,
      top_quote,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private memoryTypeOf(ev: ReplayEvent): string {
    const p = ev.payload as { type?: string; entityType?: string; category?: string } | null;
    return p?.entityType ?? p?.type ?? p?.category ?? ev.type;
  }

  private archetypeFromEvent(ev: ReplayEvent): ArchetypeName | null {
    const t = ev.type;
    if (t.includes('collision')) return 'The Debugger';
    if (t.includes('decision') || t.includes('adr')) return 'The Architect';
    if (t.includes('cache.hit') || t.includes('fast')) return 'The Speedster';
    if (t.includes('hallucination') || t.includes('quarantine')) return 'The Sentinel';
    if (t.includes('handoff') || t.includes('agent.')) return 'The Diplomat';
    return null;
  }

  private computeLongestStreak(days: string[]): number {
    if (!days.length) return 0;
    const sorted = days.slice().sort();
    let longest = 1, cur = 1;
    for (let i = 1; i < sorted.length; i++) {
      const a = Date.parse(sorted[i - 1] + 'T00:00:00Z');
      const b = Date.parse(sorted[i] + 'T00:00:00Z');
      const delta = Math.round((b - a) / (24 * 60 * 60 * 1000));
      if (delta === 1) { cur++; if (cur > longest) longest = cur; }
      else cur = 1;
    }
    return longest;
  }

  private pickBiggestMilestone(events: ReplayEvent[]): string {
    if (!events.length) return 'First spark';
    const memWrites = events.filter(e => e.type === 'memory.write' || e.type === 'brain.remember').length;
    if (memWrites >= 10000) return `${fmt(memWrites)} memories recorded`;
    if (memWrites >= 1000) return `${fmt(memWrites)} memories recorded`;
    if (memWrites >= 100) return `Crossed 100 memories`;
    const decisions = events.filter(e => e.type.includes('decision') || e.type.includes('adr')).length;
    if (decisions >= 10) return `${decisions} decisions recorded`;
    return `${events.length} events captured`;
  }

  private pickTopQuote(project: string, events: ReplayEvent[]): string {
    try {
      const projectId = GlobalBrain.projectIdFor(project);
      const entries = this.brain.recall({ projectId, limit: 200 });
      let best: { score: number; text: string } | null = null;
      for (const e of entries) {
        const importance = Number(e.metadata?.importance ?? 0.5);
        const ageDays = (Date.now() - (e.createdAt instanceof Date ? e.createdAt.getTime() : Number(e.createdAt))) / (24 * 60 * 60 * 1000);
        const recencyPenalty = Math.min(1, ageDays / 365);
        const score = importance * 0.7 + recencyPenalty * 0.3;
        const text = typeof e.content === 'string' ? e.content : JSON.stringify(e.content).slice(0, 140);
        if (!best || score > best.score) best = { score, text };
      }
      if (best) return truncate(best.text.replace(/\s+/g, ' ').trim(), 110);
    } catch { /* swallow */ }
    if (events.length) {
      const lastDecision = events.reverse().find(e => e.type.includes('decision'));
      if (lastDecision) {
        const p = lastDecision.payload as { text?: string; summary?: string } | null;
        return truncate(p?.summary ?? p?.text ?? 'A quiet year of building.', 110);
      }
    }
    return 'A quiet year of building.';
  }

  private persist(project: string, year: number, svg: string): void {
    try {
      const slug = path.basename(path.resolve(project)).replace(/[^a-z0-9-_]+/gi, '_');
      fs.writeFileSync(path.join(HOLIDAY_DIR, `${slug}-${year}.svg`), svg);
    } catch { /* non-fatal */ }
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private render(project: string, m: HolidayManifest, style: HolidayStyle): string {
    const W = 1080, H = 1920;
    const palette = PALETTES[style];
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';

    const heatmap = this.renderHeatmap(project, m.year, palette);
    const archetypes = this.renderArchetypeTimeline(m.archetypeEvolution, palette);
    const pie = this.renderTypePie(project, m.year, palette);

    const grad = palette.bg.length === 3
      ? `<linearGradient id="h-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.bg[0]}"/>
      <stop offset="0.5" stop-color="${palette.bg[1]}"/>
      <stop offset="1" stop-color="${palette.bg[2]}"/>
    </linearGradient>`
      : `<linearGradient id="h-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.bg[0]}"/>
      <stop offset="1" stop-color="${palette.bg[1]}"/>
    </linearGradient>`;

    const hero = style === 'wrapped'
      ? `<text x="${W / 2}" y="510" fill="${palette.accent}" font-size="220" font-family="ui-sans-serif,system-ui" font-weight="900" text-anchor="middle">${fmt(m.totalEvents)}</text>
  <text x="${W / 2}" y="570" fill="${palette.ink}" font-size="26" font-family="ui-sans-serif,system-ui" text-anchor="middle" opacity="0.92">events shipped this year</text>`
      : style === 'classic'
        ? `<text x="${W / 2}" y="510" fill="${palette.accent}" font-size="170" font-family="ui-sans-serif,system-ui" font-weight="700" text-anchor="middle">${fmt(m.totalEvents)}</text>
  <text x="${W / 2}" y="560" fill="${palette.ink}" font-size="24" font-family="ui-sans-serif,system-ui" text-anchor="middle" opacity="0.85" letter-spacing="3">EVENTS RECORDED</text>`
        : `<text x="${W / 2}" y="510" fill="${palette.accent}" font-size="190" font-family="ui-monospace,monospace" font-weight="700" text-anchor="middle">${fmt(m.totalEvents)}</text>
  <text x="${W / 2}" y="560" fill="${palette.muted}" font-size="22" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="6">EVENTS</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    ${grad}
    <linearGradient id="h-accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.accent}"/>
      <stop offset="1" stop-color="${palette.accent2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#h-bg)"/>

  <!-- header -->
  <text x="${W / 2}" y="180" fill="${palette.muted}" font-size="18" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="6" opacity="0.85">BRAIN WRAPPED · ${m.year}</text>
  <text x="${W / 2}" y="260" fill="${palette.ink}" font-size="56" font-family="ui-sans-serif,system-ui" font-weight="700" text-anchor="middle">${esc(projName)}</text>
  <line x1="${W / 2 - 60}" y1="290" x2="${W / 2 + 60}" y2="290" stroke="url(#h-accent)" stroke-width="3"/>

  <!-- hero stat -->
  ${hero}

  <!-- top categories -->
  <g transform="translate(80,680)">
    <text x="0" y="0" fill="${palette.muted}" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">TOP CATEGORIES</text>
    ${pie}
  </g>

  <!-- heatmap -->
  <g transform="translate(80,1080)">
    <text x="0" y="0" fill="${palette.muted}" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">ACTIVITY CALENDAR</text>
    ${heatmap}
  </g>

  <!-- archetype evolution -->
  <g transform="translate(80,1400)">
    <text x="0" y="0" fill="${palette.muted}" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">ARCHETYPE EVOLUTION</text>
    ${archetypes}
  </g>

  <!-- stats stripe -->
  <g transform="translate(80,1620)">
    <text x="0" y="0" fill="${palette.muted}" font-size="13" font-family="ui-monospace,monospace" letter-spacing="3" opacity="0.7">LONGEST STREAK</text>
    <text x="0" y="36" fill="${palette.ink}" font-size="34" font-family="ui-sans-serif,system-ui" font-weight="700">${m.longestStreak} days</text>
    <text x="320" y="0" fill="${palette.muted}" font-size="13" font-family="ui-monospace,monospace" letter-spacing="3" opacity="0.7">TOP MONTH</text>
    <text x="320" y="36" fill="${palette.ink}" font-size="34" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(m.topMonth)}</text>
    <text x="620" y="0" fill="${palette.muted}" font-size="13" font-family="ui-monospace,monospace" letter-spacing="3" opacity="0.7">TOP AGENT</text>
    <text x="620" y="36" fill="${palette.ink}" font-size="28" font-family="ui-sans-serif,system-ui" font-weight="700">${esc(truncate(m.topAgent, 14))}</text>
  </g>

  <!-- most surprising memory -->
  <g transform="translate(80,1720)">
    <text x="0" y="0" fill="${palette.muted}" font-size="13" font-family="ui-monospace,monospace" letter-spacing="3" opacity="0.7">MOST SURPRISING MEMORY</text>
    <text x="0" y="36" fill="${palette.ink}" font-size="20" font-family="ui-sans-serif,system-ui" font-style="italic" opacity="0.92">“${esc(m.top_quote)}”</text>
  </g>

  <!-- footer -->
  <text x="${W / 2}" y="${H - 80}" fill="${palette.muted}" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.85">Powered by Shadow Brain · ${esc(m.biggestMilestone)} · ~${m.hours_saved_estimate}h saved</text>
  <text x="${W / 2}" y="${H - 50}" fill="${palette.accent}" font-size="15" font-family="ui-monospace,monospace" text-anchor="middle" font-weight="700">npm i -g @theihtisham/agent-shadow-brain</text>
</svg>`;
  }

  private renderHeatmap(project: string, year: number, palette: { bg: string[]; accent: string; accent2: string; ink: string; muted: string }): string {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project, { from: start, to: end }); } catch { /* empty */ }
    const counts = new Map<string, number>();
    for (const e of events) {
      const k = new Date(e.ts).toISOString().slice(0, 10);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let peak = 0; counts.forEach(v => { if (v > peak) peak = v; });
    if (peak === 0) peak = 1;

    const cell = 12, gap = 2;
    const days = 365;
    const cols = 53;
    const cells: string[] = [];
    const firstDow = new Date(Date.UTC(year, 0, 1)).getUTCDay();
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(year, 0, 1) + i * 86400000);
      const key = date.toISOString().slice(0, 10);
      const v = counts.get(key) ?? 0;
      const col = Math.floor((i + firstDow) / 7);
      const row = (i + firstDow) % 7;
      const intensity = v === 0 ? 0.06 : 0.2 + Math.min(0.75, v / peak * 0.75);
      cells.push(`<rect x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" fill="${palette.accent2}" fill-opacity="${intensity.toFixed(2)}" rx="2"/>`);
    }
    const totalW = cols * (cell + gap);
    return `<g transform="translate(0,30)"><svg width="${totalW}" height="${7 * (cell + gap)}" viewBox="0 0 ${totalW} ${7 * (cell + gap)}">${cells.join('')}</svg></g>`;
  }

  private renderArchetypeTimeline(evo: Array<{ month: string; archetype: ArchetypeName }>, palette: { bg: string[]; accent: string; accent2: string; ink: string; muted: string }): string {
    const W = 920;
    const colW = W / 12;
    const items: string[] = [];
    let prev: ArchetypeName | null = null;
    evo.forEach((e, i) => {
      const x = i * colW;
      const changed = e.archetype !== prev;
      const dot = changed ? `<circle cx="${x + colW / 2}" cy="60" r="6" fill="${palette.accent}"/>` : '';
      const label = changed ? `<text x="${x + colW / 2}" y="42" fill="${palette.ink}" font-size="11" font-family="ui-monospace,monospace" text-anchor="middle">${esc(e.archetype.replace('The ', ''))}</text>` : '';
      items.push(`<g>
      ${label}
      ${dot}
      <text x="${x + colW / 2}" y="86" fill="${palette.muted}" font-size="10" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.7">${esc(e.month)}</text>
    </g>`);
      prev = e.archetype;
    });
    return `<g transform="translate(0,30)">
    <line x1="0" y1="60" x2="${W}" y2="60" stroke="${palette.accent2}" stroke-opacity="0.4" stroke-width="1"/>
    ${items.join('\n    ')}
  </g>`;
  }

  private renderTypePie(project: string, year: number, palette: { bg: string[]; accent: string; accent2: string; ink: string; muted: string }): string {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project, { from: start, to: end }); } catch { /* empty */ }
    const counts = new Map<string, number>();
    for (const e of events) {
      const p = e.payload as { type?: string; category?: string } | null;
      const k = p?.category ?? p?.type ?? e.type;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

    const cx = 130, cy = 170, r = 110;
    const arcs: string[] = [];
    const labels: string[] = [];
    const colors = [palette.accent, palette.accent2, '#a78bfa', '#fb7185', '#34d399'];
    let acc = 0;
    sorted.forEach(([k, v], i) => {
      const frac = v / total;
      const a0 = acc * Math.PI * 2 - Math.PI / 2;
      const a1 = (acc + frac) * Math.PI * 2 - Math.PI / 2;
      acc += frac;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      arcs.push(`<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${colors[i % colors.length]}" fill-opacity="0.85"/>`);
      labels.push(`<g transform="translate(300,${40 + i * 36})">
      <rect width="20" height="20" fill="${colors[i % colors.length]}" rx="3"/>
      <text x="30" y="15" fill="${palette.ink}" font-size="16" font-family="ui-sans-serif,system-ui">${esc(truncate(k, 18))}</text>
      <text x="${W_PIE_TEXT}" y="15" fill="${palette.muted}" font-size="13" font-family="ui-monospace,monospace" text-anchor="end">${Math.round(frac * 100)}%</text>
    </g>`);
    });
    if (!sorted.length) {
      return `<g transform="translate(0,40)"><text x="0" y="80" fill="${palette.muted}" font-size="18" font-family="ui-sans-serif,system-ui" opacity="0.6">No category data this year.</text></g>`;
    }
    return `<g transform="translate(0,30)">${arcs.join('')}${labels.join('')}</g>`;
  }

  private renderEmpty(project: string, year: number, style: HolidayStyle): string {
    const W = 1080, H = 1920;
    const palette = PALETTES[style];
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    const grad = palette.bg.length === 3
      ? `<linearGradient id="he-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.bg[0]}"/><stop offset="0.5" stop-color="${palette.bg[1]}"/><stop offset="1" stop-color="${palette.bg[2]}"/></linearGradient>`
      : `<linearGradient id="he-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.bg[0]}"/><stop offset="1" stop-color="${palette.bg[1]}"/></linearGradient>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${grad}</defs>
  <rect width="${W}" height="${H}" fill="url(#he-bg)"/>
  <text x="${W / 2}" y="240" fill="${palette.muted}" font-size="18" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="6">BRAIN WRAPPED · ${year}</text>
  <text x="${W / 2}" y="320" fill="${palette.ink}" font-size="48" font-family="ui-sans-serif,system-ui" font-weight="700" text-anchor="middle">${esc(projName)}</text>
  <text x="${W / 2}" y="${H / 2 - 40}" fill="${palette.accent}" font-size="56" font-family="ui-sans-serif,system-ui" font-weight="800" text-anchor="middle">Your brain is new.</text>
  <text x="${W / 2}" y="${H / 2 + 20}" fill="${palette.ink}" font-size="24" font-family="ui-sans-serif,system-ui" text-anchor="middle" opacity="0.85">Come back in a year for your first wrap.</text>
  <text x="${W / 2}" y="${H - 80}" fill="${palette.muted}" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.7">Powered by Shadow Brain</text>
  <text x="${W / 2}" y="${H - 50}" fill="${palette.accent}" font-size="15" font-family="ui-monospace,monospace" text-anchor="middle" font-weight="700">npm i -g @theihtisham/agent-shadow-brain</text>
</svg>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const W_PIE_TEXT = 520;

function topKey<K>(m: Map<K, number>): K | undefined {
  let best: K | undefined; let bestV = -1;
  m.forEach((v, k) => { if (v > bestV) { bestV = v; best = k; } });
  return best;
}
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

let _instance: BrainHolidayCard | null = null;
export function getBrainHolidayCard(): BrainHolidayCard {
  if (!_instance) _instance = new BrainHolidayCard();
  return _instance;
}
export function resetBrainHolidayCardForTests(): void { _instance = null; }
