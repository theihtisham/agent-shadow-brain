// src/brain/hive-voice.ts — Hive Voice (viral feature)
// v6.0.2 — multi-agent debate-vote with transparent dissent + confidence distribution
//
// Different from swarm-debate: this is for ANY question, real-time, with explicit
// dissent, confidence weighting, and a "consensus card" SVG ready to tweet.
//
// Default: probes Ollama for up to 3 distinct local coder models (qwen2.5-coder,
// deepseek-coder, llama3.2). If only 1 model is available, asks it 3 times with
// different temperatures and treats each as an independent voter.
//
// Output: HiveVote { consensus, confidence, votes, dissents, distribution, svg }
// Persisted to: ~/.shadow-brain/hive-voice/<project>/<timestamp>.json

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const STORE_ROOT = path.join(os.homedir(), '.shadow-brain', 'hive-voice');
const PREFERRED_MODELS = ['qwen2.5-coder', 'deepseek-coder', 'llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2'];
const TEMP_FAN = [0.2, 0.55, 0.9];

export type VotingMode = 'unanimous' | 'majority' | 'weighted';

export interface AgentSpec {
  /** Friendly label used in output / SVG */
  name: string;
  /** Ollama model tag (e.g. 'qwen2.5-coder:7b'). If missing, treated as "external". */
  model?: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Optional system prompt to nudge perspective. */
  systemPrompt?: string;
  /** Trust weight ∈ [0, 1]. Defaults to 1. */
  weight?: number;
}

export interface AgentVote {
  agent: string;
  position: string;
  confidence: number;
  reasoning: string;
  weight: number;
}

export interface HiveVote {
  question: string;
  consensus: string;
  confidence: number;
  votes: AgentVote[];
  dissents: AgentVote[];
  distribution: {
    byConfidence: number[];
    byPosition: Record<string, number>;
  };
  transcript: string;
  svg: string;
  mode: VotingMode;
  durationMs: number;
  capturedAt: string;
}

export interface AskOptions {
  agents?: AgentSpec[];
  rounds?: number;
  allowDissent?: boolean;
  mode?: VotingMode;
  projectDir?: string;
  ollamaUrl?: string;
}

export class HiveVoice {
  private ollamaBaseUrl: string;
  private cachedModels: string[] | null = null;

  constructor(ollamaUrl = 'http://127.0.0.1:11434') {
    this.ollamaBaseUrl = ollamaUrl;
  }

  /** Ask the hive a question. Returns a HiveVote with consensus + SVG card. */
  async ask(question: string, opts: AskOptions = {}): Promise<HiveVote> {
    const start = Date.now();
    if (opts.ollamaUrl) this.ollamaBaseUrl = opts.ollamaUrl;
    const mode: VotingMode = opts.mode ?? 'weighted';
    const rounds = Math.max(1, opts.rounds ?? 1);
    const allowDissent = opts.allowDissent !== false;

    const agents = await this.resolveAgents(opts.agents);
    const votes: AgentVote[] = [];

    // Each agent votes in each round; later rounds see prior transcript for refinement.
    let transcript = `Q: ${question}\n`;
    for (let r = 0; r < rounds; r++) {
      for (const agent of agents) {
        const vote = await this.askAgent(question, agent, transcript, r);
        votes.push(vote);
        transcript += `[R${r + 1}] ${vote.agent} (conf ${vote.confidence.toFixed(2)}): ${vote.position} — ${vote.reasoning}\n`;
      }
    }

    // Use only the LAST round's votes as the final tally — earlier rounds are deliberation.
    const lastRoundVotes = votes.slice(-agents.length);
    const { consensus, confidence, dissents } = this.tally(lastRoundVotes, mode, allowDissent);
    const distribution = this.distribute(lastRoundVotes);

    const result: HiveVote = {
      question,
      consensus,
      confidence,
      votes: lastRoundVotes,
      dissents,
      distribution,
      transcript: transcript.trim(),
      svg: this.renderSvg(question, lastRoundVotes, consensus, dissents),
      mode,
      durationMs: Date.now() - start,
      capturedAt: new Date().toISOString(),
    };

    await this.persist(result, opts.projectDir ?? process.cwd());
    return result;
  }

