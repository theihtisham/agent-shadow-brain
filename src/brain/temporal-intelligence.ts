// src/brain/temporal-intelligence.ts — Time-series analysis of code evolution
// v6.0.0 — Temporal pattern detection and velocity tracking

import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TemporalEvent {
  id: string;
  timestamp: number;
  type: 'commit' | 'file-change' | 'bug-fix' | 'feature' | 'refactor' | 'incident' | 'deploy' | 'review';
  file?: string;
  description: string;
  impact: number; // 0-1
  metadata?: Record<string, unknown>;
}

export interface VelocityMetrics {
  daily: number;
  weekly: number;
  monthly: number;
  trend: 'accelerating' | 'stable' | 'decelerating' | 'stalled';
  trendConfidence: number;
  peakHours: number[]; // 0-23
  peakDays: number[]; // 0-6 (Sun-Sat)
  avgCycleTime: number; // ms between feature start and completion
}

export interface TemporalAnomaly {
  timestamp: number;
  type: 'burst' | 'drought' | 'pattern-break' | 'unusual-hour' | 'regression';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  evidence: string[];
  recommendation: string;
}

export interface FileHeatmap {
  file: string;
  changeFrequency: number;
  lastChanged: number;
  avgTimeBetweenChanges: number;
  hotness: number; // 0-1
  churnRisk: number; // 0-1
  stabilityScore: number; // 0-1
  changeTimes: number[];
}

export interface BugPrediction {
  file: string;
  probability: number;
  factors: string[];
  lastBugFix: number | null;
  changesSinceLastFix: number;
  complexity: number;
}

export interface TemporalStats {
  totalEvents: number;
  timeSpan: { start: number; end: number; durationDays: number };
  velocity: VelocityMetrics;
  anomalyCount: number;
  hotFiles: number;
  bugPredictions: number;
  avgEventsPerDay: number;
}

// ── Temporal Intelligence Engine ────────────────────────────────────────────

export class TemporalIntelligence {
  private events: TemporalEvent[] = [];
  private fileHistory: Map<string, TemporalEvent[]> = new Map();
  private anomalies: TemporalAnomaly[] = [];
  private fileHeatmaps: Map<string, FileHeatmap> = new Map();
  private bugPredictions: Map<string, BugPrediction> = new Map();
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  // ── Event Recording ─────────────────────────────────────────────────

  recordEvent(event: Omit<TemporalEvent, 'id'>): TemporalEvent {
    const fullEvent: TemporalEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    this.events.push(fullEvent);
    if (this.events.length > 50000) {
      this.events = this.events.slice(-30000);
    }

    // Track file history
    if (fullEvent.file) {
      if (!this.fileHistory.has(fullEvent.file)) {
        this.fileHistory.set(fullEvent.file, []);
      }
      const history = this.fileHistory.get(fullEvent.file)!;
      history.push(fullEvent);
      if (history.length > 500) {
        this.fileHistory.set(fullEvent.file, history.slice(-300));
      }
      this.updateFileHeatmap(fullEvent.file);
    }

    // Check for anomalies
    this.detectAnomalies(fullEvent);

    return fullEvent;
  }

  recordCommit(files: string[], message: string, timestamp?: number): void {
    const type = this.classifyCommit(message);
    const ts = timestamp || Date.now();

    for (const file of files) {
      this.recordEvent({
        timestamp: ts,
        type,
        file,
        description: message,
        impact: this.estimateImpact(message, files.length),
      });
    }
  }

  recordFileChange(file: string, changeType: 'add' | 'modify' | 'delete'): void {
    this.recordEvent({
      timestamp: Date.now(),
      type: 'file-change',
      file,
      description: `${changeType}: ${path.basename(file)}`,
      impact: changeType === 'delete' ? 0.5 : 0.3,
    });
  }

  // ── Velocity Analysis ───────────────────────────────────────────────

