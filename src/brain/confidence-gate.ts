// src/brain/confidence-gate.ts — Active output filter for confidence-tagged results
// v6.0.2 — Hive Mind Edition
//
// CalibrationMonitor is passive: it watches claims roll past and scores them.
// This module is the active half: given a `{text, confidence}` result, it
// can block it, downgrade its tone, or flag it with a warning — depending on
// the gate mode chosen by the caller.
//
// Why three modes? Different callers want different ergonomics:
//   - block:     hard gate for tool calls / autonomous agents that must not
//                act on shaky info.
//   - downgrade: chat surfaces, where we still want to say something but
//                visibly hedge so the user doesn't trust it blindly.
//   - flag:     observability layer that lets downstream logic decide.
//
// Calibration history (predicted → outcome) is logged as JSONL so the
// reliability of `confidence` itself is auditable. Brier score + ECE on
// .stats() lets us tell whether the gate threshold is well-chosen.
//
// Exposed: ConfidenceGate, getConfidenceGate(), resetConfidenceGateForTests().
//   .gate(result, opts)
//   .recordOutcome(predicted, wasCorrect, meta?)
//   .stats()
//   .setThreshold(t), .getThreshold()

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type GateMode = 'block' | 'downgrade' | 'flag';

export interface GatedInput {
  text: string;
  confidence: number;
  [k: string]: unknown;
}

export interface GateOpts {
  threshold?: number;
  mode: GateMode;
  hedgeHint?: string;
}

export interface GatedResultBlocked {
  blocked: true;
  reason: string;
  predicted: number;
  threshold: number;
}

export interface GatedResultPassed<T extends GatedInput> {
  blocked: false;
  result: T & { _warning?: string };
  mode: GateMode;
  predicted: number;
  threshold: number;
  downgraded: boolean;
}

export type GateOutcome<T extends GatedInput> = GatedResultBlocked | GatedResultPassed<T>;

export interface CalibrationEntry {
  ts: string;
  predicted: number;
  wasCorrect: 0 | 0.5 | 1;
  meta?: Record<string, unknown>;
}

export interface CalibrationStats {
  sampleSize: number;
  brierScore: number;
  expectedCalibrationError: number;
  bucketBreakdown: Array<{ bucket: string; samples: number; meanPredicted: number; meanOutcome: number; gap: number }>;
  threshold: number;
}

const HOME_DIR = path.join(os.homedir(), '.shadow-brain');
const HISTORY_PATH = path.join(HOME_DIR, 'calibration-history.jsonl');
const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
const DEFAULT_THRESHOLD = 0.6;
const ECE_BUCKETS = 10;

