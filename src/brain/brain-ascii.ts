// src/brain/brain-ascii.ts — Brain ASCII (viral feature)
// v6.0.2
//
// Terminal-art renderings of brain state. Six styles: galaxy, tree, matrix,
// pixel, banner, sparkline. Plus archetype mascots and an embedded mini-figlet.
//
// Stdlib only. ANSI colors when stdout is a TTY; plain ASCII otherwise.
// Empty-state never crashes — degrades to a single dot in space.

import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';
import type { ArchetypeName } from './brain-dna.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type AsciiStyle = 'galaxy' | 'tree' | 'matrix' | 'pixel' | 'banner' | 'sparkline';

export interface AsciiOptions {
  width?: number;
  height?: number;
  style?: AsciiStyle;
}

// ── Brand palette (ANSI 24-bit, parallels brain-dna accents) ─────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[38;2;125;211;252m',     // #7dd3fc — sub/labels
  bright: '\x1b[38;2;226;245;255m',   // #e2f5ff — text
  teal: '\x1b[38;2;0;255;213m',       // #00ffd5 — accent
  violet: '\x1b[38;2;167;139;250m',   // #a78bfa
  pink: '\x1b[38;2;255;107;138m',     // #ff6b8a
  amber: '\x1b[38;2;251;191;36m',     // #fbbf24
  green: '\x1b[38;2;52;211;153m',     // #34d399
  blue: '\x1b[38;2;96;165;250m',      // #60a5fa
  red: '\x1b[38;2;248;113;113m',      // #f87171
  sky: '\x1b[38;2;125;211;252m',
};

