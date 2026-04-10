// src/brain/pattern-memory.ts — Pattern learning system that persists across sessions
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BrainInsight, FileChange, ProjectContext } from '../types.js';

interface ObservedPattern {
  id: string;
  type: 'file_correlation' | 'error_pattern' | 'change_frequency' | 'dependency_impact' | 'agent_behavior';
  pattern: string;
  occurrences: number;
  lastSeen: Date;
  context: Record<string, string>;
  insightTemplate?: string;
}

interface PatternMemoryStore {
  version: number;
  patterns: ObservedPattern[];
  projectSummaries: Record<string, ProjectSummary>;
  lastCleanup: Date;
}

interface ProjectSummary {
  name: string;
  languages: string[];
  framework?: string;
  totalFilesWatched: number;
  totalInsightsGenerated: number;
  topInsightTypes: Record<string, number>;
  lastAnalyzed: Date;
}

export class PatternMemory {
  private storePath: string;
  private store: PatternMemoryStore;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storeDir?: string) {
    const dir = storeDir || join(homedir(), '.shadow-brain');
    this.storePath = join(dir, 'patterns.json');
    this.store = {
      version: 1,
      patterns: [],
      projectSummaries: {},
      lastCleanup: new Date(),
    };
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        version: parsed.version || 1,
        patterns: (parsed.patterns || []).map((p: any) => ({
          ...p,
          lastSeen: new Date(p.lastSeen),
        })),
        projectSummaries: parsed.projectSummaries || {},
        lastCleanup: new Date(parsed.lastCleanup || Date.now()),
      };
    } catch {
      // No existing store — start fresh
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      const dir = join(this.storePath, '..');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Silently fail — pattern memory is best-effort
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 5000);
  }

  // === PATTERN RECORDING ===

  /** Record file correlation patterns (files that change together) */
  recordFileCorrelation(changes: FileChange[]): void {
    if (changes.length < 2) return;

    const files = changes.map(c => c.path).sort();
    const patternKey = files.join('|');

    const existing = this.store.patterns.find(
      p => p.type === 'file_correlation' && p.pattern === patternKey
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = new Date();
    } else {
      this.store.patterns.push({
        id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'file_correlation',
        pattern: patternKey,
        occurrences: 1,
        lastSeen: new Date(),
        context: { fileCount: String(files.length) },
        insightTemplate: `These ${files.length} files frequently change together. Consider refactoring into a shared module or ensuring changes are coordinated.`,
      });
    }

    this.dirty = true;
    this.scheduleSave();
  }

  /** Record error patterns from insights */
  recordErrorPattern(insight: BrainInsight): void {
    if (insight.priority !== 'critical' && insight.priority !== 'high') return;

    const patternKey = `${insight.type}:${insight.title.replace(/\s+/g, '_').toLowerCase()}`;

    const existing = this.store.patterns.find(
      p => p.type === 'error_pattern' && p.pattern === patternKey
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = new Date();
      if (insight.files) {
        existing.context.files = [...new Set([...(existing.context.files?.split(',') || []), ...insight.files])].join(',');
      }
    } else {
      this.store.patterns.push({
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'error_pattern',
        pattern: patternKey,
        occurrences: 1,
        lastSeen: new Date(),
        context: {
          title: insight.title,
          priority: insight.priority,
          files: insight.files?.join(',') || '',
        },
      });
    }

    this.dirty = true;
    this.scheduleSave();
  }

  /** Record which files change most frequently */
  recordChangeFrequency(changes: FileChange[]): void {
    for (const change of changes) {
      const patternKey = `freq:${change.path}`;

      const existing = this.store.patterns.find(
        p => p.type === 'change_frequency' && p.pattern === patternKey
      );

      if (existing) {
        existing.occurrences++;
        existing.lastSeen = new Date();
      } else {
        this.store.patterns.push({
          id: `freq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'change_frequency',
          pattern: patternKey,
          occurrences: 1,
          lastSeen: new Date(),
          context: { path: change.path, type: change.type },
        });
      }
    }

    this.dirty = true;
    this.scheduleSave();
  }

  /** Record project analysis summary */
  recordProjectSummary(context: ProjectContext, insightCount: number, insightTypes: Record<string, number>): void {
    const key = context.rootDir.replace(/[\/\\]/g, '_');
    this.store.projectSummaries[key] = {
      name: context.name,
      languages: context.language,
      framework: context.framework,
      totalFilesWatched: (this.store.projectSummaries[key]?.totalFilesWatched || 0) + context.recentChanges.length,
      totalInsightsGenerated: (this.store.projectSummaries[key]?.totalInsightsGenerated || 0) + insightCount,
      topInsightTypes: { ...this.store.projectSummaries[key]?.topInsightTypes, ...insightTypes },
      lastAnalyzed: new Date(),
    };

    this.dirty = true;
    this.scheduleSave();
  }

  // === PATTERN RETRIEVAL ===

  /** Get insights based on learned patterns for current changes */
  getPatternInsights(changes: FileChange[]): BrainInsight[] {
    const insights: BrainInsight[] = [];
    const now = new Date();
    const changedPaths = new Set(changes.map(c => c.path));

    // Check file correlations — if some files in a known group changed, warn about the others
    const correlations = this.store.patterns
      .filter(p => p.type === 'file_correlation' && p.occurrences >= 3);

    for (const corr of correlations) {
      const files = corr.pattern.split('|');
      const changedInGroup = files.filter(f => changedPaths.has(f));
      const unchangedInGroup = files.filter(f => !changedPaths.has(f));

      if (changedInGroup.length > 0 && unchangedInGroup.length > 0) {
        insights.push({
          type: 'pattern',
          priority: 'medium',
          title: 'Related files may need updating',
          content: `These files frequently change together. You changed ${changedInGroup.join(', ')} but did NOT update: ${unchangedInGroup.join(', ')}. Verify they don't need coordinated changes.`,
          files: unchangedInGroup,
          timestamp: now,
        });
      }
    }

    // Check for recurring error patterns in the same files
    const errorPatterns = this.store.patterns
      .filter(p => p.type === 'error_pattern' && p.occurrences >= 2);

    for (const err of errorPatterns) {
      const errFiles = err.context.files?.split(',').filter(Boolean) || [];
      const overlap = errFiles.some(f => changedPaths.has(f));
      if (overlap) {
        insights.push({
          type: 'warning',
          priority: 'high',
          title: `Recurring issue: ${err.context.title}`,
          content: `This pattern has been flagged ${err.occurrences} times before. The issue "${err.context.title}" keeps recurring in these files. Consider a more fundamental fix.`,
          files: errFiles,
          timestamp: now,
        });
      }
    }

    // Check hot spots — files that change very frequently
    const hotFiles = this.store.patterns
      .filter(p => p.type === 'change_frequency' && p.occurrences >= 5)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 3);

    for (const hot of hotFiles) {
      if (changedPaths.has(hot.context.path)) {
        insights.push({
          type: 'pattern',
          priority: 'low',
          title: 'Frequently changed file',
          content: `${hot.context.path} has been modified ${hot.occurrences} times. Consider whether this file has too many responsibilities or if there's an unstable requirement.`,
          files: [hot.context.path],
          timestamp: now,
        });
      }
    }

    return insights;
  }

  /** Get project summary for a directory */
  getProjectSummary(projectDir: string): ProjectSummary | null {
    const key = projectDir.replace(/[\/\\]/g, '_');
    return this.store.projectSummaries[key] || null;
  }

  /** Get pattern statistics */
  getStats(): { totalPatterns: number; byType: Record<string, number>; projectCount: number } {
    const byType: Record<string, number> = {};
    for (const p of this.store.patterns) {
      byType[p.type] = (byType[p.type] || 0) + 1;
    }
    return {
      totalPatterns: this.store.patterns.length,
      byType,
      projectCount: Object.keys(this.store.projectSummaries).length,
    };
  }

  /** Clean up old patterns (called periodically) */
  cleanup(maxAgeDays = 30): void {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    this.store.patterns = this.store.patterns.filter(
      p => p.lastSeen > cutoff || p.occurrences >= 3
    );

    this.store.lastCleanup = new Date();
    this.dirty = true;
    this.scheduleSave();
  }
}
