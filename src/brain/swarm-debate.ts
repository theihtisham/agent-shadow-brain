// src/brain/swarm-debate.ts — Swarm Debate Protocol
// v6.0.0 — Hive Mind Edition
//
// For critical decisions, spawn 2–N sub-agents that DEBATE a question.
// An arbiter agent reads the transcript and picks a winner with reasoning.
// Uses Local LLM (Ollama) by default; remote providers opt-in.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { DebateTranscript, DebateTurn } from '../types.js';
import { getLocalLLM, LocalLLM } from './local-llm.js';

const DEBATE_PATH = path.join(os.homedir(), '.shadow-brain', 'debates.json');

interface PersistShape {
  schemaVersion: 1;
  debates: DebateTranscript[];
}

export class SwarmDebate {
  private llm: LocalLLM;
  private debates: Map<string, DebateTranscript> = new Map();
  private initialized = false;

  constructor() {
    this.llm = getLocalLLM();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(DEBATE_PATH), { recursive: true });
    if (fs.existsSync(DEBATE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(DEBATE_PATH, 'utf-8')) as PersistShape;
        for (const d of parsed.debates ?? []) {
          this.debates.set(d.id, {
            ...d,
            createdAt: new Date(d.createdAt),
            turns: d.turns.map(t => ({ ...t, timestamp: new Date(t.timestamp) })),
          });
        }
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  /** Run a debate. Returns a transcript with verdict. */
  async debate(question: string, context: string, opts: { turns?: number; proLabel?: string; conLabel?: string } = {}): Promise<DebateTranscript> {
    await this.init();
    const turnCount = opts.turns ?? 2;
    const proLabel = opts.proLabel ?? 'pro';
    const conLabel = opts.conLabel ?? 'con';
    const start = Date.now();

    const turns: DebateTurn[] = [];
    let turnId = 1;

    // Alternate pro/con turns
    for (let i = 0; i < turnCount; i++) {
      const proTurn = await this.generateTurn(turnId++, proLabel, 'pro', question, context, turns);
      turns.push(proTurn);
      const conTurn = await this.generateTurn(turnId++, conLabel, 'con', question, context, turns);
      turns.push(conTurn);
    }

    // Arbiter
    const arbiter = await this.generateArbiter(turnId, question, context, turns);
    turns.push(arbiter);

    const transcript: DebateTranscript = {
      id: `deb-${crypto.randomBytes(6).toString('hex')}`,
      question,
      context,
      turns,
      verdict: arbiter.statement,
      arbiterConfidence: arbiter.confidence,
      durationMs: Date.now() - start,
      createdAt: new Date(),
    };

    this.debates.set(transcript.id, transcript);
    await this.persist();
    return transcript;
  }

  listDebates(limit = 20): DebateTranscript[] {
    return Array.from(this.debates.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async generateTurn(turnId: number, agentLabel: string, position: 'pro' | 'con', question: string, context: string, prior: DebateTurn[]): Promise<DebateTurn> {
    const transcript = prior.map(t => `${t.agentLabel} (${t.position}): ${t.statement}`).join('\n');
    const prompt = `Question: ${question}\nContext: ${context}\n\nPrior turns:\n${transcript || '(no prior turns)'}\n\nYou are arguing ${position}. Respond in 2 short sentences max.`;
    const res = await this.llm.generate(prompt, `You are a terse debater taking the ${position} position.`);
    const statement = res.text.trim() || this.fallbackStatement(position, question);
    return {
      turnId,
      agentLabel,
      position,
      statement: statement.slice(0, 340),
      confidence: res.provider === 'none' ? 0.5 : 0.7,
      timestamp: new Date(),
    };
  }

  private async generateArbiter(turnId: number, question: string, context: string, turns: DebateTurn[]): Promise<DebateTurn> {
    const transcript = turns.map(t => `${t.agentLabel} (${t.position}): ${t.statement}`).join('\n');
    const prompt = `You are an arbiter reading this debate. Pick the stronger side and give a one-sentence verdict.\n\nQuestion: ${question}\nContext: ${context}\n\nTranscript:\n${transcript}\n\nReply: "Winner: <pro|con>. Reason: <one sentence>."`;
    const res = await this.llm.generate(prompt, 'You are a fair, terse arbiter.');
    const text = res.text.trim() || 'Winner: pro. Reason: no clear evidence presented by con side.';
    const confidence = res.provider === 'none' ? 0.5 : 0.75;
    return {
      turnId,
      agentLabel: 'arbiter',
      position: 'arbiter',
      statement: text.slice(0, 340),
      confidence,
      timestamp: new Date(),
    };
  }

  private fallbackStatement(position: 'pro' | 'con', question: string): string {
    return position === 'pro'
      ? `Proceeding with the proposal for "${question.slice(0, 60)}" is the safer default given existing conventions.`
      : `There is no evidence base for "${question.slice(0, 60)}" — defaulting to the status quo is safer.`;
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = { schemaVersion: 1, debates: Array.from(this.debates.values()) };
      const tmp = DEBATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, DEBATE_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: SwarmDebate | null = null;

export function getSwarmDebate(): SwarmDebate {
  if (!_instance) _instance = new SwarmDebate();
  return _instance;
}

export function resetSwarmDebateForTests(): void {
  _instance = null;
}
