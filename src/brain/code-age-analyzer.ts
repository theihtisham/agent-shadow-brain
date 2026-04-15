// src/brain/code-age-analyzer.ts — Code staleness and age analysis
// v3.0.0 — Tracks file modification age, churn, and staleness risk

import { BrainInsight, CodeAgeResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export class CodeAgeAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 300): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];
    const results: CodeAgeResult[] = [];

    const now = Date.now();

    for (const filePath of files) {
      const result = this.analyzeFileAge(filePath, now);
      if (result) {
        results.push(result);
      }
    }

    // Sort by staleness score descending
    results.sort((a, b) => b.stalenessScore - a.stalenessScore);

    // Generate insights for stale files
    for (const result of results) {
      if (result.risk === 'ancient' || result.risk === 'stale') {
        insights.push(this.ageToInsight(result));
      }
    }

    // Summary insight if many stale files
    const staleCount = results.filter(r => r.risk === 'stale' || r.risk === 'ancient').length;
    const totalFiles = results.length;
    if (staleCount > totalFiles * 0.3 && totalFiles > 10) {
      insights.push({
        type: 'warning',
        priority: 'medium',
        title: `[age] ${(staleCount / totalFiles * 100).toFixed(0)}% of code is stale (>180 days since modification)`,
        content:
          `Project has ${staleCount}/${totalFiles} files that haven't been modified in over 180 days.\n` +
          `  This may indicate: dead code, abandoned features, or stable-but-untested modules.\n` +
          `  Consider reviewing stale files for removal or adding test coverage.`,
        files: results.filter(r => r.risk === 'stale' || r.risk === 'ancient').map(r => r.file).slice(0, 20),
        timestamp: new Date(),
        confidence: 0.7,
        metadata: { stalePercentage: staleCount / totalFiles, totalFiles, staleCount },
      });
    }

    return insights;
  }

  private analyzeFileAge(filePath: string, now: number): CodeAgeResult | null {
    let stat: fs.Stats;
    try { stat = fs.statSync(filePath); } catch { return null; }

    const relPath = path.relative(this.projectDir, filePath);
    const lastModified = stat.mtime;
    const daysSinceModification = Math.floor((now - lastModified.getTime()) / (1000 * 60 * 60 * 24));

    // Determine risk level
    let risk: CodeAgeResult['risk'];
    if (daysSinceModification <= 7) risk = 'fresh';
    else if (daysSinceModification <= 30) risk = 'stable';
    else if (daysSinceModification <= 90) risk = 'aging';
    else if (daysSinceModification <= 365) risk = 'stale';
    else risk = 'ancient';

    // Staleness score: 0 = fresh, 1 = very stale
    const stalenessScore = Math.min(1, daysSinceModification / 365);

    // Try to get git blame info (simplified — just count unique authors from recent changes)
    const authors = this.getFileAuthors(filePath);

    return {
      file: relPath,
      lastModified,
      daysSinceModification,
      linesChangedRecently: 0, // would need git log for exact count
      stalenessScore,
      risk,
      authors,
      churnRate: 0, // would need git history for exact rate
    };
  }

  private getFileAuthors(filePath: string): string[] {
    // Try reading git log for authors (best-effort)
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        `git log --format="%an" --follow -- "${path.relative(this.projectDir, filePath)}"`,
        { cwd: this.projectDir, timeout: 5000, encoding: 'utf-8' }
      );
      const authors = [...new Set(output.trim().split('\n').filter(Boolean) as string[])];
      return authors.slice(0, 5);
    } catch {
      return [];
    }
  }

  private ageToInsight(result: CodeAgeResult): BrainInsight {
    const daysText = result.daysSinceModification > 365
      ? `${(result.daysSinceModification / 365).toFixed(1)} years`
      : `${result.daysSinceModification} days`;

    return {
      type: 'warning',
      priority: result.risk === 'ancient' ? 'high' : 'medium',
      title: `[age] ${result.risk} file: ${result.file} (${daysText} since last change)`,
      content:
        `File ${result.file} hasn't been modified in ${daysText}.\n` +
        `  Risk level: ${result.risk}\n` +
        `  Staleness score: ${(result.stalenessScore * 100).toFixed(0)}%\n` +
        (result.authors.length > 0 ? `  Previous authors: ${result.authors.join(', ')}\n` : '') +
        `  Consider: Review for relevance, add tests if still needed, or remove if obsolete.`,
      files: [result.file],
      timestamp: new Date(),
      confidence: 0.75,
      metadata: { daysSinceModification: result.daysSinceModification, risk: result.risk, stalenessScore: result.stalenessScore },
    };
  }

  private collectFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles || depth > 10) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
