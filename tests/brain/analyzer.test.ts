import { describe, it, expect } from 'vitest';
import { Analyzer, PromptBuilder } from '../../src/brain/analyzer.js';
import { BrainInsight, FileChange, ProjectContext, AgentActivity, BrainPersonality, AgentMemory } from '../../src/types.js';

// Mock LLM client that always throws, forcing rule-based fallback
class MockLLMClient {
  async completeWithSchema(): Promise<never> {
    throw new Error('LLM unavailable — using rule-based fallback');
  }
}

describe('PromptBuilder', () => {
  const personalities: BrainPersonality[] = ['mentor', 'critic', 'architect', 'security', 'performance', 'balanced'];

  describe('buildSystemPrompt()', () => {
    it('produces a prompt for each personality', () => {
      for (const p of personalities) {
        const prompt = PromptBuilder.buildSystemPrompt(p);
        expect(prompt).toContain('Shadow Brain');
        expect(prompt).toContain('JSON');
        expect(prompt.length).toBeGreaterThan(100);
      }
    });

    it('includes personality-specific instructions', () => {
      const mentor = PromptBuilder.buildSystemPrompt('mentor');
      expect(mentor).toContain('MENTOR');
      expect(mentor).toContain('teach');

      const critic = PromptBuilder.buildSystemPrompt('critic');
      expect(critic).toContain('CRITIC');

      const security = PromptBuilder.buildSystemPrompt('security');
      expect(security).toContain('SECURITY');
      expect(security).toContain('vulnerabilities');

      const performance = PromptBuilder.buildSystemPrompt('performance');
      expect(performance).toContain('PERFORMANCE');
      expect(performance).toContain('optimize');

      const architect = PromptBuilder.buildSystemPrompt('architect');
      expect(architect).toContain('ARCHITECT');

      const balanced = PromptBuilder.buildSystemPrompt('balanced');
      expect(balanced).toContain('BALANCED');
    });
  });

  describe('buildUserPrompt()', () => {
    const baseParams = {
      changes: [] as FileChange[],
      context: {
        name: 'test-project',
        rootDir: '/tmp/test',
        language: ['typescript'],
        structure: ['tsconfig.json', '.gitignore'],
        recentChanges: [],
      } as ProjectContext,
      activity: [] as AgentActivity[],
    };

    it('includes project context', () => {
      const prompt = PromptBuilder.buildUserPrompt(baseParams, 'quick');
      expect(prompt).toContain('test-project');
      expect(prompt).toContain('typescript');
    });

    it('includes file changes for standard depth', () => {
      const params = {
        ...baseParams,
        changes: [
          {
            path: 'src/app.ts',
            type: 'modify' as const,
            diff: '+export const app = 1;\n-const app = 0;',
          },
        ],
      };
      const prompt = PromptBuilder.buildUserPrompt(params, 'standard');
      expect(prompt).toContain('src/app.ts');
      expect(prompt).toContain('MODIFY');
    });

    it('includes full diff for deep depth', () => {
      const diffContent = Array.from({ length: 150 }, (_, i) => `+line ${i}`).join('\n');
      const params = {
        ...baseParams,
        changes: [
          { path: 'src/big.ts', type: 'modify' as const, diff: diffContent },
        ],
      };
      const prompt = PromptBuilder.buildUserPrompt(params, 'deep');
      expect(prompt).toContain('line 149');
    });

    it('truncates standard diff to 100 lines', () => {
      const diffContent = Array.from({ length: 150 }, (_, i) => `+line ${i}`).join('\n');
      const params = {
        ...baseParams,
        changes: [
          { path: 'src/big.ts', type: 'modify' as const, diff: diffContent },
        ],
      };
      const prompt = PromptBuilder.buildUserPrompt(params, 'standard');
      expect(prompt).toContain('more lines');
    });

    it('includes agent activity', () => {
      const params = {
        ...baseParams,
        activity: [
          { timestamp: new Date(), type: 'file_edit' as const, detail: 'Modified app.ts', file: 'src/app.ts' },
        ],
      };
      const prompt = PromptBuilder.buildUserPrompt(params, 'quick');
      expect(prompt).toContain('file_edit');
      expect(prompt).toContain('Modified app.ts');
    });

    it('includes agent memory rules', () => {
      const params = {
        ...baseParams,
        agentMemory: {
          rules: ['Always use TypeScript', 'No any types allowed'],
          context: [],
          recentFiles: [],
          projectKnowledge: {},
        } as AgentMemory,
      };
      const prompt = PromptBuilder.buildUserPrompt(params, 'quick');
      expect(prompt).toContain('TypeScript');
    });

    it('includes token budget guidance', () => {
      const promptQuick = PromptBuilder.buildUserPrompt(baseParams, 'quick');
      const promptStandard = PromptBuilder.buildUserPrompt(baseParams, 'standard');
      const promptDeep = PromptBuilder.buildUserPrompt(baseParams, 'deep');

      expect(promptQuick).toContain('~4000');
      expect(promptStandard).toContain('~8000');
      expect(promptDeep).toContain('~16000');
    });
  });
});

