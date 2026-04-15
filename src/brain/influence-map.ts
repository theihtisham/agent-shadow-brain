// src/brain/influence-map.ts — Code change influence mapping
// v3.1.0 — Predicts which files are affected by changes using import graph analysis

import { BrainInsight } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export interface InfluenceResult {
  changedFiles: string[];
  affectedFiles: Array<{
    file: string;
    score: number;
    reasons: string[];
  }>;
  totalReachable: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface ImportEdge {
  from: string; // file that imports
  to: string;   // file being imported
}

interface FileNode {
  path: string;
  imports: Set<string>;     // files this file imports
  importedBy: Set<string>;  // files that import this file
  testCorrelation: string | null; // corresponding test file
}

export class InfluenceMapper {
  private projectDir: string;
  private graph: Map<string, FileNode> = new Map();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 300): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];

    // Build the import graph
    this.buildGraph(files);

    // Find high-influence files (files imported by many others)
    const influenceMap = this.calculateInfluenceScores();

    // Generate insights for high-influence files
    const highInfluence = influenceMap
      .filter(f => f.score >= 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    if (highInfluence.length > 0) {
      insights.push({
        type: 'architecture',
        priority: 'medium',
        title: `[architecture] ${highInfluence.length} high-influence files detected (change impact analysis)`,
        content:
          `Import graph analysis found ${highInfluence.length} files with high change influence.\n` +
          `  Total files in graph: ${this.graph.size}\n` +
          `  These files affect many others when changed:\n` +
          highInfluence.map(f =>
            `    - ${f.file} (influence: ${f.score}, imported by ${this.graph.get(f.file)?.importedBy.size || 0} files)`
          ).join('\n') +
          `\n  Changes to these files require thorough testing of dependent modules.`,
        files: highInfluence.map(f => f.file),
        timestamp: new Date(),
        confidence: 0.8,
        metadata: {
          totalFiles: this.graph.size,
          highInfluenceFiles: highInfluence.map(f => ({
            file: f.file,
            score: f.score,
            dependents: this.graph.get(f.file)?.importedBy.size || 0,
          })),
        },
      });
    }

    // Detect potential orphan files
    const orphans = [...this.graph.values()].filter(
      node => node.imports.size === 0 && node.importedBy.size === 0
    );
    if (orphans.length > 0 && orphans.length < this.graph.size * 0.5) {
      insights.push({
        type: 'architecture',
        priority: 'low',
        title: `[architecture] ${orphans.length} orphan files (no import relationships)`,
        content:
          `${orphans.length} files have no detected import relationships.\n` +
          `  These may be: entry points, standalone scripts, or dead code.\n` +
          `  Files: ${orphans.slice(0, 10).map(o => o.path).join(', ')}${orphans.length > 10 ? ' ...' : ''}`,
        files: orphans.map(o => o.path).slice(0, 20),
        timestamp: new Date(),
        confidence: 0.6,
        metadata: { orphanCount: orphans.length },
      });
    }

    return insights;
  }

  analyzeInfluence(changedFiles: string[]): InfluenceResult {
    const affectedMap = new Map<string, { score: number; reasons: Set<string> }>();

    for (const changedFile of changedFiles) {
      const relPath = this.toRelative(changedFile);

      // 1. Direct reverse dependencies (weight 3)
      const directDeps = this.getReverseDependencies(relPath);
      for (const dep of directDeps) {
        if (!affectedMap.has(dep)) {
          affectedMap.set(dep, { score: 0, reasons: new Set() });
        }
        const entry = affectedMap.get(dep)!;
        entry.score += 3;
        entry.reasons.add(`directly imports ${relPath}`);
      }

      // 2. Transitive (indirect) dependencies (weight 1)
      const transitiveDeps = this.getTransitiveReverseDependencies(relPath, new Set(), 0, 3);
      for (const dep of transitiveDeps) {
        if (directDeps.has(dep)) continue; // already counted as direct
        if (!affectedMap.has(dep)) {
          affectedMap.set(dep, { score: 0, reasons: new Set() });
        }
        const entry = affectedMap.get(dep)!;
        entry.score += 1;
        entry.reasons.add(`indirectly depends on ${relPath}`);
      }

      // 3. Test file correlation (weight 2)
      const testFile = this.findTestCorrelation(relPath);
      if (testFile && this.graph.has(testFile)) {
        if (!affectedMap.has(testFile)) {
          affectedMap.set(testFile, { score: 0, reasons: new Set() });
        }
        const entry = affectedMap.get(testFile)!;
        entry.score += 2;
        entry.reasons.add(`test file for ${relPath}`);
      }

      // Also check if the changed file IS a test file — mark the source
      const sourceFile = this.findSourceForTest(relPath);
      if (sourceFile && this.graph.has(sourceFile)) {
        if (!affectedMap.has(sourceFile)) {
          affectedMap.set(sourceFile, { score: 0, reasons: new Set() });
        }
        const entry = affectedMap.get(sourceFile)!;
        entry.score += 2;
        entry.reasons.add(`source file tested by ${relPath}`);
      }
    }

    // Sort by score descending, take top 20
    const affected = [...affectedMap.entries()]
      .map(([file, data]) => ({
        file,
        score: data.score,
        reasons: [...data.reasons],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const maxScore = affected.length > 0 ? affected[0].score : 0;
    const riskLevel: InfluenceResult['riskLevel'] =
      maxScore >= 15 ? 'high' : maxScore >= 8 ? 'medium' : 'low';

    return {
      changedFiles: changedFiles.map(f => this.toRelative(f)),
      affectedFiles: affected,
      totalReachable: affectedMap.size,
      riskLevel,
    };
  }

  private buildGraph(files: string[]): void {
    this.graph.clear();

    // Phase 1: Create nodes
    for (const filePath of files) {
      const relPath = path.relative(this.projectDir, filePath).replace(/\\/g, '/');
      this.graph.set(relPath, {
        path: relPath,
        imports: new Set(),
        importedBy: new Set(),
        testCorrelation: this.inferTestFile(relPath),
      });
    }

    // Phase 2: Extract imports and build edges
    for (const filePath of files) {
      const relPath = path.relative(this.projectDir, filePath).replace(/\\/g, '/');
      const imports = this.extractImports(filePath, relPath);

      const node = this.graph.get(relPath);
      if (!node) continue;

      for (const importPath of imports) {
        node.imports.add(importPath);
        const targetNode = this.graph.get(importPath);
        if (targetNode) {
          targetNode.importedBy.add(relPath);
        }
      }
    }
  }

  private extractImports(filePath: string, relPath: string): string[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const ext = path.extname(filePath);
    const dir = path.dirname(relPath);
    const imports: string[] = [];

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      // ESM: import ... from './foo'
      const esmPattern = /import\s+(?:type\s+)?(?:[\w{},\s*]*\s+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = esmPattern.exec(content)) !== null) {
        const resolved = this.resolveImport(match[1], dir, ext);
        if (resolved) imports.push(resolved);
      }

      // Dynamic imports: import('./foo')
      const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynamicPattern.exec(content)) !== null) {
        const resolved = this.resolveImport(match[1], dir, ext);
        if (resolved) imports.push(resolved);
      }

      // CJS: require('./foo')
      const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = cjsPattern.exec(content)) !== null) {
        const resolved = this.resolveImport(match[1], dir, ext);
        if (resolved) imports.push(resolved);
      }
    } else if (ext === '.py') {
      const pyPattern = /(?:from|import)\s+([.\w]+)/g;
      let match: RegExpExecArray | null;
      while ((match = pyPattern.exec(content)) !== null) {
        const resolved = this.resolvePythonImport(match[1], dir);
        if (resolved) imports.push(resolved);
      }
    } else if (ext === '.go') {
      // Go imports are in import blocks
      const goPattern = /"([^"]+)"/g;
      const importBlock = content.match(/import\s*\([\s\S]*?\)/);
      let match: RegExpExecArray | null;
      if (importBlock) {
        while ((match = goPattern.exec(importBlock[0])) !== null) {
          // Go uses module paths, limited local resolution
          const localPath = match[1].replace(/\/.*$/, '');
          if (this.graph.has(localPath)) imports.push(localPath);
        }
      }
    }

    return [...new Set(imports)];
  }

  private resolveImport(importPath: string, fromDir: string, ext: string): string | null {
    // Only resolve relative imports (not node_modules or packages)
    if (!importPath.startsWith('.')) return null;

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

    // Normalize the path
    let resolved = path.normalize(path.join(fromDir, importPath)).replace(/\\/g, '/');

    // Try exact path first
    if (this.graph.has(resolved)) return resolved;

    // Try with extensions
    for (const tryExt of extensions) {
      const candidate = resolved + tryExt;
      if (this.graph.has(candidate)) return candidate;
    }

    return null;
  }

  private resolvePythonImport(importPath: string, fromDir: string): string | null {
    const parts = importPath.split('.');
    const candidates = [
      parts.join('/') + '.py',
      path.join(...parts.slice(0, -1), '__init__.py'),
    ];
    for (const candidate of candidates) {
      if (this.graph.has(candidate)) return candidate;
    }
    return null;
  }

  private getReverseDependencies(filePath: string): Set<string> {
    const node = this.graph.get(filePath);
    if (!node) return new Set();
    return new Set(node.importedBy);
  }

  private getTransitiveReverseDependencies(
    filePath: string,
    visited: Set<string>,
    depth: number,
    maxDepth: number
  ): Set<string> {
    const result = new Set<string>();
    if (depth >= maxDepth) return result;

    const node = this.graph.get(filePath);
    if (!node) return result;

    for (const dep of node.importedBy) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      result.add(dep);
      // Recurse to find transitive deps
      const transitive = this.getTransitiveReverseDependencies(dep, visited, depth + 1, maxDepth);
      for (const t of transitive) {
        result.add(t);
      }
    }

    return result;
  }

  private inferTestFile(relPath: string): string | null {
    const ext = path.extname(relPath);
    const base = relPath.replace(ext, '');

    const testPatterns = [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      `${base}.test.ts`,
      `${base}.spec.ts`,
      `tests/${base}.test${ext}`,
      `test/${base}.test${ext}`,
      `__tests__/${base}.test${ext}`,
    ];

    for (const pattern of testPatterns) {
      if (this.graph.has(pattern)) return pattern;
    }

    return null;
  }

  private findTestCorrelation(relPath: string): string | null {
    const node = this.graph.get(relPath);
    if (node?.testCorrelation) return node.testCorrelation;

    // Try inferring
    return this.inferTestFile(relPath);
  }

  private findSourceForTest(testPath: string): string | null {
    // Reverse: given a test file, find the source
    const testMatch = testPath.match(/^(.+?)(?:\.test|\.spec|_test|Test)(\.\w+)$/);
    if (!testMatch) return null;

    const sourcePath = testMatch[1] + testMatch[2];
    if (this.graph.has(sourcePath)) return sourcePath;

    // Try common extensions
    const ext = testMatch[2];
    const base = testMatch[1];
    const candidates = [base + ext, base + '.ts', base + '.tsx', base + '.js'];
    for (const candidate of candidates) {
      if (this.graph.has(candidate)) return candidate;
    }

    return null;
  }

  private calculateInfluenceScores(): Array<{ file: string; score: number }> {
    const scores: Array<{ file: string; score: number }> = [];

    for (const [file, node] of this.graph) {
      let score = 0;

      // Direct dependents
      score += node.importedBy.size * 3;

      // Transitive reach
      const transitive = this.getTransitiveReverseDependencies(file, new Set([file]), 0, 2);
      score += transitive.size * 1;

      // Is imported by many = higher influence
      // Is a hub (imports many + imported by many) = higher influence
      if (node.imports.size > 3 && node.importedBy.size > 3) {
        score += 5;
      }

      scores.push({ file, score });
    }

    return scores;
  }

  private toRelative(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.relative(this.projectDir, filePath).replace(/\\/g, '/');
    }
    return filePath.replace(/\\/g, '/');
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
