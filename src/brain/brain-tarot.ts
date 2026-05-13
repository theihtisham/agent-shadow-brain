// src/brain/brain-tarot.ts — Brain Tarot (viral feature)
// v6.0.2
//
// Tongue-in-cheek mystic interface. Reads git + brain state, then performs a
// deterministic "tarot reading" against a 78-card deck. Same project + same
// day + same question = same cards, every time.
//
// Pure-stdlib, zero new npm deps. Uses node:crypto for the deterministic draw.

import * as path from 'path';
import * as crypto from 'crypto';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type Spread = 'one-card' | 'three-card' | 'celtic-cross';

export type Suit = 'wands' | 'cups' | 'swords' | 'pentacles' | 'major';
export type CardSource = 'major' | 'minor';
export type Orientation = 'upright' | 'reversed';

export interface TarotCard {
  name: string;
  position: string;
  meaning: string;
  source: CardSource;
  orientation: Orientation;
  associatedEvidence: string[];
}

export interface Reading {
  spread: Spread;
  drawnAt: string;          // ISO date (day-precision)
  cards: TarotCard[];
  synthesis: string;
  lucky_file: string;
  advice: string;
  svg: string;
}

export interface DrawOptions {
  spread?: Spread;
  question?: string;
}

interface DeckCard {
  name: string;
  suit: Suit;
  source: CardSource;
  brainMeaning: string;     // template with optional {{evidence}} marker
}

interface BrainSignals {
  firstEvent?: ReplayEvent;
  firstRefactor?: ReplayEvent;
  recentDelete?: ReplayEvent;
  topEntity?: string;
  topAgent: string;
  agentVariety: number;
  collisions: number;
  decisions: number;
  hallucinations: number;
  totalMemories: number;
  ageDays: number;
  hotFile?: string;
  bugs: number;
  features: number;
  tests: number;
  refactors: number;
  hasData: boolean;
}

// ── Deck (78 cards) ──────────────────────────────────────────────────────────

const MAJOR_ARCANA: DeckCard[] = [
  { name: 'The Fool',            suit: 'major', source: 'major', brainMeaning: 'The first commit. A blank slate, hands trembling at `git init`. {{evidence}}' },
  { name: 'The Magician',        suit: 'major', source: 'major', brainMeaning: 'The first refactor that worked. The moment the brain trusted its own recall. {{evidence}}' },
  { name: 'The High Priestess',  suit: 'major', source: 'major', brainMeaning: 'The hidden knowledge in your README — read by none, blessed by all. {{evidence}}' },
  { name: 'The Empress',         suit: 'major', source: 'major', brainMeaning: 'A fertile season of feature work. New routes bloom. {{evidence}}' },
  { name: 'The Emperor',         suit: 'major', source: 'major', brainMeaning: 'The architecture decision that ruled all others. Iron-fisted. Rarely reversed. {{evidence}}' },
  { name: 'The Hierophant',      suit: 'major', source: 'major', brainMeaning: 'Convention. Style guides. The senior who said "we always do it this way". {{evidence}}' },
  { name: 'The Lovers',          suit: 'major', source: 'major', brainMeaning: 'A decision between two libraries. Both were right. Both were wrong. {{evidence}}' },
  { name: 'The Chariot',         suit: 'major', source: 'major', brainMeaning: 'A sprint pulled to victory by sheer force of will. The build passed at 4:47am. {{evidence}}' },
  { name: 'Strength',            suit: 'major', source: 'major', brainMeaning: 'The bug that returned ten times and was tamed only on the eleventh. {{evidence}}' },
  { name: 'The Hermit',          suit: 'major', source: 'major', brainMeaning: 'A long, quiet refactor. No commits. Only thought. {{evidence}}' },
  { name: 'Wheel of Fortune',    suit: 'major', source: 'major', brainMeaning: 'The release. The deploy. The unpredictable spin of CI. {{evidence}}' },
  { name: 'Justice',             suit: 'major', source: 'major', brainMeaning: 'Code review. The merciless eye. The reversible verdict. {{evidence}}' },
  { name: 'The Hanged Man',      suit: 'major', source: 'major', brainMeaning: 'A pull request that has waited too long. Sacrifice yields perspective. {{evidence}}' },
  { name: 'Death',               suit: 'major', source: 'major', brainMeaning: 'A deleted module. A mercy killing. The repository breathes again. {{evidence}}' },
  { name: 'Temperance',          suit: 'major', source: 'major', brainMeaning: 'Balance between speed and care. The cache hit rate finds its sweet spot. {{evidence}}' },
  { name: 'The Devil',           suit: 'major', source: 'major', brainMeaning: 'Tech debt. A pact signed in haste. Interest compounding nightly. {{evidence}}' },
  { name: 'The Tower',           suit: 'major', source: 'major', brainMeaning: 'The migration. The breaking change. Lightning strikes the foundation. {{evidence}}' },
  { name: 'The Star',            suit: 'major', source: 'major', brainMeaning: 'Hope returns. The new abstraction feels right. The tests are green. {{evidence}}' },
  { name: 'The Moon',            suit: 'major', source: 'major', brainMeaning: 'A heisenbug. A flake. Something only reproducible at midnight. {{evidence}}' },
  { name: 'The Sun',             suit: 'major', source: 'major', brainMeaning: 'A clear, simple solution. Joy in code. Worth screenshotting. {{evidence}}' },
  { name: 'Judgement',           suit: 'major', source: 'major', brainMeaning: 'A retrospective. Old patterns rise to be reckoned with. {{evidence}}' },
  { name: 'The World',           suit: 'major', source: 'major', brainMeaning: 'A complete cycle. v1.0.0 ships. The brain has lived a life. {{evidence}}' },
];

