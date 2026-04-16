// src/brain/consensus-engine.ts — Multi-Agent Consensus Protocol
// Voting, trust scoring, conflict resolution for shared intelligence
// v5.0.0 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  TrustScore,
} from '../types.js';

const STORE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.shadow-brain', 'consensus'
);

const VOTE_TIMEOUT_MS = 60_000; // 1 minute to vote on a proposal
const MIN_VOTES_FOR_CONSENSUS = 2;
const CONSENSUS_THRESHOLD = 0.6; // 60% agreement required

type Verdict = 'accepted' | 'rejected' | 'conflict' | 'pending';

/**
 * ConsensusEngine — multi-agent agreement protocol.
 *
 * When multiple AI agents observe the same codebase, they may produce
 * conflicting insights. This engine:
 *
 * 1. Collects proposals from agents
 * 2. Opens voting windows where agents vote accept/reject with confidence
 * 3. Computes agreement scores and confidence intervals
 * 4. Resolves conflicts via weighted trust scores
 * 5. Tracks long-term trust for each agent based on proposal accuracy
 */
export class ConsensusEngine {
  private proposals: Map<string, ConsensusProposal> = new Map();
  private votes: Map<string, ConsensusVote[]> = new Map();
  private results: Map<string, ConsensusResult> = new Map();
  private trustScores: Map<string, TrustScore> = new Map();
  private pendingTimers: Map<string, NodeJS.Timeout> = new Map();
  private storeDir: string;
  private agentId: string;

  constructor(agentId?: string, customDir?: string) {
    this.agentId = agentId || `agent-${crypto.randomUUID().slice(0, 8)}`;
    this.storeDir = customDir || STORE_DIR;
    this.loadFromDisk();
  }

  // ── Proposal Management ──────────────────────────────────────────────────────

  /** Submit a new proposal for consensus */
  propose(
    content: string,
    category: string,
    confidence: number,
    evidence: string[] = []
  ): string {
    const id = crypto.randomUUID();

    const proposal: ConsensusProposal = {
      id,
      proposer: this.agentId,
      content,
      category,
      confidence,
      evidence,
      timestamp: new Date(),
    };

    this.proposals.set(id, proposal);
    this.votes.set(id, []);

    // Auto-vote agree for own proposal
    this.vote(id, 'agree', confidence, 'Self-proposal with initial confidence');

    // Set timeout for consensus resolution
    const timer = setTimeout(() => {
      this.resolveProposal(id);
      this.pendingTimers.delete(id);
    }, VOTE_TIMEOUT_MS);

    this.pendingTimers.set(id, timer);

    return id;
  }

  /** Vote on a proposal */
  vote(
    proposalId: string,
    vote: 'agree' | 'disagree' | 'abstain',
    confidence: number,
    reasoning: string
  ): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return false;

    const existingVotes = this.votes.get(proposalId) || [];

    // Check if agent already voted
    if (existingVotes.some(v => v.voter === this.agentId)) {
      return false;
    }

    const consensusVote: ConsensusVote = {
      voter: this.agentId,
      proposalId,
      vote,
      confidence,
      reasoning,
      timestamp: new Date(),
    };

    existingVotes.push(consensusVote);
    this.votes.set(proposalId, existingVotes);

    // Auto-resolve if enough votes
    if (existingVotes.length >= MIN_VOTES_FOR_CONSENSUS) {
      this.resolveProposal(proposalId);
    }

