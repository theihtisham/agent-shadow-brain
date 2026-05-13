// src/brain/brain-quest.ts — Gamified onboarding adventure
// v6.0.2 — Hive Mind Edition
//
// A scripted, choose-your-own-adventure introduction to the brain.
// Quests are deterministic — they advance when verify() returns true.
// No LLM calls, no shell exec. Verification uses fs heuristics only.
// Progress persisted per project under ~/.shadow-brain/quests/<project>.json.
//
// Exposed: availableQuests(), start(id, project), current(project),
// step(project, choice?), reset(project).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const QUEST_DIR = path.join(os.homedir(), '.shadow-brain', 'quests');
const BRAIN_HOME = path.join(os.homedir(), '.shadow-brain');

export interface QuestStepDef {
  id: string;
  narrative: string;
  prompt: string;
  verify: (project: string) => boolean;
  branches?: Record<string, string>; // choice → next step id
  nextId?: string; // default next step
}

export interface QuestDef {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  estimatedMinutes: number;
  steps: QuestStepDef[];
  rewardAchievement: string;
  rewardMessage: string;
}

export interface QuestState {
  questId: string;
  project: string;
  currentStepId: string;
  startedAt: number;
  completedAt?: number;
  completedSteps: string[];
  branchHistory: Array<{ stepId: string; choice: string; ts: number }>;
}

interface QuestFile {
  schemaVersion: 1;
  active: QuestState | null;
  history: QuestState[];
}

export class BrainQuest {
  private quests: QuestDef[] = [];
  private states: Map<string, QuestFile> = new Map();

  constructor() {
    this.registerQuests();
  }

  availableQuests(): QuestDef[] {
    return this.quests.map(q => ({ ...q }));
  }

  async start(questId: string, project: string): Promise<QuestState> {
    const quest = this.quests.find(q => q.id === questId);
    if (!quest) throw new Error(`Unknown quest: ${questId}`);
    const file = this.loadFile(project);
    const state: QuestState = {
      questId,
      project,
      currentStepId: quest.steps[0].id,
      startedAt: Date.now(),
      completedSteps: [],
      branchHistory: [],
    };
    file.active = state;
    this.persist(project, file);
    return state;
  }

  current(project: string): QuestState | null {
    return this.loadFile(project).active;
  }

  async step(
    project: string,
    choice?: string
  ): Promise<{
    state: QuestState;
    narrative: string;
    options?: string[];
    complete?: boolean;
    reward?: { achievementId?: string; message: string };
  }> {
    const file = this.loadFile(project);
    const state = file.active;
    if (!state) {
      return {
        state: emptyState(project),
        narrative: 'No active quest. Run `availableQuests()` to see your options, then `start(questId, project)` to begin.',
      };
    }

    const quest = this.quests.find(q => q.id === state.questId);
    if (!quest) {
      return {
        state,
        narrative: `Quest \`${state.questId}\` no longer exists. Resetting.`,
      };
    }

    const stepDef = quest.steps.find(s => s.id === state.currentStepId);
    if (!stepDef) {
      return { state, narrative: 'Current step is missing from quest definition. Try `reset(project)`.' };
    }

    // If user provided a choice, record it and follow branch
    if (choice && stepDef.branches && stepDef.branches[choice]) {
      state.branchHistory.push({ stepId: stepDef.id, choice, ts: Date.now() });
      state.currentStepId = stepDef.branches[choice];
      this.persist(project, file);
      const nextDef = quest.steps.find(s => s.id === state.currentStepId);
      if (nextDef) {
        return {
          state,
          narrative: `${nextDef.narrative}\n\n— ${nextDef.prompt}`,
          options: nextDef.branches ? Object.keys(nextDef.branches) : undefined,
        };
      }
    }

    // Otherwise, check if current step is verified — advance if so
    let verified = false;
    try { verified = stepDef.verify(project); } catch { verified = false; }

    if (!verified) {
      return {
        state,
        narrative: `${stepDef.narrative}\n\n— ${stepDef.prompt}`,
        options: stepDef.branches ? Object.keys(stepDef.branches) : undefined,
      };
    }

    // Step verified! Advance.
    if (!state.completedSteps.includes(stepDef.id)) {
      state.completedSteps.push(stepDef.id);
    }

    const nextId = stepDef.nextId ?? this.defaultNext(quest, stepDef.id);
    if (!nextId) {
      // Quest complete
      state.completedAt = Date.now();
      file.history.push({ ...state });
      file.active = null;
      this.persist(project, file);
      const reward = await this.unlockTrophy(quest);
      return {
        state,
        narrative: `\n${quest.emoji}  **Quest Complete — ${quest.title}**\n\n${quest.rewardMessage}`,
        complete: true,
        reward,
      };
    }

    state.currentStepId = nextId;
    this.persist(project, file);
    const nextDef = quest.steps.find(s => s.id === nextId);
    if (!nextDef) {
      return { state, narrative: 'Quest is in a broken state. Try `reset(project)`.' };
    }
    return {
      state,
      narrative: `${nextDef.narrative}\n\n— ${nextDef.prompt}`,
      options: nextDef.branches ? Object.keys(nextDef.branches) : undefined,
    };
  }

