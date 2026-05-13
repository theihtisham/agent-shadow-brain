// src/brain/brain-coach.ts — Proactive idle suggestion engine
// v6.0.2 — Hive Mind Edition
//
// Observes brain activity events and proactively surfaces helpful
// suggestions when the user goes idle. All detection is heuristic /
// deterministic — no LLM dependencies. Suggestions are persisted per
// project under ~/.shadow-brain/coach/<project>.json.
//
// Exposed: observe(event), suggestions(project, opts?), dismiss(id),
// pinned(), pin(id), unpin(id), idleCheck(project, idleSinceMs).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const COACH_DIR = path.join(os.homedir(), '.shadow-brain', 'coach');
const MAX_EVENTS = 500;

export type CoachEventType =
  | 'memory.add' | 'memory.search' | 'memory.unconfirmed'
  | 'commit' | 'file.touch' | 'file.refactor.start'
  | 'bug.solved' | 'debug.attempt'
  | 'capsule.freeze' | 'dna.generate' | 'replay.view'
  | 'agent.spawn' | 'hive.share' | 'voice.ask'
  | 'constitution.violation' | 'idle' | 'session.start';

export type SuggestionKind =
  | 'reminder' | 'pattern-spotted' | 'next-action'
  | 'warning' | 'celebrate';

export interface CoachEvent {
  type: CoachEventType;
  ts?: number;
  project?: string;
  payload?: Record<string, unknown>;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  priority: number; // 0..1
  title: string;
  body: string;
  evidence: string[];
  emoji: string;
  actionHints: string[];
  createdAt: number;
}

interface ProjectState {
  events: Array<CoachEvent & { ts: number; project: string }>;
  dismissed: Record<string, number>;
  pinned: Record<string, Suggestion>;
  surfaced: Record<string, number>;
}

interface CoachFile {
  schemaVersion: 1;
  state: ProjectState;
}

interface SuggestionRule {
  id: string;
  detect: (events: ProjectState['events'], project: string, now: number) => Suggestion | null;
}

export class BrainCoach {
  private states: Map<string, ProjectState> = new Map();
  private rules: SuggestionRule[] = [];

  constructor() {
    this.registerRules();
  }

  /** Feed a brain activity event into the coach. */
  observe(event: CoachEvent): void {
    const project = event.project || 'default';
    const ts = event.ts ?? Date.now();
    const state = this.loadState(project);
    state.events.push({ ...event, ts, project });
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
    this.persist(project, state);
  }

  /** Get current suggestions for a project. */
  async suggestions(
    project: string,
    opts: { topN?: number; sinceMs?: number } = {}
  ): Promise<Suggestion[]> {
    const topN = opts.topN ?? 5;
    const since = opts.sinceMs ?? 0;
    const state = this.loadState(project);
    const now = Date.now();
    const out: Suggestion[] = [];

    for (const rule of this.rules) {
      const s = rule.detect(state.events, project, now);
      if (!s) continue;
      if (state.dismissed[s.id]) continue;
      if (since && (state.surfaced[s.id] || 0) > now - since) continue;
      out.push(s);
    }
    out.sort((a, b) => b.priority - a.priority);
    const top = out.slice(0, topN);
    for (const s of top) state.surfaced[s.id] = now;
    this.persist(project, state);
    return top;
  }

  /** Mark a suggestion as seen — don't re-surface. */
  dismiss(suggestionId: string, project = 'default'): void {
    const state = this.loadState(project);
    state.dismissed[suggestionId] = Date.now();
    this.persist(project, state);
  }

  /** List pinned suggestions across all projects. */
  pinned(project = 'default'): Suggestion[] {
    const state = this.loadState(project);
    return Object.values(state.pinned);
  }

  pin(id: string, project = 'default'): void {
    const state = this.loadState(project);
    // Look in current rule outputs to find the suggestion
    for (const rule of this.rules) {
      const s = rule.detect(state.events, project, Date.now());
      if (s && s.id === id) {
        state.pinned[id] = s;
        this.persist(project, state);
        return;
      }
    }
  }