  /** List recent hive votes for a project. */
  list(projectDir = process.cwd(), limit = 50): Array<{ file: string; capturedAt: string; question: string }> {
    const dir = this.projectStoreDir(projectDir);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit);
    const out: Array<{ file: string; capturedAt: string; question: string }> = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as HiveVote;
        out.push({ file: path.join(dir, f), capturedAt: raw.capturedAt, question: raw.question });
      } catch { /* skip */ }
    }
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async resolveAgents(spec?: AgentSpec[]): Promise<AgentSpec[]> {
    if (spec && spec.length) return spec;
    const models = await this.probeOllamaModels();

    if (models.length === 0) {
      // No Ollama at all → 3 deterministic stub voters (fallback mode keeps API functional).
      return [
        { name: 'stub-a', temperature: 0.2, weight: 1 },
        { name: 'stub-b', temperature: 0.55, weight: 1 },
        { name: 'stub-c', temperature: 0.9, weight: 1 },
      ];
    }

    if (models.length === 1) {
      // Single model → 3 voters with different temperatures = diversity simulation.
      return TEMP_FAN.map((t, i) => ({
        name: `${models[0].split(':')[0]}-t${i + 1}`,
        model: models[0],
        temperature: t,
        weight: 1,
      }));
    }

    // 2+ models → take up to 3 distinct ones for genuine diversity.
    return models.slice(0, 3).map((m, i) => ({
      name: m.split(':')[0],
      model: m,
      temperature: TEMP_FAN[i] ?? 0.5,
      weight: 1,
    }));
  }

  private async probeOllamaModels(): Promise<string[]> {
    if (this.cachedModels) return this.cachedModels;
    try {
      const res = await fetch(this.ollamaBaseUrl + '/api/tags', { signal: AbortSignal.timeout(2500) });
      if (!res.ok) { this.cachedModels = []; return []; }
      const json = await res.json() as { models?: Array<{ name: string }> };
      const names = (json.models ?? []).map(m => m.name);
      // Prefer well-known coder/general models, then anything else.
      const ordered: string[] = [];
      for (const pref of PREFERRED_MODELS) {
        const hit = names.find(n => n.startsWith(pref));
        if (hit && !ordered.includes(hit)) ordered.push(hit);
      }
      for (const n of names) if (!ordered.includes(n)) ordered.push(n);
      this.cachedModels = ordered;
      return ordered;
    } catch {
      this.cachedModels = [];
      return [];
    }
  }

  private async askAgent(question: string, agent: AgentSpec, transcript: string, round: number): Promise<AgentVote> {
    const system = agent.systemPrompt
      ?? `You are voter "${agent.name}". Reply STRICTLY as JSON: {"position":"<short label>","confidence":<0..1>,"reasoning":"<one sentence>"}. Be opinionated and concise.`;
    const prompt = `Question: ${question}\n${round > 0 ? `Prior debate:\n${transcript}\n` : ''}Your vote (JSON only):`;
    const raw = agent.model
      ? await this.callOllama(agent.model, prompt, system, agent.temperature ?? 0.5)
      : this.deterministicStub(question, agent);

    const parsed = this.parseVote(raw);
    return {
      agent: agent.name,
      position: (parsed.position || 'undecided').slice(0, 80),
      confidence: clamp01(parsed.confidence),
      reasoning: (parsed.reasoning || raw).slice(0, 280),
      weight: clamp01(agent.weight ?? 1),
    };
  }

  private async callOllama(model: string, prompt: string, system: string, temperature: number): Promise<string> {
    try {
      const res = await fetch(this.ollamaBaseUrl + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, prompt, system, stream: false,
          options: { temperature, num_predict: 256 },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return '';
      const json = await res.json() as { response?: string };
      return (json.response ?? '').trim();
    } catch {
      return '';
    }
  }

  private parseVote(raw: string): { position: string; confidence: number; reasoning: string } {
    if (!raw) return { position: 'undecided', confidence: 0.5, reasoning: 'No response from model.' };
    // Try JSON first (handles models that follow instructions).
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { position?: string; confidence?: number; reasoning?: string };
        return {
          position: String(parsed.position ?? 'undecided'),
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          reasoning: String(parsed.reasoning ?? raw),
        };
      } catch { /* fall through */ }
    }
    // Heuristic fallback: first short line = position, rest = reasoning.
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const position = lines[0]?.slice(0, 60) || 'undecided';
    const reasoning = lines.slice(1).join(' ') || raw;
    return { position, confidence: 0.55, reasoning };
  }

  private deterministicStub(question: string, agent: AgentSpec): string {
    // Provides 3 distinct stable positions when no LLM is available.
    const seed = hash32(`${agent.name}::${question}`);
    const labels = ['yes', 'no', 'depends'];
    const pos = labels[seed % labels.length];
    const conf = 0.4 + ((seed >>> 8) % 60) / 100;
    return JSON.stringify({
      position: pos,
      confidence: Number(conf.toFixed(2)),
      reasoning: `Stub voter ${agent.name} answered "${pos}" deterministically (no LLM available).`,
    });
  }

  private tally(votes: AgentVote[], mode: VotingMode, allowDissent: boolean): { consensus: string; confidence: number; dissents: AgentVote[] } {
    if (votes.length === 0) {
      return { consensus: 'undecided', confidence: 0, dissents: [] };
    }
    const byPosition: Record<string, { totalWeight: number; totalConf: number; count: number }> = {};
    for (const v of votes) {
      const key = normalizePosition(v.position);
      const entry = byPosition[key] ?? { totalWeight: 0, totalConf: 0, count: 0 };
      entry.totalWeight += v.weight * v.confidence;
      entry.totalConf += v.confidence;
      entry.count += 1;
      byPosition[key] = entry;
    }
    const ranked = Object.entries(byPosition).sort((a, b) => {
      if (mode === 'majority') return b[1].count - a[1].count;
      // 'weighted' or 'unanimous' both use weighted sum for the winner
      return b[1].totalWeight - a[1].totalWeight;
    });

    const winner = ranked[0][0];
    const winnerEntry = ranked[0][1];
    const dissents = votes.filter(v => normalizePosition(v.position) !== winner);

    if (mode === 'unanimous' && dissents.length > 0 && !allowDissent) {
      return {
        consensus: 'NO CONSENSUS (unanimous mode, dissent present)',
        confidence: 1 - dissents.length / votes.length,
        dissents,
      };
    }

    const confidence = winnerEntry.totalConf / winnerEntry.count;
    return { consensus: winner, confidence, dissents };
  }

  private distribute(votes: AgentVote[]): { byConfidence: number[]; byPosition: Record<string, number> } {
    const buckets = new Array<number>(10).fill(0);
    for (const v of votes) {
      const idx = Math.min(9, Math.max(0, Math.floor(v.confidence * 10)));
      buckets[idx]++;
    }
    const byPosition: Record<string, number> = {};
    for (const v of votes) {
      const k = normalizePosition(v.position);
      byPosition[k] = (byPosition[k] ?? 0) + 1;
    }
    return { byConfidence: buckets, byPosition };
  }

  private renderSvg(question: string, votes: AgentVote[], consensus: string, dissents: AgentVote[]): string {
    const W = 1200, H = 400;
    const dissentSet = new Set(dissents.map(d => d.agent));
    const margin = { top: 90, left: 70, right: 40, bottom: 60 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;
    const barCount = Math.max(1, votes.length);
    const barW = Math.max(40, Math.floor(innerW / (barCount * 1.4)));
    const gap = (innerW - barW * barCount) / Math.max(1, barCount + 1);

    const bars = votes.map((v, i) => {
      const x = margin.left + gap + i * (barW + gap);
      const h = Math.max(4, Math.round(v.confidence * v.weight * innerH));
      const y = margin.top + innerH - h;
      const isDissent = dissentSet.has(v.agent);
      const fill = isDissent ? 'url(#asbDissent)' : 'url(#asbAccent)';
      const label = escapeXml(v.agent.length > 14 ? v.agent.slice(0, 13) + '…' : v.agent);
      const pos = escapeXml(v.position.length > 18 ? v.position.slice(0, 17) + '…' : v.position);
      return `    <g>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${fill}" stroke="#18ffff" stroke-opacity="0.35"/>
      <text x="${x + barW / 2}" y="${margin.top + innerH + 22}" font-size="14" fill="#a4afc4" text-anchor="middle">${label}</text>
      <text x="${x + barW / 2}" y="${margin.top + innerH + 40}" font-size="11" fill="#64708a" text-anchor="middle">${pos}</text>
      <text x="${x + barW / 2}" y="${y - 8}" font-size="12" fill="#e8ecf4" text-anchor="middle">${(v.confidence * 100).toFixed(0)}%</text>
    </g>`;
    }).join('\n');

    const safeQ = escapeXml(question.length > 110 ? question.slice(0, 109) + '…' : question);
    const safeConsensus = escapeXml(consensus);
    const dissentText = dissents.length === 0
      ? 'unanimous'
      : `${dissents.length} dissent${dissents.length === 1 ? '' : 's'}`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Hive Voice consensus card">
  <defs>
    <linearGradient id="asbAccent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#18ffff"/>
      <stop offset="55%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
    <linearGradient id="asbDissent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff5864"/>
      <stop offset="100%" stop-color="#ffb53f"/>
    </linearGradient>
    <linearGradient id="asbBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#030509"/>
      <stop offset="100%" stop-color="#10152a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#asbBg)"/>
  <text x="40" y="44" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="700" fill="#18ffff">Hive Voice</text>
  <text x="40" y="68" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" fill="#a4afc4">${safeQ}</text>
  <text x="${W - 40}" y="44" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14" fill="#ec4899" text-anchor="end">consensus: ${safeConsensus}</text>
  <text x="${W - 40}" y="64" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#a855f7" text-anchor="end">${dissentText}</text>
${bars}
  <line x1="${margin.left}" y1="${margin.top + innerH}" x2="${W - margin.right}" y2="${margin.top + innerH}" stroke="#3e4762" stroke-width="1"/>
  <text x="40" y="${H - 12}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#3e4762">agent-shadow-brain · hive voice</text>
</svg>`;
  }

  private projectStoreDir(projectDir: string): string {
    return path.join(STORE_ROOT, slugify(path.basename(projectDir || 'default')));
  }

  private async persist(result: HiveVote, projectDir: string): Promise<void> {
    try {
      const dir = this.projectStoreDir(projectDir);
      fs.mkdirSync(dir, { recursive: true });
      const ts = result.capturedAt.replace(/[:.]/g, '-');
      const id = crypto.randomBytes(3).toString('hex');
      const filePath = path.join(dir, `${ts}-${id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    } catch { /* non-fatal */ }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function normalizePosition(s: string): string {
  return s.trim().toLowerCase().replace(/[.!?,;]+$/, '').slice(0, 60) || 'undecided';
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

let _instance: HiveVoice | null = null;
export function getHiveVoice(): HiveVoice {
  if (!_instance) _instance = new HiveVoice();
  return _instance;
}
export function resetHiveVoiceForTests(): void { _instance = null; }
