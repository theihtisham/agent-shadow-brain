// src/brain/brain-trophies.ts — Brain Trophies (viral feature)
// v6.0.2
//
// 25 video-game-style achievements + shareable SVG trophy cards (1200x630
// OG-image/Twitter-card size). Wall-of-trophies is 1200x800. Persists unlocks
// to ~/.shadow-brain/trophies/<project_hash>.json. Zero new npm deps.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';
import { BrainDna, getBrainDna, ArchetypeName } from './brain-dna.js';

const TROPHIES_DIR = path.join(os.homedir(), '.shadow-brain', 'trophies');

// ── Types ────────────────────────────────────────────────────────────────────

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  criteria: string;
  unlockedAt?: number;
}

export interface ProgressEntry {
  achievement: Achievement;
  progressPct: number;
}

export interface ProgressReport {
  unlocked: Achievement[];
  inProgress: ProgressEntry[];
}

interface UnlockStore {
  schemaVersion: 1;
  project: string;
  unlocks: Record<string, number>;
}

interface BrainSignals {
  totalMemories: number;
  uniqueAgents: number;
  longestStreakDays: number;
  hasReflection: boolean;
  brierScore?: number;
  ece?: number;
  hasTeamSync: boolean;
  hasBrainExchangeImport: boolean;
  hasPrAutoReview: boolean;
  archetype: ArchetypeName;
  ageDays: number;
  collisions: number;
  decisions: number;
  hallucinations: number;
  cacheHitRate?: number;
  fastestRecallMs?: number;
  searchesInDay: number;
  reflections: number;
  thirdAmCommit: boolean;
  oldBugFixed: boolean;
  capsuleRestored: boolean;
  searchOver10kMs?: number;
}

// ── Achievement Catalog (25) ─────────────────────────────────────────────────

const RARITY_COLORS: Record<Rarity, { primary: string; secondary: string; glow: string }> = {
  common:    { primary: '#00ffd5', secondary: '#7dd3fc', glow: '#00ffd5' },
  rare:      { primary: '#a78bfa', secondary: '#c4b5fd', glow: '#a78bfa' },
  epic:      { primary: '#ff5fdc', secondary: '#fb7185', glow: '#ff5fdc' },
  legendary: { primary: '#fbbf24', secondary: '#fcd34d', glow: '#fbbf24' },
};
const RARITY_LABEL: Record<Rarity, string> = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };

