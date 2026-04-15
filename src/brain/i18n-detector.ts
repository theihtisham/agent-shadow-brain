// src/brain/i18n-detector.ts — Internationalization (i18n) readiness checker
// v3.0.0 — Detects hardcoded strings, date/number format issues, missing RTL support

import { BrainInsight, I18nIssue } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
  '__tests__', '__test__', 'test', 'tests', 'spec',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte']);

// Common English words that suggest hardcoded UI text
const UI_PATTERNS = [
  // String literals in JSX/HTML attributes that look like user-facing text
  /placeholder\s*=\s*["']([A-Z][^"']{3,})["']/g,
  /title\s*=\s*["']([A-Z][^"']{3,})["']/g,
  /label\s*=\s*["']([A-Z][^"']{3,})["']/g,
  /aria-label\s*=\s*["']([A-Z][^"']{3,})["']/g,
  /alt\s*=\s*["']([A-Z][^"']{3,})["']/g,
  // Button text in JSX
  />\s*([A-Z][a-z]+(\s+[A-Z]?[a-z]+){1,5})\s*</g,
  // Error messages as string literals
  /throw\s+new\s+\w+Error\s*\(\s*["']([A-Z][^"']{10,})["']/g,
  // Alert/confirm messages
  /\balert\s*\(\s*["']([A-Z][^"']{5,})["']/g,
  /\bconfirm\s*\(\s*["']([A-Z][^"']{5,})["']/g,
  // console.log with descriptive text (might be user-facing in some contexts)
  /toast\s*\(\s*["']([A-Z][^"']{5,})["']/g,
  /notification\s*\.\s*(success|error|warning|info)\s*\(\s*["']([A-Z][^"']{5,})["']/g,
];

// Date format patterns that aren't i18n-aware
const DATE_PATTERNS = [
  { regex: /\bnew\s+Date\(\s*\)\.to(Locale)?DateString\s*\(\s*\)/g, type: 'date-format' as const },
  { regex: /\btoLocaleDateString\s*\(\s*["']en["']/g, type: 'date-format' as const },
  { regex: /\bgetMonth\(\)\s*\+\s*1/g, type: 'date-format' as const },
  { regex: /\bgetFullYear\(\)\s*-\s*\d{2}/g, type: 'date-format' as const },
];

// Number format patterns
const NUMBER_PATTERNS = [
  { regex: /\btoFixed\s*\(\s*\d+\s*\)/g, type: 'number-format' as const },
  { regex: /\b\.toLocaleString\s*\(\s*\)/g, type: 'number-format' as const },
];

// String concatenation with variables (likely needs interpolation)
const CONCAT_PATTERNS = [
  /["'][A-Za-z\s]+\s*["']\s*\+\s*\w+/g,
  /\w+\s*\+\s*["']\s+[A-Za-z\s]+["']/g,
  /`[^`]*\$\{[^}]+\}[^`]*[A-Za-z]{3,}[^`]*`/g, // template literals with text
];

export class I18nDetector {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 150): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const allIssues: I18nIssue[] = [];

    // Check if i18n library is already present
    const hasI18n = this.detectI18nLibrary();

    for (const filePath of files) {
      const issues = this.analyzeFile(filePath, hasI18n);
      allIssues.push(...issues);
    }

    return allIssues.map(issue => this.issueToInsight(issue, hasI18n));
  }

  private detectI18nLibrary(): boolean {
    const pkgPath = path.join(this.projectDir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      return !!(
        allDeps['i18next'] || allDeps['react-i18next'] || allDeps['vue-i18n'] ||
        allDeps['@angular/localize'] || allDeps['svelte-i18n'] || allDeps['next-intl'] ||
        allDeps['next-i18next'] || allDeps['react-intl'] || allDeps['formatjs'] ||
        allDeps['lingui'] || allDeps['@lingui/core']
      );
    } catch {
      return false;
    }
  }

  analyzeFile(filePath: string, hasI18n: boolean): I18nIssue[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const issues: I18nIssue[] = [];
    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);

    // Skip test files
    if (relPath.includes('.test.') || relPath.includes('.spec.') || relPath.includes('__tests__')) {
      return issues;
    }

    // Detect hardcoded UI strings
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for UI text patterns
      for (const pattern of UI_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          const text = match[1] || match[0];
          // Skip if it looks like code, not text
          if (this.isCodeNotText(text)) continue;

          issues.push({
            type: 'hardcoded-string',
            file: relPath,
            line: lineNum,
            content: text.slice(0, 100),
            suggestion: hasI18n
              ? `Replace with i18n translation key: t('key')`
              : `Extract to a translations file or use an i18n library`,
            severity: 'medium',
          });
        }
      }

      // Check for string concatenation
      for (const concatPattern of CONCAT_PATTERNS) {
        concatPattern.lastIndex = 0;
        if (concatPattern.test(line)) {
          // Avoid duplicates
          const existing = issues.find(iss => iss.line === lineNum && iss.type === 'concatenation');
          if (!existing) {
            issues.push({
              type: 'concatenation',
              file: relPath,
              line: lineNum,
              content: line.trim().slice(0, 100),
              suggestion: 'Use ICU message format or interpolation for proper i18n: `{variable}` instead of string concatenation',
              severity: 'high',
            });
          }
        }
      }
    }

    // Check date format issues
    for (const { regex, type } of DATE_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        issues.push({
          type,
          file: relPath,
          line,
          content: match[0],
          suggestion: 'Use Intl.DateTimeFormat with explicit locale or i18n library date formatting',
          severity: 'low',
        });
      }
    }

    // Check number format issues
    for (const { regex, type } of NUMBER_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        issues.push({
          type,
          file: relPath,
          line,
          content: match[0],
          suggestion: 'Use Intl.NumberFormat with locale for proper number formatting (decimals, separators, currency)',
          severity: 'low',
        });
      }
    }

    // Check for pluralization issues (hardcoded "s" for plural)
    const pluralRegex = /\+\s*["']s["']\s*|\?\s*["']s["']\s*:\s*["']["']/g;
    let pluralMatch: RegExpExecArray | null;
    while ((pluralMatch = pluralRegex.exec(content)) !== null) {
      const line = content.substring(0, pluralMatch.index).split('\n').length;
      issues.push({
        type: 'pluralization',
        file: relPath,
        line,
        content: pluralMatch[0],
        suggestion: 'Use ICU plural format: `{count, plural, one {item} other {items}}` for proper pluralization across languages',
        severity: 'medium',
      });
    }

    return issues;
  }

  private isCodeNotText(text: string): boolean {
    // Skip if it looks like code identifiers
    if (/^[a-z_]+(\.[a-z_]+)*$/.test(text)) return true;
    if (/^\d+$/.test(text)) return true;
    if (/^(true|false|null|undefined|void|async|await|return|const|let|var)$/.test(text)) return true;
    return false;
  }

  private issueToInsight(issue: I18nIssue, hasI18n: boolean): BrainInsight {
    return {
      type: 'i18n',
      priority: issue.severity === 'high' ? 'high' : issue.severity === 'medium' ? 'medium' : 'low',
      title: `[i18n] ${issue.type}: ${issue.content.slice(0, 60)}`,
      content:
        `i18n issue in ${issue.file}:${issue.line}\n` +
        `  Type: ${issue.type}\n` +
        `  Content: ${issue.content}\n` +
        `  Severity: ${issue.severity}\n` +
        `  Fix: ${issue.suggestion}\n` +
        (hasI18n ? '' : '  Note: No i18n library detected. Consider adding i18next, react-intl, or next-intl.'),
      files: [issue.file],
      timestamp: new Date(),
      confidence: 0.85,
      metadata: { i18nType: issue.type, hasI18nLibrary: hasI18n },
    };
  }

  private collectFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles || depth > 10) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
