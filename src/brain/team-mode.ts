// src/brain/team-mode.ts — Shared team insights, patterns, and stats
// Stores team data in .shadow-brain-team/ directory under the project

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { BrainInsight, TeamInsight, TeamStats, SharedPattern } from '../types.js';

export class TeamMode {
  private projectDir: string;
  private userName: string;
  private teamDir: string;
  private insightsDir: string;
  private patternsDir: string;
  private statsFile: string;

  constructor(projectDir: string, userName?: string) {
    this.projectDir = projectDir;
    this.userName = userName || this.detectUser();
    this.teamDir = path.join(projectDir, '.shadow-brain-team');
    this.insightsDir = path.join(this.teamDir, 'insights');
    this.patternsDir = path.join(this.teamDir, 'patterns');
    this.statsFile = path.join(this.teamDir, 'stats.json');

    this.ensureDirectories();
  }

  shareInsight(insight: BrainInsight): TeamInsight {
    const id = crypto.randomUUID();
    const teamInsight: TeamInsight = {
      id,
      insight: {
        ...insight,
        timestamp: insight.timestamp instanceof Date
          ? insight.timestamp
          : new Date(insight.timestamp),
      },
      sharedBy: this.userName,
      sharedAt: new Date(),
      upvotes: 0,
      downvotes: 0,
      tags: this.extractTags(insight),
    };

    const filePath = path.join(this.insightsDir, `${id}.json`);
    const serialized = this.serializeWithDates(teamInsight);

    fs.writeFileSync(filePath, serialized, 'utf-8');
    this.updateStats('share-insight', teamInsight);

    return teamInsight;
  }

  getTeamInsights(limit?: number): TeamInsight[] {
    const files = this.readJsonFiles(this.insightsDir);
    const insights = files
      .map((data) => this.deserializeTeamInsight(data))
      .sort((a, b) => {
        const dateA = a.sharedAt instanceof Date ? a.sharedAt.getTime() : new Date(a.sharedAt).getTime();
        const dateB = b.sharedAt instanceof Date ? b.sharedAt.getTime() : new Date(b.sharedAt).getTime();
        return dateB - dateA; // newest first
      });

    return limit ? insights.slice(0, limit) : insights;
  }

  getStats(): TeamStats {
    // Read existing stats or compute fresh
    let stats = this.readStatsFile();

    // Refresh stats by scanning actual data
    const insightFiles = this.readJsonFiles(this.insightsDir);
    const patternFiles = this.readJsonFiles(this.patternsDir);

    // Count unique contributors
    const contributors = new Map<string, number>();
    for (const data of insightFiles) {
      const sharedBy = (data as any).sharedBy as string;
      if (sharedBy) {
        contributors.set(sharedBy, (contributors.get(sharedBy) ?? 0) + 1);
      }
    }

    // Build top contributors
    const topContributors = Array.from(contributors.entries())
      .map(([name, insights]) => ({ name, insights }))
      .sort((a, b) => b.insights - a.insights);

    // Gather recent activity from stats log
    const recentActivity = (stats.recentActivity ?? [])
      .sort((a: any, b: any) => {
        const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return tB - tA;
      })
      .slice(0, 50);

    stats = {
      members: contributors.size || 1,
      totalInsights: insightFiles.length,
      totalPatterns: patternFiles.length,
      topContributors,
      recentActivity,
    };

    // Persist updated stats
    this.writeStatsFile(stats);

    return stats;
  }

  addPattern(pattern: SharedPattern): void {
    const filePath = path.join(this.patternsDir, `${pattern.id}.json`);

    // Check if pattern already exists — increment occurrences
    if (fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      existing.occurrences = (existing.occurrences ?? 0) + 1;
      existing.lastSeen = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    } else {
      const serialized = JSON.stringify({
        ...pattern,
        addedAt: pattern.addedAt instanceof Date ? pattern.addedAt.toISOString() : pattern.addedAt,
        occurrences: pattern.occurrences ?? 1,
      }, null, 2);
      fs.writeFileSync(filePath, serialized, 'utf-8');
    }

    this.updateStats('add-pattern', pattern);
  }

