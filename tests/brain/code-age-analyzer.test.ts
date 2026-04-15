import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeAgeAnalyzer } from '../../src/brain/code-age-analyzer.js';

describe('CodeAgeAnalyzer', () => {
  let tempDir: string;
  let analyzer: CodeAgeAnalyzer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-age-test-'));
    analyzer = new CodeAgeAnalyzer(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  function createFile(name: string, content: string, mtimeDaysAgo: number): string {
    const filePath = path.join(tempDir, name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    // Set mtime to simulate age
    const mtime = new Date(Date.now() - mtimeDaysAgo * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, mtime, mtime);
    return filePath;
  }

  describe('analyzeProject()', () => {
    it('classifies fresh files (0-7 days)', async () => {
      createFile('fresh.ts', 'const x = 1;', 3);

      // analyzeFileAge is private, but analyzeProject generates insights for stale/ancient
      // Fresh files should NOT appear in insights
      const insights = await analyzer.analyzeProject();
      expect(insights.length).toBe(0); // fresh file → no warnings
    });

    it('classifies stable files (8-30 days)', async () => {
      createFile('stable.ts', 'const x = 2;', 15);

      const insights = await analyzer.analyzeProject();
      expect(insights.length).toBe(0); // stable file → no warnings
    });

    it('classifies aging files (31-90 days)', async () => {
      createFile('aging.ts', 'const x = 3;', 60);

      const insights = await analyzer.analyzeProject();
      expect(insights.length).toBe(0); // aging file → no warnings (only stale/ancient generate insights)
    });

    it('classifies stale files (91-365 days) and generates warnings', async () => {
      createFile('stale.ts', 'const x = 4;', 200);

      const insights = await analyzer.analyzeProject();
      const staleInsight = insights.find(i => i.title.includes('stale'));
      expect(staleInsight).toBeDefined();
      expect(staleInsight!.priority).toBe('medium');
      expect(staleInsight!.files).toContain('stale.ts');
    });

    it('classifies ancient files (365+ days) and generates high-priority warnings', async () => {
      createFile('ancient.ts', 'const x = 5;', 400);

      const insights = await analyzer.analyzeProject();
      const ancientInsight = insights.find(i => i.title.includes('ancient'));
      expect(ancientInsight).toBeDefined();
      expect(ancientInsight!.priority).toBe('high');
    });

    it('generates a summary insight when >30% of files are stale', async () => {
      // Create mix: some fresh, many stale/ancient (need >10 total files for summary)
      for (let i = 0; i < 5; i++) {
        createFile(`fresh${i}.ts`, `const a${i} = ${i};`, 2);
      }
      for (let i = 0; i < 8; i++) {
        createFile(`stale${i}.ts`, '// old', 200 + i * 30);
      }

      const insights = await analyzer.analyzeProject();
      // Should have individual stale insights + summary
      const summaryInsight = insights.find(i =>
        i.title.includes('% of code is stale')
      );
      expect(summaryInsight).toBeDefined();
      expect(summaryInsight!.priority).toBe('medium');
    });

    it('ignores non-code files', async () => {
      createFile('readme.md', '# Readme', 400);
      createFile('data.json', '{}', 400);

      const insights = await analyzer.analyzeProject();
      expect(insights.length).toBe(0);
    });

    it('respects maxFiles parameter', async () => {
      // Create many files
      for (let i = 0; i < 20; i++) {
        createFile(`file${i}.ts`, `const x${i} = ${i};`, 400);
      }

      const insights5 = await analyzer.analyzeProject(5);
      const insights20 = await analyzer.analyzeProject(20);
      // With maxFiles=5, should process fewer files
      expect(insights5.length).toBeLessThanOrEqual(insights20.length);
    });

    it('handles empty project directory', async () => {
      const insights = await analyzer.analyzeProject();
      expect(insights).toHaveLength(0);
    });
  });
});
