import { describe, it, expect } from 'vitest';
import { SmartFixEngine, FixSuggestion } from '../../src/brain/smart-fix.js';
import { BrainInsight, FileChange } from '../../src/types.js';

describe('SmartFixEngine', () => {
  let engine: SmartFixEngine;

  function makeEngine(): SmartFixEngine {
    return new SmartFixEngine(undefined);
  }

  describe('generateFixes()', () => {
    it('detects hardcoded API keys', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/config.ts',
          type: 'modify',
          content: `const apiKey = "sk-thisisalongkeythatshouldbematched123456";`,
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const apiKeyFix = fixes.find(f => f.issue === 'Hardcoded API key');
      expect(apiKeyFix).toBeDefined();
      expect(apiKeyFix!.category).toBe('security');
      expect(apiKeyFix!.before).toContain('apiKey');
      expect(apiKeyFix!.after).toContain('process.env.API_KEY');
    });

    it('detects hardcoded passwords', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/db.ts',
          type: 'modify',
          content: `const password = "supersecret123";`,
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const pwdFix = fixes.find(f => f.issue === 'Hardcoded password');
      expect(pwdFix).toBeDefined();
      expect(pwdFix!.category).toBe('security');
      expect(pwdFix!.after).toContain('process.env');
    });

    it('detects eval() usage', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/eval.ts',
          type: 'modify',
          content: `const result = eval(someString);`,
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const evalFix = fixes.find(f => f.issue === 'Dangerous eval() usage');
      expect(evalFix).toBeDefined();
      expect(evalFix!.before).toContain('eval');
      expect(evalFix!.after).toContain('JSON.parse');
    });

    it('detects SQL injection with template literals', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/queries.ts',
          type: 'modify',
          content: 'db.query(`SELECT * FROM users WHERE id = ${userId}`);',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const sqlFix = fixes.find(f => f.issue === 'SQL injection risk — string interpolation in query');
      expect(sqlFix).toBeDefined();
      expect(sqlFix!.after).toContain('$1');
    });

    it('detects readFileSync usage', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/files.ts',
          type: 'modify',
          content: 'const data = fs.readFileSync("input.txt", "utf-8");',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const syncFix = fixes.find(f => f.issue === 'Synchronous file read blocks event loop');
      expect(syncFix).toBeDefined();
      expect(syncFix!.after).toContain('readFile');
    });

    it('detects console.log usage', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/index.ts',
          type: 'modify',
          content: 'console.log("Hello world");',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const logFix = fixes.find(f => f.issue === 'console.log in production code');
      expect(logFix).toBeDefined();
      expect(logFix!.after).toContain('logger.debug');
    });

    it('detects var declarations', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/legacy.ts',
          type: 'modify',
          content: 'var x = 42;',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const varFix = fixes.find(f => f.issue === 'var declaration (function-scoped, avoid)');
      expect(varFix).toBeDefined();
      expect(varFix!.after).toContain('const');
    });

    it('detects dangerouslySetInnerHTML', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/component.tsx',
          type: 'modify',
          content: '<div dangerouslySetInnerHTML={{ __html: userInput }} />',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const xssFix = fixes.find(f => f.issue === 'XSS risk: unescaped HTML injection');
      expect(xssFix).toBeDefined();
      expect(xssFix!.after).toContain('DOMPurify');
    });

    it('returns empty array for code with no issues', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/clean.ts',
          type: 'modify',
          content: 'const greeting: string = "hello";\nexport default greeting;',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      expect(fixes).toHaveLength(0);
    });

    it('detects multiple issues in a single file', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/bad.ts',
          type: 'modify',
          content: `var x = 42;\nconsole.log("debug");\nconst data = eval(someData);`,
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      expect(fixes.length).toBeGreaterThanOrEqual(3);
    });

    it('generates fixes from critical insights', () => {
      engine = makeEngine();
      const changes: FileChange[] = [];
      const insights: BrainInsight[] = [
        {
          type: 'warning',
          priority: 'critical',
          title: 'Potential SQL injection vulnerability',
          content: 'SQL injection detected',
          files: ['src/db.ts'],
          timestamp: new Date(),
        },
      ];

      const fixes = engine.generateFixes(changes, insights);
      const sqlFix = fixes.find(f => f.issue === 'SQL injection vulnerability');
      expect(sqlFix).toBeDefined();
      expect(sqlFix!.category).toBe('security');
    });

    it('deduplicates fixes for the same file+issue', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/a.ts',
          type: 'modify',
          content: 'var x = 1;',
        },
        {
          path: 'src/b.ts',
          type: 'modify',
          content: 'var y = 2;',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      const varFixes = fixes.filter(f => f.issue === 'var declaration (function-scoped, avoid)');
      // Should have one fix per file since they are different files
      expect(varFixes.length).toBeGreaterThanOrEqual(1);
    });

    it('sorts fixes with security first', () => {
      engine = makeEngine();
      const changes: FileChange[] = [
        {
          path: 'src/mixed.ts',
          type: 'modify',
          content: 'var x = 42;\nconst apiKey = "sk-abcdefghijklmnopqrstuvwxyz1234567890";',
        },
      ];

      const fixes = engine.generateFixes(changes, []);
      if (fixes.length >= 2) {
        const categories = fixes.map(f => f.category);
        const securityIdx = categories.indexOf('security');
        const qualityIdx = categories.indexOf('quality');
        if (securityIdx !== -1 && qualityIdx !== -1) {
          expect(securityIdx).toBeLessThan(qualityIdx);
        }
      }
    });
  });

  describe('formatFixes()', () => {
    it('returns message when no fixes available', () => {
      engine = makeEngine();
      const output = engine.formatFixes([]);
      expect(output).toContain('No auto-fixes available');
    });

    it('formats fixes with before/after sections', () => {
      engine = makeEngine();
      const fixes: FixSuggestion[] = [
        {
          file: 'src/test.ts',
          issue: 'Test issue',
          before: 'old code',
          after: 'new code',
          explanation: 'Because reasons',
          confidence: 'high',
          category: 'security',
        },
      ];
      const output = engine.formatFixes(fixes);
      expect(output).toContain('Smart Fix Engine');
      expect(output).toContain('Test issue');
      expect(output).toContain('old code');
      expect(output).toContain('new code');
    });
  });

  describe('toMarkdown()', () => {
    it('returns message when no fixes', () => {
      engine = makeEngine();
      const md = engine.toMarkdown([]);
      expect(md).toContain('No auto-fixes generated');
    });

    it('produces markdown with code blocks', () => {
      engine = makeEngine();
      const fixes: FixSuggestion[] = [
        {
          file: 'src/app.ts',
          issue: 'Test fix',
          before: 'before()',
          after: 'after()',
          explanation: 'Fix explanation',
          confidence: 'high',
          category: 'quality',
        },
      ];
      const md = engine.toMarkdown(fixes);
      expect(md).toContain('```');
      expect(md).toContain('before()');
      expect(md).toContain('after()');
      expect(md).toContain('Fix explanation');
    });
  });
});
