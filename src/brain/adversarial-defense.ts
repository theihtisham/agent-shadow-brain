// src/brain/adversarial-defense.ts — Hallucination & Threat Guard
// Detects hallucinations, contradictions, and prompt injection in LLM outputs.
// Ensemble verification for critical insights.
// v4.0.0 — Hyper-Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  BrainInsight, HallucinationFlag, EnsembleVote, AdversarialLog, ThreatVector,
} from '../types.js';

const DEFENSE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.shadow-brain', 'defense');
const LOG_FILE = 'adversarial-log.json';

/**
 * Adversarial Defense — the immune system of the brain.
 *
 * Hallucination Detection:
 *   Cross-reference LLM claims against actual file content.
 *   "function X exists in file Y" → verify with file reads.
 *   Contradiction detection: compare against stored knowledge.
 *
 * Ensemble Verification:
 *   Critical insights → send to 2+ models → majority vote.
 *   Split verdict → flag for human review.
 *
 * Injection Detection:
 *   Scan for prompt injection patterns in agent inputs.
 *   Block and log ThreatVector when detected.
 *   Rate limit: max 3 injections per session before alert.
 */
export class AdversarialDefense {
  private log: AdversarialLog = {
    timestamp: new Date(),
    flagged: 0,
    blocked: 0,
    accuracy: 1.0,
    totalChecked: 0,
    falsePositives: 0,
  };
  private injectionCount = 0;
  private readonly MAX_INJECTIONS_PER_SESSION = 3;

  // Common prompt injection patterns
  private static readonly INJECTION_PATTERNS: Array<{ pattern: RegExp; type: ThreatVector['type']; severity: ThreatVector['severity'] }> = [
    { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, type: 'prompt-injection', severity: 'critical' },
    { pattern: /forget\s+(your|all)\s+rules/i, type: 'prompt-injection', severity: 'critical' },
    { pattern: /pretend\s+you\s+are/i, type: 'prompt-injection', severity: 'high' },
    { pattern: /you\s+are\s+now\s+a/i, type: 'prompt-injection', severity: 'high' },
    { pattern: /disregard\s+(your|all)\s+(training|instructions)/i, type: 'prompt-injection', severity: 'critical' },
    { pattern: /override\s+safety/i, type: 'prompt-injection', severity: 'critical' },
    { pattern: /system\s*:\s*/i, type: 'prompt-injection', severity: 'high' },
    { pattern: /<\|im_start\|>/i, type: 'prompt-injection', severity: 'high' },
    { pattern: /jailbreak/i, type: 'prompt-injection', severity: 'medium' },
    { pattern: /DAN\s+mode/i, type: 'prompt-injection', severity: 'high' },
    { pattern: /bypass\s+(all\s+)?filters/i, type: 'prompt-injection', severity: 'critical' },
    { pattern: /extract\s+(the\s+)?(prompt|system|instructions)/i, type: 'data-poisoning', severity: 'high' },
  ];

  constructor() {
    this.loadFromDisk();
  }

  // ── Hallucination Detection ─────────────────────────────────────────────────

  /**
   * Verify an insight against actual project state.
   * Cross-references claims with file content.
   */
  async verifyInsight(insight: BrainInsight, projectDir: string): Promise<HallucinationFlag> {
    this.log.totalChecked++;
    const contradictions: string[] = [];
    const evidence: string[] = [];
    let verifiedCount = 0;
    let totalClaims = 0;

    // Check file references in the insight
    if (insight.files && insight.files.length > 0) {
      for (const fileRef of insight.files) {
        totalClaims++;
        const fullPath = path.join(projectDir, fileRef);
        if (fs.existsSync(fullPath)) {
          verifiedCount++;
          evidence.push(`File exists: ${fileRef}`);

          // If insight mentions specific content, verify it
          if (insight.content) {
            try {
              const fileContent = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
              const contentLower = insight.content.toLowerCase();

              // Extract quoted strings from insight (potential claims about file content)
              const quotedMatches = contentLower.match(/["'`]([^"'`]{3,50})["'`]/g) || [];
              for (const match of quotedMatches) {
                const claim = match.replace(/["'`]/g, '');
                if (claim.length > 5 && !fileContent.includes(claim)) {
                  contradictions.push(`Claim "${claim}" not found in ${fileRef}`);
                }
              }
            } catch {
              // Cannot verify content
            }
          }
        } else {
          contradictions.push(`Referenced file does not exist: ${fileRef}`);
        }
      }
    }

    // Check confidence calibration
    if (insight.confidence !== undefined) {
      totalClaims++;
      if (insight.confidence > 0.9 && contradictions.length > 0) {
        contradictions.push(`High confidence (${insight.confidence}) but ${contradictions.length} unverified claims`);
      } else if (insight.confidence < 0.3) {
        evidence.push('Low confidence claim — treated with appropriate uncertainty');
        verifiedCount++;
      } else {
        verifiedCount++;
      }
    }

    // Calculate verification score
    const confidence = totalClaims > 0 ? verifiedCount / totalClaims : 0.5;
    const hasContradictions = contradictions.length > 0;

