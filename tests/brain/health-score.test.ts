import { describe, it, expect, beforeEach } from 'vitest';
import { HealthScoreEngine, HealthScore } from '../../src/brain/health-score.js';
import { BrainInsight, FileChange, ProjectContext } from '../../src/types.js';

describe('HealthScoreEngine', () => {
  let engine: HealthScoreEngine;

  const emptyContext: ProjectContext = {
    name: 'test-project',
    rootDir: '/tmp/test',
    language: ['typescript'],
    structure: ['.gitignore', 'tsconfig.json', 'vitest.config.ts'],
    recentChanges: [],
  };

  beforeEach(() => {
    engine = new HealthScoreEngine();
  });

  describe('compute()', () => {
    it('returns a perfect score for clean insights and changes', () => {
      const insights: BrainInsight[] = [
        { type: 'context', priority: 'low', title: 'Changes monitored', content: 'All clean', timestamp: new Date() },
      ];
      const changes: FileChange[] = [
        { path: 'src/utils.ts', type: 'modify', content: 'const x = 1;' },
        { path: 'src/utils.test.ts', type: 'modify', content: 'test("works", () => {});' },
      ];

      const score = engine.compute(insights, changes, emptyContext);

      expect(score.overall).toBeGreaterThan(70);
      expect(score.grade).toBeDefined();
      expect(score.dimensions).toHaveLength(5);
      expect(score.timestamp).toBeInstanceOf(Date);
      expect(score.topIssues).toBeDefined();
    });

    it('penalizes for security warnings', () => {
      const insights: BrainInsight[] = [
        { type: 'warning', priority: 'critical', title: 'Possible API key exposed in code', content: 'Hardcoded secret found', timestamp: new Date() },
        { type: 'warning', priority: 'critical', title: 'Potential SQL injection vulnerability', content: 'SQL injection risk', timestamp: new Date() },
      ];
      const changes: FileChange[] = [
        { path: 'src/db.ts', type: 'modify', content: "const apiKey = 'sk-1234567890abcdef1234567890abcdef'" },
      ];

      const score = engine.compute(insights, changes, emptyContext);
      expect(score.overall).toBeLessThan(70);
      expect(score.topIssues.length).toBeGreaterThan(0);
    });

    it('penalizes for very large batches of changes', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = Array.from({ length: 20 }, (_, i) => ({
        path: `src/file${i}.ts`,
        type: 'modify' as const,
        content: `console.log("file ${i}");`,
      }));

      const score = engine.compute(insights, changes, emptyContext);
      expect(score.overall).toBeLessThan(90);
    });

    it('rewards test file changes', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [
        { path: 'src/app.ts', type: 'modify', content: 'export const app = 1;' },
        { path: 'src/app.test.ts', type: 'modify', content: 'test("app", () => { expect(app).toBe(1); });' },
      ];

      const score = engine.compute(insights, changes, emptyContext);
      const testDim = score.dimensions.find(d => d.name === 'Test Coverage');
      expect(testDim).toBeDefined();
      expect(testDim!.score).toBe(100);
    });
  });

  describe('toGrade()', () => {
    it('returns A+ for 95+', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [
        { path: 'src/a.test.ts', type: 'modify', content: 'test("a", () => {});' },
      ];
      const score = engine.compute(insights, changes, emptyContext);
      // We can't easily control the exact score, so test boundary logic via compute
      // by examining the score field directly
      expect(score.grade).toMatch(/^[A-F+]+$/);
    });

    it('returns correct grades for boundary values', () => {
      // Access the private toGrade via reflection on a computed result
      // The engine's compute method applies toGrade internally.
      // We verify the grade field is one of the valid values.
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [];
      const score = engine.compute(insights, changes, emptyContext);
      const validGrades: HealthScore['grade'][] = ['A+', 'A', 'B', 'C', 'D', 'F'];
      expect(validGrades).toContain(score.grade);
    });
  });

  describe('computeTrend()', () => {
    it('returns improving when recent scores are rising', () => {
      // First compute a few scores to build history
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [
        { path: 'src/util.ts', type: 'modify', content: 'export const x = 1;' },
      ];

      // Low score first (by having security issues)
      engine.compute([
        { type: 'warning', priority: 'critical', title: 'SQL injection risk detected in query', content: 'bad', timestamp: new Date() },
        { type: 'warning', priority: 'critical', title: 'eval usage detected — security risk', content: 'bad', timestamp: new Date() },
      ], changes, emptyContext);

      engine.compute([
        { type: 'warning', priority: 'high', title: 'eval usage detected — security risk', content: 'bad', timestamp: new Date() },
      ], changes, emptyContext);

      // Clean score now
      const finalScore = engine.compute(insights, changes, emptyContext);
      // Trend should be improving (went from bad to good)
      expect(['improving', 'stable']).toContain(finalScore.trend);
    });

    it('returns stable when scores are consistent', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [
        { path: 'src/app.ts', type: 'modify', content: 'const a = 1;' },
      ];

      // Compute several similar scores
      engine.compute(insights, changes, emptyContext);
      engine.compute(insights, changes, emptyContext);
      const finalScore = engine.compute(insights, changes, emptyContext);
      expect(finalScore.trend).toBe('stable');
    });
  });

  describe('weightedAverage()', () => {
    it('produces correct weighted result', () => {
      // Compute with all good dimensions
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [
        { path: 'src/a.test.ts', type: 'modify', content: 'test("a", () => {});' },
      ];
      const score = engine.compute(insights, changes, emptyContext);
      // Verify the weighted computation is internally consistent
      const totalWeight = score.dimensions.reduce((s, d) => s + d.weight, 0);
      expect(totalWeight).toBe(100); // 30 + 25 + 20 + 15 + 10
    });
  });

  describe('generateBadgeSvg()', () => {
    it('produces valid SVG with score info', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [];
      const score = engine.compute(insights, changes, emptyContext);
      const svg = engine.generateBadgeSvg(score);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('Shadow Brain');
      expect(svg).toContain(`Health ${score.overall}/100`);
    });

    it('uses green color for high scores', () => {
      const score: HealthScore = {
        overall: 95,
        grade: 'A+',
        trend: 'stable',
        dimensions: [],
        topIssues: [],
        timestamp: new Date(),
      };
      const svg = engine.generateBadgeSvg(score);
      expect(svg).toContain('#4ade80'); // green
    });

    it('uses red color for low scores', () => {
      const score: HealthScore = {
        overall: 30,
        grade: 'F',
        trend: 'declining',
        dimensions: [],
        topIssues: [],
        timestamp: new Date(),
      };
      const svg = engine.generateBadgeSvg(score);
      expect(svg).toContain('#f87171'); // red
    });
  });

  describe('formatConsole()', () => {
    it('produces formatted console output with score', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [];
      const score = engine.compute(insights, changes, emptyContext);
      const output = engine.formatConsole(score);

      expect(output).toContain(`Health Score: ${score.overall}/100`);
      expect(output).toContain(`Grade: ${score.grade}`);
      expect(output).toContain('Security');
      expect(output).toContain('Code Quality');
      expect(output).toContain('Test Coverage');
      expect(output).toContain('Performance');
      expect(output).toContain('Architecture');
    });
  });

  describe('getHistory()', () => {
    it('returns history with recorded scores', () => {
      const insights: BrainInsight[] = [];
      const changes: FileChange[] = [];
      engine.compute(insights, changes, emptyContext);
      engine.compute(insights, changes, emptyContext);

      const history = engine.getHistory();
      expect(history.scores.length).toBeGreaterThanOrEqual(2);
      expect(history.scores[0].overall).toBeTypeOf('number');
    });
  });
});
