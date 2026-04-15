// src/brain/health-score.ts — Code Health Score system (0-100) with detailed breakdown

import { BrainInsight, FileChange, ProjectContext } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface HealthDimension {
  name: string;
  score: number;      // 0-100
  weight: number;     // relative weight in final score
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  details: string[];
}

export interface HealthScore {
  overall: number;           // 0-100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  trend: 'improving' | 'stable' | 'declining';
  dimensions: HealthDimension[];
  topIssues: string[];
  timestamp: Date;
  sessionId?: string;
}

export interface HealthHistory {
  scores: Array<{ overall: number; timestamp: string; sessionId?: string }>;
  baseline?: number;
}

const HISTORY_FILE = path.join(os.homedir(), '.shadow-brain', 'health-history.json');

export class HealthScoreEngine {
  private history: HealthHistory = { scores: [] };

  async load(): Promise<void> {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        this.history = JSON.parse(raw);
      }
    } catch { /* start fresh */ }
  }

  async save(): Promise<void> {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2));
    } catch { /* ignore */ }
  }

  compute(insights: BrainInsight[], changes: FileChange[], context: ProjectContext): HealthScore {
    const dimensions = this.computeDimensions(insights, changes, context);
    const overall = this.weightedAverage(dimensions);
    const grade = this.toGrade(overall);
    const trend = this.computeTrend(overall);
    const topIssues = this.extractTopIssues(insights);

    const score: HealthScore = {
      overall: Math.round(overall),
      grade,
      trend,
      dimensions,
      topIssues,
      timestamp: new Date(),
    };

    // Record in history
    this.history.scores.push({ overall: score.overall, timestamp: new Date().toISOString() });
    // Keep last 50 readings
    if (this.history.scores.length > 50) {
      this.history.scores = this.history.scores.slice(-50);
    }
    if (!this.history.baseline && this.history.scores.length >= 3) {
      this.history.baseline = Math.round(
        this.history.scores.slice(0, 3).reduce((s, r) => s + r.overall, 0) / 3
      );
    }

    return score;
  }

  private computeDimensions(
    insights: BrainInsight[],
    changes: FileChange[],
    context: ProjectContext,
  ): HealthDimension[] {
    const allContent = changes.map(c => c.content || c.diff || '').join('\n');

    // ─── Security (weight 30) ────────────────────────────────────────
    const securityIssues = insights.filter(i =>
      i.type === 'warning' && (
        i.title.includes('SQL') || i.title.includes('XSS') ||
        i.title.includes('secret') || i.title.includes('inject') ||
        i.title.includes('eval') || i.title.includes('exposed')
      )
    );
    const criticalSecurity = securityIssues.filter(i => i.priority === 'critical').length;
    const securityScore = Math.max(0, 100 - (criticalSecurity * 40) - (securityIssues.length * 10));
    const securityDetails: string[] = [];
    if (criticalSecurity > 0) securityDetails.push(`${criticalSecurity} critical vulnerability/vulnerabilities`);
    if (securityIssues.length === 0) securityDetails.push('No security issues detected');
    const envChanges = changes.filter(c => c.path.includes('.env') && !c.path.includes('.example'));
    if (envChanges.length > 0) securityDetails.push('Env file changes detected');

    // ─── Code Quality (weight 25) ────────────────────────────────────
    const qualityInsights = insights.filter(i =>
      i.type === 'review' || (i.type === 'suggestion' && !i.title.includes('performance') && !i.title.includes('N+1'))
    );
    const deletedFiles = changes.filter(c => c.type === 'delete').length;
    const largeBatch = changes.length > 15;
    const consoleLogCount = (allContent.match(/console\.log\s*\(/g) || []).length;
    let qualityScore = 100;
    qualityScore -= qualityInsights.filter(i => i.priority === 'high').length * 15;
    qualityScore -= qualityInsights.filter(i => i.priority === 'medium').length * 8;
    qualityScore -= deletedFiles > 0 ? 10 : 0;
    qualityScore -= largeBatch ? 20 : 0;
    qualityScore -= Math.min(consoleLogCount * 2, 15);
    qualityScore = Math.max(0, qualityScore);
    const qualityDetails: string[] = [];
    if (qualityInsights.length === 0) qualityDetails.push('Clean code changes');
    else qualityDetails.push(`${qualityInsights.length} quality concern(s)`);
    if (consoleLogCount > 3) qualityDetails.push(`${consoleLogCount} console.log statements`);
    if (largeBatch) qualityDetails.push('Very large batch of changes');

    // ─── Test Coverage (weight 20) ───────────────────────────────────
    const testFiles = changes.filter(c =>
      c.path.includes('.test.') || c.path.includes('.spec.') || c.path.includes('_test.')
    );
    const srcFiles = changes.filter(c =>
      !c.path.includes('.test.') && !c.path.includes('.spec.') &&
      /\.(ts|tsx|js|jsx|py|go|rs|java)$/.test(c.path) &&
      !c.path.includes('node_modules')
    );
    let testScore = 80; // start at 80 — can't know total coverage from just changes
    if (testFiles.length > 0) testScore = 100;
    else if (srcFiles.length > 3) testScore = 50;
    else if (srcFiles.length > 0) testScore = 70;
    // Bonus: has test framework in project
    const hasTestFramework = context.structure?.some(f =>
      /jest|vitest|pytest|mocha|rspec/.test(f)
    ) || false;
    if (hasTestFramework) testScore = Math.min(100, testScore + 10);
    const testDetails: string[] = [];
    testDetails.push(testFiles.length > 0 ? `${testFiles.length} test file(s) updated` : 'No test files changed');
    if (srcFiles.length > 0) testDetails.push(`${srcFiles.length} source file(s) modified`);

    // ─── Performance (weight 15) ─────────────────────────────────────
    const perfInsights = insights.filter(i =>
      i.title.includes('N+1') || i.title.includes('sync') || i.title.includes('performance') ||
      i.title.includes('Synchronous')
    );
    const n1Count = perfInsights.filter(i => i.title.includes('N+1')).length;
    const syncIOCount = perfInsights.filter(i => i.title.includes('Synchronous') || i.title.includes('sync')).length;
    let perfScore = 100;
    perfScore -= n1Count * 25;
    perfScore -= syncIOCount * 15;
    perfScore = Math.max(0, perfScore);
    const perfDetails: string[] = [];
    if (perfInsights.length === 0) perfDetails.push('No performance issues detected');
    if (n1Count > 0) perfDetails.push(`${n1Count} N+1 query risk(s)`);
    if (syncIOCount > 0) perfDetails.push(`${syncIOCount} sync I/O usage`);

    // ─── Architecture (weight 10) ────────────────────────────────────
    const archInsights = insights.filter(i =>
      i.title.includes('config') || i.title.includes('migration') ||
      i.title.includes('infrastructure') || i.title.includes('API endpoint') ||
      i.title.includes('Lock file') || i.title.includes('framework')
    );
    const hasGitignore = context.structure?.some(f => f.includes('.gitignore')) ?? true;
    const hasTsConfig = context.structure?.some(f => f.includes('tsconfig')) ?? true;
    let archScore = 100;
    archScore -= archInsights.filter(i => i.priority === 'high').length * 20;
    archScore -= archInsights.filter(i => i.priority === 'medium').length * 10;
    archScore -= !hasGitignore ? 15 : 0;
    archScore -= !hasTsConfig && changes.some(c => c.path.endsWith('.ts')) ? 10 : 0;
    archScore = Math.max(0, archScore);
    const archDetails: string[] = [];
    if (archInsights.length === 0) archDetails.push('Good architecture practices');
    else archDetails.push(`${archInsights.length} architecture concern(s)`);
    if (!hasGitignore) archDetails.push('Missing .gitignore');

    const dimensions: HealthDimension[] = [
      { name: 'Security', score: securityScore, weight: 30, status: this.toStatus(securityScore), details: securityDetails },
      { name: 'Code Quality', score: qualityScore, weight: 25, status: this.toStatus(qualityScore), details: qualityDetails },
      { name: 'Test Coverage', score: testScore, weight: 20, status: this.toStatus(testScore), details: testDetails },
      { name: 'Performance', score: perfScore, weight: 15, status: this.toStatus(perfScore), details: perfDetails },
      { name: 'Architecture', score: archScore, weight: 10, status: this.toStatus(archScore), details: archDetails },
    ];

    return dimensions;
  }

  private weightedAverage(dimensions: HealthDimension[]): number {
    const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
    const weighted = dimensions.reduce((s, d) => s + (d.score * d.weight), 0);
    return weighted / totalWeight;
  }

  private toGrade(score: number): HealthScore['grade'] {
    if (score >= 95) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  private toStatus(score: number): HealthDimension['status'] {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 55) return 'fair';
    if (score >= 35) return 'poor';
    return 'critical';
  }

  private computeTrend(current: number): HealthScore['trend'] {
    const recent = this.history.scores.slice(-5);
    if (recent.length < 2) return 'stable';
    const avg = recent.slice(0, -1).reduce((s, r) => s + r.overall, 0) / (recent.length - 1);
    if (current > avg + 3) return 'improving';
    if (current < avg - 3) return 'declining';
    return 'stable';
  }

  private extractTopIssues(insights: BrainInsight[]): string[] {
    return insights
      .filter(i => i.priority === 'critical' || i.priority === 'high')
      .slice(0, 3)
      .map(i => i.title);
  }

  generateBadgeSvg(score: HealthScore): string {
    const color = score.overall >= 85 ? '#4ade80' : score.overall >= 70 ? '#facc15' : score.overall >= 50 ? '#fb923c' : '#f87171';
    const label = `Health ${score.overall}/100`;
    const labelW = 90;
    const valueW = 72;
    const totalW = labelW + valueW;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${labelW / 2 * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - 10) * 10}">Shadow Brain</text>
    <text x="${labelW / 2 * 10}" y="140" transform="scale(.1)" textLength="${(labelW - 10) * 10}">Shadow Brain</text>
    <text x="${(labelW + valueW / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${label}</text>
    <text x="${(labelW + valueW / 2) * 10}" y="140" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${label}</text>
  </g>
</svg>`;
  }

  formatConsole(score: HealthScore): string {
    const trendIcon = score.trend === 'improving' ? '↑' : score.trend === 'declining' ? '↓' : '→';
    const gradeColor = score.overall >= 85 ? '\x1b[32m' : score.overall >= 70 ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';

    let out = `\n  ${gradeColor}⬟ Health Score: ${score.overall}/100 (Grade: ${score.grade}) ${trendIcon}${reset}\n\n`;

    for (const dim2 of score.dimensions) {
      const bar = this.progressBar(dim2.score, 20);
      const statusColor = dim2.status === 'excellent' ? '\x1b[32m' : dim2.status === 'good' ? '\x1b[36m' : dim2.status === 'fair' ? '\x1b[33m' : '\x1b[31m';
      out += `  ${dim}${dim2.name.padEnd(15)}${reset} ${statusColor}${bar}${reset} ${dim2.score}%\n`;
      for (const detail of dim2.details) {
        out += `                   ${dim}• ${detail}${reset}\n`;
      }
    }

    if (score.topIssues.length > 0) {
      out += `\n  \x1b[31mTop Issues:\x1b[0m\n`;
      for (const issue of score.topIssues) {
        out += `  ${dim}• ${issue}${reset}\n`;
      }
    }

    return out;
  }

  private progressBar(value: number, width: number): string {
    const filled = Math.round((value / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  getHistory(): HealthHistory {
    return this.history;
  }
}
