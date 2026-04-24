// src/brain/forgetting-curve.ts — Ebbinghaus-inspired memory decay + sleep consolidation
// v6.0.0 — Hive Mind Edition
//
// Memory strength decays over time unless reinforced. During "sleep" cycles,
// memories that cross strength thresholds are promoted or demoted between
// hierarchical tiers (raw → summary → pattern → principle).
//
// Formula (simplified Ebbinghaus):
//   strength(t) = initialStrength * exp(-t / halfLife)
// Half-life grows each time a memory is reinforced (spacing effect).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ConsolidationReport,
  ForgettingState,
  MemoryTier,
} from '../types.js';

const STATE_PATH = path.join(os.homedir(), '.shadow-brain', 'forgetting.json');

const DEFAULT_HALF_LIFE_HOURS = 72;
const MIN_STRENGTH_BEFORE_FORGET = 0.05;

interface PersistShape {
  schemaVersion: 1;
  states: ForgettingState[];
  reports: ConsolidationReport[];
}

export class ForgettingCurve {
  private states: Map<string, ForgettingState> = new Map();
  private reports: ConsolidationReport[] = [];
  private cycleCount = 0;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (fs.existsSync(STATE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as PersistShape;
        for (const s of parsed.states ?? []) {
          this.states.set(s.memoryId, { ...s, lastReinforced: new Date(s.lastReinforced) });
        }
        this.reports = (parsed.reports ?? []).map(r => ({ ...r, ranAt: new Date(r.ranAt) }));
        this.cycleCount = this.reports.length;
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  async track(memoryId: string, initialStrength = 1.0, consolidatedTier: MemoryTier = 'raw'): Promise<ForgettingState> {
    await this.init();
    const existing = this.states.get(memoryId);
    if (existing) return existing;
    const state: ForgettingState = {
      memoryId,
      initialStrength,
      currentStrength: initialStrength,
      lastReinforced: new Date(),
      accessCount: 1,
      halfLifeHours: DEFAULT_HALF_LIFE_HOURS,
      consolidatedTier,
    };
    this.states.set(memoryId, state);
    await this.persist();
    return state;
  }

  async reinforce(memoryId: string, strengthBoost = 0.2): Promise<ForgettingState | null> {
    await this.init();
    const state = this.states.get(memoryId);
    if (!state) return null;
    state.currentStrength = Math.min(1.0, state.currentStrength + strengthBoost);
    state.accessCount++;
    state.halfLifeHours = Math.min(24 * 90, state.halfLifeHours * 1.4); // spacing effect
    state.lastReinforced = new Date();
    await this.persist();
    return state;
  }

  /** Run a consolidation sleep cycle. Returns a report of changes. */
  async runConsolidation(): Promise<ConsolidationReport> {
    await this.init();
    const start = Date.now();
    this.cycleCount++;
    let promoted = 0;
    let demoted = 0;
    let forgotten = 0;
    let strengthened = 0;

    const now = Date.now();
    const toForget: string[] = [];

    for (const state of this.states.values()) {
      const ageHours = (now - state.lastReinforced.getTime()) / (1000 * 60 * 60);
      state.currentStrength = state.initialStrength * Math.exp(-ageHours / state.halfLifeHours);

      if (state.currentStrength < MIN_STRENGTH_BEFORE_FORGET) {
        toForget.push(state.memoryId);
        forgotten++;
        continue;
      }

      // Tier movement based on strength
      const prevTier = state.consolidatedTier;
      state.consolidatedTier = this.tierForStrength(state.currentStrength, state.accessCount);
      if (this.tierRank(state.consolidatedTier) > this.tierRank(prevTier)) promoted++;
      else if (this.tierRank(state.consolidatedTier) < this.tierRank(prevTier)) demoted++;
      if (state.currentStrength >= 0.85) strengthened++;
    }

    for (const id of toForget) this.states.delete(id);

    const report: ConsolidationReport = {
      cycle: this.cycleCount,
      processedMemories: this.states.size + forgotten,
      promoted,
      demoted,
      forgotten,
      strengthened,
      ranAt: new Date(),
      durationMs: Date.now() - start,
    };
    this.reports.push(report);
    if (this.reports.length > 50) this.reports = this.reports.slice(-50);
    await this.persist();
    return report;
  }

  getState(memoryId: string): ForgettingState | null {
    return this.states.get(memoryId) ?? null;
  }

  listStates(limit = 50): ForgettingState[] {
    return Array.from(this.states.values())
      .sort((a, b) => b.currentStrength - a.currentStrength)
      .slice(0, limit);
  }

  listReports(limit = 20): ConsolidationReport[] {
    return this.reports.slice(-limit).reverse();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private tierForStrength(strength: number, accessCount: number): MemoryTier {
    if (strength >= 0.9 && accessCount >= 10) return 'principle';
    if (strength >= 0.7 && accessCount >= 4) return 'pattern';
    if (strength >= 0.4) return 'summary';
    return 'raw';
  }

  private tierRank(tier: MemoryTier): number {
    switch (tier) {
      case 'raw': return 0;
      case 'summary': return 1;
      case 'pattern': return 2;
      case 'principle': return 3;
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        states: Array.from(this.states.values()),
        reports: this.reports,
      };
      const tmp = STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, STATE_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: ForgettingCurve | null = null;

export function getForgettingCurve(): ForgettingCurve {
  if (!_instance) _instance = new ForgettingCurve();
  return _instance;
}

export function resetForgettingCurveForTests(): void {
  _instance = null;
}