  getVelocity(): VelocityMetrics {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;

    const dailyEvents = this.events.filter(e => now - e.timestamp < dayMs);
    const weeklyEvents = this.events.filter(e => now - e.timestamp < weekMs);
    const monthlyEvents = this.events.filter(e => now - e.timestamp < monthMs);

    // Peak hours analysis
    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    for (const event of this.events) {
      const date = new Date(event.timestamp);
      hourCounts[date.getHours()]++;
      dayCounts[date.getDay()]++;
    }

    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(h => h.hour);

    const peakDays = dayCounts
      .map((count, day) => ({ day, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(d => d.day);

    // Trend detection (compare recent vs older activity)
    const recentWeek = this.events.filter(e => now - e.timestamp < weekMs).length;
    const previousWeek = this.events.filter(e => now - e.timestamp >= weekMs && now - e.timestamp < 2 * weekMs).length;

    let trend: VelocityMetrics['trend'] = 'stable';
    let trendConfidence = 0.5;

    if (previousWeek > 0) {
      const ratio = recentWeek / previousWeek;
      if (ratio > 1.3) { trend = 'accelerating'; trendConfidence = Math.min(1, (ratio - 1) * 2); }
      else if (ratio < 0.7) { trend = 'decelerating'; trendConfidence = Math.min(1, (1 - ratio) * 2); }
      else { trend = 'stable'; trendConfidence = 1 - Math.abs(ratio - 1); }
    } else if (recentWeek === 0) {
      trend = 'stalled';
      trendConfidence = 0.9;
    }

    // Average cycle time (time between feature-type events)
    const featureEvents = this.events.filter(e => e.type === 'feature').sort((a, b) => a.timestamp - b.timestamp);
    let avgCycleTime = 0;
    if (featureEvents.length >= 2) {
      const gaps = [];
      for (let i = 1; i < featureEvents.length; i++) {
        gaps.push(featureEvents[i].timestamp - featureEvents[i - 1].timestamp);
      }
      avgCycleTime = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    }

    return {
      daily: dailyEvents.length,
      weekly: weeklyEvents.length,
      monthly: monthlyEvents.length,
      trend,
      trendConfidence,
      peakHours,
      peakDays,
      avgCycleTime,
    };
  }

  // ── File Heatmap ────────────────────────────────────────────────────

  private updateFileHeatmap(file: string): void {
    const history = this.fileHistory.get(file);
    if (!history || history.length === 0) return;

    const now = Date.now();
    const timestamps = history.map(e => e.timestamp).sort((a, b) => a - b);

    // Calculate average time between changes
    let avgGap = 0;
    if (timestamps.length >= 2) {
      const gaps = [];
      for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i] - timestamps[i - 1]);
      }
      avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    }

    const lastChanged = timestamps[timestamps.length - 1];
    const dayMs = 24 * 60 * 60 * 1000;
    const timeSinceLastChange = now - lastChanged;

    // Hotness: recent changes with high frequency = hot
    const recentChanges = timestamps.filter(t => now - t < 7 * dayMs).length;
    const hotness = Math.min(1, recentChanges / 10);

    // Churn risk: files changing too frequently may be unstable
    const churnRisk = Math.min(1, (recentChanges / 7) * (history.filter(e => e.type === 'bug-fix').length / Math.max(1, history.length)));

    // Stability: inverse of change frequency, weighted by time since last change
    const stabilityScore = Math.min(1, Math.max(0, 1 - hotness + (timeSinceLastChange > 30 * dayMs ? 0.3 : 0)));

    this.fileHeatmaps.set(file, {
      file,
      changeFrequency: history.length,
      lastChanged,
      avgTimeBetweenChanges: avgGap,
      hotness,
      churnRisk,
      stabilityScore,
      changeTimes: timestamps.slice(-50),
    });
  }

  getHotFiles(n: number = 10): FileHeatmap[] {
    return Array.from(this.fileHeatmaps.values())
      .sort((a, b) => b.hotness - a.hotness)
      .slice(0, n);
  }

  getStableFiles(n: number = 10): FileHeatmap[] {
    return Array.from(this.fileHeatmaps.values())
      .filter(f => f.changeFrequency >= 3) // Must have some history
      .sort((a, b) => b.stabilityScore - a.stabilityScore)
      .slice(0, n);
  }

  getChurnRisks(threshold: number = 0.5): FileHeatmap[] {
    return Array.from(this.fileHeatmaps.values())
      .filter(f => f.churnRisk >= threshold)
      .sort((a, b) => b.churnRisk - a.churnRisk);
  }

  // ── Bug Prediction ──────────────────────────────────────────────────

  predictBugs(topN: number = 10): BugPrediction[] {
    this.bugPredictions.clear();

    for (const [file, history] of this.fileHistory) {
      const bugFixes = history.filter(e => e.type === 'bug-fix');
      const totalChanges = history.length;
      const lastBugFix = bugFixes.length > 0 ? bugFixes[bugFixes.length - 1].timestamp : null;
      const changesSinceLastFix = lastBugFix
        ? history.filter(e => e.timestamp > lastBugFix).length
        : totalChanges;

      // Bug probability factors
      const factors: string[] = [];
      let probability = 0;

      // Factor 1: Historical bug rate
      const bugRate = totalChanges > 0 ? bugFixes.length / totalChanges : 0;
      if (bugRate > 0.3) { probability += 0.3; factors.push(`High bug rate: ${(bugRate * 100).toFixed(0)}%`); }
      else if (bugRate > 0.1) { probability += 0.15; factors.push(`Moderate bug rate: ${(bugRate * 100).toFixed(0)}%`); }

      // Factor 2: High churn
      const heatmap = this.fileHeatmaps.get(file);
      if (heatmap && heatmap.hotness > 0.7) { probability += 0.2; factors.push('High churn rate'); }

      // Factor 3: Recent rapid changes
      const recentChanges = history.filter(e => Date.now() - e.timestamp < 7 * 24 * 60 * 60 * 1000).length;
      if (recentChanges > 5) { probability += 0.15; factors.push(`${recentChanges} changes in last week`); }

      // Factor 4: Many changes since last bug fix
      if (changesSinceLastFix > 10) { probability += 0.15; factors.push(`${changesSinceLastFix} changes since last fix`); }

      // Factor 5: High-impact changes
      const highImpact = history.filter(e => e.impact > 0.7).length;
      if (highImpact > 3) { probability += 0.1; factors.push(`${highImpact} high-impact changes`); }

      // Estimate complexity from change frequency
      const complexity = Math.min(1, totalChanges / 50);

      probability = Math.min(1, probability);
      if (factors.length > 0) {
        this.bugPredictions.set(file, {
          file,
          probability,
          factors,
          lastBugFix,
          changesSinceLastFix,
          complexity,
        });
      }
    }

    return Array.from(this.bugPredictions.values())
      .sort((a, b) => b.probability - a.probability)
      .slice(0, topN);
  }

