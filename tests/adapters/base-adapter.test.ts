import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseAdapter } from '../../src/adapters/base-adapter.js';
import { BrainInsight, AgentPaths, AgentMemory, AgentActivity } from '../../src/types.js';

// Create a concrete test subclass of the abstract BaseAdapter
class TestAdapter extends BaseAdapter {
  name = 'claude-code' as const;
  displayName = 'Test Adapter';
  private _configPaths: AgentPaths;

  constructor(configPaths: AgentPaths) {
    super();
    this._configPaths = configPaths;
  }

  async detect(): Promise<boolean> { return true; }
  getConfigPaths(): AgentPaths { return this._configPaths; }
  async readActivity(): Promise<AgentActivity[]> { return []; }
}

describe('BaseAdapter', () => {
  let tempDir: string;
  let adapter: TestAdapter;
  let configPaths: AgentPaths;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-test-'));
    configPaths = {
      memoryDir: path.join(tempDir, 'memory'),
      rulesDir: path.join(tempDir, 'rules'),
    };
    adapter = new TestAdapter(configPaths);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('setProjectDir() / getProjectDir()', () => {
    it('sets and gets project directory', async () => {
      adapter.setProjectDir('/tmp/my-project');
      const dir = await adapter.getProjectDir();
      expect(dir).toBe('/tmp/my-project');
    });

    it('returns null when no project dir is set', async () => {
      const dir = await adapter.getProjectDir();
      expect(dir).toBeNull();
    });
  });

  describe('formatInsight()', () => {
    it('formats insight with correct structure', () => {
      const insight: BrainInsight = {
        type: 'warning',
        priority: 'critical',
        title: 'Security issue found',
        content: 'SQL injection detected in db.ts',
        files: ['src/db.ts'],
        timestamp: new Date('2024-01-15T10:30:00Z'),
      };

      // Access protected method via the instance
      const output = (adapter as any).formatInsight(insight);
      expect(output).toContain('Security issue found');
      expect(output).toContain('warning');
      expect(output).toContain('critical');
      expect(output).toContain('src/db.ts');
      expect(output).toContain('SQL injection detected');
      expect(output).toContain('2024-01-15');
    });

    it('uses correct emoji for each priority level', () => {
      const priorities: Array<{ priority: BrainInsight['priority']; emoji: string }> = [
        { priority: 'critical', emoji: '🚨' },
        { priority: 'high', emoji: '⚠️' },
        { priority: 'medium', emoji: '💡' },
        { priority: 'low', emoji: 'ℹ️' },
      ];

      for (const { priority, emoji } of priorities) {
        const insight: BrainInsight = {
          type: 'suggestion',
          priority,
          title: `Test ${priority}`,
          content: 'content',
          timestamp: new Date(),
        };
        const output = (adapter as any).formatInsight(insight);
        expect(output).toContain(emoji);
      }
    });
  });

  describe('injectContext()', () => {
    it('writes insight to shadow-brain directory', async () => {
      fs.mkdirSync(configPaths.memoryDir, { recursive: true });

      const insight: BrainInsight = {
        type: 'warning',
        priority: 'high',
        title: 'Test insight',
        content: 'This is a test insight',
        files: ['src/test.ts'],
        timestamp: new Date(),
      };

      const result = await adapter.injectContext(insight);
      expect(result).toBe(true);

      // Check that files were written
      const injectionDir = path.join(configPaths.memoryDir, 'shadow-brain');
      expect(fs.existsSync(injectionDir)).toBe(true);

      const brainFile = path.join(injectionDir, 'BRAIN.md');
      expect(fs.existsSync(brainFile)).toBe(true);

      const brainContent = fs.readFileSync(brainFile, 'utf-8');
      expect(brainContent).toContain('Test insight');
    });
  });

  describe('readMemory()', () => {
    it('reads rules from rules directory', async () => {
      fs.mkdirSync(configPaths.rulesDir, { recursive: true });
      fs.writeFileSync(
        path.join(configPaths.rulesDir, 'rule1.md'),
        '# Rule 1\nAlways use TypeScript',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(configPaths.rulesDir, 'rule2.md'),
        '# Rule 2\nNo any types',
        'utf-8'
      );
      // Non-md file should be ignored
      fs.writeFileSync(
        path.join(configPaths.rulesDir, 'ignore.txt'),
        'not a rule',
        'utf-8'
      );

      const memory = await adapter.readMemory();
      expect(memory.rules).toHaveLength(2);
      expect(memory.rules[0]).toContain('Rule 1');
      expect(memory.rules[1]).toContain('Rule 2');
    });

    it('reads knowledge from memory directory', async () => {
      fs.mkdirSync(configPaths.memoryDir, { recursive: true });
      fs.writeFileSync(
        path.join(configPaths.memoryDir, 'knowledge.json'),
        '{"key": "value"}',
        'utf-8'
      );

      const memory = await adapter.readMemory();
      expect(memory.projectKnowledge['knowledge.json']).toBeDefined();
      expect(memory.projectKnowledge['knowledge.json']).toContain('key');
    });

    it('returns empty memory when directories do not exist', async () => {
      const memory = await adapter.readMemory();
      expect(memory.rules).toHaveLength(0);
      expect(memory.context).toHaveLength(0);
      expect(memory.recentFiles).toHaveLength(0);
    });
  });

  describe('fileExists()', () => {
    it('returns true for existing file', () => {
      const filePath = path.join(tempDir, 'exists.txt');
      fs.writeFileSync(filePath, 'hello', 'utf-8');
      expect((adapter as any).fileExists(filePath)).toBe(true);
    });

    it('returns false for non-existing file', () => {
      expect((adapter as any).fileExists('/nonexistent/path')).toBe(false);
    });
  });

  describe('readFile()', () => {
    it('reads file contents', () => {
      const filePath = path.join(tempDir, 'read.txt');
      fs.writeFileSync(filePath, 'file content', 'utf-8');
      expect((adapter as any).readFile(filePath)).toBe('file content');
    });

    it('returns null for non-existing file', () => {
      expect((adapter as any).readFile('/nonexistent/path')).toBeNull();
    });
  });
});
