// src/brain/mutation-advisor.ts — Mutation testing advisor
// v3.0.0 — Suggests mutation testing strategies based on code analysis

import { BrainInsight, MutationSuggestion } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
  '__tests__', '__test__', 'test', 'tests', 'spec',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export class MutationAdvisor {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 150): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];

    for (const filePath of files) {
      const suggestions = this.suggestMutations(filePath);
      for (const mut of suggestions.slice(0, 5)) { // cap per file
        insights.push(this.mutationToInsight(mut));
      }
    }

    return insights;
  }

  private suggestMutations(filePath: string): MutationSuggestion[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const suggestions: MutationSuggestion[] = [];
    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed === '') continue;

      // Arithmetic mutations: + → -, * → /, - → +, > → >=, < → <=
      if (/[+\-*/]/.test(trimmed) && !trimmed.startsWith('//') && !trimmed.includes('import ')) {
        // + to -
        if (/\w\s*\+\s*\w/.test(trimmed) && !/\+\+/.test(trimmed) && !/import/.test(trimmed)) {
          suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed,
            trimmed.replace(/(\w)\s*\+\s*(\w)/, '$1 - $2'),
            'arithmetic', 'easy',
            'Arithmetic operator mutation: replacing + with -. If tests still pass, coverage gap exists.'));
        }
        // > to >=
        if (/>\s*[^>]/.test(trimmed) && !/=>/.test(trimmed) && !/>>/.test(trimmed) && !/<.*>/.test(trimmed)) {
          const mutated = trimmed.replace(/(\w)\s*>\s*(\w)/, '$1 >= $2');
          if (mutated !== trimmed) {
            suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
              'boundary', 'medium',
              'Boundary mutation: replacing > with >=. Tests should distinguish strict vs non-strict comparisons.'));
          }
        }
      }

      // Conditional mutations: === → !==, == → !=
      if (/===?/.test(trimmed) && !trimmed.includes('import ')) {
        const mutated = trimmed.includes('===') ? trimmed.replace(/===/g, '!==') : trimmed.replace(/==/g, '!=');
        suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
          'conditional', 'easy',
          'Conditional negation: flipping equality check. Tests should catch inverted logic.'));
      }

      // Logical mutations: && → ||, || → &&
      if (/&&|\|\|/.test(trimmed)) {
        const mutated = trimmed.includes('&&') ? trimmed.replace(/&&/g, '||') : trimmed.replace(/\|\|/g, '&&');
        suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
          'logical', 'medium',
          'Logical operator mutation: swapping &&/||. Tests should verify compound conditions.'));
      }

      // Negation: !x → x
      if (/!\w/.test(trimmed) && !/!=/.test(trimmed) && !trimmed.includes('import ')) {
        const mutated = trimmed.replace(/!(\w)/g, '$1');
        if (mutated !== trimmed) {
          suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
            'negation', 'easy',
            'Negation removal: removing ! operator. Tests should verify boolean logic.'));
        }
      }

      // String literal mutation: "..." → ""
      const stringMatches = trimmed.match(/["'][^"']{3,}["']/g);
      if (stringMatches && !trimmed.includes('import ') && !trimmed.includes('require(')) {
        for (const str of stringMatches) {
          const quote = str[0];
          const mutated = trimmed.replace(str, `${quote}${quote}`);
          suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
            'string', 'easy',
            'String mutation: emptying string literal. Tests should validate string content.'));
          break; // one per line
        }
      }

      // Return value mutation: return true → return false, return x → return !x
      if (/return\s+(true|false)/.test(trimmed)) {
        const mutated = trimmed.includes('return true') ? trimmed.replace('return true', 'return false') : trimmed.replace('return false', 'return true');
        suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed, mutated,
          'return-value', 'easy',
          'Boolean return flip: inverting return value. Tests should verify returned boolean.'));
      }

      // Statement deletion: skip some lines that are standalone statements
      if (trimmed.endsWith(';') && !trimmed.startsWith('if') && !trimmed.startsWith('for') &&
          !trimmed.startsWith('while') && !trimmed.startsWith('return') && !trimmed.startsWith('const') &&
          !trimmed.startsWith('let') && !trimmed.startsWith('var') && !trimmed.startsWith('import') &&
          !trimmed.startsWith('export') && !trimmed.startsWith('function') && !trimmed.startsWith('class') &&
          trimmed.length > 5 && trimmed.length < 80) {
        suggestions.push(this.makeSuggestion(relPath, i + 1, trimmed,
          `// ${trimmed} (deleted)`,
          'statement-deletion', 'hard',
          'Statement deletion: removing a statement. Hard-to-kill mutation indicates potential dead code or missing assertions.'));
      }
    }

    return suggestions;
  }

  private makeSuggestion(
    file: string, line: number, originalCode: string, mutatedCode: string,
    mutationType: MutationSuggestion['mutationType'], killability: MutationSuggestion['killability'],
    rationale: string,
  ): MutationSuggestion {
    return {
      id: `mut-${file.replace(/[/\\]/g, '-')}-${line}-${mutationType}`,
      file, line, originalCode: originalCode.trim(), mutatedCode, mutationType, killability, rationale,
    };
  }

  private mutationToInsight(mut: MutationSuggestion): BrainInsight {
    return {
      type: 'mutation',
      priority: mut.killability === 'hard' ? 'high' : mut.killability === 'medium' ? 'medium' : 'low',
      title: `[mutation] ${mut.mutationType} mutation in ${mut.file}:${mut.line}`,
      content:
        `Mutation testing suggestion in ${mut.file}:${mut.line}\n` +
        `  Type: ${mut.mutationType}\n` +
        `  Original: ${mut.originalCode}\n` +
        `  Mutated:  ${mut.mutatedCode}\n` +
        `  Killability: ${mut.killability}\n` +
        `  Rationale: ${mut.rationale}`,
      files: [mut.file],
      timestamp: new Date(),
      confidence: 0.8,
      metadata: { mutationType: mut.mutationType, killability: mut.killability, line: mut.line },
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
