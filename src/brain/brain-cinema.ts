// src/brain/brain-cinema.ts — Brain Cinema (viral feature)
// v6.0.2
//
// Auto-procedural 60-second video of brain growth. Reads the replay event log
// and emits a SINGLE SVG with embedded SMIL animations (<animate>,
// <animateTransform>) that plays inline in any modern browser. Generative-art
// feel: nodes appear scaled to importance, edges draw between related entities,
// color tone shifts cold-blue (new) → cyan (active) → warm-magenta (mature).
//
// Storage (for the mp4 stub):
//   ~/.shadow-brain/cinema/<project_hash>.svg
//   ~/.shadow-brain/cinema/<project_hash>.README.txt (conversion guidance)
//
// Independent of brain-dna.ts. Reads via BrainReplay; works gracefully when the
// project has no events yet.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

const CINEMA_DIR = path.join(os.homedir(), '.shadow-brain', 'cinema');
const DEFAULT_DURATION_S = 60;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_SCENE_COUNT = 60;
const MAX_NODES = 120;
const MAX_EDGES = 180;

// ── Types ────────────────────────────────────────────────────────────────────

export type CinemaStyle = 'minimal' | 'rich' | 'arcade';

export interface CinemaOptions {
  durationS?: number;
  width?: number;
  height?: number;
  style?: CinemaStyle;
}

export interface CinemaManifest {
  durationMs: number;
  frameCount: number;
  eventsRendered: number;
  milestones: string[];
  style: CinemaStyle;
  dimensions: { width: number; height: number };
}

interface CinemaNode {
  id: string;
  x: number;
  y: number;
  r: number;
  appearAt: number;
  intensity: number;
  archetypeColor: string;
}

interface CinemaEdge {
  fromIdx: number;
  toIdx: number;
  appearAt: number;
}

