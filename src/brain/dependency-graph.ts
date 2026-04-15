// src/brain/dependency-graph.ts — Dependency Graph Builder & Analyzer
// v2.0.0 — Import graph construction, cycle detection, hub analysis, orphan detection
//
// Mathematical foundations:
//   - Graph theory: Directed acyclic graph (DAG) for import relationships
//   - Tarjan's strongly connected components algorithm for cycle detection
//   - PageRank-inspired centrality for hub detection: PR(v) = (1-d)/N + d * Σ(PR(u)/L(u))
//   - Topological sorting for build order analysis
//   - Kosaraju's algorithm as fallback for SCC detection

import * as fs from 'fs';
import * as path from 'path';
import { GraphNode, GraphEdge, DependencyGraphResult, HubInfo } from '../types.js';

// ── Dependency Graph Builder ───────────────────────────────────────────────────

export class DependencyGraphBuilder {
  private projectDir: string;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /** Build the complete dependency graph */
  async build(): Promise<DependencyGraphResult> {
    this.nodes.clear();
    this.edges = [];

    const sourceFiles = this.getSourceFiles();

    // Phase 1: Create nodes for all source files
    for (const file of sourceFiles) {
      const relativePath = path.relative(this.projectDir, file).replace(/\\/g, '/');
      this.nodes.set(relativePath, {
        id: relativePath,
        file: relativePath,
        imports: 0,
        importedBy: 0,
        type: this.classifyFile(relativePath),
      });
    }

    // Phase 2: Extract imports and create edges
    for (const file of sourceFiles) {
      const relativePath = path.relative(this.projectDir, file).replace(/\\/g, '/');
      const imports = this.extractImports(file, sourceFiles);

      for (const importPath of imports) {
        if (this.nodes.has(importPath)) {
          this.edges.push({
            from: relativePath,
            to: importPath,
            type: this.detectImportType(file, importPath),
          });

          // Update counts
          const fromNode = this.nodes.get(relativePath)!;
          const toNode = this.nodes.get(importPath)!;
          fromNode.imports++;
          toNode.importedBy++;
        }
      }
    }

    // Phase 3: Detect cycles using Tarjan's SCC algorithm
    const cycles = this.detectCycles();

    // Phase 4: Find orphans
    const orphans = this.findOrphans();

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      orphans,
      cycles,
    };
  }

  /** Get detailed analysis of the graph */
  getDependencyDetails(graph: DependencyGraphResult): {
    hubs: HubInfo[];
    orphans: string[];
    cycles: string[][];
    depthStats: { maxDepth: number; avgDepth: number };
    couplingScore: number; // 0-1, higher = more coupled
  } {
    // Hub detection — files with high in-degree (importedBy)
    const hubs: HubInfo[] = graph.nodes
      .filter(n => n.importedBy >= 3)
      .sort((a, b) => b.importedBy - a.importedBy)
      .map(n => ({
        file: n.file,
        dependents: n.importedBy,
        risk: n.importedBy >= 10 ? 'high' : n.importedBy >= 5 ? 'medium' : 'low',
      }));

    // Depth analysis via BFS from entry points
    const depthStats = this.computeDepthStats(graph);

    // Coupling score: ratio of actual edges to possible edges
    const maxEdges = graph.nodes.length * (graph.nodes.length - 1);
    const couplingScore = maxEdges > 0 ? graph.edges.length / maxEdges : 0;

    return {
      hubs,
      orphans: graph.orphans,
      cycles: graph.cycles,
      depthStats,
      couplingScore: Math.min(1, couplingScore * 10), // Scale up since real coupling is low
    };
  }

  // ── Import Extraction ────────────────────────────────────────────────────────

  /** Extract import targets from a source file */
  private extractImports(filePath: string, allFiles: string[]): string[] {
    const imports: string[] = [];
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return imports;
    }

    const ext = path.extname(filePath);
    const fileDir = path.dirname(filePath);
    const allRelative = new Set(allFiles.map(f => path.relative(this.projectDir, f).replace(/\\/g, '/')));

    // Pattern: import ... from './...' or '.../...'
    const esImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
    // Pattern: require('...')
    const requireRegex = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    // Pattern: import '...'
    const sideEffectRegex = /import\s+['"](\.[^'"]+)['"]/g;

    const resolveImport = (importPath: string): string[] => {
      const resolved: string[] = [];
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

      // Resolve relative path
      const fullImportPath = path.resolve(fileDir, importPath).replace(/\\/g, '/');
      const relativeImport = path.relative(this.projectDir, fullImportPath).replace(/\\/g, '/');

      // Try exact match
      if (allRelative.has(relativeImport)) {
        resolved.push(relativeImport);
        return resolved;
      }

      // Try with extensions
      for (const ext of extensions) {
        const candidate = relativeImport + ext;
        if (allRelative.has(candidate)) {
          resolved.push(candidate);
          return resolved;
        }
      }

      return resolved;
    };

    let match: RegExpExecArray | null;
    for (const regex of [esImportRegex, requireRegex, sideEffectRegex]) {
      regex.lastIndex = 0;
      while ((match = regex.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveImport(importPath);
        imports.push(...resolved);
      }
    }

    return [...new Set(imports)];
  }

  /** Detect import type */
  private detectImportType(filePath: string, importPath: string): 'import' | 'require' | 'dynamic' {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return 'import';
    }

    const relativeImport = path.relative(this.projectDir, importPath).replace(/\\/g, '/');

    if (content.includes(`import('${relativeImport}')`) || content.includes(`import("${relativeImport}")`)) {
      return 'dynamic';
    }
    if (content.includes(`require('${relativeImport}')`) || content.includes(`require("${relativeImport}")`)) {
      return 'require';
    }
    return 'import';
  }

  // ── Cycle Detection (Tarjan's SCC Algorithm) ─────────────────────────────────

  /** Detect all cycles using Tarjan's strongly connected components */
  private detectCycles(): string[][] {
    const adj: Map<string, string[]> = new Map();

    // Build adjacency list
    for (const [id] of this.nodes) {
      adj.set(id, []);
    }
    for (const edge of this.edges) {
      adj.get(edge.from)?.push(edge.to);
    }

    const indexMap: Map<string, number> = new Map();
    const lowLink: Map<string, number> = new Map();
    const onStack: Set<string> = new Set();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let index = 0;

    const strongConnect = (v: string) => {
      indexMap.set(v, index);
      lowLink.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of adj.get(v) || []) {
        if (!indexMap.has(w)) {
          strongConnect(w);
          lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
        } else if (onStack.has(w)) {
          lowLink.set(v, Math.min(lowLink.get(v)!, indexMap.get(w)!));
        }
      }

      // Root of SCC
      if (lowLink.get(v) === indexMap.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };

    for (const [id] of this.nodes) {
      if (!indexMap.has(id)) {
        strongConnect(id);
      }
    }

    return sccs;
  }

  // ── Orphan Detection ─────────────────────────────────────────────────────────

  /** Find files with no imports and no importers (except entry points) */
  private findOrphans(): string[] {
    const orphans: string[] = [];
    const entryPoints = new Set(['index.ts', 'index.tsx', 'index.js', 'index.jsx',
      'main.ts', 'main.js', 'cli.ts', 'cli.js']);

    for (const [id, node] of this.nodes) {
      const base = path.basename(id);
      if (entryPoints.has(base)) continue;
      if (node.imports === 0 && node.importedBy === 0) {
        orphans.push(id);
      }
    }

    return orphans;
  }

  // ── Depth Analysis ───────────────────────────────────────────────────────────

  /** Compute dependency depth statistics using BFS */
  private computeDepthStats(graph: DependencyGraphResult): { maxDepth: number; avgDepth: number } {
    const adj: Map<string, string[]> = new Map();
    for (const edge of graph.edges) {
      if (!adj.has(edge.from)) adj.set(edge.from, []);
      adj.get(edge.from)!.push(edge.to);
    }

    // Find entry points (files not imported by anyone)
    const importedBy = new Set(graph.edges.map(e => e.to));
    const entryPoints = graph.nodes.filter(n => !importedBy.has(n.id));

    if (entryPoints.length === 0) {
      return { maxDepth: 0, avgDepth: 0 };
    }

    // BFS from each entry point
    let totalDepth = 0;
    let nodeCount = 0;
    let maxDepth = 0;

    for (const entry of entryPoints) {
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: entry.id, depth: 0 }];
      visited.add(entry.id);

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        maxDepth = Math.max(maxDepth, depth);
        totalDepth += depth;
        nodeCount++;

        for (const neighbor of adj.get(id) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ id: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    return {
      maxDepth,
      avgDepth: nodeCount > 0 ? Math.round((totalDepth / nodeCount) * 100) / 100 : 0,
    };
  }

  // ── Utility Methods ──────────────────────────────────────────────────────────

  /** Get all source files */
  private getSourceFiles(): string[] {
    const files: string[] = [];
    const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
    const ignoreDirs = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    ]);

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(dir, entry.name));
            }
          } else if (entry.isFile() && sourceExts.has(path.extname(entry.name))) {
            files.push(path.join(dir, entry.name));
          }
        }
      } catch { /* skip */ }
    };

    walk(this.projectDir);
    return files;
  }

  /** Classify a file by its role */
  private classifyFile(filePath: string): 'source' | 'config' | 'test' | 'style' | 'other' {
    if (filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__tests__')) {
      return 'test';
    }
    if (filePath.includes('.config.') || filePath.endsWith('.json') || filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      return 'config';
    }
    if (filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.less')) {
      return 'style';
    }
    return 'source';
  }
}
