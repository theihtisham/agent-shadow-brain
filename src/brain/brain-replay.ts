// src/brain/brain-replay.ts — Brain Replay (viral feature)
// v6.0.2
//
// The "AlphaGo replay" for codebases. A scrubbable, day-zero timeline of every
// brain event in a project. Records to a per-project JSONL log, computes
// snapshot frames at intervals, and exports a Twitter-ready SVG timeline.
//
// Storage: ~/.shadow-brain/replay/<project_hash>.jsonl  (append-only events)
//          ~/.shadow-brain/replay/<project_hash>.snap.json (compact snapshots)
//
// Independent of causal-chains.ts and brain-garden.ts. Reads global brain for
// entity state when computing frames; works gracefully on empty input.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const REPLAY_DIR = path.join(os.homedir(), '.shadow-brain', 'replay');
const FRAME_EVERY_EVENTS = 100;
const FRAME_EVERY_MS = 60 * 60 * 1000; // 1 hour
const COMPRESS_THRESHOLD = 5000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReplayEvent {
  type: string;
  payload: unknown;
  ts: number;
  project: string;
  agent?: string;
}

export interface ReplayFrame {
  ts: number;
  eventCount: number;
  memoryCount: number;
  entityCount: number;
  topEntities: string[];
  deltaFromPrevious: { added: number; modified: number; decayed: number };
  healthScore?: number;
}