export class ConfidenceGate {
  private threshold: number = DEFAULT_THRESHOLD;
  private historyCache: CalibrationEntry[] | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(HOME_DIR, { recursive: true });
    this.threshold = this.readConfiguredThreshold();
    this.initialized = true;
  }

  /** Apply the gate. Synchronous because the threshold is already loaded. */
  gate<T extends GatedInput>(result: T, opts: GateOpts): GateOutcome<T> {
    if (!this.initialized) this.threshold = this.readConfiguredThreshold();
    const threshold = opts.threshold ?? this.threshold;
    const predicted = clamp(result.confidence, 0, 1);

    if (predicted >= threshold) {
      return {
        blocked: false,
        result,
        mode: opts.mode,
        predicted,
        threshold,
        downgraded: false,
      };
    }

    switch (opts.mode) {
      case 'block':
        return {
          blocked: true,
          reason: `Confidence ${(predicted * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`,
          predicted,
          threshold,
        };
      case 'downgrade': {
        const hedged: T & { _warning?: string } = {
          ...result,
          text: hedge(result.text, predicted, opts.hedgeHint),
          _warning: `low-confidence (${(predicted * 100).toFixed(0)}%)`,
        };
        return { blocked: false, result: hedged, mode: 'downgrade', predicted, threshold, downgraded: true };
      }
      case 'flag':
      default:
        return {
          blocked: false,
          result: { ...result, _warning: `low-confidence (${(predicted * 100).toFixed(0)}%)` },
          mode: 'flag',
          predicted,
          threshold,
          downgraded: false,
        };
    }
  }

  /** Record what actually happened so we can compute calibration stats later. */
  async recordOutcome(predicted: number, wasCorrect: boolean | 'partial', meta?: Record<string, unknown>): Promise<void> {
    await this.init();
    const entry: CalibrationEntry = {
      ts: new Date().toISOString(),
      predicted: clamp(predicted, 0, 1),
      wasCorrect: wasCorrect === 'partial' ? 0.5 : wasCorrect ? 1 : 0,
      meta,
    };
    try { fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n'); }
    catch { /* non-fatal */ }
    if (this.historyCache) this.historyCache.push(entry);
  }

  /** Brier + ECE over all recorded outcomes. */
  async stats(): Promise<CalibrationStats> {
    await this.init();
    const entries = this.loadHistory();
    if (!entries.length) {
      return {
        sampleSize: 0,
        brierScore: 0,
        expectedCalibrationError: 0,
        bucketBreakdown: [],
        threshold: this.threshold,
      };
    }

    let brierSum = 0;
    for (const e of entries) {
      const d = e.predicted - e.wasCorrect;
      brierSum += d * d;
    }
    const brier = brierSum / entries.length;

    const buckets: Array<{ bucket: string; samples: number; meanPredicted: number; meanOutcome: number; gap: number }> = [];
    for (let i = 0; i < ECE_BUCKETS; i++) {
      const lo = i / ECE_BUCKETS;
      const hi = (i + 1) / ECE_BUCKETS;
      const inBucket = entries.filter(e => e.predicted >= lo && (i === ECE_BUCKETS - 1 ? e.predicted <= hi : e.predicted < hi));
      if (!inBucket.length) continue;
      const meanPredicted = avg(inBucket.map(e => e.predicted));
      const meanOutcome = avg(inBucket.map(e => e.wasCorrect));
      buckets.push({
        bucket: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
        samples: inBucket.length,
        meanPredicted: +meanPredicted.toFixed(3),
        meanOutcome: +meanOutcome.toFixed(3),
        gap: +Math.abs(meanPredicted - meanOutcome).toFixed(3),
      });
    }
    const ece = buckets.reduce((s, b) => s + (b.samples / entries.length) * b.gap, 0);

    return {
      sampleSize: entries.length,
      brierScore: +brier.toFixed(4),
      expectedCalibrationError: +ece.toFixed(4),
      bucketBreakdown: buckets,
      threshold: this.threshold,
    };
  }

  setThreshold(t: number): void {
    this.threshold = clamp(t, 0, 1);
    this.writeConfiguredThreshold(this.threshold);
  }

  getThreshold(): number { return this.threshold; }

  /** Convenience wrapper for promise-returning functions. */
  async wrap<T extends GatedInput>(
    fn: () => Promise<T>,
    opts: GateOpts,
  ): Promise<GateOutcome<T>> {
    await this.init();
    const result = await fn();
    return this.gate(result, opts);
  }

  // -- Internals -----------------------------------------------------------

  private loadHistory(): CalibrationEntry[] {
    if (this.historyCache) return this.historyCache;
    if (!fs.existsSync(HISTORY_PATH)) { this.historyCache = []; return this.historyCache; }
    const out: CalibrationEntry[] = [];
    try {
      const lines = fs.readFileSync(HISTORY_PATH, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as CalibrationEntry); } catch { /* skip malformed */ }
      }
    } catch { /* fall through with empty cache */ }
    this.historyCache = out;
    return out;
  }

  private readConfiguredThreshold(): number {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_THRESHOLD;
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as { confidenceGate?: number | { threshold?: number } };
      const raw = cfg.confidenceGate;
      if (typeof raw === 'number') return clamp(raw, 0, 1);
      if (raw && typeof raw === 'object' && typeof raw.threshold === 'number') return clamp(raw.threshold, 0, 1);
      return DEFAULT_THRESHOLD;
    } catch { return DEFAULT_THRESHOLD; }
  }

  private writeConfiguredThreshold(t: number): void {
    try {
      let cfg: Record<string, unknown> = {};
      if (fs.existsSync(CONFIG_PATH)) {
        try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>; }
        catch { cfg = {}; }
      }
      cfg.confidenceGate = t;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    } catch { /* non-fatal */ }
  }
}

function hedge(text: string, confidence: number, hint?: string): string {
  const pct = Math.round(confidence * 100);
  const verifyTarget = hint || 'the key claims';
  return `I'm only ${pct}% confident — verify ${verifyTarget} first:\n\n${text}`;
}

function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

let _instance: ConfidenceGate | null = null;
export function getConfidenceGate(): ConfidenceGate {
  if (!_instance) _instance = new ConfidenceGate();
  return _instance;
}
export function resetConfidenceGateForTests(): void { _instance = null; }