  // ── Anomaly Detection ───────────────────────────────────────────────

  private detectAnomalies(event: TemporalEvent): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Detect burst: many events in short time
    const recentEvents = this.events.filter(e => now - e.timestamp < hourMs);
    if (recentEvents.length > 20) {
      const existingBurst = this.anomalies.find(a => a.type === 'burst' && now - a.timestamp < hourMs);
      if (!existingBurst) {
        this.anomalies.push({
          timestamp: now,
          type: 'burst',
          severity: recentEvents.length > 50 ? 'critical' : 'warning',
          description: `${recentEvents.length} events in the last hour — unusual activity burst`,
          evidence: recentEvents.slice(-5).map(e => e.description),
          recommendation: 'Review recent changes for accidental bulk operations or CI issues',
        });
      }
    }

    // Detect unusual hour
    const hour = new Date(event.timestamp).getHours();
    if (hour >= 0 && hour < 6) {
      this.anomalies.push({
        timestamp: now,
        type: 'unusual-hour',
        severity: 'info',
        description: `Activity at ${hour}:00 — outside normal working hours`,
        evidence: [event.description],
        recommendation: 'Late-night changes may need extra review',
      });
    }

    // Keep anomalies manageable
    if (this.anomalies.length > 1000) {
      this.anomalies = this.anomalies.slice(-500);
    }
  }

  detectDrought(): TemporalAnomaly | null {
    if (this.events.length === 0) return null;

    const lastEvent = this.events[this.events.length - 1];
    const gap = Date.now() - lastEvent.timestamp;
    const dayMs = 24 * 60 * 60 * 1000;

    if (gap > 3 * dayMs) {
      return {
        timestamp: Date.now(),
        type: 'drought',
        severity: gap > 7 * dayMs ? 'warning' : 'info',
        description: `No activity for ${Math.floor(gap / dayMs)} days`,
        evidence: [`Last event: ${lastEvent.description}`],
        recommendation: 'Consider reviewing pending work or checking for blocked tasks',
      };
    }

    return null;
  }

  getAnomalies(since?: number): TemporalAnomaly[] {
    if (since) {
      return this.anomalies.filter(a => a.timestamp >= since);
    }
    return [...this.anomalies];
  }

  // ── Timeline Analysis ───────────────────────────────────────────────

  getTimeline(file?: string, limit: number = 50): TemporalEvent[] {
    let events = file
      ? this.fileHistory.get(file) || []
      : this.events;

    return events.slice(-limit);
  }

  getDayDistribution(): Array<{ date: string; count: number; types: Record<string, number> }> {
    const distribution = new Map<string, { count: number; types: Record<string, number> }>();

    for (const event of this.events) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      if (!distribution.has(date)) {
        distribution.set(date, { count: 0, types: {} });
      }
      const day = distribution.get(date)!;
      day.count++;
      day.types[event.type] = (day.types[event.type] || 0) + 1;
    }

    return Array.from(distribution.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private classifyCommit(message: string): TemporalEvent['type'] {
    const msg = message.toLowerCase();
    if (/^fix|bug|patch|hotfix|resolve/.test(msg)) return 'bug-fix';
    if (/^feat|feature|add|new|implement/.test(msg)) return 'feature';
    if (/^refactor|restructure|reorganize|simplify/.test(msg)) return 'refactor';
    if (/^deploy|release|publish/.test(msg)) return 'deploy';
    if (/^review|cr |code review/.test(msg)) return 'review';
    return 'commit';
  }

  private estimateImpact(message: string, fileCount: number): number {
    let impact = 0.3;
    const msg = message.toLowerCase();

    if (/breaking|critical|urgent|security/.test(msg)) impact += 0.4;
    if (/major|significant|important/.test(msg)) impact += 0.2;
    if (fileCount > 10) impact += 0.2;
    else if (fileCount > 5) impact += 0.1;

    return Math.min(1, impact);
  }

  // ── Stats ────────────────────────────────────────────────────────────

  stats(): TemporalStats {
    const timestamps = this.events.map(e => e.timestamp);
    const start = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const end = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
    const durationDays = Math.max(1, (end - start) / (24 * 60 * 60 * 1000));

    return {
      totalEvents: this.events.length,
      timeSpan: { start, end, durationDays: Math.round(durationDays) },
      velocity: this.getVelocity(),
      anomalyCount: this.anomalies.length,
      hotFiles: Array.from(this.fileHeatmaps.values()).filter(f => f.hotness > 0.5).length,
      bugPredictions: this.bugPredictions.size,
      avgEventsPerDay: Math.round(this.events.length / durationDays),
    };
  }
}