describe('Analyzer (rule-based fallback)', () => {
  function makeAnalyzer(personality: BrainPersonality = 'balanced'): Analyzer {
    const mockClient = new MockLLMClient() as any;
    return new Analyzer(mockClient, personality, 'standard');
  }

  const baseContext: ProjectContext = {
    name: 'test-project',
    rootDir: '/tmp/test',
    language: ['typescript'],
    structure: ['.gitignore', 'tsconfig.json', 'package.json'],
    recentChanges: [],
  };

  it('detects hardcoded secrets', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        {
          path: 'src/config.ts',
          type: 'modify',
          content: 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz1234567890abcdef";',
        },
      ],
      context: baseContext,
      activity: [],
    });

    const secretInsight = result.find(i => i.title.includes('secret') || i.title.includes('API key'));
    expect(secretInsight).toBeDefined();
    expect(secretInsight!.priority).toBe('critical');
  });

  it('detects eval() usage', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/eval.ts', type: 'modify', content: 'const result = eval(userInput);' },
      ],
      context: baseContext,
      activity: [],
    });

    const evalInsight = result.find(i => i.title.includes('eval'));
    expect(evalInsight).toBeDefined();
    expect(evalInsight!.priority).toBe('critical');
  });

  it('detects SQL injection', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/db.ts', type: 'modify', content: 'db.query(`SELECT * FROM users WHERE id = ${userId}`);' },
      ],
      context: baseContext,
      activity: [],
    });

    const sqlInsight = result.find(i => i.title.includes('SQL injection'));
    expect(sqlInsight).toBeDefined();
    expect(sqlInsight!.priority).toBe('critical');
  });

  it('detects XSS risk', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/component.tsx', type: 'modify', content: '<div dangerouslySetInnerHTML={{ __html: data }} />' },
      ],
      context: baseContext,
      activity: [],
    });

    const xssInsight = result.find(i => i.title.includes('XSS'));
    expect(xssInsight).toBeDefined();
    expect(xssInsight!.priority).toBe('high');
  });

  it('flags .env file changes', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: '.env', type: 'modify', content: 'DB_PASSWORD=secret123' },
      ],
      context: baseContext,
      activity: [],
    });

    const envInsight = result.find(i => i.title.includes('.env'));
    expect(envInsight).toBeDefined();
    expect(envInsight!.priority).toBe('critical');
  });

  it('flags very large batches of changes', async () => {
    const analyzer = makeAnalyzer();
    const changes: FileChange[] = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.ts`,
      type: 'modify' as const,
      content: `export const x${i} = ${i};`,
    }));

    const result = await analyzer.analyze({
      changes,
      context: baseContext,
      activity: [],
    });

    const batchInsight = result.find(i => i.title.includes('large batch'));
    expect(batchInsight).toBeDefined();
    expect(batchInsight!.priority).toBe('high');
  });

  it('flags deleted files', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/old-module.ts', type: 'delete', content: '' },
      ],
      context: baseContext,
      activity: [],
    });

    const deleteInsight = result.find(i => i.title.includes('deleted') || i.title.includes('Deleted'));
    expect(deleteInsight).toBeDefined();
    expect(deleteInsight!.priority).toBe('high');
  });

  it('recognizes test file additions positively', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/app.test.ts', type: 'add', content: 'test("works", () => {});' },
      ],
      context: baseContext,
      activity: [],
    });

    const testInsight = result.find(i => i.title.includes('test') || i.title.includes('Test'));
    expect(testInsight).toBeDefined();
    expect(testInsight!.type).toBe('context');
    expect(testInsight!.priority).toBe('low');
  });

  it('suggests test updates when source changes without tests', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/a.ts', type: 'modify', content: 'export const a = 1;' },
        { path: 'src/b.ts', type: 'modify', content: 'export const b = 2;' },
        { path: 'src/c.ts', type: 'modify', content: 'export const c = 3;' },
      ],
      context: baseContext,
      activity: [],
    });

    const testInsight = result.find(i => i.title.includes('test') && i.title.includes('without'));
    expect(testInsight).toBeDefined();
  });

  it('detects N+1 query pattern', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        {
          path: 'src/service.ts',
          type: 'modify',
          content: 'for (const id of ids) { await db.find(id); }',
        },
      ],
      context: baseContext,
      activity: [],
    });

    const n1Insight = result.find(i => i.title.includes('N+1'));
    expect(n1Insight).toBeDefined();
    expect(n1Insight!.priority).toBe('high');
  });

  it('detects synchronous file I/O', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        {
          path: 'src/files.ts',
          type: 'modify',
          content: 'const data = fs.readFileSync("input.txt", "utf-8");',
        },
      ],
      context: baseContext,
      activity: [],
    });

    const syncInsight = result.find(i => i.title.includes('Synchronous') || i.title.includes('sync'));
    expect(syncInsight).toBeDefined();
  });

  it('returns a fallback insight when no issues found', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'src/clean.ts', type: 'modify', content: 'export const x = 1;' },
      ],
      context: baseContext,
      activity: [],
    });

    // Should always return at least one insight
    expect(result.length).toBeGreaterThanOrEqual(1);
    // The last resort insight mentions "Changes monitored"
    const fallback = result.find(i => i.title === 'Changes monitored');
    if (result.length === 1) {
      expect(fallback).toBeDefined();
      expect(fallback!.type).toBe('context');
    }
  });

  it('detects dependency manifest changes', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.analyze({
      changes: [
        { path: 'package.json', type: 'modify', content: '{"dependencies": {"lodash": "^4.0.0"}}' },
      ],
      context: baseContext,
      activity: [],
    });

    const depInsight = result.find(i => i.title.includes('Dependencies'));
    expect(depInsight).toBeDefined();
    expect(depInsight!.priority).toBe('medium');
  });
});
