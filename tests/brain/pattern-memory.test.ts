import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PatternMemory } from '../../src/brain/pattern-memory.js';
import { BrainInsight, FileChange, ProjectContext } from '../../src/types.js';

describe('PatternMemory', () => {
  let memory: PatternMemory;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pattern-memory-test-'));
    memory = new PatternMemory(tempDir);
    await memory.load();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('load() / save() round-trip', () => {
    it('persists patterns to disk and reloads them', async () => {
      const changes: FileChange[] = [
        { path: 'src/a.ts', type: 'modify' },
        { path: 'src/b.ts', type: 'modify' },
      ];
      memory.recordFileCorrelation(changes);
      await memory.save();

      // Load into a fresh instance
      const memory2 = new PatternMemory(tempDir);
      await memory2.load();
      const stats = memory2.getStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.byType['file_correlation']).toBe(1);
    });

    it('starts fresh when no store file exists', async () => {
      const stats = memory.getStats();
      expect(stats.totalPatterns).toBe(0);
      expect(stats.projectCount).toBe(0);
    });
  });

  describe('recordFileCorrelation()', () => {
    it('records a correlation between changed files', async () => {
      const changes: FileChange[] = [
        { path: 'src/user.ts', type: 'modify' },
        { path: 'src/user.test.ts', type: 'modify' },
      ];
      memory.recordFileCorrelation(changes);

      const stats = memory.getStats();
      expect(stats.byType['file_correlation']).toBe(1);
    });

    it('increments occurrences when same pattern seen again', async () => {
      const changes: FileChange[] = [
        { path: 'src/a.ts', type: 'modify' },
        { path: 'src/b.ts', type: 'modify' },
      ];
      memory.recordFileCorrelation(changes);
      memory.recordFileCorrelation(changes);
      memory.recordFileCorrelation(changes);

      const stats = memory.getStats();
      expect(stats.totalPatterns).toBe(1); // same pattern, not duplicated
    });

    it('does nothing with fewer than 2 changes', () => {
      const changes: FileChange[] = [
        { path: 'src/only.ts', type: 'modify' },
      ];
      memory.recordFileCorrelation(changes);
      expect(memory.getStats().totalPatterns).toBe(0);
    });
  });

  describe('recordChangeFrequency()', () => {
    it('records per-file change frequency', () => {
      const changes: FileChange[] = [
        { path: 'src/hot.ts', type: 'modify' },
        { path: 'src/cool.ts', type: 'modify' },
      ];
      memory.recordChangeFrequency(changes);

      const stats = memory.getStats();
      expect(stats.byType['change_frequency']).toBe(2);
    });

    it('increments frequency for already-seen files', () => {
      const changes1: FileChange[] = [{ path: 'src/hot.ts', type: 'modify' }];
      const changes2: FileChange[] = [{ path: 'src/hot.ts', type: 'modify' }];

      memory.recordChangeFrequency(changes1);
      memory.recordChangeFrequency(changes2);

      const stats = memory.getStats();
      expect(stats.byType['change_frequency']).toBe(1); // same file, not duplicated
    });
  });

  describe('recordErrorPattern()', () => {
    it('records high-priority insight as error pattern', () => {
      const insight: BrainInsight = {
        type: 'warning',
        priority: 'critical',
        title: 'SQL Injection Detected',
        content: 'Potential SQL injection in db.ts',
        files: ['src/db.ts'],
        timestamp: new Date(),
      };

      memory.recordErrorPattern(insight);
      const stats = memory.getStats();
      expect(stats.byType['error_pattern']).toBe(1);
    });

    it('ignores low-priority insights', () => {
      const insight: BrainInsight = {
        type: 'context',
        priority: 'low',
        title: 'Changes monitored',
        content: 'Nothing serious',
        timestamp: new Date(),
      };

      memory.recordErrorPattern(insight);
      expect(memory.getStats().totalPatterns).toBe(0);
    });

    it('accumulates file list for recurring errors', () => {
      const insight1: BrainInsight = {
        type: 'warning',
        priority: 'high',
        title: 'Missing Error Handling',
        content: 'No try/catch',
        files: ['src/a.ts'],
        timestamp: new Date(),
      };
      const insight2: BrainInsight = {
        type: 'warning',
        priority: 'high',
        title: 'Missing Error Handling',
        content: 'No try/catch again',
        files: ['src/b.ts'],
        timestamp: new Date(),
      };

      memory.recordErrorPattern(insight1);
      memory.recordErrorPattern(insight2);

      const stats = memory.getStats();
      expect(stats.byType['error_pattern']).toBe(1); // same pattern, incremented
    });
  });

  describe('getPatternInsights()', () => {
    it('returns correlation insights when related files change', async () => {
      // Record a correlation pattern 3+ times
      const correlatedFiles: FileChange[] = [
        { path: 'src/model.ts', type: 'modify' },
        { path: 'src/model.test.ts', type: 'modify' },
      ];
      for (let i = 0; i < 3; i++) {
        memory.recordFileCorrelation(correlatedFiles);
      }

      // Now change only one of the correlated files
      const newChanges: FileChange[] = [
        { path: 'src/model.ts', type: 'modify' },
      ];

      const insights = await memory.getPatternInsights(newChanges);
      const correlationInsight = insights.find(i =>
        i.title === 'Related files may need updating'
      );
      expect(correlationInsight).toBeDefined();
      expect(correlationInsight!.files).toContain('src/model.test.ts');
    });

    it('returns error pattern insights when same files are changed', async () => {
      // Record an error pattern 2+ times
      const insight: BrainInsight = {
        type: 'warning',
        priority: 'critical',
        title: 'Auth Bypass Risk',
        content: 'Missing auth check',
        files: ['src/routes.ts'],
        timestamp: new Date(),
      };
      memory.recordErrorPattern(insight);
      memory.recordErrorPattern(insight);

      const changes: FileChange[] = [
        { path: 'src/routes.ts', type: 'modify' },
      ];
      const insights = await memory.getPatternInsights(changes);
      const errorInsight = insights.find(i =>
        i.title.includes('Recurring issue')
      );
      expect(errorInsight).toBeDefined();
    });

    it('returns empty when no patterns match', async () => {
      const changes: FileChange[] = [
        { path: 'src/new-file.ts', type: 'add' },
      ];
      const insights = await memory.getPatternInsights(changes);
      expect(insights).toHaveLength(0);
    });
  });

  describe('recordProjectSummary()', () => {
    it('records project analysis summary', () => {
      const context: ProjectContext = {
        name: 'test-project',
        rootDir: '/tmp/test',
        language: ['typescript'],
        structure: [],
        recentChanges: [{ path: 'src/app.ts', type: 'modify' }],
      };

      memory.recordProjectSummary(context, 5, { warning: 3, suggestion: 2 });
      const summary = memory.getProjectSummary('/tmp/test');
      expect(summary).toBeDefined();
      expect(summary!.name).toBe('test-project');
      expect(summary!.totalInsightsGenerated).toBe(5);
    });
  });

  describe('cleanup()', () => {
    it('removes old patterns but keeps frequent ones', () => {
      // Record a pattern
      const changes: FileChange[] = [
        { path: 'src/a.ts', type: 'modify' },
        { path: 'src/b.ts', type: 'modify' },
      ];
      memory.recordFileCorrelation(changes);
      memory.recordFileCorrelation(changes);
      memory.recordFileCorrelation(changes); // 3 occurrences — should survive

      memory.cleanup(0); // maxAge=0 removes everything old, but keeps >=3 occurrences
      const stats = memory.getStats();
      expect(stats.totalPatterns).toBe(1); // kept because occurrences >= 3
    });
  });
});
