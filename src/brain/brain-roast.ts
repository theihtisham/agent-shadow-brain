// src/brain/brain-roast.ts — Brain Roast (viral feature)
// v6.0.2
//
// Comedy code-review mode. Reads brain events/memories, finds embarrassing
// patterns (TODO mountains, rename loops, abandoned refactors, recurring bugs),
// and generates spicy-but-affectionate roasts in one of six personas.
//
// Pure-stdlib, zero new npm deps. Template-based (no LLM). Graceful empty-state.

import * as path from 'path';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type RoastPersona =
  | 'gordon-ramsay'
  | 'simon-cowell'
  | 'mom'
  | 'comedian'
  | 'critic'
  | 'philosopher';

export type RoastIntensity = 'gentle' | 'medium' | 'savage';
export type RoastGrade = 'A+' | 'B-' | 'C' | 'F' | 'M for Mature';

export interface RoastEvidence {
  memory: string;
  observation: string;
}

export interface RoastResult {
  lines: string[];
  grade: RoastGrade;
  persona: RoastPersona;
  intensity: RoastIntensity;
  evidence: RoastEvidence[];
  svg: string;
}

export interface RoastOptions {
  target?: string;
  intensity?: RoastIntensity;
  persona?: RoastPersona;
}

interface PatternFindings {
  todoCount: number;
  renameLoops: string[];           // e.g. "auth-v2-FINAL-FINAL-actual.ts"
  hotFiles: Array<{ file: string; edits: number }>;
  abandonedRefactors: string[];
  recurringBugs: Array<{ pattern: string; count: number }>;
  hallucinations: number;
  collisions: number;
  decisionFlips: number;
  ageDays: number;
  totalMemories: number;
  topAgent: string;
  agentVariety: number;
  noTests: boolean;
  midnightCommits: number;
}

// ── Persona templates ────────────────────────────────────────────────────────
//
// Each persona has 20+ template lines. {{var}} placeholders are filled from
// PatternFindings. Templates without a viable placeholder are filtered out so
// we never render half-empty lines.

interface Template {
  text: string;
  needs?: Array<keyof PatternFindings>;
}