export interface ReplayTimeline {
  project: string;
  frames: ReplayFrame[];
  totalEvents: number;
  firstEventAt: number | null;
  lastEventAt: number | null;
}

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainReplay {
  private brain: GlobalBrain;

  constructor(brain?: GlobalBrain) {
    this.brain = brain ?? getGlobalBrain();
    try { fs.mkdirSync(REPLAY_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  /** Append an event to the per-project log. */
  record(event: { type: string; payload: unknown; ts?: number; project?: string; agent?: string }): void {
    const project = event.project ?? 'default';
    const full: ReplayEvent = {
      type: event.type,
      payload: event.payload,
      ts: event.ts ?? Date.now(),
      project,
      agent: event.agent,
    };
    try {
      const file = this.fileFor(project);
      fs.appendFileSync(file, JSON.stringify(full) + '\n');
    } catch { /* persistence non-fatal */ }
  }

  /** Read all events for a project as a timeline of frames (downsampled). */
  getTimeline(project: string, opts: { from?: number; to?: number; types?: string[] } = {}): ReplayFrame[] {
    const events = this.readEvents(project, opts);
    if (!events.length) return [];

    const frames: ReplayFrame[] = [];
    const seen = new Set<string>();
    let lastFrameTs = events[0].ts;
    let lastFrameIdx = 0;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const sinceLast = ev.ts - lastFrameTs;
      const eventsSinceLast = i - lastFrameIdx;

      const shouldFrame =
        i === events.length - 1 ||
        eventsSinceLast >= FRAME_EVERY_EVENTS ||
        sinceLast >= FRAME_EVERY_MS;

      if (shouldFrame) {
        frames.push(this.buildFrame(events.slice(0, i + 1), seen, frames[frames.length - 1]));
        lastFrameTs = ev.ts;
        lastFrameIdx = i;
      }
    }
    return frames;
  }

  /** Return the brain state as it would have appeared at exactly `ts`. */
  frameAt(project: string, ts: number): ReplayFrame {
    const events = this.readEvents(project, { to: ts });
    if (!events.length) return this.emptyFrame(ts);
    const seen = new Set<string>();
    return this.buildFrame(events, seen);
  }

  /** Compact old events into snapshots + diff chains; keeps file size bounded. */
  compress(project: string): { kept: number; archived: number } {
    const file = this.fileFor(project);
    if (!fs.existsSync(file)) return { kept: 0, archived: 0 };
    const events = this.readEvents(project);
    if (events.length < COMPRESS_THRESHOLD) return { kept: events.length, archived: 0 };

    // Keep most recent half raw; collapse older half into snapshot frames.
    const cutoff = Math.floor(events.length / 2);
    const older = events.slice(0, cutoff);
    const newer = events.slice(cutoff);

    const seen = new Set<string>();
    const snapshots: ReplayFrame[] = [];
    for (let i = FRAME_EVERY_EVENTS; i <= older.length; i += FRAME_EVERY_EVENTS) {
      snapshots.push(this.buildFrame(older.slice(0, i), seen, snapshots[snapshots.length - 1]));
    }

    // Write snapshots sidecar + rewrite jsonl with only newer events.
    try {
      const snapFile = path.join(REPLAY_DIR, this.projectHash(project) + '.snap.json');
      fs.writeFileSync(snapFile, JSON.stringify({ schemaVersion: 1, snapshots }, null, 2));
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, newer.map(e => JSON.stringify(e)).join('\n') + '\n');
      fs.renameSync(tmp, file);
    } catch { /* non-fatal */ }

    return { kept: newer.length, archived: older.length };
  }

  /** Export as JSONL string, CSV string, or SVG Buffer. */
  export(project: string, format: 'jsonl' | 'csv' | 'svg'): string | Buffer {
    const events = this.readEvents(project);
    if (format === 'jsonl') {
      return events.map(e => JSON.stringify(e)).join('\n');
    }
    if (format === 'csv') {
      const rows = ['ts,iso,type,agent,project'];
      for (const e of events) {
        const iso = new Date(e.ts).toISOString();
        rows.push(`${e.ts},${iso},${e.type},${e.agent ?? ''},${e.project}`);
      }
      return rows.join('\n');
    }
    return Buffer.from(this.renderSvg(project, events), 'utf-8');
  }

  /** Get the raw event list (used by Brain DNA + tests). */
  listEvents(project: string, opts: { from?: number; to?: number; types?: string[] } = {}): ReplayEvent[] {
    return this.readEvents(project, opts);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private fileFor(project: string): string {
    return path.join(REPLAY_DIR, this.projectHash(project) + '.jsonl');
  }

  private projectHash(project: string): string {
    return crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
  }

  private readEvents(project: string, opts: { from?: number; to?: number; types?: string[] } = {}): ReplayEvent[] {
    const file = this.fileFor(project);
    if (!fs.existsSync(file)) return [];
    const out: ReplayEvent[] = [];
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as ReplayEvent;
          if (opts.from && ev.ts < opts.from) continue;
          if (opts.to && ev.ts > opts.to) continue;
          if (opts.types && !opts.types.includes(ev.type)) continue;
          out.push(ev);
        } catch { /* skip bad line */ }
      }
    } catch { /* missing file */ }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  private buildFrame(events: ReplayEvent[], seen: Set<string>, prev?: ReplayFrame): ReplayFrame {
    const ts = events[events.length - 1].ts;
    const entityCounts = new Map<string, number>();
    let memoryCount = 0;
    let modified = 0;

    for (const ev of events) {
      const key = this.entityKeyOf(ev);
      if (key) {
        if (seen.has(key)) modified++;
        else seen.add(key);
        entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1);
      }
      if (ev.type === 'memory.write' || ev.type === 'brain.remember') memoryCount++;
    }

    const topEntities = Array.from(entityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    const prevCount = prev?.eventCount ?? 0;
    const prevEntities = prev?.entityCount ?? 0;
    const added = Math.max(0, seen.size - prevEntities);
    const decayed = events.filter(e => e.type === 'memory.decay' || e.type === 'forget').length;

    return {
      ts,
      eventCount: events.length,
      memoryCount,
      entityCount: seen.size,
      topEntities,
      deltaFromPrevious: { added, modified: Math.max(0, modified - (prev?.eventCount ?? 0)), decayed },
      healthScore: this.estimateHealth(events.length - prevCount, decayed),
    };
  }

  private entityKeyOf(ev: ReplayEvent): string | null {
    const p = ev.payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== 'object') return null;
    return (p.entity as string) || (p.id as string) || (p.name as string) || null;
  }

  private estimateHealth(eventsInFrame: number, decayed: number): number {
    if (eventsInFrame === 0) return 0.5;
    const decayRatio = decayed / eventsInFrame;
    return Math.max(0, Math.min(1, 1 - decayRatio * 0.5));
  }

  private emptyFrame(ts: number): ReplayFrame {
    return { ts, eventCount: 0, memoryCount: 0, entityCount: 0, topEntities: [],
      deltaFromPrevious: { added: 0, modified: 0, decayed: 0 }, healthScore: 0.5 };
  }

  // ── SVG renderer (Twitter-ready marketing artifact) ─────────────────────────

  private renderSvg(project: string, events: ReplayEvent[]): string {
    const W = 1200, H = 300, PAD = 40;
    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;
    const projName = path.basename(path.resolve(project));

    if (!events.length) return this.emptySvg(W, H, projName);

    const t0 = events[0].ts;
    const t1 = events[events.length - 1].ts;
    const span = Math.max(1, t1 - t0);

    // Histogram of event density across 80 buckets
    const BUCKETS = 80;
    const buckets = new Array<number>(BUCKETS).fill(0);
    for (const ev of events) {
      const b = Math.min(BUCKETS - 1, Math.floor(((ev.ts - t0) / span) * BUCKETS));
      buckets[b]++;
    }
    const peak = Math.max(1, ...buckets);

    // Color map per event type
    const typeColor = (t: string): string => {
      if (t.startsWith('memory') || t.includes('remember')) return '#00ffd5';
      if (t.includes('decay') || t.includes('forget')) return '#ff5577';
      if (t.includes('agent') || t.includes('handoff')) return '#ffb84d';
      if (t.includes('decision') || t.includes('adr')) return '#a78bfa';
      if (t.includes('collision') || t.includes('error')) return '#ff3860';
      return '#7dd3fc';
    };

    // Milestone markers: first memory, 100th entity, first collision, halfway, last
    const milestones = this.findMilestones(events);

    const bars: string[] = [];
    const barW = innerW / BUCKETS;
    for (let i = 0; i < BUCKETS; i++) {
      const h = (buckets[i] / peak) * (innerH - 40);
      const x = PAD + i * barW;
      const y = H - PAD - h;
      bars.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="url(#barGrad)" rx="1"/>`);
    }

    const dots: string[] = [];
    const maxDots = 400;
    const stride = Math.max(1, Math.ceil(events.length / maxDots));
    for (let i = 0; i < events.length; i += stride) {
      const ev = events[i];
      const x = PAD + ((ev.ts - t0) / span) * innerW;
      const y = H - PAD - 4;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y}" r="2" fill="${typeColor(ev.type)}" opacity="0.85"/>`);
    }

    const marks: string[] = [];
    for (const m of milestones) {
      const x = PAD + ((m.ts - t0) / span) * innerW;
      marks.push(`<line x1="${x.toFixed(1)}" y1="${PAD + 8}" x2="${x.toFixed(1)}" y2="${H - PAD}" stroke="#ffffff" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.4"/>`);
      marks.push(`<text x="${x.toFixed(1)}" y="${PAD + 4}" fill="#ffffff" font-size="9" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.7">${esc(m.label)}</text>`);
    }

    const days = Math.max(1, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
    const stats = `${events.length.toLocaleString()} events · ${days}d · peak ${peak}/bucket`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1628"/>
      <stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#00ffd5" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#00ffd5" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${PAD}" y="26" fill="#e2f5ff" font-size="16" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)} · Brain Replay</text>
  <text x="${W - PAD}" y="26" fill="#7dd3fc" font-size="11" font-family="ui-monospace,monospace" text-anchor="end">${esc(stats)}</text>
  <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#7dd3fc" stroke-width="0.5" opacity="0.5"/>
  ${bars.join('\n  ')}
  ${dots.join('\n  ')}
  ${marks.join('\n  ')}
  <text x="${PAD}" y="${H - 12}" fill="#7dd3fc" font-size="10" font-family="ui-monospace,monospace" opacity="0.7">${new Date(t0).toISOString().slice(0, 10)}</text>
  <text x="${W - PAD}" y="${H - 12}" fill="#7dd3fc" font-size="10" font-family="ui-monospace,monospace" text-anchor="end" opacity="0.7">${new Date(t1).toISOString().slice(0, 10)}</text>
</svg>`;
  }

  private emptySvg(W: number, H: number, name: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1628"/><stop offset="1" stop-color="#0d2540"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${W / 2}" y="${H / 2}" fill="#7dd3fc" font-size="18" font-family="ui-sans-serif,system-ui" text-anchor="middle">${esc(name)} · awaiting first event</text>
</svg>`;
  }

  private findMilestones(events: ReplayEvent[]): Array<{ ts: number; label: string }> {
    const out: Array<{ ts: number; label: string }> = [];
    const entities = new Set<string>();
    let firstMemory = false;
    let firstCollision = false;
    for (const ev of events) {
      const key = this.entityKeyOf(ev);
      if (key) entities.add(key);
      if (!firstMemory && (ev.type === 'memory.write' || ev.type === 'brain.remember')) {
        out.push({ ts: ev.ts, label: '1st memory' });
        firstMemory = true;
      }
      if (entities.size === 100 && !out.find(m => m.label === '100 entities')) {
        out.push({ ts: ev.ts, label: '100 entities' });
      }
      if (!firstCollision && ev.type.includes('collision')) {
        out.push({ ts: ev.ts, label: '1st collision' });
        firstCollision = true;
      }
    }
    return out.slice(0, 6);
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

let _instance: BrainReplay | null = null;
export function getBrainReplay(): BrainReplay {
  if (!_instance) _instance = new BrainReplay();
  return _instance;
}
export function resetBrainReplayForTests(): void { _instance = null; }
