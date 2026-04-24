// src/brain/calibration-monitor.ts — Confidence calibration tracking
// v6.0.0 — Hive Mind Edition
//
// Does the AI know when it's right? Track every claim's confidence → outcome.
// Compute the Brier score per agent per category. Auto-adjust trust weights so
// downstream consumers can discount overconfident agents.
//
// Brier = mean squared error between claimed confidence and 0/1 outcome.
// Lower = better calibrated.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTool,
  CalibrationRecord,
  CalibrationScore,
} from '../types.js';

const DATA_PATH = path.join(os.homedir(), '.shadow-brain', 'calibration.json');

interface PersistShape {
  schemaVersion: 1;
  records: CalibrationRecord[];
  scores: CalibrationScore[];
}

export class CalibrationMonitor {
  private records: CalibrationRecord[] = [];
  private scores: Map<string, CalibrationScore> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    if (fs.existsSync(DATA_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as PersistShape;
        this.records = (parsed.records ?? []).map(r => ({
          ...r,
          recordedAt: new Date(r.recordedAt),
          outcomeAt: new Date(r.outcomeAt),
        }));
        for (const s of parsed.scores ?? []) {
          this.scores.set(this.keyFor(s.agentTool, s.category), { ...s, updatedAt: new Date(s.updatedAt) });
        }
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  async record(rec: Omit<CalibrationRecord, 'recordedAt'> & { recordedAt?: Date }): Promise<CalibrationScore> {
    await this.init();
    const full: CalibrationRecord = {
      ...rec,
      recordedAt: rec.recordedAt ?? new Date(),
      outcomeAt: rec.outcomeAt ?? new Date(),
    };
    this.records.push(full);
    const score = this.recomputeScore(full.agentTool, full.category);
    await this.persist();
    return score;
  }

  getScore(agentTool: AgentTool, category: string): CalibrationScore | null {
    return this.scores.get(this.keyFor(agentTool, category)) ?? null;
  }

  listScores(limit = 50): CalibrationScore[] {
    return Array.from(this.scores.values())
      .sort((a, b) => a.brierScore - b.brierScore)
      .slice(0, limit);
  }

  /** Multiplicative trust weight for a given agent+category (1.0 = as claimed). */
  trustWeight(agentTool: AgentTool, category: string): number {
    const s = this.getScore(agentTool, category);
    if (!s) return 1.0;
    return s.trustWeight;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private recomputeScore(agentTool: AgentTool, category: string): CalibrationScore {
    const relevant = this.records.filter(r => r.agentTool === agentTool && r.category === category);
    const sampleSize = relevant.length;
    if (!sampleSize) {
      const blank: CalibrationScore = {
        agentTool,
        category,
        sampleSize: 0,
        brierScore: 0,
        calibrationError: 0,
        overconfidenceRatio: 0,
        trustWeight: 1.0,
        updatedAt: new Date(),
      };
      this.scores.set(this.keyFor(agentTool, category), blank);
      return blank;
    }

    let brierSum = 0;
    let calErrSum = 0;
    let overconfidentCount = 0;
    for (const r of relevant) {
      const outcomeBinary = r.actualOutcome === 'correct' ? 1 : r.actualOutcome === 'partial' ? 0.5 : 0;
      const delta = r.claimedConfidence - outcomeBinary;
      brierSum += delta * delta;
      calErrSum += Math.abs(delta);
      if (r.claimedConfidence > 0.7 && outcomeBinary < 0.5) overconfidentCount++;
    }
    const brier = brierSum / sampleSize;
    const calErr = calErrSum / sampleSize;
    const overconfidenceRatio = overconfidentCount / sampleSize;

    // Trust weight: 1.0 when calibrated, approaches 0.4 when badly over-confident
    const trustWeight = +Math.max(0.4, 1 - calErr * 0.8 - overconfidenceRatio * 0.4).toFixed(3);

    const score: CalibrationScore = {
      agentTool,
      category,
      sampleSize,
      brierScore: +brier.toFixed(4),
      calibrationError: +calErr.toFixed(4),
      overconfidenceRatio: +overconfidenceRatio.toFixed(3),
      trustWeight,
      updatedAt: new Date(),
    };
    this.scores.set(this.keyFor(agentTool, category), score);
    return score;
  }

  private keyFor(agent: AgentTool, category: string): string {
    return `${agent}::${category}`;
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        records: this.records,
        scores: Array.from(this.scores.values()),
      };
      const tmp = DATA_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, DATA_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: CalibrationMonitor | null = null;

export function getCalibrationMonitor(): CalibrationMonitor {
  if (!_instance) _instance = new CalibrationMonitor();
  return _instance;
}

export function resetCalibrationMonitorForTests(): void {
  _instance = null;
}
