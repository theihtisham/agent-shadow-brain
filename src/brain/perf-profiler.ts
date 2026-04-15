// src/brain/perf-profiler.ts — Performance anti-pattern detection: N+1 queries, sync I/O, memory leaks, etc.

import { PerfInsight } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.tox',
  'venv', '.venv', 'env', '.env', 'bin', 'obj', 'Pods', '.gradle',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

interface PerfRule {
  name: string;
  regex: RegExp;
  category: string;
  severity: PerfInsight['severity'];
  description: string;
  suggestion: string;
  estimatedImpact: string;
  skipInTest: boolean;
}

const PERF_RULES: PerfRule[] = [
  {
    name: 'n-plus-1-query-await-find',
    regex: /for\s*\(.*await.*\.?\s*find\s*\(/g,
    category: 'database',
    severity: 'critical',
    description: 'N+1 query pattern: awaiting .find() inside a loop',
    suggestion: 'Batch queries outside the loop, use $in or a single aggregate query, or load all records upfront.',
    estimatedImpact: 'O(n) database round-trips reduced to O(1). Can improve response time by 10-100x for large datasets.',
    skipInTest: true,
  },
  {
    name: 'n-plus-1-query-in-loop',
    regex: /for\s*\(.*(?:query|execute|fetch|findById|findOne)\s*\(/g,
    category: 'database',
    severity: 'critical',
    description: 'N+1 query pattern: database query inside a loop',
    suggestion: 'Collect IDs first, then batch-fetch with a single query using WHERE IN.',
    estimatedImpact: 'Eliminates N-1 unnecessary database round-trips.',
    skipInTest: true,
  },
  {
    name: 'n-plus-1-forEach-await',
    regex: /\.forEach\s*\(.*async|\bforEach\s*\(\s*(?:async)/g,
    category: 'database',
    severity: 'critical',
    description: 'N+1 query pattern: async callback inside forEach (does NOT await properly)',
    suggestion: 'Use for...of loop or Promise.all() with .map(). forEach does not wait for async callbacks.',
    estimatedImpact: 'Fixes unhandled concurrent queries and potential data corruption.',
    skipInTest: true,
  },
  {
    name: 'sync-file-read',
    regex: /readFileSync|readdirSync|statSync|lstatSync|existsSync|accessSync|openSync|readSync|writeSync|appendFileSync|copyFileSync|unlinkSync|rmdirSync|mkdirSync|renameSync|writeFileSync/g,
    category: 'io',
    severity: 'high',
    description: 'Synchronous filesystem operation blocks the event loop',
    suggestion: 'Use the async fs.promises API or promisified fs methods (fs.promises.readFile, etc.).',
    estimatedImpact: 'Prevents event loop blocking. Critical under concurrent load — sync I/O can freeze the entire process.',
    skipInTest: true,
  },
  {
    name: 'chained-array-operations',
    regex: /\.(map|filter|reduce|flatMap|forEach)\s*\([^)]*\)\s*\.\s*(map|filter|reduce|flatMap|forEach)\s*\([^)]*\)\s*\.\s*(map|filter|reduce|flatMap|forEach)\s*\(/g,
    category: 'algorithmic',
    severity: 'medium',
    description: 'Excessive chained array operations (>3 chain links create intermediate arrays)',
    suggestion: 'Use a single .reduce() to process data in one pass, or use a for-loop for complex transformations.',
    estimatedImpact: 'Reduces memory allocations and intermediate array creation. Can cut processing time by 30-50% on large arrays.',
    skipInTest: false,
  },
  {
    name: 'hardcoded-large-slice',
    regex: /\.slice\s*\(\s*0\s*,\s*\d{4,}\s*\)/g,
    category: 'pagination',
    severity: 'medium',
    description: 'Large hardcoded slice limit may indicate missing pagination',
    suggestion: 'Implement proper cursor-based or offset pagination. Do not load thousands of records at once.',
    estimatedImpact: 'Prevents memory exhaustion and slow response times on large datasets.',
    skipInTest: false,
  },
  {
    name: 'json-parse-stringify',
    regex: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    category: 'serialization',
    severity: 'high',
    description: 'Deep clone via JSON.parse(JSON.stringify()) — lossy and slow',
    suggestion: 'Use structuredClone() (available in Node 17+ and modern browsers) or a proper deep-clone library.',
    estimatedImpact: 'structuredClone is 2-5x faster and handles Date, RegExp, Map, Set, ArrayBuffer, etc. JSON method loses undefined, functions, symbols, and circular refs.',
    skipInTest: false,
  },
  {
    name: 'console-log-production',
    regex: /console\.(log|debug|info)\s*\(/g,
    category: 'logging',
    severity: 'low',
    description: 'Console logging in production source code',
    suggestion: 'Use a proper logging library (pino, winston) with log levels. Remove or guard debug logs behind env checks.',
    estimatedImpact: 'Minor performance overhead per call, but significant noise in production logs.',
    skipInTest: true,
  },
  {
    name: 'regex-with-user-input',
    regex: /new\s+RegExp\s*\(\s*[^)]*\+\s*|new\s+RegExp\s*\(\s*`[^`]*\$\{/g,
    category: 'security',
    severity: 'high',
    description: 'RegExp constructed with dynamic/user input (ReDoS risk)',
    suggestion: 'Sanitize input with escape-string-regexp or limit regex complexity. Use a regex-safe allowlist of patterns.',
    estimatedImpact: 'Prevents Regular Expression Denial of Service attacks that can freeze the server indefinitely.',
    skipInTest: false,
  },
  {
    name: 'require-in-loop',
    regex: /(?:require\s*\(|import\s*\()\s*(?:'[^']*'|"[^"]*")\s*\)/g,
    category: 'module-loading',
    severity: 'critical',
    description: 'Dynamic require/import inside a loop — extremely expensive per iteration',
    suggestion: 'Move all imports/require calls to the top of the file. Dynamic imports in loops cause module resolution overhead each iteration.',
    estimatedImpact: 'Eliminates repeated module resolution. Each require() involves filesystem access and caching checks.',
    skipInTest: false,
  },
  {
    name: 'dom-query-in-loop',
    regex: /document\.querySelector(?:All)?\s*\(/g,
    category: 'dom',
    severity: 'high',
    description: 'DOM query inside a loop (potential — check surrounding context)',
    suggestion: 'Cache DOM references outside the loop. Use event delegation instead of querying per iteration.',
    estimatedImpact: 'DOM queries are expensive (reflow/repaint). Caching reduces layout thrashing and can improve rendering 10-50x.',
    skipInTest: false,
  },
];

export class PerformanceProfiler {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 100): Promise<PerfInsight[]> {
    const sourceFiles = this.collectSourceFiles(this.projectDir, maxFiles);
    const allInsights: PerfInsight[] = [];

    for (const filePath of sourceFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const insights = this.analyzeFile(filePath, content);
        allInsights.push(...insights);
      } catch {
        // Skip unreadable files
      }
    }

    return allInsights;
  }

  analyzeFile(filePath: string, content?: string): PerfInsight[] {
    const insights: PerfInsight[] = [];

    if (!content) {
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        return insights;
      }
    }

    const isTestFile = this.isTestFile(filePath);
    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);

    for (const rule of PERF_RULES) {
      if (rule.skipInTest && isTestFile) continue;

      const matches = [...content.matchAll(rule.regex)];

      if (matches.length === 0) continue;

      // For rules that need loop context, verify the match is actually inside a loop
      if (rule.name === 'dom-query-in-loop' || rule.name === 'require-in-loop') {
        for (const match of matches) {
          if (this.isInsideLoop(content, match.index!)) {
            insights.push(this.buildInsight(rule, relPath, match[0], this.getLineNumber(content, match.index!)));
          }
        }
        continue;
      }

      for (const match of matches) {
        const lineNum = this.getLineNumber(content, match.index!);
        insights.push(this.buildInsight(rule, relPath, match[0], lineNum));
      }
    }

    // File-level check: addEventListener without matching removeEventListener
    this.checkMemoryLeaks(content, relPath, insights);

    return insights;
  }

  // ── Memory leak detection ─────────────────────────────────────────────────────

  private checkMemoryLeaks(content: string, filePath: string, insights: PerfInsight[]): void {
    const addListenerRegex = /\.addEventListener\s*\(\s*['"](\w+)['"]/g;
    const removeListenerRegex = /\.removeEventListener\s*\(\s*['"](\w+)['"]/g;

    const addedEvents = new Map<string, number>();
    const removedEvents = new Map<string, number>();

    let match: RegExpExecArray | null;
    while ((match = addListenerRegex.exec(content)) !== null) {
      const evt = match[1];
      addedEvents.set(evt, (addedEvents.get(evt) || 0) + 1);
    }

    while ((match = removeListenerRegex.exec(content)) !== null) {
      const evt = match[1];
      removedEvents.set(evt, (removedEvents.get(evt) || 0) + 1);
    }

    for (const [event, addCount] of addedEvents) {
      const removeCount = removedEvents.get(event) || 0;
      if (addCount > removeCount) {
        insights.push({
          category: 'memory',
          severity: 'high',
          pattern: 'addEventListener-without-removeEventListener',
          description:
            `Possible memory leak in ${path.basename(filePath)}: "${event}" has ${addCount} addEventListener() ` +
            `but only ${removeCount} removeEventListener() calls.`,
          suggestion:
            'Store references to listener functions and call removeEventListener in cleanup/unmount hooks.\n' +
            '  For React: clean up in useEffect return. For classes: clean up in destroy/disconnect methods.',
          estimatedImpact:
            'Memory leak accumulation. Over time, dangling listeners keep references to closures and DOM nodes, preventing garbage collection.',
        });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private buildInsight(rule: PerfRule, filePath: string, matchedText: string, lineNum: number): PerfInsight {
    return {
      category: rule.category,
      severity: rule.severity,
      pattern: rule.name,
      description: `${rule.description}\n  File: ${filePath}:${lineNum}\n  Match: "${matchedText.trim()}"`,
      suggestion: rule.suggestion,
      estimatedImpact: rule.estimatedImpact,
    };
  }

  private isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return (
      normalized.includes('.test.') ||
      normalized.includes('.spec.') ||
      normalized.includes('__tests__') ||
      normalized.includes('/test/') ||
      normalized.includes('/tests/') ||
      normalized.includes('/spec/')
    );
  }

  private isInsideLoop(content: string, matchIndex: number): boolean {
    // Look backwards from the match position for loop keywords within a reasonable window
    const lookbackWindow = 500;
    const start = Math.max(0, matchIndex - lookbackWindow);
    const preceding = content.substring(start, matchIndex);

    // Check for for/while/do-while/forEach/map loops in the preceding code
    const loopPatterns = [
      /\bfor\s*\(/,
      /\bwhile\s*\(/,
      /\bdo\s*\{/,
      /\.forEach\s*\(/,
      /\.map\s*\(/,
      /\.flatMap\s*\(/,
    ];

    return loopPatterns.some(p => p.test(preceding));
  }

  private getLineNumber(content: string, index: number): number {
    let count = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    return count;
  }

  private collectSourceFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];

    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles) return;
      if (depth > 10) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };

    walk(dir, 0);
    return results;
  }
}
