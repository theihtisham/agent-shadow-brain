// src/brain/brain-memes.ts — Brain Memes (viral feature)
// v6.0.2
//
// Auto-generated dev memes whose top/bottom text is driven by your project's
// actual brain state. Pure-SVG, 1080×1080 (Instagram square). Templates are
// caricatured vector representations of the original meme structure — NOT
// embedded PNGs.
//
// Stdlib only. Empty brain → generic dev jokes. Optional sharePath writes to
// ~/.shadow-brain/memes/<project>-<timestamp>.svg.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type MemeTemplate =
  | 'drake' | 'distracted-bf' | 'this-is-fine' | 'change-my-mind'
  | 'astronaut-always-has-been' | 'pikachu-shocked' | 'galaxy-brain'
  | 'two-buttons' | 'spongebob-mocking' | 'expanding-brain';

export interface MemeResult {
  template: MemeTemplate;
  topText: string;
  bottomText: string;
  svg: string;
  alt: string;
  sharePath?: string;
}

export interface MemeOptions {
  template?: MemeTemplate;
  count?: number;
  sharePath?: boolean;
}

const ALL_TEMPLATES: MemeTemplate[] = [
  'drake', 'distracted-bf', 'this-is-fine', 'change-my-mind', 'astronaut-always-has-been',
  'pikachu-shocked', 'galaxy-brain', 'two-buttons', 'spongebob-mocking', 'expanding-brain',
];