const PERSONAS: Record<RoastPersona, Template[]> = {
  'gordon-ramsay': [
    { text: 'You have {{todoCount}} TODOs in this codebase. {{todoCount}}. That is not a backlog, that is a CRIME SCENE.', needs: ['todoCount'] },
    { text: 'I see {{renameLoop}}. Tell me, chef — who hurt you?', needs: ['renameLoops'] },
    { text: '{{hotFile}} has been edited {{hotEdits}} times. {{hotEdits}}! It is not a file, it is a HOSTAGE.', needs: ['hotFiles'] },
    { text: 'You shipped this with {{hallucinations}} hallucinations? I would not feed this to my DOG.', needs: ['hallucinations'] },
    { text: 'This brain is {{ageDays}} days old and you still cannot agree with yourself? {{decisionFlips}} flipped decisions. SHAMEFUL.', needs: ['ageDays', 'decisionFlips'] },
    { text: 'You call THIS a refactor? You abandoned {{abandonedCount}} of them. ABANDONED. Like my hopes for this kitchen.', needs: ['abandonedRefactors'] },
    { text: 'No tests. NO TESTS. Get OUT of my kitchen.', needs: ['noTests'] },
    { text: '{{midnightCommits}} commits after midnight. Stop. Go to bed. The code will still be broken tomorrow.', needs: ['midnightCommits'] },
    { text: 'Bland. Dry. Overcomplicated. Like everything in your {{topAgent}} log.', needs: ['topAgent'] },
    { text: 'I have seen pasta sauce with more structure than this.', needs: [] },
    { text: '{{collisions}} collisions and you call this a codebase? It is a PILE-UP.', needs: ['collisions'] },
    { text: 'You wrote this. You. Look me in the eye and TELL ME you wrote this.', needs: [] },
    { text: 'The bug pattern {{recurringBug}} appeared {{recurringBugCount}} times. Are you doing it on PURPOSE?', needs: ['recurringBugs'] },
    { text: 'Donkey. Absolute. Donkey.', needs: [] },
    { text: '{{totalMemories}} memories and not one of them is "do not ship at 3am". SORT IT OUT.', needs: ['totalMemories', 'midnightCommits'] },
    { text: 'This codebase is more confused than my grandmother at a TikTok shop.', needs: [] },
    { text: 'You have {{agentVariety}} different agents and they ALL disagree. Pick a lane.', needs: ['agentVariety'] },
    { text: 'The file {{hotFile}} is touched more than my microphone. KNOCK IT OFF.', needs: ['hotFiles'] },
    { text: 'I have tasted regret. It tastes like this codebase.', needs: [] },
    { text: 'Wake up. WAKE UP. This is not a feature, it is a CRY for help.', needs: [] },
    { text: 'You renamed it three times and STILL got it wrong. THREE TIMES.', needs: ['renameLoops'] },
  ],
  'simon-cowell': [
    { text: 'I am going to be honest with you. That was dreadful.', needs: [] },
    { text: 'You have {{todoCount}} TODOs. It is a karaoke night, not a codebase.', needs: ['todoCount'] },
    { text: 'I have seen better architecture in a IKEA catalogue. And IKEA, I am not a fan.', needs: [] },
    { text: '{{hotFile}}? {{hotEdits}} edits? Darling, even Britney took breaks.', needs: ['hotFiles'] },
    { text: 'It was a no from me. It is still a no.', needs: [] },
    { text: 'You sing one song. You commit one feature. Pick one.', needs: [] },
    { text: '{{renameLoop}} is the worst stage name I have ever seen.', needs: ['renameLoops'] },
    { text: 'There is no x-factor in this code. There is no factor at all.', needs: [] },
    { text: '{{hallucinations}} hallucinations? The judges are concerned. Specifically me.', needs: ['hallucinations'] },
    { text: 'This is not a refactor. This is a hostage video.', needs: ['abandonedRefactors'] },
    { text: 'You walked in here {{ageDays}} days ago with a dream. The dream is now a nightmare.', needs: ['ageDays'] },
    { text: 'I am bored. The codebase is bored. The compiler is bored.', needs: [] },
    { text: '{{topAgent}} did all the work. Be honest. You just rode the elevator.', needs: ['topAgent'] },
    { text: '{{collisions}} collisions. It is not a duet, it is a hostage situation.', needs: ['collisions'] },
    { text: 'I want you to listen to me very carefully. This is not good.', needs: [] },
    { text: 'It is forgettable. Like a Eurovision interval act.', needs: [] },
    { text: 'You will not be going through to the next round of code review.', needs: [] },
    { text: '{{decisionFlips}} decision reversals. Pick a key and sing in it.', needs: ['decisionFlips'] },
    { text: 'The recurring bug {{recurringBug}} appears {{recurringBugCount}} times. Encore? Hard pass.', needs: ['recurringBugs'] },
    { text: 'The lights are on. Nobody is home. The code knows it.', needs: [] },
    { text: 'Do you have ANY tests? No? Then this is a karaoke bar.', needs: ['noTests'] },
    { text: 'I have seen reality TV with more reality than this.', needs: [] },
  ],
  'mom': [
    { text: 'Honey. {{todoCount}} TODOs. We are going to sit down and talk about this.', needs: ['todoCount'] },
    { text: 'I am not mad. I am just disappointed. {{hotEdits}} edits to one file, sweetie.', needs: ['hotFiles'] },
    { text: 'When you have time, could you maybe close one of the {{abandonedCount}} refactors? Just one. For mom.', needs: ['abandonedRefactors'] },
    { text: 'You did NOT just commit at 3am again. Did you eat?', needs: ['midnightCommits'] },
    { text: 'I love you. The codebase loves you. We just want to help.', needs: [] },
    { text: 'You named it {{renameLoop}}? Oh honey. Honey.', needs: ['renameLoops'] },
    { text: 'I cleaned your repo. Do not ask which {{abandonedCount}} branches I deleted.', needs: ['abandonedRefactors'] },
    { text: 'No tests? In this house? Under MY roof?', needs: ['noTests'] },
    { text: 'I told your father about the {{collisions}} collisions. He is very quiet right now.', needs: ['collisions'] },
    { text: 'You used to write such clean code. What happened.', needs: [] },
    { text: 'Have you eaten? Have you slept? Have you removed any of the {{todoCount}} TODOs?', needs: ['todoCount'] },
    { text: 'Sweetie, your brother\'s codebase has {{topAgent}} doing all the work too. I am not comparing. I am observing.', needs: ['topAgent'] },
    { text: '{{ageDays}} days old. So mature. So messy.', needs: ['ageDays'] },
    { text: 'I framed your first commit. The recent ones I will not be framing.', needs: [] },
    { text: 'You have a beautiful mind. The code is not currently reflecting it.', needs: [] },
    { text: 'I packed you a lunch. I cannot pack you a working test suite.', needs: ['noTests'] },
    { text: 'The {{recurringBug}} keeps coming back. Like the cat. Please address it.', needs: ['recurringBugs'] },
    { text: 'Take a deep breath. The hallucinations are NOT real. Even if there are {{hallucinations}} of them.', needs: ['hallucinations'] },
    { text: 'You are SO talented. The proof is somewhere in this {{totalMemories}}-memory archive. I am sure.', needs: ['totalMemories'] },
    { text: 'I am proud of you. I am also locking your laptop after midnight.', needs: ['midnightCommits'] },
    { text: 'There is a hole in your codebase the shape of {{hotFile}}. Please patch it.', needs: ['hotFiles'] },
    { text: 'Did you flip {{decisionFlips}} decisions today? On purpose? Tell mommy.', needs: ['decisionFlips'] },
  ],
  'comedian': [
    { text: 'You know you got {{todoCount}} TODOs? Yeah. That\'s not a backlog, that\'s a TED Talk.', needs: ['todoCount'] },
    { text: '{{renameLoop}}? I\'ve seen prison nicknames with more dignity.', needs: ['renameLoops'] },
    { text: 'Your hottest file is {{hotFile}}. {{hotEdits}} edits. That file\'s seen things.', needs: ['hotFiles'] },
    { text: '{{abandonedCount}} abandoned refactors. You don\'t have a repo, you have a Goodwill drop-off.', needs: ['abandonedRefactors'] },
    { text: '{{midnightCommits}} commits after midnight. That ain\'t productivity. That\'s a hostage situation.', needs: ['midnightCommits'] },
    { text: 'No tests? Bold strategy, Cotton. Let\'s see if it pays off in production.', needs: ['noTests'] },
    { text: '{{hallucinations}} hallucinations. The brain isn\'t lying — it\'s just freestyling.', needs: ['hallucinations'] },
    { text: '{{topAgent}} did all the heavy lifting. Give that bot a raise.', needs: ['topAgent'] },
    { text: 'The {{recurringBug}} bug came back {{recurringBugCount}} times. It\'s not a bug, it\'s a recurring character.', needs: ['recurringBugs'] },
    { text: 'Your collision rate is {{collisions}}. That\'s not a codebase, that\'s a Mario Kart match.', needs: ['collisions'] },
    { text: 'You flipped {{decisionFlips}} decisions. Pick a side. The fence is collapsing.', needs: ['decisionFlips'] },
    { text: '{{ageDays}} days alive and the brain still has trust issues with itself.', needs: ['ageDays'] },
    { text: '{{totalMemories}} memories. Half are good. Half I\'m not allowed to mention on stage.', needs: ['totalMemories'] },
    { text: 'You named a file {{renameLoop}}. That\'s not a filename, that\'s a confession.', needs: ['renameLoops'] },
    { text: 'I want to roast you but the codebase already did it for me.', needs: [] },
    { text: 'Your codebase has the energy of a Wi-Fi password at a coffee shop. Long and unnecessary.', needs: [] },
    { text: 'Look, every coder has a hot file. Yours is just hot like a stovetop.', needs: ['hotFiles'] },
    { text: '{{agentVariety}} agents working on this and they all walked out for different reasons.', needs: ['agentVariety'] },
    { text: 'I read your git log. It reads like a true-crime podcast.', needs: [] },
    { text: 'Your linter is not "off". It quit. It moved to Bali. It does pottery now.', needs: [] },
    { text: 'You\'ve got {{todoCount}} TODOs. That\'s not a list. That\'s a bucket list. For the codebase. Before it dies.', needs: ['todoCount'] },
    { text: '{{hotFile}} called. It wants a vacation. And alimony.', needs: ['hotFiles'] },
  ],
  'critic': [
    { text: 'The brain demonstrates {{todoCount}} unresolved intentions — an ambitious archive of inaction.', needs: ['todoCount'] },
    { text: 'The recurring motif of {{renameLoop}} suggests an unresolved identity crisis at the file system level.', needs: ['renameLoops'] },
    { text: '{{hotFile}} bears the wear of {{hotEdits}} revisits — a palimpsest of indecision.', needs: ['hotFiles'] },
    { text: '{{abandonedCount}} half-completed refactors form a poignant tableau of intent without follow-through.', needs: ['abandonedRefactors'] },
    { text: '{{hallucinations}} hallucinations caught — the brain\'s relationship with truth remains aspirational.', needs: ['hallucinations'] },
    { text: 'A codebase {{ageDays}} days old, oscillating between {{decisionFlips}} contradictory verdicts. Compelling.', needs: ['ageDays', 'decisionFlips'] },
    { text: '{{collisions}} collisions — the work of a brain unafraid to disagree with itself, often, publicly.', needs: ['collisions'] },
    { text: 'The absence of tests reads as a stylistic choice. A bold one. A documented one.', needs: ['noTests'] },
    { text: 'In {{midnightCommits}} after-midnight commits, one perceives the auteur at their most exposed.', needs: ['midnightCommits'] },
    { text: '{{topAgent}} emerges as the dominant voice — collaborator, ghost, or sole author? The text refuses to clarify.', needs: ['topAgent'] },
    { text: 'A pattern is not a flaw if you repeat it {{recurringBugCount}} times. It becomes a signature.', needs: ['recurringBugs'] },
    { text: 'The codebase resists closure with the determination of a postmodern novel.', needs: [] },
    { text: 'Every file is a draft. Every commit is a confession. Every TODO is a vow unkept.', needs: [] },
    { text: 'The {{totalMemories}} memories form less of an archive and more of an inventory of doubt.', needs: ['totalMemories'] },
    { text: 'One does not "read" this codebase. One survives it.', needs: [] },
    { text: 'The {{recurringBug}} returns like a memory the brain cannot integrate. Therapy, perhaps.', needs: ['recurringBugs'] },
    { text: 'The work is brave. The work is exhausting. The work needs a structural editor.', needs: [] },
    { text: '{{agentVariety}} authorial voices — a chorus, or a committee. Different things.', needs: ['agentVariety'] },
    { text: 'There is a Beckettian quality to the abandoned {{abandonedCount}} refactors.', needs: ['abandonedRefactors'] },
    { text: 'It is rare to encounter such commitment to the unresolved.', needs: [] },
    { text: 'The brand of this codebase is consistency — in its refusal to converge.', needs: [] },
    { text: 'Recommendation: enroll in a writing workshop. Or a git workshop. Either is fine.', needs: [] },
  ],
  'philosopher': [
    { text: 'What is a TODO, if not a promise we make to a future self who never arrives? You have {{todoCount}}.', needs: ['todoCount'] },
    { text: 'You renamed {{renameLoop}} thrice. Ship of Theseus would weep. Is it still the same file?', needs: ['renameLoops'] },
    { text: '{{hotFile}} bears {{hotEdits}} marks of your touch. The Stoics would say: change one thing, or change yourself.', needs: ['hotFiles'] },
    { text: '{{abandonedCount}} refactors abandoned. Each a road not taken. Frost would understand.', needs: ['abandonedRefactors'] },
    { text: '{{midnightCommits}} commits at midnight — the hour Nietzsche warned us about.', needs: ['midnightCommits'] },
    { text: 'A codebase without tests is a leap of faith. Kierkegaard would approve. Senior engineers, less so.', needs: ['noTests'] },
    { text: '{{collisions}} collisions in the brain. Hegel called this dialectic. Your CI calls it broken.', needs: ['collisions'] },
    { text: 'To flip {{decisionFlips}} decisions is to be honest. To stop flipping them is to be free.', needs: ['decisionFlips'] },
    { text: '{{hallucinations}} hallucinations — the brain dreams of code that does not exist. Cogito, perhaps not ergo sum.', needs: ['hallucinations'] },
    { text: '{{ageDays}} days alive. In the grand sweep of time, even this codebase is brief. Almost merciful.', needs: ['ageDays'] },
    { text: 'The {{recurringBug}} returns like Sisyphus\' boulder. We must imagine it happy. We must fix it.', needs: ['recurringBugs'] },
    { text: 'You are not your codebase. The codebase is just what you do when you cannot sleep.', needs: [] },
    { text: 'In {{totalMemories}} memories, the brain has not yet remembered how to forget.', needs: ['totalMemories'] },
    { text: '{{topAgent}} writes the most. But who watches the watcher?', needs: ['topAgent'] },
    { text: 'Every git push is a small mortality. Every revert, a denial of death.', needs: [] },
    { text: 'There is no truth in this codebase, only contradictions. Marx would call this revolutionary.', needs: [] },
    { text: 'The unexamined codebase is not worth shipping.', needs: [] },
    { text: 'Heraclitus said: you cannot step in the same git diff twice. {{hotFile}} disagrees.', needs: ['hotFiles'] },
    { text: 'Each {{recurringBug}} is the eternal return. Embrace it. Or fix the index.', needs: ['recurringBugs'] },
    { text: '{{agentVariety}} agents have shaped this. The self is a committee. You are merely the chair.', needs: ['agentVariety'] },
    { text: 'A senior engineer once said: simplicity is the ultimate sophistication. They did not see your {{hotFile}}.', needs: ['hotFiles'] },
    { text: 'When you stare into the codebase, the codebase stares back. {{collisions}} collisions are merely the eye contact.', needs: ['collisions'] },
  ],
};