interface SceneCaption {
  ts: number;
  appearAt: number;
  label: string;
}

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainCinema {
  private replay: BrainReplay;

  constructor(replay?: BrainReplay) {
    this.replay = replay ?? getBrainReplay();
    try { fs.mkdirSync(CINEMA_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  /** Generate a 60s SMIL animated SVG of brain growth. */
  async generate(project: string, opts: CinemaOptions = {}): Promise<{ svg: string; manifest: CinemaManifest }> {
    const durationS = opts.durationS ?? DEFAULT_DURATION_S;
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const style: CinemaStyle = opts.style ?? 'rich';

    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    if (!events.length) {
      const svg = this.renderEmpty(project, width, height, durationS);
      const manifest: CinemaManifest = {
        durationMs: durationS * 1000,
        frameCount: 0,
        eventsRendered: 0,
        milestones: [],
        style,
        dimensions: { width, height },
      };
      return { svg, manifest };
    }

    const sceneCount = Math.min(DEFAULT_SCENE_COUNT, Math.max(8, events.length));
    const { nodes, edges } = this.buildGraph(events, width, height, durationS, sceneCount);
    const captions = this.buildCaptions(events, durationS, sceneCount);

    const svg = this.renderSvg(project, width, height, durationS, style, nodes, edges, captions, events.length);

    const manifest: CinemaManifest = {
      durationMs: durationS * 1000,
      frameCount: sceneCount,
      eventsRendered: events.length,
      milestones: captions.map(c => c.label),
      style,
      dimensions: { width, height },
    };
    return { svg, manifest };
  }

  /** Write SVG to disk + a README describing how to rasterize SVG → MP4. */
  async renderMp4Stub(project: string, opts: CinemaOptions = {}): Promise<{ svgPath: string; readmePath: string }> {
    const { svg } = await this.generate(project, opts);
    const id = this.projectHash(project);
    const svgPath = path.join(CINEMA_DIR, id + '.svg');
    const readmePath = path.join(CINEMA_DIR, id + '.README.txt');
    try {
      fs.writeFileSync(svgPath, svg, 'utf-8');
      fs.writeFileSync(readmePath, this.mp4Readme(svgPath), 'utf-8');
    } catch { /* non-fatal */ }
    return { svgPath, readmePath };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private projectHash(project: string): string {
    return crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
  }

  private buildGraph(
    events: ReplayEvent[],
    width: number,
    height: number,
    durationS: number,
    sceneCount: number,
  ): { nodes: CinemaNode[]; edges: CinemaEdge[] } {
    const t0 = events[0].ts;
    const t1 = events[events.length - 1].ts;
    const span = Math.max(1, t1 - t0);

    // Compute importance: count per entity key
    const importance = new Map<string, number>();
    const firstSeenAt = new Map<string, number>();
    for (const ev of events) {
      const key = this.entityKeyOf(ev);
      if (!key) continue;
      importance.set(key, (importance.get(key) ?? 0) + 1);
      if (!firstSeenAt.has(key)) firstSeenAt.set(key, ev.ts);
    }

    // Pick top N nodes by importance
    const ranked = Array.from(importance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NODES);
    const maxImp = Math.max(1, ranked[0]?.[1] ?? 1);

    const cx = width / 2;
    const cy = height / 2;
    const ringRadius = Math.min(width, height) * 0.38;

    const nodes: CinemaNode[] = ranked.map(([id, imp], i) => {
      // Golden-ratio spiral layout for organic look
      const angle = i * 2.39996; // golden angle in radians
      const r = ringRadius * Math.sqrt(i / Math.max(1, ranked.length - 1));
      const seedHash = crypto.createHash('sha1').update(id).digest();
      const jitterX = ((seedHash[0] / 255) - 0.5) * 60;
      const jitterY = ((seedHash[1] / 255) - 0.5) * 60;
      const x = cx + Math.cos(angle) * r + jitterX;
      const y = cy + Math.sin(angle) * r + jitterY;
      const ts = firstSeenAt.get(id) ?? t0;
      const appearAt = ((ts - t0) / span) * durationS;
      const intensity = imp / maxImp;
      const archetypeColor = this.toneAt(appearAt / durationS);
      return {
        id,
        x: Math.max(40, Math.min(width - 40, x)),
        y: Math.max(40, Math.min(height - 80, y)),
        r: 4 + intensity * 18,
        appearAt,
        intensity,
        archetypeColor,
      };
    });

    // Edges: co-occurrence in adjacent events (event chains)
    const idToIdx = new Map<string, number>();
    nodes.forEach((n, i) => idToIdx.set(n.id, i));

    const edgeSet = new Map<string, CinemaEdge>();
    let lastKey: string | null = null;
    let lastTs = t0;
    for (const ev of events) {
      const key = this.entityKeyOf(ev);
      if (!key) continue;
      if (lastKey && lastKey !== key && idToIdx.has(lastKey) && idToIdx.has(key)) {
        const a = idToIdx.get(lastKey)!;
        const b = idToIdx.get(key)!;
        const edgeKey = a < b ? a + '-' + b : b + '-' + a;
        if (!edgeSet.has(edgeKey)) {
          const appearAt = ((ev.ts - t0) / span) * durationS;
          edgeSet.set(edgeKey, { fromIdx: Math.min(a, b), toIdx: Math.max(a, b), appearAt });
        }
      }
      lastKey = key;
      lastTs = ev.ts;
    }
    void lastTs; // referenced for potential extension

    const edges = Array.from(edgeSet.values())
      .sort((a, b) => a.appearAt - b.appearAt)
      .slice(0, MAX_EDGES);

    void sceneCount;
    return { nodes, edges };
  }

  private buildCaptions(events: ReplayEvent[], durationS: number, sceneCount: number): SceneCaption[] {
    if (!events.length) return [];
    const t0 = events[0].ts;
    const t1 = events[events.length - 1].ts;
    const span = Math.max(1, t1 - t0);

    const out: SceneCaption[] = [];
    const seenEntities = new Set<string>();
    let firstMemory = false;
    let firstCollision = false;
    let firstDecision = false;
    let milestoneCount = 0;

    const dayOf = (ts: number): number => Math.max(1, Math.round((ts - t0) / (24 * 60 * 60 * 1000)));

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const key = this.entityKeyOf(ev);
      if (key) seenEntities.add(key);

      if (!firstMemory && (ev.type === 'memory.write' || ev.type === 'brain.remember')) {
        out.push({ ts: ev.ts, appearAt: ((ev.ts - t0) / span) * durationS, label: 'First memory · day ' + dayOf(ev.ts) });
        firstMemory = true;
      }
      if (!firstDecision && (ev.type.includes('decision') || ev.type.includes('adr'))) {
        out.push({ ts: ev.ts, appearAt: ((ev.ts - t0) / span) * durationS, label: 'First decision · day ' + dayOf(ev.ts) });
        firstDecision = true;
      }
      if (!firstCollision && ev.type.includes('collision')) {
        out.push({ ts: ev.ts, appearAt: ((ev.ts - t0) / span) * durationS, label: 'First collision · day ' + dayOf(ev.ts) });
        firstCollision = true;
      }
      const milestoneN = [100, 500, 1000, 5000, 10000][milestoneCount];
      if (milestoneN && i + 1 === milestoneN) {
        out.push({ ts: ev.ts, appearAt: ((ev.ts - t0) / span) * durationS, label: milestoneN.toLocaleString() + 'th event · day ' + dayOf(ev.ts) });
        milestoneCount++;
      }
    }

    // Closing milestone
    out.push({
      ts: events[events.length - 1].ts,
      appearAt: durationS - 2,
      label: events.length.toLocaleString() + ' events · ' + seenEntities.size.toLocaleString() + ' entities',
    });

    void sceneCount;
    return out.slice(0, 8);
  }

  private entityKeyOf(ev: ReplayEvent): string | null {
    const p = ev.payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== 'object') return null;
    return (p.entity as string) || (p.id as string) || (p.name as string) || null;
  }

  // Color tone shifts cold-blue → cyan → warm-magenta across [0, 1]
  private toneAt(progress: number): string {
    const p = Math.max(0, Math.min(1, progress));
    if (p < 0.5) {
      // cold blue (#3a5fcd) → cyan (#00ffd5)
      const k = p / 0.5;
      const r = Math.round(58 + (0 - 58) * k);
      const g = Math.round(95 + (255 - 95) * k);
      const b = Math.round(205 + (213 - 205) * k);
      return rgbHex(r, g, b);
    }
    // cyan (#00ffd5) → warm magenta (#ff4d8a)
    const k = (p - 0.5) / 0.5;
    const r = Math.round(0 + (255 - 0) * k);
    const g = Math.round(255 + (77 - 255) * k);
    const b = Math.round(213 + (138 - 213) * k);
    return rgbHex(r, g, b);
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private renderSvg(
    project: string,
    W: number,
    H: number,
    durationS: number,
    style: CinemaStyle,
    nodes: CinemaNode[],
    edges: CinemaEdge[],
    captions: SceneCaption[],
    eventTotal: number,
  ): string {
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    const durStr = durationS + 's';
    const accent = style === 'arcade' ? '#ff4d8a' : style === 'minimal' ? '#7dd3fc' : '#00ffd5';
    const bg = style === 'arcade' ? '#1a0726' : '#06121f';

    // Edges (drawn first so nodes sit on top)
    const edgeMarks: string[] = [];
    for (const e of edges) {
      const a = nodes[e.fromIdx];
      const b = nodes[e.toIdx];
      if (!a || !b) continue;
      const delay = Math.max(0, e.appearAt).toFixed(2) + 's';
      edgeMarks.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" stroke="${accent}" stroke-width="0.8" opacity="0">
    <animate attributeName="x2" to="${b.x.toFixed(1)}" begin="${delay}" dur="0.8s" fill="freeze"/>
    <animate attributeName="y2" to="${b.y.toFixed(1)}" begin="${delay}" dur="0.8s" fill="freeze"/>
    <animate attributeName="opacity" from="0" to="0.35" begin="${delay}" dur="0.8s" fill="freeze"/>
  </line>`);
    }

    // Nodes
    const nodeMarks: string[] = [];
    for (const n of nodes) {
      const delay = Math.max(0, n.appearAt).toFixed(2) + 's';
      const radius = n.r.toFixed(1);
      nodeMarks.push(`<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="0" fill="${n.archetypeColor}" opacity="0">
    <animate attributeName="r" from="0" to="${radius}" begin="${delay}" dur="0.6s" fill="freeze"/>
    <animate attributeName="opacity" from="0" to="${(0.55 + n.intensity * 0.4).toFixed(2)}" begin="${delay}" dur="0.6s" fill="freeze"/>
    <animate attributeName="r" values="${radius};${(n.r * 1.15).toFixed(1)};${radius}" begin="${delay}" dur="3s" repeatCount="indefinite"/>
  </circle>`);
    }

    // Captions: each appears, holds 4s, fades out
    const captionMarks: string[] = [];
    for (let i = 0; i < captions.length; i++) {
      const c = captions[i];
      const delay = Math.max(0, c.appearAt).toFixed(2) + 's';
      captionMarks.push(`<text x="${W / 2}" y="${H - 80}" fill="#e2f5ff" font-size="28" font-family="ui-sans-serif,system-ui" font-weight="600" text-anchor="middle" opacity="0">
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" begin="${delay}" dur="4s" fill="freeze"/>
    ${esc(c.label)}
  </text>`);
    }

    // Final-frame archetype glow: scales in over last 3s
    const finalBegin = (durationS - 3).toFixed(2) + 's';
    const archetypeGlyph = this.deriveArchetype(eventTotal, nodes.length);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Brain Cinema · auto-procedural 60s growth animation -->
  <!-- Project: ${esc(projName)} · ${eventTotal.toLocaleString()} events · ${nodes.length} nodes -->
  <defs>
    <radialGradient id="cinema-bg" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0" stop-color="${bg}" stop-opacity="1"/>
      <stop offset="1" stop-color="#020812" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="cinema-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft-blur"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#cinema-bg)"/>
  <text x="48" y="60" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="3" opacity="0.7">BRAIN CINEMA · ${durStr}</text>
  <text x="48" y="100" fill="#e2f5ff" font-size="28" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <g filter="url(#soft-blur)" opacity="0.6">
    ${edgeMarks.join('\n    ')}
  </g>
  <g>
    ${nodeMarks.join('\n    ')}
  </g>
  <circle cx="${W / 2}" cy="${H / 2}" r="0" fill="url(#cinema-glow)" opacity="0">
    <animate attributeName="r" from="0" to="${(Math.min(W, H) * 0.45).toFixed(0)}" begin="${finalBegin}" dur="3s" fill="freeze"/>
    <animate attributeName="opacity" from="0" to="1" begin="${finalBegin}" dur="3s" fill="freeze"/>
  </circle>
  <text x="${W / 2}" y="${H / 2 + 12}" fill="${accent}" font-size="120" font-family="ui-sans-serif,system-ui" font-weight="800" text-anchor="middle" opacity="0">
    <animate attributeName="opacity" from="0" to="1" begin="${finalBegin}" dur="2s" fill="freeze"/>
    ${esc(archetypeGlyph)}
  </text>
  ${captionMarks.join('\n  ')}
  <text x="48" y="${H - 32}" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" opacity="0.55">npm i -g @theihtisham/agent-shadow-brain</text>
  <text x="${W - 48}" y="${H - 32}" fill="${accent}" font-size="13" font-family="ui-monospace,monospace" text-anchor="end" opacity="0.75">style: ${esc(style)}</text>
</svg>`;
  }

  private renderEmpty(project: string, W: number, H: number, durationS: number): string {
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Brain Cinema · empty state -->
  <defs>
    <radialGradient id="e-bg" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0" stop-color="#06121f"/><stop offset="1" stop-color="#020812"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#e-bg)"/>
  <text x="${W / 2}" y="${H / 2 - 20}" fill="#e2f5ff" font-size="42" font-family="ui-sans-serif,system-ui" font-weight="600" text-anchor="middle">${esc(projName)}</text>
  <text x="${W / 2}" y="${H / 2 + 30}" fill="#7dd3fc" font-size="22" font-family="ui-sans-serif,system-ui" text-anchor="middle" opacity="0.8">Your brain is brand new. Come back after some activity.</text>
  <circle cx="${W / 2}" cy="${H / 2 + 130}" r="6" fill="#00ffd5">
    <animate attributeName="r" values="6;18;6" dur="${durationS}s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.8;0.2;0.8" dur="${durationS}s" repeatCount="indefinite"/>
  </circle>
</svg>`;
  }

  private deriveArchetype(eventTotal: number, nodeCount: number): string {
    if (eventTotal === 0) return 'WND';
    if (nodeCount >= 80) return 'CTG';
    if (eventTotal >= 1000) return 'SCH';
    if (eventTotal >= 200) return 'ARC';
    return 'SPD';
  }

  private mp4Readme(svgPath: string): string {
    return [
      'Brain Cinema · SVG → MP4 conversion notes',
      '',
      'The file at:',
      '  ' + svgPath,
      '',
      'is a single SVG with SMIL animations (cross-browser-supported).',
      'It plays natively in Chrome, Safari, Firefox, and Edge.',
      '',
      'ffmpeg cannot rasterize SMIL on its own — it needs a rendering pass first.',
      'Recommended conversion paths:',
      '',
      '  1. rsvg-convert (fast, but only renders single frames — not animation)',
      '     rsvg-convert -w 1920 input.svg -o frame.png',
      '',
      '  2. Inkscape (single-frame export only)',
      '     inkscape input.svg --export-png=frame.png',
      '',
      '  3. Puppeteer / Playwright (recommended — captures animation frame-by-frame)',
      '     • Open the SVG in a headless browser',
      '     • Snapshot screen every ~33ms (30 fps)',
      '     • Pipe frames to ffmpeg:',
      '         ffmpeg -framerate 30 -i frame-%04d.png -c:v libx264 -pix_fmt yuv420p output.mp4',
      '',
      '  4. Or share the SVG directly — most platforms (Twitter web, Discord, GitHub)',
      '     embed inline SVG and play SMIL animations automatically.',
      '',
      'No external runtime is required to view the animation; only to convert.',
      '',
    ].join('\n');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rgbHex(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, n));
  const hex = (n: number): string => clamp(n).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

let _instance: BrainCinema | null = null;
export function getBrainCinema(): BrainCinema {
  if (!_instance) _instance = new BrainCinema();
  return _instance;
}
export function resetBrainCinemaForTests(): void { _instance = null; }