const MEMES_DIR = path.join(os.homedir(), '.shadow-brain', 'memes');

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainMemes {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  /** Generate N memes for a project. Returns rendered SVG + texts + optional path. */
  async generate(project: string, opts: MemeOptions = {}): Promise<MemeResult[]> {
    const stats = this.gather(project);
    const count = Math.max(1, Math.min(opts.count ?? 5, ALL_TEMPLATES.length));
    const order = opts.template
      ? [opts.template, ...ALL_TEMPLATES.filter(t => t !== opts.template)]
      : ALL_TEMPLATES.slice();
    const picked = order.slice(0, count);

    const out: MemeResult[] = [];
    for (const tmpl of picked) {
      const { top, bottom, alt } = this.fillText(tmpl, stats);
      const svg = this.renderTemplate(tmpl, top, bottom);
      const result: MemeResult = { template: tmpl, topText: top, bottomText: bottom, svg, alt };
      if (opts.sharePath) result.sharePath = this.write(project, tmpl, svg);
      out.push(result);
    }
    return out;
  }

  /** List all available templates. */
  listTemplates(): MemeTemplate[] { return ALL_TEMPLATES.slice(); }

  // ── Data gathering ────────────────────────────────────────────────────────

  private gather(project: string): MemeStats {
    let entries: Array<{ category: string; agentTool: string; importance: number; id: string }> = [];
    let events: ReplayEvent[] = [];
    let projectId = '';
    try { projectId = GlobalBrain.projectIdFor(project); } catch { /* empty */ }
    try { void this.brain.getStats(); } catch { /* empty */ }
    try {
      entries = this.brain.recall({ projectId, limit: 3000 }).map(e => ({
        category: e.category, agentTool: e.agentTool, importance: e.importance, id: e.id,
      }));
    } catch { /* empty */ }
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    const agentCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();
    for (const e of entries) {
      agentCounts.set(e.agentTool, (agentCounts.get(e.agentTool) ?? 0) + 1);
      catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
    }
    const collisions = events.filter(e => e.type.includes('collision')).length;
    const hallucinations = events.filter(e => e.type.includes('hallucination') || e.type.includes('quarantine')).length;
    const decisions = events.filter(e => e.type.includes('decision') || e.type.includes('adr')).length
      + entries.filter(e => /decision|adr|architecture/i.test(e.category)).length;
    const cacheHits = events.filter(e => e.type === 'cache.hit').length;
    const cacheMisses = events.filter(e => e.type === 'cache.miss').length;
    const cacheTotal = cacheHits + cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? cacheHits / cacheTotal : undefined;

    const topAgent = [...agentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const topCategory = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      project: path.basename(path.resolve(project)) || 'unknown-brain',
      totalEntries: entries.length,
      totalEvents: events.length,
      collisions, hallucinations, decisions,
      cacheHitRate,
      topAgent, topCategory,
      uniqueAgents: agentCounts.size,
      empty: entries.length === 0 && events.length === 0,
    };
  }

  // ── Text generators ───────────────────────────────────────────────────────

  private fillText(tmpl: MemeTemplate, s: MemeStats): { top: string; bottom: string; alt: string } {
    const proj = s.project;
    const empty = s.empty;
    const agent = s.topAgent ?? 'an agent';
    const cat = s.topCategory ?? 'patterns';

    switch (tmpl) {
      case 'drake':
        return {
          top: empty ? 'Reading the docs' : `Reading the docs for ${proj}`,
          bottom: empty ? 'Asking the brain' : `brain_recall("${cat}") · ${s.totalEntries} hits`,
          alt: 'Drake meme: top panel rejects docs, bottom panel approves shadow-brain recall.',
        };
      case 'distracted-bf':
        return {
          top: `Me, with ${s.totalEntries || 'no'} brain memories`,
          bottom: empty
            ? 'A shiny new debugging idea I forgot last week'
            : `"${cat}" pattern I already solved 3 times`,
          alt: 'Distracted boyfriend meme captioned with brain memory regret.',
        };
      case 'this-is-fine':
        return {
          top: empty
            ? 'Project with zero memory of past bugs'
            : `${s.collisions} collisions detected · ${s.hallucinations} hallucinations quarantined`,
          bottom: 'This is fine.',
          alt: 'Dog in burning room meme captioned with brain collision count.',
        };
      case 'change-my-mind':
        return {
          top: empty
            ? 'Every project deserves a brain'
            : `${proj} has ${s.totalEntries} memories — it knows you better than you do`,
          bottom: 'Change my mind.',
          alt: 'Change my mind table meme captioned with brain stat.',
        };
      case 'astronaut-always-has-been':
        return {
          top: empty
            ? 'Wait, agents share state?'
            : `Wait, ${agent} has been writing ${cat} this whole time?`,
          bottom: 'Always has been.',
          alt: 'Astronaut pointing gun meme captioned with agent revelation.',
        };
      case 'pikachu-shocked':
        return {
          top: empty
            ? 'Shipped without telling the brain anything'
            : `Skipped brain_recall · re-introduced bug #${shortHash(proj)}`,
          bottom: 'Surprised face.',
          alt: 'Shocked Pikachu meme captioned with a predictable dev mistake.',
        };
      case 'galaxy-brain':
        return {
          top: 'Tiny brain: console.log',
          bottom: empty
            ? 'Galaxy brain: ask shadow-brain'
            : `Galaxy brain: ${s.totalEntries} memories whisper the answer`,
          alt: 'Galaxy brain ascending revelations from console.log to shadow-brain.',
        };
      case 'two-buttons':
        return {
          top: 'Write a test',
          bottom: empty
            ? 'Trust the vibes'
            : `Trust ${proj}'s ${s.totalEntries} memories`,
          alt: 'Two buttons sweating meme: write a test vs. trust the brain.',
        };
      case 'spongebob-mocking':
        return {
          top: empty
            ? 'i DoNt nEEd a sHaReD bRaiN'
            : `iT's JuSt $(cat).Md fIlEs`,
          bottom: empty
            ? 'I dont need a shared brain.'
            : `It's just .md files. (${s.totalEntries} entities say otherwise.)`,
          alt: 'Mocking SpongeBob meme captioned with dev denial.',
        };
      case 'expanding-brain':
        return {
          top: 'console.log → debugger → git bisect',
          bottom: empty
            ? '→ ask shadow-brain'
            : `→ brain_recall (${pct(s.cacheHitRate)} hit rate)`,
          alt: 'Expanding brain meme escalating from console.log to brain recall.',
        };
      default:
        return { top: proj, bottom: 'shadow-brain', alt: 'Default meme.' };
    }
  }

  // ── SVG renderers ─────────────────────────────────────────────────────────

  private renderTemplate(t: MemeTemplate, top: string, bottom: string): string {
    const map: Record<MemeTemplate, (a: string, b: string) => string> = {
      'drake': (a, b) => this.svgDrake(a, b),
      'distracted-bf': (a, b) => this.svgDistracted(a, b),
      'this-is-fine': (a, b) => this.svgThisIsFine(a, b),
      'change-my-mind': (a, b) => this.svgChangeMyMind(a, b),
      'astronaut-always-has-been': (a, b) => this.svgAstronaut(a, b),
      'pikachu-shocked': (a, b) => this.svgPikachu(a, b),
      'galaxy-brain': (a, b) => this.svgGalaxyBrain(a, b),
      'two-buttons': (a, b) => this.svgTwoButtons(a, b),
      'spongebob-mocking': (a, b) => this.svgSpongebob(a, b),
      'expanding-brain': (a, b) => this.svgExpandingBrain(a, b),
    };
    return map[t](top, bottom);
  }

  private base(inner: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#061224"/><stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <style>
      .cap { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-weight: 800; fill: #ffffff; stroke: #000; stroke-width: 2; paint-order: stroke fill; }
      .lbl { font-family: ui-monospace, monospace; fill: #7dd3fc; }
      .panel { stroke: #1a3a5a; stroke-width: 2; }
    </style>
  </defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  ${inner}
  <text x="540" y="1060" class="lbl" font-size="14" text-anchor="middle" opacity="0.6">shadow-brain · v6.0.2</text>
</svg>`;
  }

  private cap(x: number, y: number, w: number, text: string, size = 38, anchor: 'start' | 'middle' = 'middle'): string {
    return wrapText(text, w, size).map((line, i) =>
      `<text x="${x}" y="${y + i * (size + 6)}" class="cap" font-size="${size}" text-anchor="${anchor}">${esc(line)}</text>`
    ).join('\n  ');
  }

  // Each template draws a caricature panel + caption.

  private svgDrake(top: string, bottom: string): string {
    return this.base(`<rect x="60" y="80" width="960" height="460" fill="#1a2b44" class="panel" rx="12"/>
<g transform="translate(180,110)"><ellipse cx="160" cy="200" rx="150" ry="190" fill="#d4a373"/><ellipse cx="115" cy="180" rx="18" ry="10" fill="#000"/><ellipse cx="205" cy="180" rx="18" ry="10" fill="#000"/><path d="M 100 280 Q 160 250 220 280" stroke="#000" stroke-width="6" fill="none"/><text x="160" y="370" class="cap" font-size="80" text-anchor="middle">✋</text></g>
${this.cap(720, 320, 600, top, 32)}
<rect x="60" y="560" width="960" height="460" fill="#1a2b44" class="panel" rx="12"/>
<g transform="translate(180,590)"><ellipse cx="160" cy="200" rx="150" ry="190" fill="#d4a373"/><ellipse cx="115" cy="180" rx="18" ry="14" fill="#000"/><ellipse cx="205" cy="180" rx="18" ry="14" fill="#000"/><path d="M 100 270 Q 160 320 220 270" stroke="#000" stroke-width="6" fill="none"/><text x="160" y="370" class="cap" font-size="70" text-anchor="middle">👉</text></g>
${this.cap(720, 800, 600, bottom, 32)}`);
  }

  private svgDistracted(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="120" width="1000" height="600" fill="#1a2b44" class="panel" rx="12"/>
<g transform="translate(120,180)"><circle cx="120" cy="80" r="60" fill="#d4a373"/><rect x="80" y="140" width="80" height="180" fill="#3a7" rx="10"/><text x="120" y="360" class="cap" font-size="22" text-anchor="middle">girlfriend</text><circle cx="420" cy="60" r="70" fill="#d4a373"/><path d="M 350 130 L 490 130 L 470 360 L 370 360 Z" fill="#26d"/><path d="M 420 130 L 380 60" stroke="#000" stroke-width="4"/><text x="420" y="400" class="cap" font-size="22" text-anchor="middle">boyfriend</text><circle cx="720" cy="80" r="60" fill="#d4a373"/><path d="M 660 140 L 780 140 L 780 320 L 660 320 Z" fill="#c33"/><text x="720" y="360" class="cap" font-size="22" text-anchor="middle">distraction</text></g>
${this.cap(540, 800, 900, top, 38)}
${this.cap(540, 970, 900, bottom, 32)}`);
  }

  private svgThisIsFine(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="100" width="1000" height="700" fill="#3a1a0a" class="panel" rx="12"/>
${flames(60, 760, 980, 12)}
<g transform="translate(360,300)"><rect x="80" y="240" width="220" height="20" fill="#8a4a2a"/><circle cx="190" cy="160" r="80" fill="#d4a373"/><ellipse cx="160" cy="150" rx="6" ry="10" fill="#000"/><ellipse cx="220" cy="150" rx="6" ry="10" fill="#000"/><path d="M 160 200 Q 190 220 220 200" stroke="#000" stroke-width="4" fill="none"/><ellipse cx="120" cy="120" rx="20" ry="15" fill="#d4a373"/><ellipse cx="260" cy="120" rx="20" ry="15" fill="#d4a373"/><rect x="100" y="100" width="180" height="40" fill="#ff8c42" opacity="0.4"/></g>
${this.cap(540, 80, 1000, top, 32)}
${this.cap(540, 920, 1000, bottom, 56)}`);
  }

  private svgChangeMyMind(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="120" width="1000" height="700" fill="#2a4a2a" class="panel" rx="12"/>
<g transform="translate(120,200)"><rect x="60" y="280" width="720" height="30" fill="#6a3a1a"/><rect x="100" y="200" width="640" height="80" fill="#fff" stroke="#000" stroke-width="3"/><text x="420" y="245" font-family="ui-sans-serif" font-size="26" fill="#000" text-anchor="middle">${esc(truncate(top, 48))}</text></g>
<g transform="translate(550,380)"><circle cx="0" cy="0" r="80" fill="#d4a373"/><rect x="-90" y="-100" width="180" height="50" fill="#c33" rx="6"/><ellipse cx="-30" cy="-10" rx="10" ry="6" fill="#000"/><ellipse cx="30" cy="-10" rx="10" ry="6" fill="#000"/><rect x="-50" y="30" width="100" height="30" fill="#444"/></g>
${this.cap(540, 900, 1000, bottom, 56)}`);
  }

  private svgAstronaut(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="100" width="1000" height="700" fill="#0a1a3a" class="panel" rx="12"/>
${stars(60, 120, 960, 660, 80, 'memes')}
<circle cx="540" cy="500" r="220" fill="#2a6a8a"/>
<path d="M 420 480 Q 480 420 540 460 Q 600 500 660 460 Q 720 440 700 520 Q 660 580 540 580 Q 420 560 420 480" fill="#3a8a3a"/>
<g transform="translate(220,220)"><circle cx="60" cy="60" r="50" fill="#ddd"/><rect x="15" y="40" width="90" height="40" fill="#88c" opacity="0.7"/><rect x="20" y="110" width="80" height="100" fill="#eee"/></g>
<g transform="translate(780,260)"><circle cx="60" cy="60" r="50" fill="#ddd"/><rect x="15" y="40" width="90" height="40" fill="#88c" opacity="0.7"/><rect x="20" y="110" width="80" height="100" fill="#eee"/><rect x="-40" y="80" width="60" height="14" fill="#444"/></g>
${this.cap(540, 110, 1000, top, 34)}
${this.cap(540, 900, 1000, bottom, 52)}`);
  }

  private svgPikachu(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="120" width="1000" height="700" fill="#3a3a1a" class="panel" rx="12"/>
<g transform="translate(540,460)"><ellipse cx="0" cy="0" rx="280" ry="240" fill="#ffd84d"/><ellipse cx="-90" cy="-30" rx="30" ry="40" fill="#000"/><ellipse cx="-86" cy="-40" rx="10" ry="14" fill="#fff"/><ellipse cx="90" cy="-30" rx="30" ry="40" fill="#000"/><ellipse cx="94" cy="-40" rx="10" ry="14" fill="#fff"/><circle cx="-160" cy="60" r="32" fill="#e44"/><circle cx="160" cy="60" r="32" fill="#e44"/><ellipse cx="0" cy="80" rx="40" ry="50" fill="#000"/><ellipse cx="0" cy="80" rx="32" ry="42" fill="#3a1a1a"/></g>
${this.cap(540, 80, 1000, top, 32)}
${this.cap(540, 920, 1000, bottom, 48)}`);
  }

  private svgGalaxyBrain(top: string, bottom: string): string {
    const stages = [
      { y: 140, c: '#7dd3fc', text: 'tiny brain', glow: 6 },
      { y: 380, c: '#a78bfa', text: 'better', glow: 12 },
      { y: 620, c: '#00ffd5', text: 'big brain', glow: 20 },
      { y: 860, c: '#ffffff', text: 'galaxy', glow: 32 },
    ];
    return this.base(`
  ${stars(40, 60, 1000, 1000, 120, 'galaxy')}
  ${stages.map((s, i) => `
  <rect x="40" y="${s.y - 100}" width="1000" height="220" fill="#1a2b44" class="panel" rx="12" opacity="${0.4 + i * 0.15}"/>
  <g transform="translate(180,${s.y})">
    <circle cx="0" cy="0" r="${50 + i * 20}" fill="${s.c}" opacity="0.7" filter="blur(${s.glow}px)"/>
    <path d="M -60 -20 Q 0 -80 60 -20 Q 90 30 0 60 Q -90 30 -60 -20 Z" fill="${s.c}" opacity="0.9"/>
    <text x="${380 + i * 20}" y="10" class="cap" font-size="${24 + i * 4}" text-anchor="start">${esc(truncate(i === 0 ? top : i === 3 ? bottom : s.text, 36))}</text>
  </g>`).join('\n')}`);
  }

  private svgTwoButtons(top: string, bottom: string): string {
    return this.base(`<rect x="40" y="100" width="1000" height="500" fill="#fbbf24" class="panel" rx="12"/>
<rect x="160" y="220" width="320" height="260" fill="#c33" rx="12" stroke="#000" stroke-width="4"/>
<circle cx="320" cy="260" r="14" fill="#000"/>
<text x="320" y="360" font-family="ui-sans-serif" font-size="26" fill="#fff" text-anchor="middle" font-weight="700">${esc(truncate(top, 26))}</text>
<rect x="600" y="220" width="320" height="260" fill="#c33" rx="12" stroke="#000" stroke-width="4"/>
<circle cx="760" cy="260" r="14" fill="#000"/>
<text x="760" y="360" font-family="ui-sans-serif" font-size="26" fill="#fff" text-anchor="middle" font-weight="700">${esc(truncate(bottom, 26))}</text>
<g transform="translate(540,700)"><circle cx="0" cy="100" r="120" fill="#d4a373"/><ellipse cx="-40" cy="80" rx="14" ry="20" fill="#000"/><ellipse cx="40" cy="80" rx="14" ry="20" fill="#000"/><path d="M -50 160 Q 0 200 50 160" stroke="#000" stroke-width="5" fill="none"/><ellipse cx="-90" cy="40" rx="12" ry="18" fill="#7dd3fc" opacity="0.8"/><ellipse cx="90" cy="40" rx="12" ry="18" fill="#7dd3fc" opacity="0.8"/></g>
${this.cap(540, 1020, 1000, 'choices...', 22)}`);
  }

  private svgSpongebob(top: string, bottom: string): string {
    const mocked = mockingCase(top);
    return this.base(`<rect x="40" y="100" width="1000" height="700" fill="#1a3a4a" class="panel" rx="12"/>
<g transform="translate(540,440)"><rect x="-200" y="-220" width="400" height="440" fill="#ffd84d" rx="20"/><rect x="-180" y="-100" width="360" height="80" fill="#fff"/><circle cx="-70" cy="-150" r="40" fill="#fff"/><circle cx="70" cy="-150" r="40" fill="#fff"/><circle cx="-70" cy="-150" r="14" fill="#000"/><circle cx="80" cy="-145" r="14" fill="#000"/><rect x="-30" y="-80" width="60" height="40" fill="#f88"/><path d="M -100 0 Q 0 60 100 0" stroke="#000" stroke-width="5" fill="none"/><rect x="-60" y="20" width="20" height="40" fill="#fff"/><rect x="40" y="20" width="20" height="40" fill="#fff"/></g>
${this.cap(540, 90, 1000, mocked, 30)}
${this.cap(540, 920, 1000, bottom, 38)}`);
  }

  private svgExpandingBrain(top: string, bottom: string): string {
    const brains = [
      { y: 160, scale: 0.4, glow: 2 }, { y: 400, scale: 0.65, glow: 8 },
      { y: 660, scale: 0.85, glow: 16 }, { y: 920, scale: 1.0, glow: 28 },
    ];
    const lines = ['console.log', 'debugger', 'git bisect', bottom.replace(/^→\s*/, '')];
    const firstStage = top.split(/[→·]|->/).map(s => s.trim()).filter(Boolean);
    firstStage.slice(0, 3).forEach((s, i) => { lines[i] = s; });
    const parts = brains.map((b, i) => {
      const cy = b.y, baseR = 60;
      return `<rect x="40" y="${cy - 120}" width="1000" height="240" fill="#1a2b44" class="panel" rx="12" opacity="${0.4 + i * 0.15}"/>
<g transform="translate(220,${cy}) scale(${b.scale})"><ellipse cx="0" cy="0" rx="${baseR * 1.2}" ry="${baseR}" fill="#ff9eb5"/><path d="M -60 -20 Q -30 -60 0 -40 Q 30 -60 60 -20 Q 80 20 30 40 Q 0 30 -30 40 Q -80 20 -60 -20 Z" fill="#ffc1d0" opacity="0.8"/><circle cx="0" cy="0" r="${baseR + i * 10}" fill="#fff" opacity="0.2" filter="blur(${b.glow}px)"/></g>
<text x="420" y="${cy + 12}" class="cap" font-size="${28 + i * 4}" text-anchor="start">${esc(truncate(lines[i], 36))}</text>`;
    });
    return this.base(parts.join('\n'));
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private write(project: string, tmpl: MemeTemplate, svg: string): string | undefined {
    try {
      fs.mkdirSync(MEMES_DIR, { recursive: true });
      const slug = path.basename(path.resolve(project)).replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'brain';
      const file = path.join(MEMES_DIR, `${slug}-${tmpl}-${Date.now()}.svg`);
      fs.writeFileSync(file, svg, 'utf-8');
      return file;
    } catch {
      return undefined;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MemeStats {
  project: string;
  totalEntries: number;
  totalEvents: number;
  collisions: number;
  hallucinations: number;
  decisions: number;
  cacheHitRate?: number;
  topAgent: string | null;
  topCategory: string | null;
  uniqueAgents: number;
  empty: boolean;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function wrapText(text: string, maxPx: number, fontSize: number): string[] {
  // Rough px/char ≈ 0.55 * fontSize for system sans bold.
  const charsPerLine = Math.max(8, Math.floor(maxPx / (fontSize * 0.55)));
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur.length + 1 + w.length) <= charsPerLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3); // cap at 3 lines so panels don't overflow
}

function mockingCase(s: string): string {
  let i = 0;
  return s.split('').map(c => {
    if (!/[a-zA-Z]/.test(c)) return c;
    const out = i % 2 === 0 ? c.toLowerCase() : c.toUpperCase();
    i++;
    return out;
  }).join('');
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36).slice(0, 4);
}

function pct(n?: number): string {
  if (n === undefined) return 'unknown';
  return (n * 100).toFixed(0) + '%';
}

// Decorative SVG primitives used across templates

function stars(x: number, y: number, w: number, h: number, n: number, seed: string): string {
  const rand = mulberry32(hashString(seed));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const sx = x + rand() * w;
    const sy = y + rand() * h;
    const r = 1 + rand() * 2.5;
    const op = 0.4 + rand() * 0.6;
    out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" opacity="${op.toFixed(2)}"/>`);
  }
  return out.join('\n');
}

function flames(x: number, y: number, w: number, n: number): string {
  const rand = mulberry32(hashString('flames'));
  const out: string[] = [];
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const fx = x + i * step + step / 2;
    const fh = 40 + rand() * 80;
    out.push(`<path d="M ${fx - 24} ${y} Q ${fx} ${y - fh} ${fx + 24} ${y} Z" fill="#ff8c42" opacity="0.85"/>`);
    out.push(`<path d="M ${fx - 14} ${y} Q ${fx} ${y - fh * 0.7} ${fx + 14} ${y} Z" fill="#ffd84d" opacity="0.9"/>`);
  }
  return out.join('\n');
}

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

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: BrainMemes | null = null;
export function getBrainMemes(): BrainMemes {
  if (!_instance) _instance = new BrainMemes();
  return _instance;
}
export function resetBrainMemesForTests(): void { _instance = null; }