  getPatterns(language?: string): SharedPattern[] {
    const files = this.readJsonFiles(this.patternsDir);
    let patterns = files.map((data) => this.deserializeSharedPattern(data));

    if (language) {
      patterns = patterns.filter((p) => p.language === language);
    }

    return patterns.sort((a, b) => b.occurrences - a.occurrences);
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private detectUser(): string {
    // Try common environment variables
    const envUser =
      process.env.USER ||
      process.env.USERNAME ||
      process.env.GITHUB_USER ||
      null;

    if (envUser) return envUser;

    // Fall back to git config
    try {
      const { execSync } = require('child_process');
      const gitUser = execSync('git config user.name', {
        cwd: this.projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (gitUser) return gitUser;
    } catch {
      // git not available or not a git repo
    }

    return 'unknown';
  }

  private ensureDirectories(): void {
    const dirs = [this.teamDir, this.insightsDir, this.patternsDir];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private readJsonFiles(dirPath: string): object[] {
    if (!fs.existsSync(dirPath)) return [];

    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
      const results: object[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
          results.push(JSON.parse(content));
        } catch {
          // skip corrupt files
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private serializeWithDates(obj: unknown): string {
    return JSON.stringify(obj, (_, value) => {
      if (value instanceof Date) {
        return { __type: 'Date', iso: value.toISOString() };
      }
      return value;
    }, 2);
  }

  private deserializeTeamInsight(data: any): TeamInsight {
    return {
      id: data.id,
      insight: {
        ...data.insight,
        timestamp: this.parseDate(data.insight?.timestamp),
      },
      sharedBy: data.sharedBy,
      sharedAt: this.parseDate(data.sharedAt),
      upvotes: data.upvotes ?? 0,
      downvotes: data.downvotes ?? 0,
      tags: data.tags ?? [],
    };
  }

  private deserializeSharedPattern(data: any): SharedPattern {
    return {
      id: data.id,
      pattern: data.pattern,
      description: data.description,
      language: data.language,
      category: data.category,
      addedBy: data.addedBy,
      addedAt: this.parseDate(data.addedAt),
      occurrences: data.occurrences ?? 1,
    };
  }

  private parseDate(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    if (value?.__type === 'Date' && value.iso) return new Date(value.iso);
    return new Date();
  }

  private extractTags(insight: BrainInsight): string[] {
    const tags = new Set<string>();
    tags.add(insight.type);
    tags.add(insight.priority);

    if (insight.files) {
      for (const file of insight.files) {
        const ext = path.extname(file).toLowerCase();
        if (ext) tags.add(ext.replace('.', ''));
      }
    }

    if (insight.sourceAgent) {
      tags.add(insight.sourceAgent);
    }

    return Array.from(tags);
  }

  private readStatsFile(): any {
    if (!fs.existsSync(this.statsFile)) {
      return { members: 0, totalInsights: 0, totalPatterns: 0, topContributors: [], recentActivity: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
    } catch {
      return { members: 0, totalInsights: 0, totalPatterns: 0, topContributors: [], recentActivity: [] };
    }
  }

  private writeStatsFile(stats: any): void {
    const serialized = JSON.stringify(stats, (_, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    }, 2);
    fs.writeFileSync(this.statsFile, serialized, 'utf-8');
  }

  private updateStats(action: string, payload: any): void {
    const stats = this.readStatsFile();

    if (!stats.recentActivity) {
      stats.recentActivity = [];
    }

    stats.recentActivity.push({
      user: this.userName,
      action,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 100 activity entries
    if (stats.recentActivity.length > 100) {
      stats.recentActivity = stats.recentActivity.slice(-100);
    }

    this.writeStatsFile(stats);
  }
}
