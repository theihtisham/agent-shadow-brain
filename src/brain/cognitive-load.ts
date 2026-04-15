// src/brain/cognitive-load.ts — Cognitive complexity analysis
// v3.1.0 — Measures function cognitive complexity: nesting, boolean ops, control flow

import { BrainInsight } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export interface CognitiveFunction {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  cognitiveScore: number;
  nestingContributions: number;
  booleanContributions: number;
  controlFlowContributions: number;
  recursionContributions: number;
  linesOfCode: number;
}

export class CognitiveLoadAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 300): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];
    const allFunctions: CognitiveFunction[] = [];

    for (const filePath of files) {
      const functions = this.analyzeFile(filePath);
      allFunctions.push(...functions);
    }

    // Sort by cognitive score descending
    allFunctions.sort((a, b) => b.cognitiveScore - a.cognitiveScore);

    // Generate insights for functions exceeding thresholds
    for (const fn of allFunctions) {
      if (fn.cognitiveScore > 15) {
        insights.push(this.functionToInsight(fn));
      }
    }

    // Summary insight for high-complexity hotspots
    const highCount = allFunctions.filter(f => f.cognitiveScore > 25).length;
    const mediumCount = allFunctions.filter(f => f.cognitiveScore > 15 && f.cognitiveScore <= 25).length;
    const totalFunctions = allFunctions.length;

    if ((highCount + mediumCount) > 0 && totalFunctions > 5) {
      insights.push({
        type: 'complexity',
        priority: highCount > 5 ? 'high' : 'medium',
        title: `[complexity] ${highCount + mediumCount} functions with high cognitive complexity`,
        content:
          `Cognitive complexity analysis found ${highCount} high (>25) and ${mediumCount} medium (>15) complexity functions.\n` +
          `  Total functions analyzed: ${totalFunctions}\n` +
          `  High complexity makes code harder to understand, test, and maintain.\n` +
          `  Consider breaking complex functions into smaller, well-named helpers.\n` +
          `  Top offenders:\n` +
          allFunctions.slice(0, 5).map(f =>
            `    - ${f.name} in ${f.file}:${f.startLine} (score: ${f.cognitiveScore})`
          ).join('\n'),
        files: allFunctions.filter(f => f.cognitiveScore > 15).map(f => f.file).slice(0, 20),
        timestamp: new Date(),
        confidence: 0.8,
        metadata: {
          totalFunctions,
          highComplexityCount: highCount,
          mediumComplexityCount: mediumCount,
          avgComplexity: totalFunctions > 0
            ? Math.round(allFunctions.reduce((s, f) => s + f.cognitiveScore, 0) / totalFunctions * 10) / 10
            : 0,
        },
      });
    }

    return insights;
  }

  analyzeFile(filePath: string): CognitiveFunction[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const relPath = path.relative(this.projectDir, filePath);
    const ext = path.extname(filePath);
    const functions: CognitiveFunction[] = [];

    // Extract function boundaries using regex
    const functionPattern = this.getFunctionPattern(ext);
    let match: RegExpExecArray | null;
    functionPattern.lastIndex = 0;

    while ((match = functionPattern.exec(content)) !== null) {
      const name = match[1] || match[2] || '<anonymous>';
      const startLine = content.substring(0, match.index).split('\n').length;

      // Find the function body by matching braces
      const bodyResult = this.extractFunctionBody(content, match.index);
      if (!bodyResult) continue;

      const { body, endIndex } = bodyResult;
      const endLine = content.substring(0, endIndex).split('\n').length;

      // Calculate cognitive complexity
      const score = this.calculateCognitiveComplexity(body, name);

      functions.push({
        name,
        file: relPath,
        startLine,
        endLine,
        cognitiveScore: score.total,
        nestingContributions: score.nesting,
        booleanContributions: score.booleanOps,
        controlFlowContributions: score.controlFlow,
        recursionContributions: score.recursion,
        linesOfCode: body.split('\n').length,
      });
    }

    return functions;
  }

  private getFunctionPattern(ext: string): RegExp {
    if (ext === '.py') {
      return /def\s+(\w+)\s*\(/g;
    }
    if (ext === '.rs') {
      return /(?:fn|pub\s+fn)\s+(\w+)\s*[<(]/g;
    }
    if (ext === '.go') {
      return /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g;
    }
    if (ext === '.java') {
      return /(?:public|private|protected|static)\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/g;
    }
    // TypeScript / JavaScript
    return /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)/g;
  }

  private extractFunctionBody(content: string, startIndex: number): { body: string; endIndex: number } | null {
    // Find the opening brace
    let braceIndex = content.indexOf('{', startIndex);
    if (braceIndex === -1) return null;

    // For arrow functions without braces, find the line end
    const arrowMatch = content.substring(startIndex, braceIndex).match(/=>\s*[^{]/);
    if (arrowMatch) {
      // Arrow function with expression body (no braces)
      const lineEnd = content.indexOf('\n', startIndex);
      const body = content.substring(startIndex, lineEnd !== -1 ? lineEnd : content.length);
      return { body, endIndex: lineEnd !== -1 ? lineEnd : content.length };
    }

    // Match braces to find the end of the function
    let depth = 0;
    let i = braceIndex;
    while (i < content.length) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) {
          const body = content.substring(startIndex, i + 1);
          return { body, endIndex: i + 1 };
        }
      }
      // Skip strings
      if (content[i] === '"' || content[i] === "'" || content[i] === '`') {
        i = this.skipString(content, i);
        continue;
      }
      i++;
    }

    return null;
  }

  private skipString(content: string, start: number): number {
    const quote = content[start];
    let i = start + 1;
    while (i < content.length) {
      if (content[i] === '\\') { i += 2; continue; }
      if (content[i] === quote) return i + 1;
      if (quote !== '`' && content[i] === '\n') return i;
      i++;
    }
    return i;
  }

  private calculateCognitiveComplexity(body: string, functionName: string): {
    total: number;
    nesting: number;
    booleanOps: number;
    controlFlow: number;
    recursion: number;
  } {
    let nesting = 0;
    let booleanOps = 0;
    let controlFlow = 0;
    let recursion = 0;

    // Remove string literals and comments to avoid false positives
    const cleaned = this.removeStringsAndComments(body);
    const lines = cleaned.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

      // Nesting depth: count open braces minus close braces
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      const prevNesting = nesting;

      // Count nesting contributions (only for lines that open blocks)
      if (opens > closes) {
        nesting += (opens - closes);
      }

      // Nesting complexity: +1 per nesting level for control flow
      if (/\b(if|else|for|while|switch|try|catch|finally)\b/.test(line)) {
        controlFlow += Math.max(0, nesting - 1);
      }

      // else / else if: +1 each
      if (/\belse\s+(if\s*)?[\{(]/.test(line) || line === 'else {') {
        controlFlow += 1;
      }

      // catch: +1
      if (/\bcatch\s*\(/.test(line)) {
        controlFlow += 1;
      }

      // break / continue in loops: +1
      if (/\b(break|continue)\b/.test(line) && !line.startsWith('//')) {
        controlFlow += 1;
      }

      // Boolean operators: && and || each +1
      const andMatches = line.match(/&&/g);
      const orMatches = line.match(/\|\|/g);
      booleanOps += (andMatches ? andMatches.length : 0) + (orMatches ? orMatches.length : 0);

      // Recursive calls: +2
      const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (functionName !== '<anonymous>' && new RegExp(`\\b${escapedName}\\s*\\(`).test(line)) {
        // Make sure it's not just the function declaration
        if (!line.includes(`function ${functionName}`) && !line.includes(`${functionName} =`)) {
          recursion += 2;
        }
      }
    }

    return {
      total: nesting + booleanOps + controlFlow + recursion,
      nesting,
      booleanOps,
      controlFlow,
      recursion,
    };
  }

  private removeStringsAndComments(code: string): string {
    // Remove single-line comments
    let result = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove double-quoted strings
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // Remove single-quoted strings
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // Remove template literals
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, '``');
    return result;
  }

  private functionToInsight(fn: CognitiveFunction): BrainInsight {
    const priority: BrainInsight['priority'] = fn.cognitiveScore > 25 ? 'high' : 'medium';
    const severity = fn.cognitiveScore > 25 ? 'HIGH' : 'MEDIUM';

    return {
      type: 'complexity',
      priority,
      title: `[complexity] ${severity} cognitive load in ${fn.name} (${fn.file}:${fn.startLine})`,
      content:
        `Function \`${fn.name}\` in ${fn.file}:${fn.startLine}-${fn.endLine} has cognitive complexity of ${fn.cognitiveScore}.\n` +
        `  Score breakdown:\n` +
        `    - Nesting depth: ${fn.nestingContributions}\n` +
        `    - Boolean operators: ${fn.booleanContributions}\n` +
        `    - Control flow (else/catch/break): ${fn.controlFlowContributions}\n` +
        `    - Recursion: ${fn.recursionContributions}\n` +
        `  Lines of code: ${fn.linesOfCode}\n` +
        `  Thresholds: medium >15, high >25\n` +
        `  Suggestion: Break into smaller functions with single responsibilities. ` +
        `Extract complex conditions into well-named variables.`,
      files: [fn.file],
      timestamp: new Date(),
      confidence: 0.75,
      metadata: {
        functionName: fn.name,
        cognitiveScore: fn.cognitiveScore,
        startLine: fn.startLine,
        endLine: fn.endLine,
        linesOfCode: fn.linesOfCode,
        breakdown: {
          nesting: fn.nestingContributions,
          booleanOps: fn.booleanContributions,
          controlFlow: fn.controlFlowContributions,
          recursion: fn.recursionContributions,
        },
      },
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