const INTENSITY_LINE_COUNTS: Record<RoastIntensity, number> = {
  gentle: 3,
  medium: 5,
  savage: 8,
};

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainRoast {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  async roast(project: string, opts: RoastOptions = {}): Promise<RoastResult> {
    const persona = opts.persona ?? 'comedian';
    const intensity = opts.intensity ?? 'medium';

    const findings = this.gatherFindings(project);

    // Empty-state graceful path.
    if (findings.totalMemories === 0 && findings.ageDays === 0) {
      const emptyLine = 'Nothing to roast yet — your brain is too new. Come back when you have sinned.';
      return {
        lines: [emptyLine],
        grade: 'A+',
        persona,
        intensity,
        evidence: [],
        svg: this.renderCard(project, [emptyLine], 'A+', persona, intensity),
      };
    }

    const templates = PERSONAS[persona];
    const usable = templates.filter(t => this.templateUsable(t, findings));
    const lineCount = INTENSITY_LINE_COUNTS[intensity];

    const picked = this.pickTemplates(usable, lineCount, findings);
    const lines = picked.map(t => this.renderTemplate(t.text, findings)).filter(s => s.length <= 200);
    if (lines.length === 0) {
      lines.push('Surprisingly clean. Suspiciously clean. Are you hiding something?');
    }

    const grade = this.computeGrade(findings, intensity);
    const evidence = this.buildEvidence(findings, picked);

    return {
      lines,
      grade,
      persona,
      intensity,
      evidence,
      svg: this.renderCard(project, lines, grade, persona, intensity),
    };
  }

  /** Re-render the top line as a share card. */
  roastCard(result: RoastResult): { svg: string } {
    return { svg: result.svg };
  }

  // ── Findings ────────────────────────────────────────────────────────────────

  private gatherFindings(project: string): PatternFindings {
    let entries: ReturnType<GlobalBrain['recall']> = [];
    let events: ReplayEvent[] = [];
    try {
      const projectId = GlobalBrain.projectIdFor(project);
      entries = this.brain.recall({ projectId, limit: 5000 });
    } catch { /* empty */ }
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    const fileEdits = new Map<string, number>();
    const renameSet = new Set<string>();
    const bugPatterns = new Map<string, number>();
    const abandonedSet = new Set<string>();
    const agentCounts = new Map<string, number>();

    let firstSeen = Number.POSITIVE_INFINITY;
    let lastSeen = 0;
    let todoCount = 0;
    let hallucinations = 0;
    let collisions = 0;
    let decisionFlips = 0;
    let midnightCommits = 0;
    let hasTests = false;

    const recordFile = (raw: unknown) => {
      if (typeof raw !== 'string' || raw.length === 0) return;
      const name = raw.split(/[\\/]/).pop() ?? raw;
      fileEdits.set(name, (fileEdits.get(name) ?? 0) + 1);
      // Detect rename loops: "auth-v2-FINAL", "auth-FINAL-FINAL", "auth-actual"
      if (/(final|actual|new|fixed|real|v2|v3|copy|backup|old|tmp|temp)/i.test(name)) {
        renameSet.add(name);
      }
      if (/\.(test|spec)\.(t|j)sx?$/i.test(name) || /__tests?__/.test(raw)) hasTests = true;
    };

    for (const e of entries) {
      const t = e.createdAt instanceof Date ? e.createdAt.getTime() : Number(e.createdAt);
      if (Number.isFinite(t)) {
        if (t < firstSeen) firstSeen = t;
        if (t > lastSeen) lastSeen = t;
        const hour = new Date(t).getHours();
        if (hour >= 0 && hour < 5) midnightCommits += 1;
      }
      agentCounts.set(e.agentTool, (agentCounts.get(e.agentTool) ?? 0) + 1);

      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      recordFile(meta.file ?? meta.path ?? meta.filename);
      const body = String(e.content ?? '');
      if (/\bTODO\b|\bFIXME\b/i.test(body)) todoCount += 1;
      if (/abandon|paused|on hold|deferred/i.test(body) && /refactor|rewrite|migration/i.test(body)) {
        const m = body.match(/refactor[^.\n]{0,60}/i);
        if (m) abandonedSet.add(m[0].slice(0, 80));
      }
      if (/hallucin|fabricat/i.test(e.category) || /hallucin/i.test(body)) hallucinations += 1;
      if (/collision/i.test(e.category)) collisions += 1;
      if (/reversed|flipped|reconsider|backtrack/i.test(body) && /decision|adr/i.test(e.category)) decisionFlips += 1;

      // Recurring bug fingerprint = lowercased "bug:" or "error:" head fragment
      const bugMatch = body.match(/(?:bug|error|exception|crash|null|undefined|panic)[^.\n]{3,60}/i);
      if (bugMatch) {
        const key = bugMatch[0].toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
        bugPatterns.set(key, (bugPatterns.get(key) ?? 0) + 1);
      }
    }

    for (const ev of events) {
      if (Number.isFinite(ev.ts)) {
        if (ev.ts < firstSeen) firstSeen = ev.ts;
        if (ev.ts > lastSeen) lastSeen = ev.ts;
        const hour = new Date(ev.ts).getHours();
        if (hour >= 0 && hour < 5) midnightCommits += 1;
      }
      if (ev.agent) agentCounts.set(ev.agent, (agentCounts.get(ev.agent) ?? 0) + 1);
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      recordFile(payload.file ?? payload.path ?? payload.entity);
      if (ev.type.includes('hallucination') || ev.type.includes('quarantine')) hallucinations += 1;
      if (ev.type.includes('collision')) collisions += 1;
      if (ev.type.includes('decision') && (ev.type.includes('reverse') || ev.type.includes('flip'))) decisionFlips += 1;
    }

    const hotFiles = Array.from(fileEdits.entries())
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([file, edits]) => ({ file, edits }));

    const recurringBugs = Array.from(bugPatterns.entries())
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => ({ pattern, count }));

    const hasData = entries.length > 0 || events.length > 0;
    const ageDays = hasData && Number.isFinite(firstSeen)
      ? Math.max(0, (lastSeen - firstSeen) / (24 * 60 * 60 * 1000))
      : 0;

    const totalMemories = entries.length
      + events.filter(e => e.type === 'memory.write' || e.type === 'brain.remember').length;

    const topAgentEntry = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      todoCount,
      renameLoops: Array.from(renameSet).slice(0, 5),
      hotFiles,
      abandonedRefactors: Array.from(abandonedSet).slice(0, 5),
      recurringBugs,
      hallucinations,
      collisions,
      decisionFlips,
      ageDays: Math.round(ageDays * 10) / 10,
      totalMemories,
      topAgent: topAgentEntry?.[0] ?? 'unknown',
      agentVariety: agentCounts.size,
      noTests: !hasTests,
      midnightCommits,
    };
  }

  // ── Template engine ─────────────────────────────────────────────────────────

  private templateUsable(t: Template, f: PatternFindings): boolean {
    if (!t.needs || t.needs.length === 0) return true;
    for (const key of t.needs) {
      const v = f[key];
      if (typeof v === 'number') { if (v <= 0) return false; }
      else if (typeof v === 'boolean') { if (!v) return false; }
      else if (Array.isArray(v)) { if (v.length === 0) return false; }
      else if (typeof v === 'string') { if (!v || v === 'unknown') return false; }
    }
    return true;
  }

  private pickTemplates(pool: Template[], count: number, findings: PatternFindings): Template[] {
    if (pool.length === 0) return [];
    // Deterministic-ish ordering by a small priority score: prefer templates that
    // reference high-signal findings. Falls back to insertion order ties.
    const scored = pool.map((t, i) => ({ t, score: this.templateScore(t, findings) - i * 0.001 }));
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const picked: Template[] = [];
    for (const { t } of scored) {
      const k = t.text.slice(0, 40);
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(t);
      if (picked.length >= count) break;
    }
    return picked;
  }

  private templateScore(t: Template, f: PatternFindings): number {
    if (!t.needs) return 0.1;
    let s = 0;
    for (const k of t.needs) {
      const v = f[k];
      if (typeof v === 'number') s += Math.min(v, 10);
      else if (Array.isArray(v)) s += Math.min(v.length, 5) * 2;
      else if (typeof v === 'boolean' && v) s += 3;
    }
    return s;
  }

  private renderTemplate(text: string, f: PatternFindings): string {
    const subs: Record<string, string> = {
      todoCount: String(f.todoCount),
      hallucinations: String(f.hallucinations),
      collisions: String(f.collisions),
      decisionFlips: String(f.decisionFlips),
      ageDays: f.ageDays.toFixed(1),
      totalMemories: String(f.totalMemories),
      topAgent: f.topAgent,
      agentVariety: String(f.agentVariety),
      midnightCommits: String(f.midnightCommits),
      abandonedCount: String(f.abandonedRefactors.length),
      renameLoop: f.renameLoops[0] ?? 'a-file-named-final-final',
      hotFile: f.hotFiles[0]?.file ?? 'unknown-file',
      hotEdits: String(f.hotFiles[0]?.edits ?? 0),
      recurringBug: f.recurringBugs[0]?.pattern ?? 'an unnamed bug',
      recurringBugCount: String(f.recurringBugs[0]?.count ?? 0),
    };
    return text.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? k);
  }

  private buildEvidence(f: PatternFindings, picked: Template[]): RoastEvidence[] {
    const out: RoastEvidence[] = [];
    const seen = new Set<keyof PatternFindings>();
    for (const t of picked) {
      for (const k of t.needs ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(this.evidenceFor(k, f));
      }
    }
    return out.slice(0, 6);
  }

  private evidenceFor(key: keyof PatternFindings, f: PatternFindings): RoastEvidence {
    switch (key) {
      case 'todoCount':         return { memory: 'TODO/FIXME tags in recall',       observation: `${f.todoCount} unresolved TODOs across memories` };
      case 'renameLoops':       return { memory: 'file rename pattern',              observation: `Files matching rename-loop suffix: ${f.renameLoops.join(', ') || 'none'}` };
      case 'hotFiles':          return { memory: 'file edit counts',                 observation: `Hottest: ${f.hotFiles[0]?.file ?? 'n/a'} with ${f.hotFiles[0]?.edits ?? 0} edits` };
      case 'abandonedRefactors':return { memory: 'paused/deferred refactor entries', observation: `${f.abandonedRefactors.length} abandoned refactors observed` };
      case 'recurringBugs':     return { memory: 'recurring bug fingerprints',       observation: `Top recurring: "${f.recurringBugs[0]?.pattern ?? 'none'}" x${f.recurringBugs[0]?.count ?? 0}` };
      case 'hallucinations':    return { memory: 'hallucination quarantine log',     observation: `${f.hallucinations} hallucinations recorded` };
      case 'collisions':        return { memory: 'collision detective events',       observation: `${f.collisions} collisions detected` };
      case 'decisionFlips':     return { memory: 'ADR / decision reversals',         observation: `${f.decisionFlips} decision flips observed` };
      case 'ageDays':           return { memory: 'first vs last event timestamp',    observation: `Brain age ~${f.ageDays.toFixed(1)} days` };
      case 'totalMemories':     return { memory: 'recall + replay counts',           observation: `${f.totalMemories} stored memories` };
      case 'topAgent':          return { memory: 'agent contribution histogram',     observation: `${f.topAgent} is the dominant author` };
      case 'agentVariety':      return { memory: 'distinct agents seen',             observation: `${f.agentVariety} distinct agents` };
      case 'noTests':           return { memory: 'absence of *.test.*  / __tests__', observation: f.noTests ? 'No test files surfaced in memories' : 'Tests detected' };
      case 'midnightCommits':   return { memory: 'event timestamps 00:00-04:59',     observation: `${f.midnightCommits} late-night events` };
      default:                  return { memory: String(key),                        observation: 'pattern observed' };
    }
  }

  private computeGrade(f: PatternFindings, intensity: RoastIntensity): RoastGrade {
    let demerits = 0;
    demerits += Math.min(f.todoCount, 30) / 5;
    demerits += f.hallucinations * 2;
    demerits += f.collisions;
    demerits += f.decisionFlips * 1.5;
    demerits += f.midnightCommits * 0.4;
    demerits += f.abandonedRefactors.length * 2;
    demerits += f.renameLoops.length * 1.5;
    demerits += (f.hotFiles[0]?.edits ?? 0) > 10 ? 3 : 0;
    if (f.noTests && f.totalMemories > 5) demerits += 6;

    // Intensity tilts the grade toward harsher labels on the same demerits.
    const tilt = intensity === 'savage' ? 1.4 : intensity === 'medium' ? 1.0 : 0.7;
    const score = demerits * tilt;

    if (score >= 40) return 'M for Mature';
    if (score >= 25) return 'F';
    if (score >= 14) return 'C';
    if (score >= 6)  return 'B-';
    return 'A+';
  }

  // ── SVG card ────────────────────────────────────────────────────────────────

  private renderCard(
    project: string,
    lines: string[],
    grade: RoastGrade,
    persona: RoastPersona,
    intensity: RoastIntensity,
  ): string {
    const W = 1200, H = 630, P = 56;
    const headline = lines[0] ?? '';
    const sub = lines[1] ?? '';
    const accent = personaAccent(persona);
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';

    const headlineWrapped = wrapText(headline, 38, 3);
    const headlineY = 230;
    const headlineSvg = headlineWrapped.map((ln, i) =>
      `<text x="${P}" y="${headlineY + i * 64}" fill="url(#r-hero)" font-size="56" font-family="ui-sans-serif,system-ui" font-weight="800">${esc(ln)}</text>`
    ).join('\n  ');

    const subWrapped = wrapText(sub, 70, 2);
    const subY = headlineY + headlineWrapped.length * 64 + 32;
    const subSvg = subWrapped.map((ln, i) =>
      `<text x="${P}" y="${subY + i * 28}" fill="#cfe9ff" font-size="20" font-family="ui-sans-serif,system-ui" opacity="0.85">${esc(ln)}</text>`
    ).join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- BRAIN ROAST · v6.0.2 -->
  <defs>
    <linearGradient id="r-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0612"/>
      <stop offset="0.5" stop-color="#150a1f"/>
      <stop offset="1" stop-color="#240e2e"/>
    </linearGradient>
    <radialGradient id="r-halo" cx="0.75" cy="0.2" r="0.7">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="r-hero" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset="1" stop-color="#ffb86b"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#r-bg)"/>
  <rect width="${W}" height="${H}" fill="url(#r-halo)"/>
  <text x="${P}" y="80" fill="${accent}" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">BRAIN ROAST · v6.0.2</text>
  <text x="${P}" y="118" fill="#e2f5ff" font-size="32" font-family="ui-sans-serif,system-ui" font-weight="600">${esc(projName)}</text>
  <text x="${P}" y="148" fill="#cfe9ff" font-size="14" font-family="ui-monospace,monospace" opacity="0.7">persona: ${esc(persona)} · intensity: ${esc(intensity)}</text>
  ${headlineSvg}
  ${subSvg}
  <g transform="translate(${W - P - 140}, ${P + 20})">
    <rect x="0" y="0" width="140" height="80" rx="10" ry="10" fill="${accent}" opacity="0.15" stroke="${accent}" stroke-width="2"/>
    <text x="70" y="32" fill="${accent}" font-size="12" font-family="ui-monospace,monospace" text-anchor="middle" opacity="0.8">GRADE</text>
    <text x="70" y="64" fill="${accent}" font-size="28" font-family="ui-monospace,monospace" text-anchor="middle" font-weight="800">${esc(grade)}</text>
  </g>
  <text x="${P}" y="${H - 56}" fill="${accent}" font-size="13" font-family="ui-monospace,monospace" opacity="0.8">Powered by @shadow-brain</text>
  <text x="${P}" y="${H - 32}" fill="#cfe9ff" font-size="14" font-family="ui-monospace,monospace">npx @theihtisham/agent-shadow-brain roast</text>
  <text x="${W - P}" y="${H - 32}" fill="${accent}" font-size="14" font-family="ui-monospace,monospace" text-anchor="end" font-weight="700">${esc(persona.toUpperCase())}</text>
</svg>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function personaAccent(persona: RoastPersona): string {
  switch (persona) {
    case 'gordon-ramsay': return '#ff4444';
    case 'simon-cowell':  return '#ffd84d';
    case 'mom':           return '#ff9ec4';
    case 'comedian':      return '#ffb86b';
    case 'critic':        return '#a78bfa';
    case 'philosopher':   return '#7dd3fc';
  }
}

function wrapText(s: string, maxChars: number, maxLines: number): string[] {
  if (!s) return [];
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: BrainRoast | null = null;
export function getBrainRoast(): BrainRoast {
  if (!_instance) _instance = new BrainRoast();
  return _instance;
}
export function resetBrainRoastForTests(): void { _instance = null; }