    return true;
  }

  /** Process an incoming vote from a remote agent */
  receiveVote(vote: ConsensusVote): boolean {
    const proposal = this.proposals.get(vote.proposalId);
    if (!proposal) return false;

    const existingVotes = this.votes.get(vote.proposalId) || [];

    // Check if voter already voted
    if (existingVotes.some(v => v.voter === vote.voter)) {
      return false;
    }

    existingVotes.push(vote);
    this.votes.set(vote.proposalId, existingVotes);

    // Auto-resolve if enough votes
    if (existingVotes.length >= MIN_VOTES_FOR_CONSENSUS) {
      this.resolveProposal(vote.proposalId);
    }

    return true;
  }

  /** Resolve a proposal by computing consensus */
  resolveProposal(proposalId: string): ConsensusResult | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    const votes = this.votes.get(proposalId) || [];
    if (votes.length === 0) return null;

    // Clear pending timer if exists
    const timer = this.pendingTimers.get(proposalId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(proposalId);
    }

    // Weighted vote counting — trust-weighted
    let acceptWeight = 0;
    let rejectWeight = 0;
    let totalWeight = 0;

    for (const v of votes) {
      const trust = this.getTrustScore(v.voter);
      const weight = trust * v.confidence;

      if (v.vote === 'agree') {
        acceptWeight += weight;
      } else {
        rejectWeight += weight;
      }
      totalWeight += weight;
    }

    const agreementScore = totalWeight > 0 ? acceptWeight / totalWeight : 0;

    // Compute confidence interval
    const confidences = votes.map(v => v.confidence);
    const avgConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;
    const confidenceStdDev = Math.sqrt(
      confidences.reduce((s, c) => s + Math.pow(c - avgConfidence, 2), 0) / confidences.length
    );
    const confidenceInterval: [number, number] = [
      Math.max(0, avgConfidence - 1.96 * confidenceStdDev),
      Math.min(1, avgConfidence + 1.96 * confidenceStdDev),
    ];

    // Determine verdict
    let verdict: Verdict;
    let conflictResolution: string | undefined;

    if (agreementScore >= CONSENSUS_THRESHOLD) {
      verdict = 'accepted';
    } else if (agreementScore <= 1 - CONSENSUS_THRESHOLD) {
      verdict = 'rejected';
    } else {
      // Conflict — resolve by trust-weighted proposer confidence
      verdict = proposal.confidence > 0.7 ? 'accepted' : 'rejected';
      conflictResolution = `Split vote (${(agreementScore * 100).toFixed(0)}% accept). Resolved by proposer confidence: ${(proposal.confidence * 100).toFixed(0)}%.`;
    }

    const result: ConsensusResult = {
      proposal,
      votes,
      verdict,
      agreementScore,
      confidenceInterval,
      resolvedAt: new Date(),
      conflictResolution,
    };

    this.results.set(proposalId, result);

    // Update trust scores based on outcome
    this.updateTrustFromResult(result);

    // Persist
    this.persistToDisk();

    return result;
  }

  // ── Trust Score Management ───────────────────────────────────────────────────

  private getTrustScore(agentId: string): number {
    const trust = this.trustScores.get(agentId);
    if (!trust) return 0.5; // Default trust for unknown agents
    return trust.score;
  }

  getTrustScores(): TrustScore[] {
    return Array.from(this.trustScores.values());
  }

  private updateTrustFromResult(result: ConsensusResult): void {
    const accepted = result.verdict === 'accepted';

    for (const vote of result.votes) {
      const trust = this.trustScores.get(vote.voter) || {
        agent: vote.voter,
        score: 0.5,
        totalProposals: 0,
        acceptedProposals: 0,
        rejectedProposals: 0,
        accuracyHistory: [],
        lastUpdated: new Date(),
      };

      trust.totalProposals++;

      const agreedWithOutcome = (vote.vote === 'agree') === accepted;
      if (agreedWithOutcome) {
        trust.acceptedProposals++;
      } else {
        trust.rejectedProposals++;
      }

      // Update accuracy history (keep last 100)
      trust.accuracyHistory.push(agreedWithOutcome ? 1 : 0);
      if (trust.accuracyHistory.length > 100) {
        trust.accuracyHistory = trust.accuracyHistory.slice(-100);
      }

      // Recalculate trust score
      const accuracy = trust.accuracyHistory.reduce((s, v) => s + v, 0) / trust.accuracyHistory.length;
      const participationBonus = Math.min(0.1, trust.totalProposals * 0.005);
      trust.score = Math.min(1, accuracy * 0.9 + participationBonus + 0.1);
      trust.lastUpdated = new Date();

      this.trustScores.set(vote.voter, trust);
    }
  }

  /** Manually adjust trust for an agent (e.g., human override) */
  setTrust(agentId: string, score: number): void {
    const trust = this.trustScores.get(agentId) || {
      agent: agentId,
      score: 0.5,
      totalProposals: 0,
      acceptedProposals: 0,
      rejectedProposals: 0,
      accuracyHistory: [],
      lastUpdated: new Date(),
    };
    trust.score = Math.max(0, Math.min(1, score));
    trust.lastUpdated = new Date();
    this.trustScores.set(agentId, trust);
  }

  // ── Query Operations ─────────────────────────────────────────────────────────

  /** Get result for a specific proposal */
  getResult(proposalId: string): ConsensusResult | undefined {
    return this.results.get(proposalId);
  }

  /** Get all proposals with a specific verdict */
  getByVerdict(verdict: Verdict): ConsensusResult[] {
    return Array.from(this.results.values())
      .filter(r => r.verdict === verdict);
  }

  /** Get proposals by category */
  getByCategory(category: string): ConsensusProposal[] {
    return Array.from(this.proposals.values())
      .filter(p => p.category === category);
  }

  /** Get pending proposals (not yet resolved) */
  getPending(): ConsensusProposal[] {
    return Array.from(this.proposals.keys())
      .filter(id => !this.results.has(id))
      .map(id => this.proposals.get(id)!)
      .filter(Boolean);
  }

  // ── Statistics ────────────────────────────────────────────────────────────────

  getStats(): {
    totalProposals: number;
    acceptedCount: number;
    rejectedCount: number;
    conflictCount: number;
    pendingCount: number;
    averageAgreement: number;
    agentCount: number;
    topTrustedAgents: Array<{ agent: string; score: number; accuracy: number }>;
  } {
    let accepted = 0;
    let rejected = 0;
    let conflict = 0;
    let totalAgreement = 0;

    for (const result of this.results.values()) {
      if (result.verdict === 'accepted') accepted++;
      else if (result.verdict === 'rejected') rejected++;
      else conflict++;
      totalAgreement += result.agreementScore;
    }

    const topTrusted = Array.from(this.trustScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(t => ({
        agent: t.agent,
        score: t.score,
        accuracy: t.accuracyHistory.length > 0
          ? t.accuracyHistory.reduce((s, v) => s + v, 0) / t.accuracyHistory.length
          : 0,
      }));

    return {
      totalProposals: this.proposals.size,
      acceptedCount: accepted,
      rejectedCount: rejected,
      conflictCount: conflict,
      pendingCount: this.proposals.size - this.results.size,
      averageAgreement: this.results.size > 0 ? totalAgreement / this.results.size : 0,
      agentCount: this.trustScores.size,
      topTrustedAgents: topTrusted,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async persistToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }

      const serialize = (obj: any): any => {
        const result = { ...obj };
        for (const key of Object.keys(result)) {
          const val = result[key];
          if (val instanceof Date) {
            result[key] = val.toISOString();
          }
        }
        return result;
      };

      const data = {
        proposals: Array.from(this.proposals.entries()).map(([id, p]) => [id, serialize(p)]),
        votes: Array.from(this.votes.entries()).map(([id, vs]) => [
          id,
          vs.map(v => serialize(v)),
        ]),
        results: Array.from(this.results.entries()).map(([id, r]) => [
          id,
          {
            ...serialize(r),
            votes: r.votes.map(v => serialize(v)),
            proposal: serialize(r.proposal),
          },
        ]),
        trustScores: Array.from(this.trustScores.entries()).map(([id, t]) => [id, serialize(t)]),
        version: '5.0.0',
      };

      fs.writeFileSync(
        path.join(this.storeDir, 'consensus-state.json'),
        JSON.stringify(data)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      const file = path.join(this.storeDir, 'consensus-state.json');
      if (!fs.existsSync(file)) return;

      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

      const revivify = (obj: Record<string, unknown>): Record<string, unknown> => {
        const result = { ...obj };
        for (const key of Object.keys(result)) {
          const val = result[key];
          if (typeof val === 'string' && key.endsWith('At') || key === 'timestamp' || key === 'lastUpdated') {
            try { (result as Record<string, unknown>)[key] = new Date(val as string); } catch { /* keep as string */ }
          }
        }
        return result;
      };

      if (data.proposals) {
        for (const [id, p] of data.proposals as [string, Record<string, unknown>][]) {
          this.proposals.set(id, revivify(p) as unknown as ConsensusProposal);
        }
      }

      if (data.votes) {
        for (const [id, vs] of data.votes as [string, Record<string, unknown>[]][]) {
          this.votes.set(id, vs.map(v => revivify(v) as unknown as ConsensusVote));
        }
      }

      if (data.results) {
        for (const [id, r] of data.results as [string, Record<string, unknown>][]) {
          const result = revivify(r) as Record<string, unknown>;
          if (result.proposal && typeof result.proposal === 'object') {
            result.proposal = revivify(result.proposal as Record<string, unknown>);
          }
          if (Array.isArray(result.votes)) {
            result.votes = (result.votes as Record<string, unknown>[]).map(v => revivify(v));
          }
          this.results.set(id, result as unknown as ConsensusResult);
        }
      }

      if (data.trustScores) {
        for (const [id, t] of data.trustScores as [string, Record<string, unknown>][]) {
          this.trustScores.set(id, revivify(t) as unknown as TrustScore);
        }
      }
    } catch {
      // Fresh start
    }
  }

  /** Clean up timers */
  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}