const CATALOG: Achievement[] = [
  { id: 'first-memory',     name: 'First Spark',         description: 'Recorded your very first memory.',         icon: '\u{1F31F}', rarity: 'common',    criteria: 'totalMemories >= 1' },
  { id: 'memories-10',      name: 'Tenfold',             description: 'Recorded 10 memories.',                    icon: '\u{1F4DD}', rarity: 'common',    criteria: 'totalMemories >= 10' },
  { id: 'memories-100',     name: 'Centurion',           description: 'Recorded 100 memories.',                   icon: '\u{1F4DA}', rarity: 'rare',      criteria: 'totalMemories >= 100' },
  { id: 'memories-1k',      name: 'Knowledge Vault',     description: 'Recorded 1,000 memories.',                 icon: '\u{1F5C4}', rarity: 'epic',      criteria: 'totalMemories >= 1000' },
  { id: 'memories-10k',     name: 'Archive Sovereign',   description: 'Recorded 10,000 memories.',                icon: '\u{1F451}', rarity: 'legendary', criteria: 'totalMemories >= 10000' },
  { id: 'streak-7',         name: 'Week One',            description: '7 consecutive days of brain activity.',    icon: '\u{1F525}', rarity: 'common',    criteria: 'longestStreakDays >= 7' },
  { id: 'streak-30',        name: 'Monthly Mind',        description: '30 consecutive days of brain activity.',   icon: '\u{1F4C5}', rarity: 'rare',      criteria: 'longestStreakDays >= 30' },
  { id: 'streak-100',       name: 'Centennial Streak',   description: '100 consecutive days of brain activity.',  icon: '\u{1F3C6}', rarity: 'legendary', criteria: 'longestStreakDays >= 100' },
  { id: 'agents-2',         name: 'Two Heads',           description: 'Shared memory across 2 different agents.', icon: '\u{1F91D}', rarity: 'common',    criteria: 'uniqueAgents >= 2' },
  { id: 'agents-5',         name: 'Hive Mind',           description: 'Shared memory across 5 different agents.', icon: '\u{1F41D}', rarity: 'rare',      criteria: 'uniqueAgents >= 5' },
  { id: 'agents-10',        name: 'Federation',          description: 'Shared memory across 10 different agents.',icon: '\u{1F30D}', rarity: 'epic',      criteria: 'uniqueAgents >= 10' },
  { id: 'brier-low',        name: 'Sharp Predictor',     description: 'Achieved Brier score below 0.10.',         icon: '\u{1F3AF}', rarity: 'epic',      criteria: 'brierScore < 0.10' },
  { id: 'ece-low',          name: 'Calibration Master',  description: 'Expected calibration error below 0.05.',   icon: '\u{1F4D0}', rarity: 'legendary', criteria: 'ece < 0.05' },
  { id: 'first-team-sync',  name: 'Sync Initiate',       description: 'Completed first team sync.',               icon: '\u{1F501}', rarity: 'rare',      criteria: 'hasTeamSync' },
  { id: 'first-bx-import',  name: 'Exchange Initiate',   description: 'Imported your first brain exchange.',      icon: '\u{1F4E6}', rarity: 'rare',      criteria: 'hasBrainExchangeImport' },
  { id: 'first-pr-review',  name: 'PR Whisperer',        description: 'First automated PR review.',               icon: '\u{1F50D}', rarity: 'rare',      criteria: 'hasPrAutoReview' },
  { id: 'arc-architect',    name: "Architect's Toolkit", description: 'Embraced The Architect archetype.',        icon: '\u{1F4D0}', rarity: 'epic',      criteria: 'archetype == The Architect' },
  { id: 'arc-debugger',     name: "Debugger's Eye",      description: 'Embraced The Debugger archetype.',         icon: '\u{1F441}', rarity: 'epic',      criteria: 'archetype == The Debugger' },
  { id: 'egg-3am',          name: 'The Witching Hour',   description: 'Committed brain activity at 3am local.',   icon: '\u{1F319}', rarity: 'rare',      criteria: 'thirdAmCommit' },
  { id: 'egg-old-bug',      name: 'Ancient Fix',         description: 'Fixed a bug introduced 1+ year ago.',      icon: '\u{1F9D9}', rarity: 'legendary', criteria: 'oldBugFixed' },
  { id: 'egg-capsule',      name: 'Time Traveler',       description: 'Restored a time capsule.',                 icon: '\u{23F3}',  rarity: 'epic',      criteria: 'capsuleRestored' },
  { id: 'speed-recall',     name: 'Sub-50',              description: 'Achieved sub-50ms recall.',                icon: '\u{26A1}',  rarity: 'epic',      criteria: 'fastestRecallMs < 50' },
  { id: 'speed-search-10k', name: 'Vector Lightning',    description: '100ms search over 10k vectors.',           icon: '\u{1F680}', rarity: 'legendary', criteria: 'searchOver10kMs <= 100' },
  { id: 'vol-searches',     name: 'Power User',          description: '1,000 searches in a single day.',          icon: '\u{1F4CA}', rarity: 'rare',      criteria: 'searchesInDay >= 1000' },
  { id: 'vol-reflections',  name: 'Dream Engineer',      description: '100 dream-engine reflections.',            icon: '\u{1F4AD}', rarity: 'epic',      criteria: 'reflections >= 100' },
];

interface Rule {
  check: (s: BrainSignals) => boolean;
  progress?: (s: BrainSignals) => { current: number; target: number };
}

