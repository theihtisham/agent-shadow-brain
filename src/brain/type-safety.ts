// src/brain/type-safety.ts — TypeScript type safety analyzer: detect `any`, ts-ignore, missing return types, etc.

import { BrainInsight } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.tox',
  'venv', '.venv', 'env', '.env', 'bin', 'obj', 'Pods', '.gradle',
]);

const TS_EXTENSIONS = new Set(['.ts', '.tsx']);

interface TypeIssueRule {
  name: string;
  regex: RegExp;
  type: BrainInsight['type'];
  priority: BrainInsight['priority'];
  buildContent: (match: RegExpMatchArray, line: string, lineNum: number, filePath: string) => string;
}

const RULES: TypeIssueRule[] = [
  {
    name: 'any-type-usage',
    regex: /:\s*any\b|\bas\s+any\b|<any>/g,
    type: 'warning',
    priority: 'medium',
    buildContent: (match, line, lineNum, filePath) =>
      `Usage of \`any\` type detected in ${path.basename(filePath)}:${lineNum}\n` +
      `  Line: ${line.trim()}\n` +
      `  Match: "${match[0]}"\n` +
      `  Replace with a specific type to maintain type safety.`,
  },
  {
    name: 'ts-ignore',
    regex: /\/\/\s*@ts-ignore/g,
    type: 'warning',
    priority: 'high',
    buildContent: (match, line, lineNum, filePath) =>
      `@ts-ignore suppresses all type errors on the next line in ${path.basename(filePath)}:${lineNum}\n` +
      `  Line: ${line.trim()}\n` +
      `  This hides real type errors. Use \`@ts-expect-error\` with an error code instead,\n` +
      `  or fix the underlying type issue.`,
  },
  {
    name: 'ts-nocheck',
    regex: /\/\/\s*@ts-nocheck/g,
    type: 'warning',
    priority: 'high',
    buildContent: (match, line, lineNum, filePath) =>
      `@ts-nocheck disables type checking for the entire file: ${path.basename(filePath)}:${lineNum}\n` +
      `  This completely defeats the purpose of TypeScript.\n` +
      `  Fix the type errors individually instead of suppressing all checks.`,
  },
  {
    name: 'ts-expect-error',
    regex: /\/\/\s*@ts-expect-error/g,
    type: 'suggestion',
    priority: 'low',
    buildContent: (match, line, lineNum, filePath) =>
      `@ts-expect-error found in ${path.basename(filePath)}:${lineNum}\n` +
      `  Line: ${line.trim()}\n` +
      `  Acceptable if accompanied by a TypeScript error code comment.\n` +
      `  Consider adding an error number for traceability.`,
  },
  {
    name: 'non-null-assertion',
    regex: /\w+!/g,
    type: 'suggestion',
    priority: 'low',
    buildContent: (match, line, lineNum, filePath) =>
      `Non-null assertion (\`!\`) used in ${path.basename(filePath)}:${lineNum}\n` +
      `  Line: ${line.trim()}\n` +
      `  Match: "${match[0]}"\n` +
      `  Consider using optional chaining (\`?.\`) or a proper null check instead.`,
  },
];

export class TypeSafetyAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 100): Promise<BrainInsight[]> {
    const tsFiles = this.collectTsFiles(this.projectDir, maxFiles);
    const allInsights: BrainInsight[] = [];

    for (const filePath of tsFiles) {
      const insights = this.analyzeFile(filePath);
      allInsights.push(...insights);
    }

    return allInsights;
  }

  analyzeFile(filePath: string): BrainInsight[] {
    const insights: BrainInsight[] = [];

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return insights;
    }

    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);

    // Run per-line rules
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      for (const rule of RULES) {
        const matches = [...line.matchAll(rule.regex)];

        // Filter false positives for non-null assertions
        if (rule.name === 'non-null-assertion') {
          const filtered = matches.filter(m => {
            const full = m[0];
            // Skip logical NOT: standalone ! operator
            if (full === '!') return false;
            // Skip != and !==
            const idx = m.index!;
            if (idx > 0 && line[idx - 1] === '!') return false;
            if (idx + 1 < line.length && line[idx + 1] === '=') return false;
            return true;
          });
          if (filtered.length > 0) {
            insights.push(this.buildInsight(rule, filtered[0], line, lineNum, relPath));
          }
          continue;
        }

        for (const match of matches) {
          insights.push(this.buildInsight(rule, match, line, lineNum, relPath));
        }
      }
    }

    // File-level rules
    this.checkMissingReturnTypes(content, lines, relPath, insights);
    this.checkExcessiveTypeAssertions(content, relPath, insights);

    return insights;
  }

  // ── File-level checks ─────────────────────────────────────────────────────────

  private checkMissingReturnTypes(
    content: string,
    lines: string[],
    filePath: string,
    insights: BrainInsight[],
  ): void {
    // Match exported functions without a return type annotation after the closing paren.
    // Pattern: export (async) function name(params) {  — no `: Type` between `)` and `{`
    const exportFnRegex = /^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
    let match: RegExpExecArray | null;

    while ((match = exportFnRegex.exec(content)) !== null) {
      const fullMatch = match[0];
      const fnName = match[1];
      const afterParams = fullMatch.substring(fullMatch.lastIndexOf(')') + 1, fullMatch.lastIndexOf('{'));

      // If there's no `:` between the closing paren and the opening brace, it's missing a return type
      if (!afterParams.includes(':')) {
        const lineNum = this.getLineNumberForIndex(content, match.index);
        insights.push({
          type: 'suggestion',
          priority: 'low',
          title: `Missing return type on exported function "${fnName}"`,
          content:
            `Exported function \`${fnName}\` in ${path.basename(filePath)}:${lineNum} lacks a return type annotation.\n` +
            `  Adding explicit return types improves documentation, enables better IDE support,\n` +
            `  and catches accidental return type changes.`,
          files: [filePath],
          timestamp: new Date(),
        });
      }
    }
  }

  private checkExcessiveTypeAssertions(
    content: string,
    filePath: string,
    insights: BrainInsight[],
  ): void {
    const assertionRegex = /\bas\s+[A-Z]\w+/g;
    const matches = content.match(assertionRegex);

    if (matches && matches.length > 5) {
      insights.push({
        type: 'warning',
        priority: 'medium',
        title: `Excessive type assertions (${matches.length} found)`,
        content:
          `File ${path.basename(filePath)} contains ${matches.length} \`as SomeType\` assertions.\n` +
          `  Assertions: ${matches.slice(0, 8).join(', ')}${matches.length > 8 ? ', ...' : ''}\n` +
          `  Excessive type assertions indicate a mismatch between code and type definitions.\n` +
          `  Consider refining types or using type guards instead of assertions.`,
        files: [filePath],
        timestamp: new Date(),
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private buildInsight(
    rule: TypeIssueRule,
    match: RegExpMatchArray,
    line: string,
    lineNum: number,
    filePath: string,
  ): BrainInsight {
    return {
      type: rule.type,
      priority: rule.priority,
      title: `[type-safety] ${rule.name}`,
      content: rule.buildContent(match, line, lineNum, filePath),
      files: [filePath],
      timestamp: new Date(),
    };
  }

  private collectTsFiles(dir: string, maxFiles: number): string[] {
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
        } else if (entry.isFile() && TS_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };

    walk(dir, 0);
    return results;
  }

  private getLineNumberForIndex(content: string, index: number): number {
    let count = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    return count;
  }
}