const SUITS: Array<{ suit: Suit; theme: string }> = [
  { suit: 'wands',     theme: 'features and creative work' },
  { suit: 'cups',      theme: 'memories, relationships, emotions' },
  { suit: 'swords',    theme: 'bugs, conflict, intellect' },
  { suit: 'pentacles', theme: 'tests, infrastructure, the material' },
];

const COURT: string[] = ['Page', 'Knight', 'Queen', 'King'];
const RANKS: string[] = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

function buildMinorMeaning(suit: Suit, rank: string): string {
  const isAce = rank === 'Ace';
  const isCourt = COURT.includes(rank);
  const suffix = '{{evidence}}';
  if (isAce) {
    if (suit === 'wands')     return `Ace of Wands — a feature begins. A first sketch. The seed of a route, untested. ${suffix}`;
    if (suit === 'cups')      return `Ace of Cups — a memory worth keeping. The brain remembered something it had not been asked to. ${suffix}`;
    if (suit === 'swords')    return `Ace of Swords — a bug named. The first clarity in a storm. ${suffix}`;
    return `Ace of Pentacles — a test passes for the first time. A foundation is laid. ${suffix}`;
  }
  if (isCourt) {
    if (suit === 'wands')     return `${rank} of Wands — a builder of features. ${rank === 'King' ? 'A mature owner of the roadmap.' : 'A restless creator.'} ${suffix}`;
    if (suit === 'cups')      return `${rank} of Cups — a keeper of memory. ${rank === 'Queen' ? 'Empathic, recalls every quiet pattern.' : 'Sensitive to the brain\'s moods.'} ${suffix}`;
    if (suit === 'swords')    return `${rank} of Swords — a hunter of bugs. ${rank === 'Knight' ? 'Charges in headfirst. Sometimes wins.' : 'Sharpens thought into action.'} ${suffix}`;
    return `${rank} of Pentacles — a steward of tests and infra. ${rank === 'King' ? 'Owns the deploy pipeline.' : 'Quietly tends the foundation.'} ${suffix}`;
  }
  // Numbered 2-10
  const tone: Record<Suit, string> = {
    wands:     'feature momentum',
    cups:      'memory and meaning',
    swords:    'conflict and clarity',
    pentacles: 'infrastructure and craft',
    major:     '',
  };
  const phases: Record<string, string> = {
    Two:   'a partnership forms — two callers agree',
    Three: 'collaboration: the first three contributors converge',
    Four:  'a moment of rest, a cache warms',
    Five:  'a setback, a regression, a difficult code review',
    Six:   'recovery, a return to harmony with the linter',
    Seven: 'a difficult choice, multiple branches diverge',
    Eight: 'mastery — the pattern has been seen many times',
    Nine:  'near-completion, a feature is almost shipped',
    Ten:   'completion, then weight — success has consequences',
  };
  return `${rank} of ${capitalize(suit)} — ${phases[rank] ?? 'a quiet turn'} in ${tone[suit]}. ${suffix}`;
}