  reset(project: string): void {
    const file = this.loadFile(project);
    if (file.active) file.history.push({ ...file.active });
    file.active = null;
    this.persist(project, file);
  }

  // ── Quest definitions ───────────────────────────────────────────────

  private registerQuests(): void {
    // Quest 1: Hello Brain
    this.quests.push({
      id: 'hello-brain',
      title: 'Hello Brain',
      subtitle: 'The first whispers of consciousness',
      emoji: '🧠',
      estimatedMinutes: 8,
      rewardAchievement: 'first-bloom',
      rewardMessage: 'You have lit the first spark. The brain knows you now — and it remembers.',
      steps: [
        {
          id: 'first-memory',
          narrative:
            'The brain stirs. It has no past, no preferences, no scars. Only potential, and an unlit lamp.\n\n' +
            'You stand before a quiet machine that wants to remember things for you. It will not judge what you teach it. It will only keep faith with what you offer.\n\n' +
            'Begin by giving it a single thought to hold.',
          prompt: 'Run `shadow-brain embed add "your first memory here"` — anything you want it to remember.',
          verify: (project: string) => fileExistsBeneath(BRAIN_HOME, 'embeddings', 'vectors.json') ||
            anyMemoryFile(project),
          nextId: 'first-search',
        },
        {
          id: 'first-search',
          narrative:
            'The memory lives. You can feel it — somewhere in the lattice, a small light is on.\n\n' +
            'Now reach for it. Ask the brain to find what it just learned.',
          prompt: 'Run `shadow-brain search "<a word from your memory>"` and confirm it surfaces.',
          verify: (project: string) => hasRecentEvent(project, 'memory.search'),
          nextId: 'first-dna',
        },
        {
          id: 'first-dna',
          narrative:
            'Memories alone are sparks. To become a brain, they must develop structure — fingerprints, ancestry, identity.\n\n' +
            'Generate a DNA card for your project. It is the brain looking at itself in a mirror for the first time.',
          prompt: 'Run `shadow-brain dna generate`.',
          verify: (project: string) => fileExistsBeneath(BRAIN_HOME, 'dna', `${safe(project)}.json`) ||
            fileExistsBeneath(BRAIN_HOME, 'dna', 'index.json'),
          nextId: 'first-capsule',
        },
        {
          id: 'first-capsule',
          narrative:
            'Time presses on every brain. What is true today may be foolish tomorrow.\n\n' +
            'Freeze a capsule — a snapshot you can return to. It is your first time-traveler\'s anchor.',
          prompt: 'Run `shadow-brain capsule freeze "first snapshot"`.',
          verify: (project: string) => anyFileIn(path.join(BRAIN_HOME, 'capsules')),
          nextId: 'first-replay',
        },
        {
          id: 'first-replay',
          narrative:
            'You have given the brain memory, search, identity, and a past. There is one ritual left.\n\n' +
            'Witness its history. Watch the replay of everything you have done together so far.',
          prompt: 'Run `shadow-brain replay --since 1h`.',
          verify: (project: string) => hasRecentEvent(project, 'replay.view'),
        },
      ],
    });

    // Quest 2: The Hive Initiate
    this.quests.push({
      id: 'hive-initiate',
      title: 'The Hive Initiate',
      subtitle: 'When one mind becomes many',
      emoji: '🐝',
      estimatedMinutes: 15,
      rewardAchievement: 'hive-born',
      rewardMessage: 'You have founded a hive. From now on, no agent works alone — and no lesson is learned twice.',
      steps: [
        {
          id: 'enable-hive',
          narrative:
            'A single brain is a candle. A hive is a hearth. Let us light the hearth.',
          prompt: 'Run `shadow-brain hive enable`.',
          verify: (project: string) => fileExistsBeneath(BRAIN_HOME, 'hive', `${safe(project)}.json`) ||
            anyFileIn(path.join(BRAIN_HOME, 'hive')),
          nextId: 'spawn-subagent',
        },
        {
          id: 'spawn-subagent',
          narrative:
            'A hive needs more than walls. It needs voices.\n\n' +
            'Spawn a subagent. Watch as it inherits the memories you have already given the brain — not as instructions, but as instinct.',
          prompt: 'Run `shadow-brain agent spawn --inherit`.',
          verify: (project: string) => hasRecentEvent(project, 'agent.spawn'),
          nextId: 'watch-inheritance',
        },
        {
          id: 'watch-inheritance',
          narrative:
            'The subagent is awake. It knows what you know — or some fraction of it.\n\n' +
            'Confirm the inheritance. Ask the new agent something only your brain should know.',
          prompt: 'Run `shadow-brain agent ask <agentId> "<question from a memory>"`.',
          verify: (project: string) => hasRecentEvent(project, 'voice.ask'),
          nextId: 'first-share',
        },
        {
          id: 'first-share',
          narrative:
            'Inheritance is the start. Sharing is the soul of the hive.\n\n' +
            'Have your subagent teach the central brain something new.',
          prompt: 'Run `shadow-brain hive share --from <agentId>`.',
          verify: (project: string) => hasRecentEvent(project, 'hive.share'),
          nextId: 'first-voice',
        },
        {
          id: 'first-voice',
          narrative:
            'A hive has a voice that is more than any one mind. Many agents, one answer.\n\n' +
            'Ask the Hive a question that requires multiple opinions.',
          prompt: 'Run `shadow-brain hive ask "should I refactor X?"`.',
          verify: (project: string) => hasRecentEvent(project, 'voice.ask'),
          nextId: 'hive-status',
        },
        {
          id: 'hive-status',
          narrative:
            'Step back. Look at the hive you have built. Count the agents. Count the bridges.',
          prompt: 'Run `shadow-brain hive status`.',
          verify: (project: string) => true, // any view counts
          nextId: 'hive-rest',
        },
        {
          id: 'hive-rest',
          narrative:
            'The hive is yours. Rest the apprentices. Take a breath.',
          prompt: 'Run `shadow-brain agent pause --all`.',
          verify: (project: string) => true,
        },
      ],
    });

    // Quest 3: The Architect's Path
    this.quests.push({
      id: 'architects-path',
      title: 'The Architect\'s Path',
      subtitle: 'Laws inscribed in silicon',
      emoji: '📜',
      estimatedMinutes: 12,
      rewardAchievement: 'lawgiver',
      rewardMessage: 'You have written the laws. The brain will defend them — even from you.',
      steps: [
        {
          id: 'draft-constitution',
          narrative:
            'Every great mind has its commandments. Without them, agents drift, conventions die, and the codebase forgets itself.\n\n' +
            'Write your first constitutional rule. Make it specific. Make it enforceable.',
          prompt: 'Run `shadow-brain constitution add "<your rule>"`.',
          verify: (project: string) => fileExistsBeneath(BRAIN_HOME, 'constitution', `${safe(project)}.json`) ||
            anyFileIn(path.join(BRAIN_HOME, 'constitution')),
          nextId: 'inject-rule',
        },
        {
          id: 'inject-rule',
          narrative:
            'A rule that lives only on disk is no rule at all. It must be felt by every agent at every turn.\n\n' +
            'Inject the constitution into your next prompt.',
          prompt: 'Run `shadow-brain constitution inject`.',
          verify: (project: string) => true,
          nextId: 'trigger-violation',
        },
        {
          id: 'trigger-violation',
          narrative:
            'A law that has never been challenged is a guess. Test it.\n\n' +
            'Ask an agent to do the very thing you forbade. Watch what happens.',
          prompt: 'Trigger a deliberate violation. The brain should object.',
          verify: (project: string) => hasRecentEvent(project, 'constitution.violation'),
          nextId: 'fix-violation',
        },
        {
          id: 'fix-violation',
          narrative:
            'The objection is the proof. Now repair the breach.',
          prompt: 'Resolve the violation. Use `shadow-brain constitution audit` to confirm.',
          verify: (project: string) => true,
          nextId: 'review-constitution',
          branches: { 'review': 'review-constitution', 'expand': 'expand-constitution' },
        },
        {
          id: 'review-constitution',
          narrative:
            'You may pause here and review what you have written — or press on and grow the lawbook.',
          prompt: 'Run `shadow-brain constitution show`.',
          verify: (project: string) => true,
          nextId: 'finalize',
        },
        {
          id: 'expand-constitution',
          narrative:
            'A growing brain needs growing laws. Add two more rules.',
          prompt: 'Run `shadow-brain constitution add "<rule>"` twice more.',
          verify: (project: string) => true,
          nextId: 'finalize',
        },
        {
          id: 'finalize',
          narrative:
            'You are now the architect. The brain has its constitution. Future agents will inherit it as their first breath.',
          prompt: 'Run `shadow-brain constitution lock`.',
          verify: (project: string) => true,
        },
      ],
    });

    // Quest 4: The Time Traveler
    this.quests.push({
      id: 'time-traveler',
      title: 'The Time Traveler',
      subtitle: 'Snapshots, drift, and return',
      emoji: '⏳',
      estimatedMinutes: 7,
      rewardAchievement: 'temporal',
      rewardMessage: 'You walk between yesterdays. The brain will never lose you again.',
      steps: [
        {
          id: 'freeze',
          narrative:
            'Time is a thief, but you can outwit it. Freeze a capsule of the brain as it stands right now.',
          prompt: 'Run `shadow-brain capsule freeze "before experiment"`.',
          verify: (project: string) => anyFileIn(path.join(BRAIN_HOME, 'capsules')),
          nextId: 'mutate',
        },
        {
          id: 'mutate',
          narrative:
            'Now break something. Or build something. Add memories. Change rules. Do anything that will leave footprints.',
          prompt: 'Run any 2-3 `shadow-brain` commands that mutate state.',
          verify: (project: string) => hasMinEventCount(project, 'memory.add', 1),
          nextId: 'diff',
          branches: { 'safe-mode': 'diff', 'risky-mode': 'risky-mutate' },
        },
        {
          id: 'risky-mutate',
          narrative:
            'You chose chaos. Good. Make several drastic changes.',
          prompt: 'Run heavy mutations — add 5+ memories or modify rules.',
          verify: (project: string) => hasMinEventCount(project, 'memory.add', 3),
          nextId: 'diff',
        },
        {
          id: 'diff',
          narrative:
            'Now look back. Compare what the brain knows now with what it knew when you froze it.',
          prompt: 'Run `shadow-brain capsule diff`.',
          verify: (project: string) => true,
          nextId: 'restore',
        },
        {
          id: 'restore',
          narrative:
            'The final step. Return — selectively — to the past. Restore one thing, leave the rest.',
          prompt: 'Run `shadow-brain capsule restore --selective`.',
          verify: (project: string) => true,
        },
      ],
    });

    // Quest 5: Speedrun
    this.quests.push({
      id: 'speedrun',
      title: 'Speedrun',
      subtitle: 'How fast can one mind awaken?',
      emoji: '⚡',
      estimatedMinutes: 3,
      rewardAchievement: 'speedrunner',
      rewardMessage: 'You are on the leaderboard. The hive remembers the swift.',
      steps: [
        {
          id: 'sprint-setup',
          narrative:
            'No narrative. No ceremony. Just speed.\n\n' +
            'Set up your brain in one shot.',
          prompt: 'Run `shadow-brain init --quick`.',
          verify: (project: string) => fs.existsSync(BRAIN_HOME),
          nextId: 'sprint-agent',
        },
        {
          id: 'sprint-agent',
          narrative:
            'Spawn an agent. Don\'t configure it — just spawn it.',
          prompt: 'Run `shadow-brain agent spawn`.',
          verify: (project: string) => hasRecentEvent(project, 'agent.spawn'),
          nextId: 'sprint-memories',
        },
        {
          id: 'sprint-memories',
          narrative:
            'Ten memories. Any ten. Go.',
          prompt: 'Run `shadow-brain embed add "..."` ten times. The leaderboard is watching.',
          verify: (project: string) => hasMinEventCount(project, 'memory.add', 10),
        },
      ],
    });
  }