function useColor(): boolean { return !!process.stdout && process.stdout.isTTY === true; }
function paint(s: string, c: string): string { return useColor() ? `${c}${s}${C.reset}` : s; }

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainAscii {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  /** Main entrypoint. Returns a console.log-ready string for the chosen style. */
  async render(project: string, opts: AsciiOptions = {}): Promise<string> {
    const style: AsciiStyle = opts.style ?? 'galaxy';
    const width = clamp(opts.width ?? 80, 20, 200);
    const height = clamp(opts.height ?? 24, 6, 40);
    const data = this.gather(project);

    switch (style) {
      case 'galaxy':    return this.galaxy(data, width, height);
      case 'tree':      return this.tree(data, width);
      case 'matrix':    return this.matrix(data, width, height);
      case 'pixel':     return this.pixel(data, width, height);
      case 'banner':    return this.bannerStyle(data, width);
      case 'sparkline': return this.sparklineStyle(data, width);
      default:          return this.galaxy(data, width, height);
    }
  }

  /** Single-line sparkline of daily brain activity over the last `days` days. */
  async dailySparkline(project: string, days: number = 30): Promise<string> {
    const d = this.gather(project);
    const buckets = bucketByDay(d.events, clamp(days, 1, 365));
    if (buckets.every(b => b === 0)) {
      return paint('▁'.repeat(buckets.length), C.dim) + paint('  empty brain', C.dim);
    }
    const line = renderSparkChars(buckets);
    const total = buckets.reduce((a, b) => a + b, 0);
    return paint(line, C.teal) + ' ' + paint(`${total} events · ${days}d`, C.cyan);
  }

  /** ASCII-art mascot for one of the 8 archetypes. */
  mascot(archetypeName?: string): string {
    const key = (archetypeName ?? 'The Wanderer') as ArchetypeName;
    const m = MASCOTS[key] ?? MASCOTS['The Wanderer'];
    return useColor() ? paint(m.art, m.color) + '\n' + paint(m.tagline, C.cyan) : m.art + '\n' + m.tagline;
  }

  /** figlet-style banner of an arbitrary string (A-Z, 0-9, space). */
  headerBanner(text: string): string {
    const lines = renderFiglet(text);
    if (!useColor()) return lines.join('\n');
    return lines.map(l => paint(l, C.teal)).join('\n');
  }

  // ── Data gathering ────────────────────────────────────────────────────────

  private gather(project: string): GatheredState {
    let entries: Array<{ id: string; agentTool: string; category: string; createdAt: Date; importance: number }> = [];
    let events: ReplayEvent[] = [];
    let projectId = '';
    try { projectId = GlobalBrain.projectIdFor(project); } catch { /* empty */ }
    try { void this.brain.getStats(); } catch { /* empty */ }
    try {
      entries = this.brain.recall({ projectId, limit: 5000 }).map(e => ({
        id: e.id,
        agentTool: e.agentTool,
        category: e.category,
        createdAt: e.createdAt instanceof Date ? e.createdAt : new Date(Number(e.createdAt)),
        importance: e.importance,
      }));
    } catch { /* empty */ }
    try { events = this.replay.listEvents(project); } catch { /* empty */ }
    return { project, entries, events };
  }

  // ── Style renderers ───────────────────────────────────────────────────────

  private galaxy(d: GatheredState, w: number, h: number): string {
    const stars: Array<{ x: number; y: number; w: number }> = [];
    const seed = hashString(d.project);
    const rand = mulberry32(seed);

    for (const e of d.entries) {
      const x = Math.floor(rand() * (w - 2)) + 1;
      const y = Math.floor(rand() * (h - 2)) + 1;
      stars.push({ x, y, w: e.importance });
    }
    for (const ev of d.events.slice(-300)) {
      const x = Math.floor(rand() * (w - 2)) + 1;
      const y = Math.floor(rand() * (h - 2)) + 1;
      stars.push({ x, y, w: ev.type.includes('decision') ? 0.85 : 0.4 });
    }
    if (!stars.length) return this.emptyGalaxy(w, h);

    const grid: string[][] = Array.from({ length: h }, () => Array(w).fill(' '));
    const colors: string[][] = Array.from({ length: h }, () => Array(w).fill(''));
    for (const s of stars) {
      if (s.y < 0 || s.y >= h || s.x < 0 || s.x >= w) continue;
      const c = pickStarChar(s.w);
      // brighter star takes precedence
      if (charWeight(grid[s.y][s.x]) <= charWeight(c)) {
        grid[s.y][s.x] = c;
        colors[s.y][s.x] = s.w >= 0.8 ? C.bright : s.w >= 0.5 ? C.teal : C.cyan;
      }
    }

    const lines: string[] = [];
    lines.push(paint(border('top', w), C.cyan));
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        const ch = grid[y][x];
        row += useColor() && ch !== ' ' && colors[y][x] ? `${colors[y][x]}${ch}${C.reset}` : ch;
      }
      lines.push(paint('│', C.cyan) + row.padEnd(w) + paint('│', C.cyan));
    }
    lines.push(paint(border('bot', w), C.cyan));
    lines.push(paint(` ${stars.length} stars · ${d.entries.length} entities · ${d.events.length} events`, C.cyan));
    return lines.join('\n');
  }

  private emptyGalaxy(w: number, h: number): string {
    const grid: string[][] = Array.from({ length: h }, () => Array(w).fill(' '));
    grid[Math.floor(h / 2)][Math.floor(w / 2)] = '·';
    const lines = [paint(border('top', w), C.dim)];
    for (let y = 0; y < h; y++) {
      const row = grid[y].join('');
      lines.push(paint('│', C.dim) + (y === Math.floor(h / 2) ? row.replace('·', paint('·', C.cyan)) : row) + paint('│', C.dim));
    }
    lines.push(paint(border('bot', w), C.dim));
    lines.push(paint(' empty brain galaxy · no events recorded yet', C.dim));
    return lines.join('\n');
  }

  private tree(d: GatheredState, w: number): string {
    if (!d.entries.length && !d.events.length) {
      return paint('shadow-brain/', C.teal) + '\n' + paint('└── (empty — no memories yet)', C.dim);
    }
    // Group entries by agent → category → top items
    const agents = new Map<string, Map<string, string[]>>();
    for (const e of d.entries) {
      if (!agents.has(e.agentTool)) agents.set(e.agentTool, new Map());
      const cats = agents.get(e.agentTool)!;
      if (!cats.has(e.category)) cats.set(e.category, []);
      const arr = cats.get(e.category)!;
      if (arr.length < 3) arr.push(e.id.slice(0, 8));
    }
    const sortedAgents = Array.from(agents.entries()).sort((a, b) => b[1].size - a[1].size).slice(0, 8);

    const lines: string[] = [];
    const projName = baseName(d.project);
    lines.push(paint(`${projName}/`, C.teal));
    sortedAgents.forEach(([agent, cats], ai) => {
      const isLastAgent = ai === sortedAgents.length - 1;
      const ap = isLastAgent ? '└── ' : '├── ';
      const ac = isLastAgent ? '    ' : '│   ';
      lines.push(paint(ap, C.cyan) + paint(agent, C.violet));
      const catEntries = Array.from(cats.entries()).slice(0, 5);
      catEntries.forEach(([cat, ids], ci) => {
        const isLastCat = ci === catEntries.length - 1;
        const cp = isLastCat ? '└── ' : '├── ';
        const cc = isLastCat ? '    ' : '│   ';
        lines.push(paint(ac + cp, C.cyan) + paint(cat, C.amber));
        ids.forEach((id, ii) => {
          const isLastId = ii === ids.length - 1;
          const ip = isLastId ? '└── ' : '├── ';
          lines.push(paint(ac + cc + ip, C.cyan) + paint(id, C.bright));
        });
      });
    });
    // Truncate to fit width
    return lines.map(l => truncateVisible(l, w)).join('\n');
  }

  private matrix(d: GatheredState, w: number, h: number): string {
    const types = d.events.length ? d.events.map(e => e.type) : ['memory.write', 'brain.recall', 'decision.adr'];
    if (!types.length) return paint(' '.repeat(w) + '\n empty matrix', C.dim);

    const seed = hashString(d.project + '|matrix');
    const rand = mulberry32(seed);
    const lines: string[] = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        const r = rand();
        if (r < 0.18) {
          const t = types[Math.floor(rand() * types.length)];
          const ch = t.charCodeAt((x + y) % t.length);
          const c = String.fromCharCode(33 + (ch % 93));
          const color = r < 0.04 ? C.bright : r < 0.10 ? C.teal : C.green;
          row += useColor() ? `${color}${c}${C.reset}` : c;
        } else {
          row += ' ';
        }
      }
      lines.push(row);
    }
    lines.push(paint(` matrix · ${types.length} event types streaming`, C.green));
    return lines.join('\n');
  }

  private pixel(d: GatheredState, w: number, _h: number): string {
    // Density map: 7 rows (day of week) × 24 columns (hour), scaled to width.
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const stamp = (ts: number) => {
      const dt = new Date(ts);
      grid[dt.getDay()][dt.getHours()]++;
    };
    for (const e of d.entries) stamp(e.createdAt.getTime());
    for (const ev of d.events) stamp(ev.ts);

    const max = Math.max(1, ...grid.flat());
    const blocks = [' ', '·', '░', '▒', '▓', '█'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cellW = Math.max(1, Math.floor((w - 5) / 24));

    const lines: string[] = [];
    lines.push(paint('     ' + Array.from({ length: 24 }, (_, i) => String(i).padStart(cellW, ' ').slice(-cellW)).join(''), C.cyan));
    for (let dow = 0; dow < 7; dow++) {
      let row = paint(days[dow] + ' ', C.cyan);
      for (let h = 0; h < 24; h++) {
        const v = grid[dow][h];
        const i = v === 0 ? 0 : Math.min(5, Math.floor((v / max) * 5) + 1);
        const ch = blocks[i].repeat(cellW);
        const color = i >= 4 ? C.teal : i >= 2 ? C.cyan : C.dim;
        row += useColor() && i > 0 ? `${color}${ch}${C.reset}` : ch;
      }
      lines.push(row);
    }
    const total = grid.flat().reduce((a, b) => a + b, 0);
    lines.push(paint(` ${total} events across day×hour · peak ${max}`, C.cyan));
    return lines.join('\n');
  }

  private bannerStyle(_d: GatheredState, w: number): string {
    const text = 'SHADOW BRAIN';
    const lines = renderFiglet(text);
    const sub = 'v6.0.2';
    const out = lines.map(l => truncateVisible(useColor() ? paint(l, C.teal) : l, w));
    out.push(paint(sub.padStart(Math.min(w, sub.length + 2)), C.cyan));
    return out.join('\n');
  }

  private sparklineStyle(d: GatheredState, w: number): string {
    const days = clamp(w - 12, 7, 120);
    const buckets = bucketByDay(d.events, days);
    if (buckets.every(b => b === 0)) {
      return paint('▁'.repeat(days), C.dim) + paint('  no activity', C.dim);
    }
    return paint(renderSparkChars(buckets), C.teal) + ' ' + paint(`${days}d`, C.cyan);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface GatheredState {
  project: string;
  entries: Array<{ id: string; agentTool: string; category: string; createdAt: Date; importance: number }>;
  events: ReplayEvent[];
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickStarChar(w: number): string {
  if (w >= 0.9) return '✦';
  if (w >= 0.7) return '*';
  if (w >= 0.4) return '+';
  return '·';
}

function charWeight(c: string): number {
  if (c === '✦') return 4;
  if (c === '*') return 3;
  if (c === '+') return 2;
  if (c === '·') return 1;
  return 0;
}

function border(side: 'top' | 'bot', w: number): string {
  return (side === 'top' ? '┌' : '└') + '─'.repeat(w) + (side === 'top' ? '┐' : '┘');
}

function bucketByDay(events: ReplayEvent[], days: number): number[] {
  const buckets = new Array<number>(days).fill(0);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const start = now - days * dayMs;
  for (const ev of events) {
    if (ev.ts < start || ev.ts > now) continue;
    const i = Math.min(days - 1, Math.floor((ev.ts - start) / dayMs));
    buckets[i]++;
  }
  return buckets;
}

function renderSparkChars(buckets: number[]): string {
  const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(1, ...buckets);
  return buckets.map(v => v === 0 ? bars[0] : bars[Math.min(7, Math.floor((v / max) * 7) + 1)]).join('');
}

function baseName(p: string): string {
  const m = p.match(/[\/\\]([^\/\\]+)\/?$/);
  return m ? m[1] : p;
}

function truncateVisible(line: string, w: number): string {
  // Strip ANSI to count visible chars
  const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length <= w) return line;
  // Naively chop — ANSI may leak but reset at end keeps terminals sane.
  return line.slice(0, w) + C.reset;
}

// ── Mini-figlet (A-Z, 0-9, space) — 5-line block font ────────────────────────

// Each glyph: 5 rows separated by '|'. Decoded lazily for compactness.
const GLYPH_DATA: Record<string, string> = {
  ' ': '  |  |  |  |  ',
  A: ' ██ |█  █|████|█  █|█  █',  B: '███ |█  █|███ |█  █|███ ',
  C: ' ███|█   |█   |█   | ███',  D: '███ |█  █|█  █|█  █|███ ',
  E: '████|█   |███ |█   |████',  F: '████|█   |███ |█   |█   ',
  G: ' ███|█   |█ ██|█  █| ███',  H: '█  █|█  █|████|█  █|█  █',
  I: '███| █ | █ | █ |███',       J: '  ██|   █|   █|█  █| ██ ',
  K: '█  █|█ █ |██  |█ █ |█  █',  L: '█   |█   |█   |█   |████',
  M: '█   █|██ ██|█ █ █|█   █|█   █', N: '█  █|██ █|█ ██|█  █|█  █',
  O: ' ██ |█  █|█  █|█  █| ██ ',  P: '███ |█  █|███ |█   |█   ',
  Q: ' ██ |█  █|█  █|█ ██| ███',  R: '███ |█  █|███ |█ █ |█  █',
  S: ' ███|█   | ██ |   █|███ ',  T: '█████|  █  |  █  |  █  |  █  ',
  U: '█  █|█  █|█  █|█  █| ██ ',  V: '█   █|█   █|█   █| █ █ |  █  ',
  W: '█   █|█   █|█ █ █|██ ██|█   █', X: '█  █| ██ | ██ | ██ |█  █',
  Y: '█   █| █ █ |  █  |  █  |  █  ', Z: '████|   █|  █ | █  |████',
  '0': ' ██ |█  █|█  █|█  █| ██ ', '1': ' █ |██ | █ | █ |███',
  '2': '██ |  █| █ |█  |███',     '3': '██ |  █| █ |  █|██ ',
  '4': '█  █|█  █|████|   █|   █', '5': '███|█  |██ |  █|██ ',
  '6': ' ██|█  |██ |█ █| █ ',     '7': '███|  █| █ | █ | █ ',
  '8': ' █ |█ █| █ |█ █| █ ',     '9': ' █ |█ █| ██|  █|██ ',
  '.': '  |  |  |  |█ ',
};
const GLYPHS: Record<string, string[]> = Object.fromEntries(
  Object.entries(GLYPH_DATA).map(([k, v]) => [k, v.split('|')]),
);

function renderFiglet(text: string): string[] {
  const chars = text.toUpperCase().split('').map(c => GLYPHS[c] ?? GLYPHS[' ']);
  const out: string[] = ['', '', '', '', ''];
  for (const g of chars) {
    for (let r = 0; r < 5; r++) out[r] += g[r] + ' ';
  }
  // swap solid blocks for nicer doubled glyphs
  return out.map(l => l.replace(/█/g, '██'));
}

// ── Mascots (one per archetype) ──────────────────────────────────────────────

interface MascotDef { art: string; tagline: string; color: string }

const MASCOTS: Record<ArchetypeName, MascotDef> = {
  'The Debugger':     { color: C.pink,   art: '   ╭─────╮\n   │ × × │   "Found it."\n   │  ▽  │\n   ╰──┬──╯\n   ──┴── DBG',                       tagline: 'Hunts root causes through collision chains.' },
  'The Architect':    { color: C.violet, art: '    ┏━━━━━┓\n    ┃ ┌─┐ ┃   "Plans first."\n    ┃ └─┘ ┃\n    ┗━┯━┯━┛\n      └─┘ ARC',                  tagline: 'Builds decisions into living blueprints.' },
  'The Speedster':    { color: C.teal,   art: '   ⟫⟫⟫⟫⟫\n   ◐ ─ ─ ─◑   "Cached."\n   ⟫⟫⟫⟫⟫\n      ╲╱ SPD',                                   tagline: 'Sub-millisecond recall, every single call.' },
  'The Scholar':      { color: C.amber,  art: '    ╔═════╗\n    ║ ▓▓▓ ║   "I read this."\n    ║ ▓▓▓ ║\n    ╚═┬═┬═╝\n      ┴ ┴  SCH',                  tagline: 'Reads more than it writes. Knows why.' },
  'The Cartographer': { color: C.green,  art: '   ╭───╮ ╭───╮\n   │ • ├─┤ • │   "Here be deps."\n   ╰─┬─╯ ╰─┬─╯\n     └──┬──┘  CTG',           tagline: 'Maps every dependency, every drift.' },
  'The Diplomat':     { color: C.blue,   art: '    ╭─╮   ╭─╮\n    │○│⇄⇄│○│   "After you."\n    ╰┬╯   ╰┬╯\n     └─────┘  DIP',                 tagline: 'Negotiates handoffs between agents.' },
  'The Sentinel':     { color: C.red,    art: '     ╱╲\n    ╱  ╲   "Halt."\n   │ !! │\n    ╲  ╱\n     ╲╱  SEN',                                  tagline: 'Quarantines hallucinations before they ship.' },
  'The Wanderer':     { color: C.sky,    art: '    · ·  *\n   · ◯  · ·   "Just looking..."\n    *  ·\n       · WND',                              tagline: 'Young brain, vast horizons, no fixed star.' },
};

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: BrainAscii | null = null;
export function getBrainAscii(): BrainAscii {
  if (!_instance) _instance = new BrainAscii();
  return _instance;
}
export function resetBrainAsciiForTests(): void { _instance = null; }