function buildDeck(): DeckCard[] {
  const minor: DeckCard[] = [];
  for (const { suit } of SUITS) {
    for (const rank of [...RANKS, ...COURT]) {
      const fullName = `${rank} of ${capitalize(suit)}`;
      minor.push({
        name: fullName,
        suit,
        source: 'minor',
        brainMeaning: buildMinorMeaning(suit, rank),
      });
    }
  }
  return [...MAJOR_ARCANA, ...minor];
}

const DECK: DeckCard[] = buildDeck();

// ── Public deck access ───────────────────────────────────────────────────────

export function cardDeck(): TarotCard[] {
  return DECK.map(c => ({
    name: c.name,
    position: '',
    meaning: c.brainMeaning,
    source: c.source,
    orientation: 'upright',
    associatedEvidence: [],
  }));
}

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainTarot {
  private brain: GlobalBrain;
  private replay: BrainReplay;

  constructor(brain?: GlobalBrain, replay?: BrainReplay) {
    this.brain = brain ?? getGlobalBrain();
    this.replay = replay ?? getBrainReplay();
  }

  async draw(project: string, opts: DrawOptions = {}): Promise<Reading> {
    const spread = opts.spread ?? 'one-card';
    const question = opts.question ?? '';
    const drawnAt = new Date().toISOString().slice(0, 10);

    const signals = this.gatherSignals(project);

    // Empty-state graceful path.
    if (!signals.hasData) {
      const empty = 'The cards are silent. You have no past for them to read.';
      const card: TarotCard = {
        name: 'No Card Drawn',
        position: 'silence',
        meaning: empty,
        source: 'major',
        orientation: 'upright',
        associatedEvidence: [],
      };
      return {
        spread,
        drawnAt,
        cards: [card],
        synthesis: empty,
        lucky_file: 'README.md',
        advice: 'Make a memory. Then return.',
        svg: this.renderReadingCard(project, [card], empty, 'README.md', spread, question),
      };
    }

    const count = spread === 'one-card' ? 1 : spread === 'three-card' ? 3 : 10;
    const positions = positionsFor(spread);

    const drawn = this.deterministicDraw(project, drawnAt, question, count);
    const cards: TarotCard[] = drawn.map((deckCard, i) => this.materialize(deckCard, positions[i] ?? `position-${i + 1}`, signals));

    const synthesis = this.synthesize(cards, signals, question);
    const lucky_file = signals.hotFile ?? signals.topEntity ?? 'src/index.ts';
    const advice = this.advise(cards, signals);

    return {
      spread,
      drawnAt,
      cards,
      synthesis,
      lucky_file,
      advice,
      svg: this.renderReadingCard(project, cards, synthesis, lucky_file, spread, question),
    };
  }

  // ── Signals ─────────────────────────────────────────────────────────────────

  private gatherSignals(project: string): BrainSignals {
    let entries: ReturnType<GlobalBrain['recall']> = [];
    let events: ReplayEvent[] = [];
    try {
      const projectId = GlobalBrain.projectIdFor(project);
      entries = this.brain.recall({ projectId, limit: 5000 });
    } catch { /* empty */ }
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    const agentCounts = new Map<string, number>();
    const entitySet = new Map<string, number>();
    const fileEdits = new Map<string, number>();
    let collisions = 0;
    let decisions = 0;
    let hallucinations = 0;
    let bugs = 0, features = 0, tests = 0, refactors = 0;
    let firstSeen = Number.POSITIVE_INFINITY;
    let lastSeen = 0;
    let firstEvent: ReplayEvent | undefined;
    let firstRefactor: ReplayEvent | undefined;
    let recentDelete: ReplayEvent | undefined;

    const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);
    for (const ev of sortedEvents) {
      if (!firstEvent) firstEvent = ev;
      if (Number.isFinite(ev.ts)) {
        if (ev.ts < firstSeen) firstSeen = ev.ts;
        if (ev.ts > lastSeen) lastSeen = ev.ts;
      }
      if (ev.agent) agentCounts.set(ev.agent, (agentCounts.get(ev.agent) ?? 0) + 1);
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      const entity = (payload.entity ?? payload.id) as string | undefined;
      if (entity) entitySet.set(entity, (entitySet.get(entity) ?? 0) + 1);
      const file = (payload.file ?? payload.path) as string | undefined;
      if (file) fileEdits.set(file, (fileEdits.get(file) ?? 0) + 1);
      if (ev.type.includes('refactor') && !firstRefactor) firstRefactor = ev;
      if (ev.type.includes('delete') || ev.type.includes('remove')) recentDelete = ev;
      if (ev.type.includes('collision')) collisions += 1;
      if (ev.type.includes('decision') || ev.type.includes('adr')) decisions += 1;
      if (ev.type.includes('hallucination') || ev.type.includes('quarantine')) hallucinations += 1;
    }

    for (const e of entries) {
      const t = e.createdAt instanceof Date ? e.createdAt.getTime() : Number(e.createdAt);
      if (Number.isFinite(t)) {
        if (t < firstSeen) firstSeen = t;
        if (t > lastSeen) lastSeen = t;
      }
      agentCounts.set(e.agentTool, (agentCounts.get(e.agentTool) ?? 0) + 1);
      entitySet.set(e.id, (entitySet.get(e.id) ?? 0) + 1);
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      const file = (meta.file ?? meta.path) as string | undefined;
      if (file) fileEdits.set(file, (fileEdits.get(file) ?? 0) + 1);

      const cat = e.category.toLowerCase();
      if (/bug|error|crash|fix/.test(cat)) bugs += 1;
      if (/feature|route|endpoint|component/.test(cat)) features += 1;
      if (/test|spec/.test(cat)) tests += 1;
      if (/refactor|cleanup|rename/.test(cat)) refactors += 1;
      if (/decision|adr/.test(cat)) decisions += 1;
      if (/hallucin/.test(cat)) hallucinations += 1;
    }

    const hasData = entries.length > 0 || events.length > 0;
    const ageDays = hasData && Number.isFinite(firstSeen)
      ? Math.max(0, (lastSeen - firstSeen) / (24 * 60 * 60 * 1000))
      : 0;

    const topAgentEntry = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    const topEntityEntry = Array.from(entitySet.entries()).sort((a, b) => b[1] - a[1])[0];
    const hotFileEntry = Array.from(fileEdits.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      firstEvent,
      firstRefactor,
      recentDelete,
      topEntity: topEntityEntry?.[0],
      topAgent: topAgentEntry?.[0] ?? 'unknown',
      agentVariety: agentCounts.size,
      collisions,
      decisions,
      hallucinations,
      totalMemories: entries.length,
      ageDays: Math.round(ageDays * 10) / 10,
      hotFile: hotFileEntry?.[0],
      bugs,
      features,
      tests,
      refactors,
      hasData,
    };
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  private deterministicDraw(project: string, day: string, question: string, count: number): DeckCard[] {
    const seedInput = `${path.resolve(project)}::${day}::${question}`;
    const seedHash = crypto.createHash('sha256').update(seedInput).digest();
    // Fisher-Yates shuffle driven by the hash stream (extend hash as needed).
    const deck = [...DECK];
    const stream = this.hashStream(seedHash);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = stream(i + 1);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck.slice(0, count);
  }

  private hashStream(seed: Buffer): (mod: number) => number {
    let pool = Buffer.from(seed);
    let offset = 0;
    return (mod: number) => {
      if (offset + 4 > pool.length) {
        pool = crypto.createHash('sha256').update(pool).digest();
        offset = 0;
      }
      const n = pool.readUInt32BE(offset);
      offset += 4;
      return n % mod;
    };
  }

  private materialize(deckCard: DeckCard, position: string, signals: BrainSignals): TarotCard {
    // Determine orientation from a second hash so it varies with the same daily seed.
    const orientationHash = crypto.createHash('sha256').update(deckCard.name + position).digest()[0];
    const orientation: Orientation = orientationHash % 3 === 0 ? 'reversed' : 'upright';

    const evidence = this.evidenceFor(deckCard, signals);
    const meaningBase = deckCard.brainMeaning.replace('{{evidence}}', evidence.summary || '');
    const meaning = orientation === 'reversed'
      ? `Reversed — ${meaningBase} The current is running the other way.`
      : meaningBase;

    return {
      name: deckCard.name,
      position,
      meaning: meaning.trim(),
      source: deckCard.source,
      orientation,
      associatedEvidence: evidence.items,
    };
  }

  private evidenceFor(card: DeckCard, s: BrainSignals): { summary: string; items: string[] } {
    const items: string[] = [];
    let summary = '';

    if (card.source === 'major') {
      switch (card.name) {
        case 'The Fool':
          if (s.firstEvent) {
            summary = `Your first event: ${s.firstEvent.type} on ${new Date(s.firstEvent.ts).toISOString().slice(0, 10)}.`;
            items.push(`first-event:${s.firstEvent.type}`);
          }
          break;
        case 'The Magician':
          if (s.firstRefactor) {
            summary = `Your first refactor: ${s.firstRefactor.type}.`;
            items.push(`first-refactor:${s.firstRefactor.type}`);
          }
          break;
        case 'Death':
          if (s.recentDelete) {
            summary = `A recent removal: ${s.recentDelete.type}.`;
            items.push(`delete:${s.recentDelete.type}`);
          }
          break;
        case 'The Tower':
          if (s.collisions > 0) {
            summary = `Your last ${s.collisions} collisions foreshadowed migrations.`;
            items.push(`collisions:${s.collisions}`);
          }
          break;
        case 'The Moon':
          if (s.hallucinations > 0) {
            summary = `Your ${s.hallucinations} hallucinations whisper from the dark.`;
            items.push(`hallucinations:${s.hallucinations}`);
          }
          break;
        case 'The Emperor':
          if (s.decisions > 0) {
            summary = `${s.decisions} architectural decrees stand in the record.`;
            items.push(`decisions:${s.decisions}`);
          }
          break;
        case 'The World':
          summary = `A brain of ${s.ageDays.toFixed(1)} days and ${s.totalMemories} memories has lived a small life.`;
          items.push(`age:${s.ageDays}`);
          break;
        default:
          break;
      }
    } else {
      switch (card.suit) {
        case 'wands':
          if (s.features > 0) {
            summary = `You have ${s.features} feature-coded memories.`;
            items.push(`features:${s.features}`);
          }
          break;
        case 'cups':
          if (s.topEntity) {
            summary = `Your most-recalled entity: ${s.topEntity}.`;
            items.push(`top-entity:${s.topEntity}`);
          }
          break;
        case 'swords':
          if (s.bugs > 0) {
            summary = `You have ${s.bugs} bug-coded memories.`;
            items.push(`bugs:${s.bugs}`);
          }
          break;
        case 'pentacles':
          if (s.tests > 0) {
            summary = `${s.tests} test-related memories anchor your foundation.`;
            items.push(`tests:${s.tests}`);
          }
          break;
      }
    }

    return { summary, items };
  }

  // ── Synthesis ───────────────────────────────────────────────────────────────

  private synthesize(cards: TarotCard[], s: BrainSignals, question: string): string {
    const names = cards.map(c => `${c.name}${c.orientation === 'reversed' ? ' (reversed)' : ''}`).join(', ');
    const intro = question
      ? `You asked of "${question}". The brain whispers an answer through ${names}.`
      : `The brain whispers of an unfinished journey through ${names}.`;

    const dominant = cards.find(c => c.source === 'major') ?? cards[0];
    const tone = dominant.orientation === 'reversed'
      ? 'The current runs against you. The lesson is in the friction.'
      : 'The currents are aligned. Move with deliberation.';

    const personalized = s.collisions > 5
      ? `Beware — ${s.collisions} collisions linger in the record. The Tower has not yet finished its work.`
      : s.hallucinations > 0
        ? `The Moon\'s veil is thin: ${s.hallucinations} hallucinations have been quarantined and still murmur.`
        : s.decisions > 5
          ? `The Emperor has spoken ${s.decisions} times in this codebase. Listen for which voice now leads.`
          : `Your ${s.totalMemories} memories are a quiet weight. They will move when you do.`;

    return `${intro} ${tone} ${personalized}`;
  }

  private advise(cards: TarotCard[], s: BrainSignals): string {
    const reversedCount = cards.filter(c => c.orientation === 'reversed').length;
    if (reversedCount > cards.length / 2) {
      return 'Pause. Read your most recent decision aloud. The brain wants you to disagree with it before you proceed.';
    }
    if (cards.some(c => c.name === 'The Tower')) {
      return 'Migrate intentionally, not reactively. Branch first. Confess to the changelog second.';
    }
    if (cards.some(c => c.name === 'Death')) {
      return 'Delete the module you have been avoiding. The brain will thank you within three commits.';
    }
    if (s.bugs > s.tests) {
      return 'Write one test for the bug you fear most. The Pentacles want their due.';
    }
    return 'Trust the smallest pattern that has worked twice. Repeat it. Name it. Ship it.';
  }

  // ── SVG card ────────────────────────────────────────────────────────────────

  private renderReadingCard(
    project: string,
    cards: TarotCard[],
    synthesis: string,
    luckyFile: string,
    spread: Spread,
    question: string,
  ): string {
    const W = 1200, H = 1600, P = 60;
    const projName = path.basename(path.resolve(project)) || 'unknown-brain';
    const title = spread === 'one-card' ? 'A SINGLE CARD' : spread === 'three-card' ? 'PAST · PRESENT · FUTURE' : 'THE CELTIC CROSS';

    // Layout cards: one (center), three (row), celtic-cross (cross + staff).
    const cardSvgs = spread === 'celtic-cross'
      ? this.layoutCeltic(cards, W, 220)
      : spread === 'three-card'
        ? this.layoutThree(cards, W, 280)
        : this.layoutOne(cards, W, 320);

    const synthWrapped = wrapText(synthesis, 64, 6);
    const synthY = 1100;
    const synthSvg = synthWrapped.map((ln, i) =>
      `<text x="${P}" y="${synthY + i * 32}" fill="#e6d9ff" font-size="22" font-family="ui-serif,Georgia,serif" opacity="0.95">${esc(ln)}</text>`
    ).join('\n  ');

    const questionLine = question
      ? `<text x="${P}" y="180" fill="#d4af37" font-size="18" font-family="ui-serif,Georgia,serif" font-style="italic" opacity="0.9">"${esc(question)}"</text>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- BRAIN TAROT · v6.0.2 -->
  <defs>
    <linearGradient id="t-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15052a"/>
      <stop offset="0.5" stop-color="#240b3e"/>
      <stop offset="1" stop-color="#0a0218"/>
    </linearGradient>
    <radialGradient id="t-halo" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#d4af37" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#d4af37" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="t-card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a1d5e"/>
      <stop offset="1" stop-color="#1c0838"/>
    </linearGradient>
    <linearGradient id="t-gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d4af37"/>
      <stop offset="1" stop-color="#fff1a8"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#t-bg)"/>
  <rect width="${W}" height="${H}" fill="url(#t-halo)"/>
  <text x="${P}" y="92" fill="#d4af37" font-size="14" font-family="ui-monospace,monospace" letter-spacing="4">BRAIN TAROT · v6.0.2</text>
  <text x="${P}" y="140" fill="url(#t-gold)" font-size="44" font-family="ui-serif,Georgia,serif" font-weight="700">${esc(projName)}</text>
  ${questionLine}
  <text x="${W - P}" y="92" fill="#d4af37" font-size="14" font-family="ui-monospace,monospace" text-anchor="end" letter-spacing="3">${esc(title)}</text>
  ${cardSvgs}
  ${synthSvg}
  <text x="${P}" y="${H - 130}" fill="#d4af37" font-size="14" font-family="ui-monospace,monospace" opacity="0.85" letter-spacing="2">LUCKY FILE</text>
  <text x="${P}" y="${H - 100}" fill="#fff1a8" font-size="22" font-family="ui-monospace,monospace">${esc(luckyFile)}</text>
  <text x="${P}" y="${H - 56}" fill="#d4af37" font-size="13" font-family="ui-monospace,monospace" opacity="0.8">Powered by @shadow-brain</text>
  <text x="${P}" y="${H - 32}" fill="#e6d9ff" font-size="14" font-family="ui-monospace,monospace">npx @theihtisham/agent-shadow-brain tarot</text>
</svg>`;
  }

  private layoutOne(cards: TarotCard[], W: number, top: number): string {
    const card = cards[0];
    if (!card) return '';
    const cw = 360, ch = 540;
    const x = (W - cw) / 2;
    return this.drawCard(card, x, top, cw, ch, 1.0);
  }

  private layoutThree(cards: TarotCard[], W: number, top: number): string {
    const cw = 280, ch = 420;
    const gap = 60;
    const totalW = cw * 3 + gap * 2;
    const startX = (W - totalW) / 2;
    return cards.slice(0, 3).map((c, i) =>
      this.drawCard(c, startX + i * (cw + gap), top, cw, ch, 1.0)
    ).join('\n');
  }

  private layoutCeltic(cards: TarotCard[], W: number, top: number): string {
    // 10-card Celtic cross: 1 center, 2 across center, 3 below, 4 above, 5 left,
    // 6 right, 7-10 vertical staff on the right.
    const cw = 160, ch = 240;
    const crossCx = W / 2 - 140;
    const crossCy = top + 280;
    const places = [
      { x: crossCx - cw / 2,           y: crossCy - ch / 2 },      // 1 center
      { x: crossCx - cw / 2,           y: crossCy - ch / 2, rot: 90 }, // 2 across
      { x: crossCx - cw / 2,           y: crossCy + ch / 2 + 12 }, // 3 below
      { x: crossCx - cw / 2,           y: crossCy - ch * 1.5 - 12 }, // 4 above
      { x: crossCx - cw * 1.5 - 12,    y: crossCy - ch / 2 },      // 5 left
      { x: crossCx + cw / 2 + 12,      y: crossCy - ch / 2 },      // 6 right
      { x: W - cw - 80,                y: top + 80 },              // 7 staff
      { x: W - cw - 80,                y: top + 80 + ch + 12 },    // 8 staff
      { x: W - cw - 80,                y: top + 80 + (ch + 12) * 2 }, // 9 staff
      { x: W - cw - 80,                y: top + 80 + (ch + 12) * 3 }, // 10 staff
    ];
    return cards.slice(0, 10).map((c, i) => {
      const p = places[i];
      return this.drawCard(c, p.x, p.y, cw, ch, 0.75, p.rot ?? 0);
    }).join('\n');
  }

  private drawCard(card: TarotCard, x: number, y: number, w: number, h: number, scale: number, rotate = 0): string {
    const transform = rotate
      ? `transform="translate(${x + w / 2}, ${y + h / 2}) rotate(${rotate}) translate(${-w / 2}, ${-h / 2})"`
      : `transform="translate(${x}, ${y})"`;
    const flip = card.orientation === 'reversed' ? `transform="translate(${w / 2}, ${h / 2}) rotate(180) translate(${-w / 2}, ${-h / 2})"` : '';
    const nameFont = Math.round(18 * scale);
    const positionFont = Math.round(11 * scale);
    const glyph = brainGlyph(card);
    return `<g ${transform}>
    <rect x="0" y="0" width="${w}" height="${h}" rx="${10 * scale}" ry="${10 * scale}" fill="url(#t-card)" stroke="#d4af37" stroke-width="${1.5 * scale}"/>
    <rect x="${6 * scale}" y="${6 * scale}" width="${w - 12 * scale}" height="${h - 12 * scale}" rx="${6 * scale}" ry="${6 * scale}" fill="none" stroke="#d4af37" stroke-width="${0.6 * scale}" opacity="0.55"/>
    <g ${flip}>
      <text x="${w / 2}" y="${28 * scale}" fill="#d4af37" font-size="${positionFont}" font-family="ui-monospace,monospace" text-anchor="middle" letter-spacing="2" opacity="0.85">${esc((card.position || ' ').toUpperCase())}</text>
      <g transform="translate(${w / 2}, ${h / 2}) scale(${scale})">${glyph}</g>
      <text x="${w / 2}" y="${h - 18 * scale}" fill="#fff1a8" font-size="${nameFont}" font-family="ui-serif,Georgia,serif" text-anchor="middle">${esc(card.name)}</text>
    </g>
  </g>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function positionsFor(spread: Spread): string[] {
  switch (spread) {
    case 'one-card':     return ['the moment'];
    case 'three-card':   return ['past', 'present', 'future'];
    case 'celtic-cross': return ['present', 'challenge', 'foundation', 'recent past', 'crown', 'near future', 'self', 'environment', 'hopes & fears', 'outcome'];
  }
}

function brainGlyph(card: TarotCard): string {
  // Brain-inspired iconography replacing traditional tarot art. Pure SVG paths.
  // Each suit has a distinct glyph; major arcana share a neural sigil.
  const stroke = '#d4af37';
  if (card.source === 'major') {
    return `<g stroke="${stroke}" stroke-width="1.6" fill="none" opacity="0.9">
      <circle cx="0" cy="0" r="38"/>
      <circle cx="0" cy="0" r="22"/>
      <path d="M -38 0 Q -10 -28 0 0 Q 10 28 38 0"/>
      <path d="M 0 -38 Q -28 -10 0 0 Q 28 10 0 38"/>
      <circle cx="0" cy="0" r="4" fill="${stroke}"/>
    </g>`;
  }
  // Determine suit from card.name suffix.
  if (/Wands$/.test(card.name)) {
    return `<g stroke="${stroke}" stroke-width="1.8" fill="none" opacity="0.9">
      <path d="M -20 30 L 20 -30"/>
      <path d="M -8 -22 L 8 -38"/>
      <path d="M -28 18 L -16 28"/>
      <circle cx="0" cy="0" r="3" fill="${stroke}"/>
    </g>`;
  }
  if (/Cups$/.test(card.name)) {
    return `<g stroke="${stroke}" stroke-width="1.6" fill="none" opacity="0.9">
      <path d="M -22 -16 Q 0 -28 22 -16 L 16 18 Q 0 26 -16 18 Z"/>
      <path d="M -10 -10 Q 0 -4 10 -10"/>
      <circle cx="0" cy="-2" r="2.5" fill="${stroke}"/>
    </g>`;
  }
  if (/Swords$/.test(card.name)) {
    return `<g stroke="${stroke}" stroke-width="1.8" fill="none" opacity="0.9">
      <path d="M 0 -32 L 0 28"/>
      <path d="M -14 -16 L 14 -16"/>
      <path d="M -4 24 L 4 24"/>
      <circle cx="0" cy="0" r="2.5" fill="${stroke}"/>
    </g>`;
  }
  // Pentacles
  return `<g stroke="${stroke}" stroke-width="1.6" fill="none" opacity="0.9">
    <circle cx="0" cy="0" r="26"/>
    <path d="M 0 -26 L 15 24 L -22 -8 L 22 -8 L -15 24 Z"/>
    <circle cx="0" cy="0" r="3" fill="${stroke}"/>
  </g>`;
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: BrainTarot | null = null;
export function getBrainTarot(): BrainTarot {
  if (!_instance) _instance = new BrainTarot();
  return _instance;
}
export function resetBrainTarotForTests(): void { _instance = null; }