  private defaultNext(quest: QuestDef, currentId: string): string | null {
    const idx = quest.steps.findIndex(s => s.id === currentId);
    if (idx === -1 || idx === quest.steps.length - 1) return null;
    return quest.steps[idx + 1].id;
  }

  private async unlockTrophy(quest: QuestDef): Promise<{ achievementId?: string; message: string }> {
    try {
      const trophiesMod = await import('./brain-trophies.js').catch(() => null);
      if (trophiesMod && typeof (trophiesMod as Record<string, unknown>).getBrainTrophies === 'function') {
        const getter = (trophiesMod as { getBrainTrophies: () => { award?: (id: string, msg: string) => unknown } }).getBrainTrophies;
        const trophies = getter();
        if (trophies && typeof trophies.award === 'function') {
          trophies.award(quest.rewardAchievement, quest.rewardMessage);
        }
      }
    } catch { /* trophies module not available; that's fine */ }
    return { achievementId: quest.rewardAchievement, message: quest.rewardMessage };
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private loadFile(project: string): QuestFile {
    const cached = this.states.get(project);
    if (cached) return cached;
    const fp = pathFor(project);
    let file: QuestFile = { schemaVersion: 1, active: null, history: [] };
    try {
      if (fs.existsSync(fp)) {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as QuestFile;
        if (raw.schemaVersion === 1) file = raw;
      }
    } catch { /* fresh */ }
    this.states.set(project, file);
    return file;
  }

  private persist(project: string, file: QuestFile): void {
    try {
      fs.mkdirSync(QUEST_DIR, { recursive: true });
      const fp = pathFor(project);
      const tmp = fp + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
      fs.renameSync(tmp, fp);
    } catch { /* non-fatal */ }
  }
}

function pathFor(project: string): string {
  return path.join(QUEST_DIR, `${safe(project)}.json`);
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default';
}

function emptyState(project: string): QuestState {
  return {
    questId: '',
    project,
    currentStepId: '',
    startedAt: 0,
    completedSteps: [],
    branchHistory: [],
  };
}

function fileExistsBeneath(...parts: string[]): boolean {
  try { return fs.existsSync(path.join(...parts)); } catch { return false; }
}

function anyFileIn(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).length > 0;
  } catch { return false; }
}

