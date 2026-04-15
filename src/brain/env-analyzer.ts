// src/brain/env-analyzer.ts — Environment variable analysis
// v3.0.0 — Detects hardcoded secrets, missing validation, inconsistent naming, unused vars

import { BrainInsight, EnvIssue } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

export class EnvAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 200): Promise<BrainInsight[]> {
    const issues: EnvIssue[] = [];

    // Phase 1: Check .env files
    issues.push(...this.analyzeEnvFiles());

    // Phase 2: Check source code for env usage
    const codeFiles = this.collectFiles(this.projectDir, maxFiles);
    const envVars = new Set<string>();
    const codeIssues: EnvIssue[] = [];

    for (const filePath of codeFiles) {
      const { vars, issues: fileIssues } = this.analyzeCodeFile(filePath);
      for (const v of vars) envVars.add(v);
      codeIssues.push(...fileIssues);
    }
    issues.push(...codeIssues);

    // Phase 3: Cross-reference .env.example with .env usage
    issues.push(...this.crossReferenceEnv(envVars));

    return issues.map(issue => this.issueToInsight(issue));
  }

  private analyzeEnvFiles(): EnvIssue[] {
    const issues: EnvIssue[] = [];
    const envFiles = ['.env', '.env.local', '.env.development', '.env.production', '.env.test', '.env.example'];
    const envVars = new Map<string, { file: string; line: number; value: string }>();

    for (const envFile of envFiles) {
      const fullPath = path.join(this.projectDir, envFile);
      let content: string;
      try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;

        const match = line.match(/^(\w+)=(.*)$/);
        if (!match) continue;

        const name = match[1];
        const value = match[2].replace(/^["']|["']$/g, '');
        envVars.set(name, { file: envFile, line: i + 1, value });

        // Check for hardcoded secrets
        if (this.looksLikeSecret(name, value) && envFile !== '.env.example') {
          issues.push({
            variable: name,
            file: envFile,
            line: i + 1,
            type: 'hardcoded-secret',
            severity: 'critical',
            suggestion: `Move ${name} to a secret manager (Vault, AWS Secrets Manager) or use CI/CD secrets. Never commit real secrets.`,
          });
        }

        // Check for missing docs
        const prevLine = i > 0 ? lines[i - 1].trim() : '';
        if (!prevLine.startsWith('#') && envFile === '.env.example') {
          issues.push({
            variable: name,
            file: envFile,
            line: i + 1,
            type: 'missing-docs',
            severity: 'low',
            suggestion: `Add a comment above ${name} explaining its purpose, format, and default value.`,
          });
        }
      }
    }

    // Check for inconsistent naming
    const varNames = [...envVars.keys()];
    const styles = new Map<string, string[]>();
    for (const name of varNames) {
      let style: string;
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) style = 'UPPER_SNAKE';
      else if (/^[a-z][a-z0-9_]*$/.test(name)) style = 'lower_snake';
      else if (/^[a-z][a-zA-Z0-9]*$/.test(name)) style = 'camelCase';
      else style = 'mixed';

      if (!styles.has(style)) styles.set(style, []);
      styles.get(style)!.push(name);
    }

    if (styles.size > 1) {
      const hasUpper = styles.has('UPPER_SNAKE');
      const nonUpper = [...styles.entries()].filter(([s]) => s !== 'UPPER_SNAKE');
      if (hasUpper && nonUpper.length > 0) {
        issues.push({
          variable: nonUpper[0][1][0],
          file: '.env',
          line: 0,
          type: 'inconsistent-naming',
          severity: 'medium',
          suggestion: `Use UPPER_SNAKE_CASE consistently for env vars. Inconsistent: ${nonUpper.flatMap(([, v]) => v).slice(0, 5).join(', ')}`,
        });
      }
    }

    return issues;
  }

  private analyzeCodeFile(filePath: string): { vars: string[]; issues: EnvIssue[] } {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return { vars: [], issues: [] }; }

    const vars: string[] = [];
    const issues: EnvIssue[] = [];
    const relPath = path.relative(this.projectDir, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect process.env.X usage
      const envMatch = line.match(/process\.env\.(\w+)/g);
      if (envMatch) {
        for (const m of envMatch) {
          const varName = m.replace('process.env.', '');
          vars.push(varName);

          // Check for missing default/fallback
          const hasFallback = line.includes('??') || line.includes('||') || line.includes('=') && !line.includes('process.env.');
          if (!hasFallback) {
            // Check if there's a validation line nearby
            const nearbyLines = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)).join('\n');
            const hasValidation = /z\.object|joi|validate|required|assert/.test(nearbyLines);

            if (!hasValidation && !line.includes('typeof')) {
              issues.push({
                variable: varName,
                file: relPath,
                line: i + 1,
                type: 'missing-default',
                severity: 'high',
                suggestion: `Provide a default value or runtime validation for ${varName}: process.env.${varName} ?? 'default'`,
              });
            }
          }
        }
      }

      // Detect hardcoded secrets in code (not process.env)
      const secretPatterns = [
        { regex: /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi, type: 'hardcoded-secret' as const },
        { regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi, type: 'hardcoded-secret' as const },
        { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, type: 'hardcoded-secret' as const },
      ];

      for (const { regex, type } of secretPatterns) {
        regex.lastIndex = 0;
        if (regex.test(line) && !line.includes('process.env') && !line.includes('getenv') && !line.trim().startsWith('//')) {
          issues.push({
            variable: 'HARDCODED_SECRET',
            file: relPath,
            line: i + 1,
            type,
            severity: 'critical',
            suggestion: 'Never hardcode secrets in source code. Use environment variables or a secret manager.',
          });
        }
      }
    }

    return { vars, issues };
  }

  private crossReferenceEnv(usedVars: Set<string>): EnvIssue[] {
    const issues: EnvIssue[] = [];

    // Check .env.example
    const examplePath = path.join(this.projectDir, '.env.example');
    let exampleVars: Set<string>;
    try {
      const content = fs.readFileSync(examplePath, 'utf-8');
      exampleVars = new Set(
        content.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
          .map(l => l.split('=')[0])
          .filter(Boolean),
      );
    } catch {
      exampleVars = new Set();
    }

    // Vars used in code but not in .env.example
    for (const v of usedVars) {
      if (!exampleVars.has(v)) {
        issues.push({
          variable: v,
          file: '.env.example',
          line: 0,
          type: 'missing-default',
          severity: 'medium',
          suggestion: `Add ${v} to .env.example so developers know it's required.`,
        });
      }
    }

    // Vars in .env.example but not used in code
    for (const v of exampleVars) {
      if (!usedVars.has(v)) {
        issues.push({
          variable: v,
          file: '.env.example',
          line: 0,
          type: 'unused',
          severity: 'low',
          suggestion: `${v} is in .env.example but not referenced in code. Consider removing it.`,
        });
      }
    }

    return issues;
  }

  private looksLikeSecret(name: string, value: string): boolean {
    const secretNames = /secret|password|passwd|pwd|token|api[_-]?key|private[_-]?key|auth|credential/i;
    if (!secretNames.test(name)) return false;

    // Non-empty, non-placeholder values
    if (!value || value === '' || value === 'changeme' || value === 'xxx' || value === 'your-key-here') return false;
    if (value.length < 8) return false;

    return true;
  }

  private issueToInsight(issue: EnvIssue): BrainInsight {
    return {
      type: 'env',
      priority: issue.severity === 'critical' ? 'critical' : issue.severity === 'high' ? 'high' : issue.severity === 'medium' ? 'medium' : 'low',
      title: `[env] ${issue.type}: ${issue.variable} in ${issue.file}${issue.line ? ':' + issue.line : ''}`,
      content:
        `Environment variable issue in ${issue.file}${issue.line ? ':' + issue.line : ''}\n` +
        `  Variable: ${issue.variable}\n` +
        `  Type: ${issue.type}\n` +
        `  Severity: ${issue.severity}\n` +
        `  Fix: ${issue.suggestion}`,
      files: [issue.file],
      timestamp: new Date(),
      confidence: issue.type === 'hardcoded-secret' ? 0.95 : 0.8,
      metadata: { variable: issue.variable, envIssueType: issue.type },
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
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