const RULES: Record<string, Rule> = {
  'first-memory':     { check: s => s.totalMemories >= 1,     progress: s => ({ current: s.totalMemories, target: 1 }) },
  'memories-10':      { check: s => s.totalMemories >= 10,    progress: s => ({ current: s.totalMemories, target: 10 }) },
  'memories-100':     { check: s => s.totalMemories >= 100,   progress: s => ({ current: s.totalMemories, target: 100 }) },
  'memories-1k':      { check: s => s.totalMemories >= 1000,  progress: s => ({ current: s.totalMemories, target: 1000 }) },
  'memories-10k':     { check: s => s.totalMemories >= 10000, progress: s => ({ current: s.totalMemories, target: 10000 }) },
  'streak-7':         { check: s => s.longestStreakDays >= 7,   progress: s => ({ current: s.longestStreakDays, target: 7 }) },
  'streak-30':        { check: s => s.longestStreakDays >= 30,  progress: s => ({ current: s.longestStreakDays, target: 30 }) },
  'streak-100':       { check: s => s.longestStreakDays >= 100, progress: s => ({ current: s.longestStreakDays, target: 100 }) },
  'agents-2':         { check: s => s.uniqueAgents >= 2,  progress: s => ({ current: s.uniqueAgents, target: 2 }) },
  'agents-5':         { check: s => s.uniqueAgents >= 5,  progress: s => ({ current: s.uniqueAgents, target: 5 }) },
  'agents-10':        { check: s => s.uniqueAgents >= 10, progress: s => ({ current: s.uniqueAgents, target: 10 }) },
  'brier-low':        { check: s => typeof s.brierScore === 'number' && s.brierScore < 0.10 },
  'ece-low':          { check: s => typeof s.ece === 'number' && s.ece < 0.05 },
  'first-team-sync':  { check: s => s.hasTeamSync },
  'first-bx-import':  { check: s => s.hasBrainExchangeImport },
  'first-pr-review':  { check: s => s.hasPrAutoReview },
  'arc-architect':    { check: s => s.archetype === 'The Architect' },
  'arc-debugger':     { check: s => s.archetype === 'The Debugger' },
  'egg-3am':          { check: s => s.thirdAmCommit },
  'egg-old-bug':      { check: s => s.oldBugFixed },
  'egg-capsule':      { check: s => s.capsuleRestored },
  'speed-recall':     { check: s => typeof s.fastestRecallMs === 'number' && s.fastestRecallMs < 50 },
  'speed-search-10k': { check: s => typeof s.searchOver10kMs === 'number' && s.searchOver10kMs <= 100 },
  'vol-searches':     { check: s => s.searchesInDay >= 1000, progress: s => ({ current: s.searchesInDay, target: 1000 }) },
  'vol-reflections':  { check: s => s.reflections >= 100,    progress: s => ({ current: s.reflections, target: 100 }) },
};

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainTrophies {
  private brain: GlobalBrain;
  private replay: BrainReplay;
  private dna: BrainDna;

  constructor(brain?: GlobalBrain, replay?: BrainReplay, dna?: BrainDna) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
    this.dna = dna ?? getBrainDna();
    try { fs.mkdirSync(TROPHIES_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  /** All achievements that are currently unlocked for a project. */
  async getAchievements(project: string): Promise<Achievement[]> {
    const store = this.loadStore(project);
    const progress = await this.checkProgress(project);
    return progress.unlocked.map(a => ({ ...a, unlockedAt: store.unlocks[a.id] ?? a.unlockedAt }));
  }

  /** Re-evaluate progress; auto-persists newly-met thresholds. */
  async checkProgress(project: string): Promise<ProgressReport> {
    const signals = this.collectSignals(project);
    const store = this.loadStore(project);
    const unlocked: Achievement[] = [];
    const inProgress: ProgressEntry[] = [];

    for (const def of CATALOG) {
      const met = this.meets(def, signals);
      const stored = store.unlocks[def.id];
      if (met || stored) {
        const at = stored ?? Date.now();
        if (!stored) store.unlocks[def.id] = at;
        unlocked.push({ ...def, unlockedAt: at });
      } else {
        inProgress.push({ achievement: def, progressPct: this.progressPct(def, signals) });
      }
    }
    this.saveStore(project, store);
    inProgress.sort((a, b) => b.progressPct - a.progressPct);
    return { unlocked, inProgress };
  }

  /** Manually unlock an achievement (mostly internal). */
  unlock(project: string, achievementId: string): void {
    const def = CATALOG.find(a => a.id === achievementId);
    if (!def) return;
    const store = this.loadStore(project);
    if (!store.unlocks[achievementId]) {
      store.unlocks[achievementId] = Date.now();
      this.saveStore(project, store);
    }
  }

  /** Generate a shareable SVG card for one achievement. */
  generateCard(project: string, achievementId: string, opts: { style?: 'card' | 'badge' | 'trophy' } = {}): { svg: string } {
    const def = CATALOG.find(a => a.id === achievementId) ?? CATALOG[0];
    const store = this.loadStore(project);
    const unlockedAt = store.unlocks[def.id];
    const style = opts.style ?? 'card';
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    if (style === 'badge') return { svg: this.renderBadge(projName, def, unlockedAt) };
    if (style === 'trophy') return { svg: this.renderTrophy(projName, def, unlockedAt) };
    return { svg: this.renderCard(projName, def, unlockedAt) };
  }

  /** A 1200x800 wall of all trophies (locked + unlocked). */
  wallSvg(project: string): { svg: string } {
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    const store = this.loadStore(project);
    return { svg: this.renderWall(projName, store) };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private collectSignals(project: string): BrainSignals {
    const stats = this.safeStats(project);
    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project); } catch { /* empty */ }
    const eventTypes = new Set(events.map(e => e.type));
    const types = Array.from(eventTypes);
    const has = (sub: string): boolean => types.some(t => t.includes(sub));
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    let brierScore: number | undefined, ece: number | undefined;
    for (const e of events) {
      const p = e.payload as { brier?: number; ece?: number } | null;
      if (typeof p?.brier === 'number') brierScore = brierScore === undefined ? p.brier : Math.min(brierScore, p.brier);
      if (typeof p?.ece === 'number') ece = ece === undefined ? p.ece : Math.min(ece, p.ece);
    }
    return {
      totalMemories: stats.totalMemories,
      uniqueAgents: stats.agentContributions.length,
      longestStreakDays: this.computeStreaks(events),
      hasReflection: events.some(e => e.type.includes('reflection') || e.type.includes('dream')),
      brierScore, ece,
      hasTeamSync: has('team.sync') || has('team-sync'),
      hasBrainExchangeImport: has('brain-exchange.import') || has('bx.import'),
      hasPrAutoReview: has('pr.review') || has('pr-auto-review'),
      archetype: stats.archetype,
      ageDays: stats.ageDays,
      collisions: stats.collisionsDetected,
      decisions: stats.decisionsRecorded,
      hallucinations: stats.hallucinationsCaught,
      cacheHitRate: stats.cacheHitRate,
      fastestRecallMs: this.minLatency(events, ['recall', 'memory.read']),
      searchesInDay: this.peakSearchesInDay(events.filter(e => e.type.includes('search') || e.type.includes('recall'))),
      reflections: events.filter(e => e.type.includes('reflection') || e.type.includes('dream')).length,
      thirdAmCommit: events.some(e => new Date(e.ts).getHours() === 3 && (e.type.includes('commit') || e.type.includes('memory.write'))),
      oldBugFixed: events.some(e => {
        const p = e.payload as { introducedAt?: number } | null;
        return e.type.includes('bug.fix') && typeof p?.introducedAt === 'number' && (e.ts - p.introducedAt) >= yearMs;
      }),
      capsuleRestored: has('capsule.restore') || has('time-capsule.restored'),
      searchOver10kMs: this.minLatency(events.filter(e => Number((e.payload as { vectors?: number } | null)?.vectors) >= 10000), ['search']),
    };
  }

  private safeStats(project: string): ReturnType<BrainDna['computeStats']> {
    try { return this.dna.computeStats(project); }
    catch {
      return { totalMemories: 0, totalEntities: 0, ageDays: 0,
        archetype: 'The Wanderer' as ArchetypeName, archetypeTagline: '',
        agentContributions: [], hallucinationsCaught: 0, decisionsRecorded: 0,
        collisionsDetected: 0, cacheHitRate: undefined,
        topEntities: [], dominantPatterns: [], topLanguages: [] };
    }
  }

  private meets(def: Achievement, s: BrainSignals): boolean {
    const r = RULES[def.id];
    return r ? r.check(s) : false;
  }

  private progressPct(def: Achievement, s: BrainSignals): number {
    const r = RULES[def.id];
    if (!r || !r.progress) return 0;
    const { current, target } = r.progress(s);
    return Math.min(0.99, Math.max(0, current / target));
  }

  private computeStreaks(events: ReplayEvent[]): number {
    if (!events.length) return 0;
    const days = new Set<string>();
    for (const e of events) days.add(new Date(e.ts).toISOString().slice(0, 10));
    const sorted = Array.from(days).sort();
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

  private peakSearchesInDay(events: ReplayEvent[]): number {
    const counts = new Map<string, number>();
    for (const e of events) {
      const day = new Date(e.ts).toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    let peak = 0;
    counts.forEach(v => { if (v > peak) peak = v; });
    return peak;
  }

  private minLatency(events: ReplayEvent[], typeMarkers: string[]): number | undefined {
    let min: number | undefined;
    for (const e of events) {
      if (!typeMarkers.some(m => e.type.includes(m))) continue;
      const p = e.payload as { latencyMs?: number; durationMs?: number; ms?: number } | null;
      const ms = p?.latencyMs ?? p?.durationMs ?? p?.ms;
      if (typeof ms === 'number' && (min === undefined || ms < min)) min = ms;
    }
    return min;
  }

  private loadStore(project: string): UnlockStore {
    const file = this.fileFor(project);
    if (!fs.existsSync(file)) return { schemaVersion: 1, project, unlocks: {} };
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as UnlockStore;
      if (!parsed.unlocks) parsed.unlocks = {};
      return parsed;
    } catch { return { schemaVersion: 1, project, unlocks: {} }; }
  }

  private saveStore(project: string, store: UnlockStore): void {
    try { fs.writeFileSync(this.fileFor(project), JSON.stringify(store, null, 2)); }
    catch { /* persistence non-fatal */ }
  }

  private fileFor(project: string): string {
    const hash = crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
    return path.join(TROPHIES_DIR, hash + '.json');
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private renderCard(projName: string, def: Achievement, unlockedAt?: number): string {
    const W = 1200, H = 630;
    const c = RARITY_COLORS[def.rarity];
    const unlocked = !!unlockedAt;
    const dateStr = unlockedAt ? new Date(unlockedAt).toISOString().slice(0, 10) : 'LOCKED';
    const ribbonText = `${RARITY_LABEL[def.rarity]} ACHIEVEMENT`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- TODO: Ed25519-signed export marker -->
  <defs>
    <linearGradient id="t-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050a18"/>
      <stop offset="0.5" stop-color="#0a1628"/>
      <stop offset="1" stop-color="#0d2540"/>
    </linearGradient>
    <radialGradient id="t-halo" cx="0.22" cy="0.5" r="0.45">
      <stop offset="0" stop-color="${c.glow}" stop-opacity="${unlocked ? 0.45 : 0.12}"/>
      <stop offset="1" stop-color="${c.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="t-hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${c.primary}"/>
      <stop offset="1" stop-color="${c.secondary}"/>
    </linearGradient>
    <linearGradient id="t-ribbon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${c.primary}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${c.primary}" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#t-bg)"/>
  <rect width="${W}" height="${H}" fill="url(#t-halo)"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${c.primary}" stroke-opacity="${unlocked ? 0.5 : 0.18}" stroke-width="2" rx="18"/>

  <!-- rarity ribbon -->
  <g transform="translate(48,40)">
    <rect width="280" height="34" fill="url(#t-ribbon)" rx="3"/>
    <text x="14" y="22" fill="#050a18" font-size="13" font-family="ui-monospace,SFMono-Regular,monospace" font-weight="800" letter-spacing="3">${esc(ribbonText)}</text>
  </g>

  <!-- icon circle -->
  <g transform="translate(180,310)">
    <circle r="140" fill="${c.primary}" fill-opacity="${unlocked ? 0.12 : 0.04}" stroke="${c.primary}" stroke-opacity="${unlocked ? 0.7 : 0.2}" stroke-width="3"/>
    <circle r="100" fill="${c.primary}" fill-opacity="${unlocked ? 0.18 : 0.06}"/>
    <text x="0" y="50" fill="#ffffff" font-size="140" text-anchor="middle" opacity="${unlocked ? 1 : 0.35}">${esc(def.icon)}</text>
  </g>

  <!-- text block -->
  <g transform="translate(360,200)">
    <text x="0" y="0" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4" opacity="0.7">SHADOW BRAIN · v6.0.2</text>
    <text x="0" y="80" fill="url(#t-hero)" font-size="76" font-family="ui-sans-serif,system-ui" font-weight="800">${esc(def.name)}</text>
    <text x="0" y="130" fill="#cfe9ff" font-size="22" font-family="ui-sans-serif,system-ui" opacity="0.9">${esc(def.description)}</text>
    <rect x="0" y="155" width="180" height="3" fill="${c.primary}"/>
    <text x="0" y="200" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" opacity="0.7" letter-spacing="2">UNLOCK CRITERIA</text>
    <text x="0" y="225" fill="#e2f5ff" font-size="16" font-family="ui-monospace,monospace">${esc(def.criteria)}</text>
    <text x="0" y="280" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" opacity="0.7" letter-spacing="2">PROJECT</text>
    <text x="0" y="305" fill="#e2f5ff" font-size="20" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  </g>

  <text x="48" y="${H - 30}" fill="#7dd3fc" font-size="13" font-family="ui-monospace,monospace" opacity="0.75">npm i -g @theihtisham/agent-shadow-brain</text>
  <text x="${W - 48}" y="${H - 30}" fill="${c.primary}" font-size="14" font-family="ui-monospace,monospace" font-weight="700" text-anchor="end">${esc(dateStr)}</text>
</svg>`;
  }

  private renderBadge(projName: string, def: Achievement, unlockedAt?: number): string {
    const S = 400;
    const c = RARITY_COLORS[def.rarity];
    const op = unlockedAt ? 1 : 0.4;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <radialGradient id="b-bg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0d2540"/><stop offset="1" stop-color="#050a18"/></radialGradient>
    <linearGradient id="b-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.primary}"/><stop offset="1" stop-color="${c.secondary}"/></linearGradient>
  </defs>
  <circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 6}" fill="url(#b-bg)" stroke="url(#b-rim)" stroke-width="6" opacity="${op}"/>
  <text x="${S / 2}" y="${S / 2 + 30}" fill="#ffffff" font-size="160" text-anchor="middle" opacity="${op}">${esc(def.icon)}</text>
  <text x="${S / 2}" y="${S - 50}" fill="${c.primary}" font-size="16" font-family="ui-monospace,monospace" font-weight="700" text-anchor="middle" letter-spacing="2">${esc(def.name.toUpperCase())}</text>
  <text x="${S / 2}" y="${S - 28}" fill="#7dd3fc" font-size="11" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.7">${esc(projName)}</text>
</svg>`;
  }

  private renderTrophy(projName: string, def: Achievement, unlockedAt?: number): string {
    const W = 800, H = 1000;
    const c = RARITY_COLORS[def.rarity];
    const op = unlockedAt ? 1 : 0.35;
    const dateStr = unlockedAt ? new Date(unlockedAt).toISOString().slice(0, 10) : 'LOCKED';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="tr-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a18"/><stop offset="1" stop-color="#0d2540"/></linearGradient>
    <linearGradient id="tr-cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.primary}"/><stop offset="1" stop-color="${c.secondary}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#tr-bg)"/>
  <g transform="translate(${W / 2},340)" opacity="${op}">
    <ellipse cx="0" cy="220" rx="220" ry="22" fill="${c.primary}" opacity="0.18"/>
    <rect x="-60" y="140" width="120" height="80" fill="url(#tr-cup)" rx="6"/>
    <rect x="-110" y="100" width="220" height="50" fill="url(#tr-cup)" rx="8"/>
    <path d="M -160 -80 Q -200 0 -110 80 Z" fill="url(#tr-cup)"/>
    <path d="M 160 -80 Q 200 0 110 80 Z" fill="url(#tr-cup)"/>
    <rect x="-160" y="-120" width="320" height="220" fill="url(#tr-cup)" rx="20"/>
    <text x="0" y="40" fill="#050a18" font-size="180" text-anchor="middle">${esc(def.icon)}</text>
  </g>
  <text x="${W / 2}" y="${H - 280}" fill="${c.primary}" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="4">${esc(RARITY_LABEL[def.rarity])} TROPHY</text>
  <text x="${W / 2}" y="${H - 220}" fill="url(#tr-cup)" font-size="62" font-family="ui-sans-serif,system-ui" font-weight="800" text-anchor="middle">${esc(def.name)}</text>
  <text x="${W / 2}" y="${H - 170}" fill="#cfe9ff" font-size="20" font-family="ui-sans-serif,system-ui" text-anchor="middle" opacity="0.85">${esc(def.description)}</text>
  <text x="${W / 2}" y="${H - 100}" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.75">${esc(projName)} · ${esc(dateStr)}</text>
  <text x="${W / 2}" y="${H - 50}" fill="#7dd3fc" font-size="12" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.6">npm i -g @theihtisham/agent-shadow-brain</text>
</svg>`;
  }

  private renderWall(projName: string, store: UnlockStore): string {
    const W = 1200, H = 800, P = 48, cols = 5;
    const cellW = (W - P * 2) / cols, cellH = 130, gridStartY = 180;
    const unlockedCount = Object.keys(store.unlocks).length;
    const tiles = CATALOG.map((def, i) => {
      const c = RARITY_COLORS[def.rarity];
      const x = P + (i % cols) * cellW, y = gridStartY + Math.floor(i / cols) * cellH;
      const ok = !!store.unlocks[def.id];
      return `<g transform="translate(${x},${y})">
    <rect width="${cellW - 16}" height="${cellH - 16}" fill="${c.primary}" fill-opacity="${ok ? 0.08 : 0.02}" stroke="${c.primary}" stroke-opacity="${ok ? 0.5 : 0.15}" stroke-width="1.5" rx="10"/>
    <text x="20" y="50" fill="#ffffff" font-size="42" opacity="${ok ? 1 : 0.25}">${esc(def.icon)}</text>
    <text x="80" y="40" fill="${ok ? c.primary : '#5a7a98'}" font-size="13" font-family="ui-monospace,monospace" font-weight="700">${esc(def.name)}</text>
    <text x="80" y="60" fill="#7dd3fc" font-size="10" font-family="ui-monospace,monospace" opacity="${ok ? 0.7 : 0.35}">${esc(RARITY_LABEL[def.rarity])}</text>
    <text x="80" y="82" fill="#cfe9ff" font-size="11" font-family="ui-sans-serif,system-ui" opacity="${ok ? 0.85 : 0.35}">${esc(truncate(def.description, 48))}</text>
  </g>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><linearGradient id="w-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050a18"/><stop offset="1" stop-color="#0d2540"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#w-bg)"/>
  <text x="${P}" y="68" fill="#7dd3fc" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">SHADOW BRAIN · TROPHY WALL</text>
  <text x="${P}" y="112" fill="#e2f5ff" font-size="38" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <text x="${P}" y="142" fill="#7dd3fc" font-size="16" font-family="ui-monospace,monospace" opacity="0.75">${unlockedCount} / ${CATALOG.length} unlocked</text>
  ${tiles.join('\n  ')}
  <text x="${P}" y="${H - 24}" fill="#7dd3fc" font-size="12" font-family="ui-monospace,monospace" opacity="0.6">npm i -g @theihtisham/agent-shadow-brain</text>
</svg>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

let _instance: BrainTrophies | null = null;
export function getBrainTrophies(): BrainTrophies {
  if (!_instance) _instance = new BrainTrophies();
  return _instance;
}
export function resetBrainTrophiesForTests(): void { _instance = null; }