function anyMemoryFile(project: string): boolean {
  const candidates = [
    path.join(BRAIN_HOME, 'memories', `${safe(project)}.json`),
    path.join(BRAIN_HOME, 'embeddings', 'vectors.json'),
    path.join(BRAIN_HOME, 'memories'),
  ];
  return candidates.some(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

/** Heuristic: check coach event log on disk for a recent event of given type. */
function hasRecentEvent(project: string, type: string): boolean {
  try {
    const coachFile = path.join(BRAIN_HOME, 'coach', `${safe(project)}.json`);
    if (!fs.existsSync(coachFile)) return false;
    const raw = JSON.parse(fs.readFileSync(coachFile, 'utf-8'));
    const events = raw?.state?.events ?? [];
    if (!Array.isArray(events)) return false;
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    return events.some((e: { type?: string; ts?: number }) =>
      e.type === type && (now - (e.ts ?? 0)) < day
    );
  } catch { return false; }
}

function hasMinEventCount(project: string, type: string, min: number): boolean {
  try {
    const coachFile = path.join(BRAIN_HOME, 'coach', `${safe(project)}.json`);
    if (!fs.existsSync(coachFile)) return false;
    const raw = JSON.parse(fs.readFileSync(coachFile, 'utf-8'));
    const events = raw?.state?.events ?? [];
    if (!Array.isArray(events)) return false;
    let count = 0;
    for (const e of events) if (e?.type === type) count++;
    return count >= min;
  } catch { return false; }
}

let _instance: BrainQuest | null = null;
export function getBrainQuest(): BrainQuest {
  if (!_instance) _instance = new BrainQuest();
  return _instance;
}
export function resetBrainQuestForTests(): void { _instance = null; }
