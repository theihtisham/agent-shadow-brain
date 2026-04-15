// src/brain/ast-analyzer.ts — AST-level code analysis: function complexity, nesting depth, parameter count
// v3.0.0 — Deep structural code analysis without external AST dependencies

import { BrainInsight, ASTFunctionInfo } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.tox',
  'venv', '.venv', 'env', '.env', 'bin', 'obj', 'Pods', '.gradle',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export class ASTAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 100): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];

    for (const filePath of files) {
      const functions = this.extractFunctionInfo(filePath);
      for (const fn of functions) {
        const fnInsights = this.analyzeFunction(fn, filePath);
        insights.push(...fnInsights);
      }

      // File-level analysis
      const fileInsights = this.analyzeFileStructure(filePath);
      insights.push(...fileInsights);
    }

    return insights;
  }

  extractFunctionInfo(filePath: string): ASTFunctionInfo[] {
    const ext = path.extname(filePath);
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      return this.extractJSFunctions(filePath);
    } else if (ext === '.py') {
      return this.extractPythonFunctions(filePath);
    }
    return [];
  }

  private extractJSFunctions(filePath: string): ASTFunctionInfo[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const functions: ASTFunctionInfo[] = [];
    const lines = content.split('\n');

    // Match function declarations, arrow functions, method definitions
    const patterns = [
      // Named function: function name(...) { or =>
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      // Arrow function: const name = (...) => { or const name = (...) =>
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
      // Method: name(...) { (in class)
      /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/,
      // Class method shorthand
      /^(?:public|private|protected|static)?\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:(]/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const name = match[1];
          const params = match[2].split(',').filter(p => p.trim().length > 0).length;
          const startLine = i + 1;
          const endLine = this.findFunctionEnd(lines, i);
          const body = lines.slice(i, endLine).join('\n');

          const nestingDepth = this.calculateNestingDepth(body);
          const returnPaths = this.countReturnPaths(body);
          const cyclomaticComplexity = this.calculateCyclomaticComplexity(body);
          const cognitiveComplexity = this.calculateCognitiveComplexity(body);
          const isExported = /^(export|module\.exports)/.test(line.trim());
          const isAsync = /async\s/.test(line);

          functions.push({
            name,
            file: path.relative(this.projectDir, filePath),
            startLine,
            endLine: endLine + 1,
            params,
            nestingDepth,
            returnPaths,
            cyclomaticComplexity,
            cognitiveComplexity,
            linesOfCode: endLine - i + 1,
            isExported,
            isAsync,
            isPure: this.assessPurity(body),
          });
          break; // matched one pattern, skip remaining
        }
      }
    }

    return functions;
  }

  private extractPythonFunctions(filePath: string): ASTFunctionInfo[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const functions: ASTFunctionInfo[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
      if (match) {
        const name = match[1];
        const params = match[2].split(',').filter(p => p.trim().length > 0 && p.trim() !== 'self').length;
        const startLine = i + 1;
        const endLine = this.findPythonFunctionEnd(lines, i);
        const body = lines.slice(i, endLine).join('\n');

        functions.push({
          name,
          file: path.relative(this.projectDir, filePath),
          startLine,
          endLine: endLine + 1,
          params,
          nestingDepth: this.calculatePythonNesting(body),
          returnPaths: (body.match(/\breturn\b/g) || []).length,
          cyclomaticComplexity: this.calculatePythonComplexity(body),
          cognitiveComplexity: this.calculatePythonCognitiveComplexity(body),
          linesOfCode: endLine - i + 1,
          isExported: !lines[i].startsWith('_'),
          isAsync: /async\s+def/.test(lines[i]),
          isPure: true, // conservative
        });
      }
    }

    return functions;
  }

  private analyzeFunction(fn: ASTFunctionInfo, filePath: string): BrainInsight[] {
    const insights: BrainInsight[] = [];
    const relPath = path.relative(this.projectDir, filePath);

    // High cyclomatic complexity
    if (fn.cyclomaticComplexity > 10) {
      insights.push({
        type: 'warning',
        priority: fn.cyclomaticComplexity > 20 ? 'critical' : 'high',
        title: `[complexity] Function "${fn.name}" has cyclomatic complexity of ${fn.cyclomaticComplexity}`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} has cyclomatic complexity ${fn.cyclomaticComplexity} (threshold: 10).\n` +
          `  Parameters: ${fn.params}, Nesting depth: ${fn.nestingDepth}, Return paths: ${fn.returnPaths}\n` +
          `  Lines of code: ${fn.linesOfCode}\n` +
          `  High complexity makes code hard to test, understand, and maintain.\n` +
          `  Consider: Extract helper functions, use early returns, simplify conditionals, apply guard clauses.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.95,
        metadata: { complexity: fn.cyclomaticComplexity, lines: fn.linesOfCode },
      });
    } else if (fn.cyclomaticComplexity > 5) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: `[complexity] Function "${fn.name}" complexity ${fn.cyclomaticComplexity} (moderate)`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} has moderate complexity (${fn.cyclomaticComplexity}).\n` +
          `  Consider simplifying if possible — complexity above 5 increases testing difficulty.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.9,
      });
    }

    // Too many parameters
    if (fn.params > 5) {
      insights.push({
        type: 'suggestion',
        priority: fn.params > 7 ? 'high' : 'medium',
        title: `[design] Function "${fn.name}" has ${fn.params} parameters`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} accepts ${fn.params} parameters.\n` +
          `  Functions with more than 3-4 parameters are hard to call correctly.\n` +
          `  Consider: Use an options/config object, extract a builder, or group related parameters.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.9,
      });
    }

    // Deep nesting
    if (fn.nestingDepth > 4) {
      insights.push({
        type: 'warning',
        priority: fn.nestingDepth > 6 ? 'critical' : 'high',
        title: `[complexity] Deep nesting (${fn.nestingDepth} levels) in "${fn.name}"`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} has ${fn.nestingDepth} levels of nesting.\n` +
          `  Deep nesting reduces readability and increases bug surface.\n` +
          `  Consider: Early returns, extract nested logic into separate functions, use guard clauses.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.95,
      });
    }

    // Very long functions
    if (fn.linesOfCode > 50) {
      insights.push({
        type: 'suggestion',
        priority: fn.linesOfCode > 100 ? 'high' : 'medium',
        title: `[quality] Function "${fn.name}" is ${fn.linesOfCode} lines long`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} spans ${fn.linesOfCode} lines.\n` +
          `  Long functions are harder to understand, test, and reuse.\n` +
          `  Consider: Extract logical sections into named helper functions.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.85,
      });
    }

    // Too many return paths
    if (fn.returnPaths > 5) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: `[quality] Function "${fn.name}" has ${fn.returnPaths} return paths`,
        content:
          `Function \`${fn.name}\` in ${relPath}:${fn.startLine} has ${fn.returnPaths} distinct return paths.\n` +
          `  Multiple return paths increase testing complexity and can hide edge cases.\n` +
          `  Consider: Consolidate return logic, use result objects, or apply the single-exit principle.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.8,
      });
    }

    return insights;
  }

  private analyzeFileStructure(filePath: string): BrainInsight[] {
    const insights: BrainInsight[] = [];
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return insights;
    }

    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);
    const lineCount = lines.length;

    // Very large files
    if (lineCount > 500) {
      insights.push({
        type: 'warning',
        priority: lineCount > 1000 ? 'high' : 'medium',
        title: `[architecture] Large file: ${relPath} (${lineCount} lines)`,
        content:
          `File ${relPath} has ${lineCount} lines. Large files indicate potential SRP violations.\n` +
          `  Consider splitting into focused modules with clear responsibilities.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.85,
      });
    }

    // Too many imports
    const importLines = lines.filter(l => /^\s*(import\s|from\s|require\s*\()/.test(l));
    if (importLines.length > 20) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: `[architecture] High import count in ${relPath} (${importLines.length})`,
        content:
          `File ${relPath} has ${importLines.length} imports. This may indicate the module has too many responsibilities.\n` +
          `  Consider: Split into smaller modules, consolidate related imports, use barrel exports.`,
        files: [relPath],
        timestamp: new Date(),
        confidence: 0.8,
      });
    }

    // TODO/FIXME/HACK comments
    const todoPatterns = [
      { regex: /TODO|FIXME|HACK|XXX|OPTIMIZE/gi, label: 'action item' },
    ];
    for (const { regex, label } of todoPatterns) {
      const matches = [...content.matchAll(regex)];
      if (matches.length > 3) {
        insights.push({
          type: 'suggestion',
          priority: 'low',
          title: `[quality] ${matches.length} ${label}s in ${relPath}`,
          content:
            `File ${relPath} contains ${matches.length} ${label} comments (TODO/FIXME/HACK/XXX).\n` +
            `  Consider addressing these or converting to tracked issues.`,
          files: [relPath],
          timestamp: new Date(),
          confidence: 0.95,
        });
      }
    }

    return insights;
  }

  // ── Complexity Calculators ──────────────────────────────────────────────────

  private calculateCyclomaticComplexity(code: string): number {
    // McCabe's cyclomatic complexity: 1 + number of decisions
    let complexity = 1;
    const decisionPatterns = [
      /\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g,
      /\bcase\b/g, /\?.*:/g, /&&/g, /\|\|/g, /\?\?/g,
      /\.catch\b/g, /\btry\b/g,
    ];
    for (const pattern of decisionPatterns) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }

  private calculateCognitiveComplexity(code: string): number {
    let complexity = 0;
    let nestingLevel = 0;
    const lines = code.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Increment nesting
      if (/[{(]\s*$/.test(trimmed) || /\bthen\b\s*$/.test(trimmed)) {
        nestingLevel++;
      }

      // Structural increments (with nesting bonus)
      if (/\bif\b/.test(trimmed)) complexity += 1 + nestingLevel;
      if (/\belse\b/.test(trimmed) || /\belif\b/.test(trimmed)) complexity += 1;
      if (/\bfor\b/.test(trimmed) || /\bwhile\b/.test(trimmed)) complexity += 1 + nestingLevel;
      if (/\bswitch\b/.test(trimmed)) complexity += 1 + nestingLevel;
      if (/\bcase\b/.test(trimmed)) complexity += 1;

      // Fundamental increments (no nesting bonus)
      if (/&&|\|\||\?\?/.test(trimmed)) complexity += 1;
      if (/\?\s*[^:]+\s*:/.test(trimmed)) complexity += 1;

      // Decrement nesting
      if (/^[)}]/.test(trimmed)) {
        nestingLevel = Math.max(0, nestingLevel - 1);
      }
    }

    return complexity;
  }

  private calculateNestingDepth(code: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < code.length; i++) {
      const ch = code[i];

      if (inString) {
        if (ch === stringChar && code[i - 1] !== '\\') inString = false;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === '{' || ch === '(') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (ch === '}' || ch === ')') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  }

  private countReturnPaths(code: string): number {
    const matches = code.match(/\breturn\b/g);
    return matches ? matches.length : 0;
  }

  private assessPurity(code: string): boolean {
    // Heuristic: if function accesses globals, modifies external state, or does I/O, it's not pure
    const impurityIndicators = [
      /\bconsole\./, /\bprocess\./, /\brequire\(/, /\bimport\s/,
      /\bfs\./, /\bfetch\(/, /\bawait\b/, /\bDate\.now\(\)/,
      /\bMath\.random\(\)/, /\bdocument\./, /\bwindow\./,
    ];
    for (const indicator of impurityIndicators) {
      if (indicator.test(code)) return false;
    }
    return true;
  }

  private findFunctionEnd(lines: string[], startIdx: number): number {
    let braceCount = 0;
    let foundFirstBrace = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { braceCount++; foundFirstBrace = true; }
        if (ch === '}') braceCount--;
      }
      if (foundFirstBrace && braceCount <= 0) return i;
    }
    return lines.length - 1;
  }

  private findPythonFunctionEnd(lines: string[], startIdx: number): number {
    const baseIndent = lines[startIdx].search(/\S/);
    for (let i = startIdx + 1; i < lines.length; i++) {
      const lineIndent = lines[i].search(/\S/);
      if (lineIndent >= 0 && lineIndent <= baseIndent && lines[i].trim().length > 0) {
        return i - 1;
      }
    }
    return lines.length - 1;
  }

  private calculatePythonNesting(code: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    for (const line of code.split('\n')) {
      const indent = line.search(/\S/);
      if (indent >= 0) {
        currentDepth = Math.floor(indent / 4);
        maxDepth = Math.max(maxDepth, currentDepth);
      }
    }
    return maxDepth;
  }

  private calculatePythonComplexity(code: string): number {
    let complexity = 1;
    const patterns = [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\band\b/g, /\bor\b/g, /\bexcept\b/g];
    for (const p of patterns) {
      const m = code.match(p);
      if (m) complexity += m.length;
    }
    return complexity;
  }

  private calculatePythonCognitiveComplexity(code: string): number {
    return this.calculatePythonComplexity(code); // simplified
  }

  private collectFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles || depth > 10) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
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