  unpin(id: string, project = 'default'): void {
    const state = this.loadState(project);
    delete state.pinned[id];
    this.persist(project, state);
  }

  /** Called when the user has been idle — surface what matters now. */
  async idleCheck(project: string, idleSinceMs: number): Promise<Suggestion[]> {
    // Idle boosts priority by adding an idle marker event
    this.observe({ type: 'idle', project, ts: Date.now(), payload: { idleSinceMs } });
    return this.suggestions(project, { topN: 3 });
  }

  // ── Rules ───────────────────────────────────────────────────────────

  private registerRules(): void {
    // Rule 1: Stale refactor reminder
    this.rules.push({
      id: 'stale-refactor',
      detect: (events, _project, now) => {
        const threeDays = 3 * 24 * 3600 * 1000;
        const refactors = events.filter(e => e.type === 'file.refactor.start');
        for (const r of refactors) {
          if (now - r.ts < threeDays) continue;
          const file = String(r.payload?.file ?? 'unknown');
          const committed = events.some(e =>
            e.type === 'commit' && e.ts > r.ts &&
            Array.isArray(e.payload?.files) &&
            (e.payload!.files as string[]).includes(file)
          );
          if (committed) continue;
          return mkSuggestion({
            id: `stale-refactor:${hashId(file + r.ts)}`,
            kind: 'reminder',
            priority: 0.75,
            title: 'Stale refactor detected',
            body: `You started refactoring \`${file}\` ${daysAgo(r.ts, now)} days ago but haven't committed. Want to review or pick it up?`,
            evidence: [`file.refactor.start @ ${new Date(r.ts).toISOString()}`],
            emoji: '🧹',
            actionHints: [`git diff -- ${file}`, `shadow-brain replay ${file}`],
          });
        }
        return null;
      },
    });

    // Rule 2: Repeated debug pattern
    this.rules.push({
      id: 'debug-pattern',
      detect: (events, _project, _now) => {
        const debugs = events.filter(e => e.type === 'debug.attempt');
        const counts: Record<string, number> = {};
        for (const d of debugs) {
          const tag = String(d.payload?.tag ?? d.payload?.category ?? 'general');
          counts[tag] = (counts[tag] || 0) + 1;
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!top || top[1] < 5) return null;
        return mkSuggestion({
          id: `debug-pattern:${top[0]}`,
          kind: 'pattern-spotted',
          priority: 0.65,
          title: 'Recurring bug pattern',
          body: `You've debugged ${top[0]} bugs ${top[1]} times. Consider extracting a helper or writing a regression suite.`,
          evidence: [`${top[1]}x debug.attempt tag=${top[0]}`],
          emoji: '🔁',
          actionHints: [`shadow-brain dna ${top[0]}`, `Write a tiny test fixture`],
        });
      },
    });

    // Rule 3: Unconfirmed memories — triage nudge
    this.rules.push({
      id: 'unconfirmed-memories',
      detect: (events, _project, _now) => {
        const unconfirmed = events.filter(e => e.type === 'memory.unconfirmed').length;
        if (unconfirmed < 5) return null;
        return mkSuggestion({
          id: `unconfirmed-memories:${Math.floor(unconfirmed / 5) * 5}`,
          kind: 'next-action',
          priority: 0.55,
          title: 'Memories waiting for triage',
          body: `Your brain has ${unconfirmed} unconfirmed memories. Want to confirm or prune them?`,
          evidence: [`${unconfirmed}x memory.unconfirmed`],
          emoji: '📥',
          actionHints: [`shadow-brain memory triage`, `shadow-brain memory list --unconfirmed`],
        });
      },
    });

    // Rule 4: Merge thrashing warning
    this.rules.push({
      id: 'merge-thrash',
      detect: (events, _project, now) => {
        const recent = events.filter(e =>
          e.type === 'commit' && now - e.ts < 6 * 3600 * 1000
        ).slice(-3);
        if (recent.length < 3) return null;
        const lineCounts: Record<string, number> = {};
        for (const c of recent) {
          const file = String(c.payload?.file ?? '');
          const line = Number(c.payload?.line ?? -1);
          if (!file || line < 0) continue;
          const k = `${file}:${line}`;
          lineCounts[k] = (lineCounts[k] || 0) + 1;
        }
        for (const [k, n] of Object.entries(lineCounts)) {
          if (n < 3) continue;
          return mkSuggestion({
            id: `merge-thrash:${hashId(k)}`,
            kind: 'warning',
            priority: 0.85,
            title: 'Possible merge thrashing',
            body: `Your last 3 commits modified \`${k}\` repeatedly. Possible flip-flop between branches or unresolved indecision.`,
            evidence: [`3x commit at ${k}`],
            emoji: '⚠️',
            actionHints: [`git log -p -- ${k.split(':')[0]}`, `Pair-program the decision`],
          });
        }
        return null;
      },
    });

    // Rule 5: Memory milestone — celebrate
    this.rules.push({
      id: 'memory-milestone',
      detect: (events, project, _now) => {
        const adds = events.filter(e => e.type === 'memory.add').length;
        const milestones = [10, 50, 100, 250, 500, 1000];
        const hit = milestones.findLast ? milestones.findLast(m => adds >= m) : milestones.slice().reverse().find(m => adds >= m);
        if (!hit) return null;
        return mkSuggestion({
          id: `memory-milestone:${hit}`,
          kind: 'celebrate',
          priority: 0.5,
          title: `${hit}th memory unlocked!`,
          body: `Your ${project} brain just crossed ${hit} memories. Trophy time. ${hit >= 100 ? '🎉' : '🌱'}`,
          evidence: [`${adds} total memory.add events`],
          emoji: '🏆',
          actionHints: [`shadow-brain trophies`, `shadow-brain dna --celebrate`],
        });
      },
    });

    // Rule 6: First capsule encouragement
    this.rules.push({
      id: 'first-capsule',
      detect: (events, _project, _now) => {
        const adds = events.filter(e => e.type === 'memory.add').length;
        const freezes = events.filter(e => e.type === 'capsule.freeze').length;
        if (adds < 20 || freezes > 0) return null;
        return mkSuggestion({
          id: 'first-capsule:nudge',
          kind: 'next-action',
          priority: 0.45,
          title: 'Freeze your first time capsule',
          body: `You have ${adds} memories but no capsules. Freezing one preserves a snapshot for time-travel diffs.`,
          evidence: [`${adds} memories, 0 capsules`],
          emoji: '🧊',
          actionHints: [`shadow-brain capsule freeze`, `shadow-brain replay --help`],
        });
      },
    });

    // Rule 7: Hive idle — invite collaboration
    this.rules.push({
      id: 'hive-idle',
      detect: (events, _project, now) => {
        const agents = events.filter(e => e.type === 'agent.spawn').length;
        if (agents < 2) return null;
        const lastShare = events.filter(e => e.type === 'hive.share').pop();
        const idle = !lastShare || now - lastShare.ts > 7 * 24 * 3600 * 1000;
        if (!idle) return null;
        return mkSuggestion({
          id: 'hive-idle:share',
          kind: 'next-action',
          priority: 0.4,
          title: 'Your hive has gone quiet',
          body: `You have ${agents} agents but no recent shares. Try \`shadow-brain hive sync\` to broadcast learnings.`,
          evidence: [`${agents} agents, last share > 7d ago or never`],
          emoji: '🐝',
          actionHints: [`shadow-brain hive sync`, `shadow-brain hive status`],
        });
      },
    });

    // Rule 8: Constitution violation streak
    this.rules.push({
      id: 'constitution-streak',
      detect: (events, _project, now) => {
        const oneWeek = 7 * 24 * 3600 * 1000;
        const recent = events.filter(e =>
          e.type === 'constitution.violation' && now - e.ts < oneWeek
        );
        if (recent.length < 3) return null;
        return mkSuggestion({
          id: `constitution-streak:${recent.length}`,
          kind: 'warning',
          priority: 0.8,
          title: 'Constitution drift',
          body: `${recent.length} constitution violations in the last week. A rule may be out-of-date or a habit is forming.`,
          evidence: recent.slice(-3).map(e => String(e.payload?.rule ?? 'unknown rule')),
          emoji: '📜',
          actionHints: [`shadow-brain constitution review`, `shadow-brain constitution audit`],
        });
      },
    });

    // Rule 9: Search-no-add (researching but not capturing)
    this.rules.push({
      id: 'search-no-add',
      detect: (events, _project, now) => {
        const day = 24 * 3600 * 1000;
        const recent = events.filter(e => now - e.ts < day);
        const searches = recent.filter(e => e.type === 'memory.search').length;
        const adds = recent.filter(e => e.type === 'memory.add').length;
        if (searches < 10 || adds >= 2) return null;
        return mkSuggestion({
          id: `search-no-add:${Math.floor(searches / 10) * 10}`,
          kind: 'pattern-spotted',
          priority: 0.5,
          title: 'Lots of looking, little capturing',
          body: `${searches} searches today, only ${adds} new memories. Are you forgetting to write down what you learn?`,
          evidence: [`${searches} memory.search`, `${adds} memory.add (today)`],
          emoji: '🔍',
          actionHints: [`shadow-brain memory add --quick`, `Enable auto-capture`],
        });
      },
    });

    // Rule 10: Welcome back — long absence
    this.rules.push({
      id: 'welcome-back',
      detect: (events, _project, now) => {
        if (events.length === 0) return null;
        const prevEvents = events.slice(0, -1);
        if (prevEvents.length === 0) return null;
        const lastBefore = prevEvents[prevEvents.length - 1];
        const gap = now - lastBefore.ts;
        const oneWeek = 7 * 24 * 3600 * 1000;
        if (gap < oneWeek) return null;
        return mkSuggestion({
          id: `welcome-back:${Math.floor(now / oneWeek)}`,
          kind: 'celebrate',
          priority: 0.35,
          title: 'Welcome back',
          body: `Your brain has been quiet for ${Math.floor(gap / (24 * 3600 * 1000))} days. Want a recap of where you left off?`,
          evidence: [`Last activity: ${new Date(lastBefore.ts).toISOString()}`],
          emoji: '👋',
          actionHints: [`shadow-brain recap`, `shadow-brain timeline --last 7d`],
        });
      },
    });
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private loadState(project: string): ProjectState {
    const cached = this.states.get(project);
    if (cached) return cached;
    const file = pathFor(project);
    let state: ProjectState = { events: [], dismissed: {}, pinned: {}, surfaced: {} };
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as CoachFile;
        if (raw.state) state = { ...state, ...raw.state };
      }
    } catch { /* fresh state */ }
    this.states.set(project, state);
    return state;
  }

  private persist(project: string, state: ProjectState): void {
    try {
      fs.mkdirSync(COACH_DIR, { recursive: true });
      const file = pathFor(project);
      const tmp = file + '.tmp';
      const wrapped: CoachFile = { schemaVersion: 1, state };
      fs.writeFileSync(tmp, JSON.stringify(wrapped, null, 2));
      fs.renameSync(tmp, file);
    } catch { /* non-fatal */ }
  }
}

function pathFor(project: string): string {
  const safe = project.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default';
  return path.join(COACH_DIR, `${safe}.json`);
}

function mkSuggestion(
  partial: Omit<Suggestion, 'createdAt'>
): Suggestion {
  return { ...partial, createdAt: Date.now() };
}

function daysAgo(ts: number, now: number): number {
  return Math.floor((now - ts) / (24 * 3600 * 1000));
}

function hashId(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

let _instance: BrainCoach | null = null;
export function getBrainCoach(): BrainCoach {
  if (!_instance) _instance = new BrainCoach();
  return _instance;
}
export function resetBrainCoachForTests(): void { _instance = null; }