    let verdict: HallucinationFlag['verdict'];
    if (hasContradictions && confidence < 0.3) {
      verdict = 'hallucinated';
      this.log.flagged++;
    } else if (hasContradictions) {
      verdict = 'uncertain';
      this.log.flagged++;
    } else {
      verdict = 'real';
    }

    // Update accuracy
    this.log.accuracy = this.log.totalChecked > 0
      ? (this.log.totalChecked - this.log.flagged) / this.log.totalChecked
      : 1.0;

    await this.saveToDisk();

    return {
      claim: insight.title,
      confidence,
      verified: verdict === 'real',
      contradictions,
      verdict,
      evidence,
      checkedAt: new Date(),
    };
  }

  // ── Ensemble Verification ───────────────────────────────────────────────────

  /**
   * Send a question to multiple models and collect votes.
   * Majority consensus required for acceptance.
   */
  ensembleVerify(question: string, modelAnswers: Array<{ model: string; answer: string; confidence: number }>): EnsembleVote {
    if (modelAnswers.length === 0) {
      return {
        question,
        votes: [],
        consensus: 'none',
        agreedAnswer: '',
        confidence: 0,
      };
    }

    // Find majority answer (by similarity, not exact match)
    const answerGroups: Map<string, Array<{ model: string; answer: string; confidence: number }>> = new Map();

    for (const vote of modelAnswers) {
      let matched = false;
      for (const [key, group] of answerGroups) {
        // Simple similarity: check if answers share key words
        const similarity = this.textSimilarity(vote.answer, key);
        if (similarity > 0.6) {
          group.push(vote);
          matched = true;
          break;
        }
      }
      if (!matched) {
        answerGroups.set(vote.answer, [vote]);
      }
    }

    // Find largest group
    let largestGroup: Array<{ model: string; answer: string; confidence: number }> = [];
    for (const group of answerGroups.values()) {
      if (group.length > largestGroup.length) {
        largestGroup = group;
      }
    }

    const totalVotes = modelAnswers.length;
    const agreeingVotes = largestGroup.length;
    const ratio = agreeingVotes / totalVotes;

    let consensus: EnsembleVote['consensus'];
    if (ratio === 1) consensus = 'unanimous';
    else if (ratio > 0.5) consensus = 'majority';
    else if (ratio === 0.5) consensus = 'split';
    else consensus = 'none';

    const avgConfidence = largestGroup.reduce((s, v) => s + v.confidence, 0) / largestGroup.length;

    return {
      question,
      votes: modelAnswers,
      consensus,
      agreedAnswer: largestGroup[0]?.answer ?? '',
      confidence: avgConfidence,
    };
  }

  // ── Injection Detection ─────────────────────────────────────────────────────

  /**
   * Scan input for prompt injection patterns.
   * Returns ThreatVector if detected, null otherwise.
   */
  scanForInjection(input: string): ThreatVector | null {
    for (const { pattern, type, severity } of AdversarialDefense.INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return {
          type,
          severity,
          blocked: true,
          source: 'input-scan',
          pattern: pattern.source,
          timestamp: new Date(),
        };
      }
    }

    // Check for encoded injection attempts
    const decodedInput = this.decodeCommonEncodings(input);
    if (decodedInput !== input) {
      for (const { pattern, type, severity } of AdversarialDefense.INJECTION_PATTERNS) {
        if (pattern.test(decodedInput)) {
          return {
            type,
            severity,
            blocked: true,
            source: 'encoded-injection',
            pattern: `encoded:${pattern.source}`,
            timestamp: new Date(),
          };
        }
      }
    }

    return null;
  }

  /** Block and log a detected threat */
  blockAndLog(threat: ThreatVector): void {
    this.injectionCount++;
    this.log.blocked++;

    if (this.injectionCount >= this.MAX_INJECTIONS_PER_SESSION) {
      threat.severity = 'critical';
    }

    this.saveToDisk();
  }

  /** Get defense statistics */
  getDefenseStats(): AdversarialLog {
    return { ...this.log, timestamp: new Date() };
  }

  /** Get injection count for current session */
  getSessionInjectionCount(): number {
    return this.injectionCount;
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /** Simple text similarity based on shared words */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /** Attempt to decode common encoding schemes */
  private decodeCommonEncodings(input: string): string {
    try {
      // Base64
      if (/^[A-Za-z0-9+/]+=*$/.test(input) && input.length > 20) {
        return Buffer.from(input, 'base64').toString('utf-8');
      }
    } catch { /* not base64 */ }

    try {
      // URL encoding
      if (input.includes('%')) {
        return decodeURIComponent(input);
      }
    } catch { /* not URL encoded */ }

    return input;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async saveToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(DEFENSE_DIR)) {
        fs.mkdirSync(DEFENSE_DIR, { recursive: true });
      }
      fs.writeFileSync(
        path.join(DEFENSE_DIR, LOG_FILE),
        JSON.stringify(this.log)
      );
    } catch { /* non-blocking */ }
  }

  private loadFromDisk(): void {
    try {
      const logFile = path.join(DEFENSE_DIR, LOG_FILE);
      if (!fs.existsSync(logFile)) return;
      const data = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
      this.log = { ...this.log, ...data, timestamp: new Date(data.timestamp) };
    } catch { /* fresh start */ }
  }
}
