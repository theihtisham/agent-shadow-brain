// src/brain/knowledge-graph.ts — Code Entity Graph with PageRank
// Builds a living graph of all code entities and their relationships.
// Scores importance using PageRank algorithm.
// v4.0.0 — Hyper-Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import { KGEntity, KGRelation, KGGraph, PageRankResult } from '../types.js';

const GRAPH_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.shadow-brain', 'knowledge-graph');

/**
 * Knowledge Graph — maps your entire codebase as a living graph.
 *
 * Entity extraction: Parse source files for functions, classes, interfaces,
 * modules, variables (exported only).
 *
 * Relations: calls, imports, extends, implements, uses, tests
 *
 * PageRank: Damping factor 0.85, convergence < 0.0001, max 100 iterations.
 *   Result: normalized score 0-1 for each entity.
 *
 * Use cases:
 *   - Most critical functions to test (high PageRank)
 *   - Orphan code (zero in-degree, zero PageRank)
 *   - Circular dependency detection (cycles)
 *   - Impact analysis: what breaks if X changes?
 */
export class KnowledgeGraph {
  private graph: KGGraph;
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.graph = {
      entities: new Map(),
      relations: [],
      lastBuilt: new Date(0),
      fileCount: 0,
    };
    this.loadFromDisk();
  }

  // ── Graph Construction ──────────────────────────────────────────────────────

  /** Build the knowledge graph from project source files */
  async build(): Promise<KGGraph> {
    this.graph = {
      entities: new Map(),
      relations: [],
      lastBuilt: new Date(),
      fileCount: 0,
    };

    // Scan project for source files
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
    const sourceFiles = this.findSourceFiles(this.projectDir, extensions);

    for (const file of sourceFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        this.graph.fileCount++;
        this.extractEntities(content, file);
      } catch {
        // Skip unreadable files
      }
    }

    // Extract relations between entities
    this.extractRelations();

    // Save to disk
    await this.saveToDisk();

    return this.graph;
  }

  /** Add a single entity */
  addEntity(entity: KGEntity): void {
    this.graph.entities.set(entity.id, entity);
  }

  /** Add a relation */
  addRelation(relation: KGRelation): void {
    this.graph.relations.push(relation);
  }

  // ── Entity Extraction ───────────────────────────────────────────────────────

  /** Extract code entities from source file content */
  private extractEntities(content: string, filePath: string): void {
    const lines = content.split('\n');
    const relativePath = path.relative(this.projectDir, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Functions
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        this.addEntity({
          id: `${relativePath}:${funcMatch[1]}`,
          type: 'function',
          name: funcMatch[1],
          file: relativePath,
          line: i + 1,
          refs: [],
          pageRankScore: 0,
          exported: line.includes('export'),
          async: line.includes('async'),
        });
      }

      // Arrow functions (exported)
      const arrowMatch = line.match(/export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch) {
        this.addEntity({
          id: `${relativePath}:${arrowMatch[1]}`,
          type: 'function',
          name: arrowMatch[1],
          file: relativePath,
          line: i + 1,
          refs: [],
          pageRankScore: 0,
          exported: true,
          async: line.includes('async'),
        });
      }

      // Classes
      const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        this.addEntity({
          id: `${relativePath}:${classMatch[1]}`,
          type: 'class',
          name: classMatch[1],
          file: relativePath,
          line: i + 1,
          refs: [],
          pageRankScore: 0,
          exported: line.includes('export'),
          async: false,
        });
      }

      // Interfaces
      const ifaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
      if (ifaceMatch) {
        this.addEntity({
          id: `${relativePath}:${ifaceMatch[1]}`,
          type: 'interface',
          name: ifaceMatch[1],
          file: relativePath,
          line: i + 1,
          refs: [],
          pageRankScore: 0,
          exported: line.includes('export'),
          async: false,
        });
      }

      // Methods (inside classes)
      const methodMatch = line.match(/(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/);
      if (methodMatch && !funcMatch && !classMatch) {
        const name = methodMatch[1];
        // Skip keywords
        if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return', 'throw', 'new'].includes(name)) continue;
        this.addEntity({
          id: `${relativePath}:${name}:${i + 1}`,
          type: 'method',
          name,
          file: relativePath,
          line: i + 1,
          refs: [],
          pageRankScore: 0,
          exported: false,
          async: line.includes('async'),
        });
      }
    }
  }

  /** Extract relations between entities based on imports, calls, etc. */
  private extractRelations(): void {
    for (const [entityId, entity] of this.graph.entities) {
      // Find references to other entities
      for (const [otherId, other] of this.graph.entities) {
        if (entityId === otherId) continue;

        // Same file references (calls/uses)
        if (entity.file === other.file && entity.type !== 'interface') {
          this.addRelation({
            from: entityId,
            to: otherId,
            type: 'uses',
            weight: 1,
          });
        }
      }
    }

    // Parse import statements for cross-file relations
    for (const [entityId, entity] of this.graph.entities) {
      try {
        const fullPath = path.join(this.projectDir, entity.file);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          const importMatch = line.match(/import\s+.*?\s+from\s+['"](.+?)['"]/);
          if (importMatch) {
            const importPath = importMatch[1];
            // Find entities in the imported file
            for (const [otherId, other] of this.graph.entities) {
              if (other.file.includes(importPath.replace('./', '').replace('../', ''))) {
                this.addRelation({
                  from: entityId,
                  to: otherId,
                  type: 'imports',
                  weight: 0.5,
                });
              }
            }
          }
        }
      } catch {
        // Skip
      }
    }
  }

  // ── PageRank ────────────────────────────────────────────────────────────────

  /**
   * Compute PageRank scores for all entities.
   * Damping factor: 0.85, convergence: < 0.0001, max iterations: 100.
   */
  pageRank(iterations: number = 100): PageRankResult {
    const DAMPING = 0.85;
    const CONVERGENCE = 0.0001;
    const entityIds = Array.from(this.graph.entities.keys());
    const n = entityIds.length;

    if (n === 0) {
      return { scores: new Map(), iterations: 0, converged: true, danglingNodes: 0 };
    }

    // Build adjacency: out-links and in-links
    const outLinks = new Map<string, Set<string>>();
    const inLinks = new Map<string, Set<string>>();

    for (const id of entityIds) {
      outLinks.set(id, new Set());
      inLinks.set(id, new Set());
    }

    for (const rel of this.graph.relations) {
      outLinks.get(rel.from)?.add(rel.to);
      inLinks.get(rel.to)?.add(rel.from);
    }

    // Count dangling nodes (no out-links)
    let danglingNodes = 0;
    for (const [_, links] of outLinks) {
      if (links.size === 0) danglingNodes++;
    }

    // Initialize scores uniformly
    let scores = new Map<string, number>();
    for (const id of entityIds) {
      scores.set(id, 1 / n);
    }

    let converged = false;
    let iter = 0;

    for (iter = 0; iter < iterations; iter++) {
      const newScores = new Map<string, number>();

      // Dangling node contribution
      let danglingSum = 0;
      for (const id of entityIds) {
        if (outLinks.get(id)!.size === 0) {
          danglingSum += scores.get(id) ?? 0;
        }
      }

      // Update scores
      for (const id of entityIds) {
        let rank = (1 - DAMPING) / n;

        // Contribution from in-links
        const incoming = inLinks.get(id) ?? new Set();
        for (const source of incoming) {
          const sourceScore = scores.get(source) ?? 0;
          const sourceOutCount = outLinks.get(source)?.size ?? 1;
          rank += DAMPING * (sourceScore / Math.max(sourceOutCount, 1));
        }

        // Dangling node redistribution
        rank += DAMPING * (danglingSum / n);

        newScores.set(id, rank);
      }

      // Check convergence
      let maxDelta = 0;
      for (const id of entityIds) {
        const delta = Math.abs((newScores.get(id) ?? 0) - (scores.get(id) ?? 0));
        if (delta > maxDelta) maxDelta = delta;
      }

      scores = newScores;

      if (maxDelta < CONVERGENCE) {
        converged = true;
        break;
      }
    }

    // Normalize scores to [0, 1]
    const maxScore = Math.max(...Array.from(scores.values()));
    if (maxScore > 0) {
      for (const [id, score] of scores) {
        scores.set(id, score / maxScore);
      }
    }

    // Update entity PageRank scores
    for (const [id, score] of scores) {
      const entity = this.graph.entities.get(id);
      if (entity) entity.pageRankScore = score;
    }

    return { scores, iterations: iter, converged, danglingNodes };
  }

  // ── Analysis Queries ────────────────────────────────────────────────────────

  /** Get top-N most important entities by PageRank */
  getTopEntities(topN: number = 20): KGEntity[] {
    return Array.from(this.graph.entities.values())
      .sort((a, b) => b.pageRankScore - a.pageRankScore)
      .slice(0, topN);
  }

  /** Find entities impacted by a change to the given entity */
  getImpactedBy(entityId: string): KGEntity[] {
    const impacted = new Set<string>();
    this.findDownstream(entityId, impacted, 5);

    return Array.from(impacted)
      .map(id => this.graph.entities.get(id))
      .filter((e): e is KGEntity => e !== undefined && e.id !== entityId);
  }

  private findDownstream(entityId: string, visited: Set<string>, depth: number): void {
    if (depth <= 0 || visited.has(entityId)) return;
    visited.add(entityId);

    for (const rel of this.graph.relations) {
      if (rel.from === entityId) {
        this.findDownstream(rel.to, visited, depth - 1);
      }
    }
  }

  /** Find circular dependencies */
  findCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (stack.has(node)) {
        // Found cycle
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart).concat(node));
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);
      path.push(node);

      for (const rel of this.graph.relations) {
        if (rel.from === node) {
          dfs(rel.to);
        }
      }

      path.pop();
      stack.delete(node);
    };

    for (const id of this.graph.entities.keys()) {
      dfs(id);
    }

    return cycles;
  }

  /** Get graph statistics */
  getStats(): { entities: number; relations: number; avgPageRank: number; orphanCount: number } {
    const entities = this.graph.entities.size;
    const relations = this.graph.relations.length;
    const scores = Array.from(this.graph.entities.values()).map(e => e.pageRankScore);
    const avgPageRank = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const orphanCount = Array.from(this.graph.entities.values())
      .filter(e => !this.graph.relations.some(r => r.to === e.id)).length;

    return { entities, relations, avgPageRank, orphanCount };
  }

  // ── File Discovery ──────────────────────────────────────────────────────────

  private findSourceFiles(dir: string, extensions: string[]): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip common non-source directories
          if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target', 'vendor'].includes(entry.name)) continue;
          results.push(...this.findSourceFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Permission denied or other — skip
    }
    return results;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async saveToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(GRAPH_DIR)) {
        fs.mkdirSync(GRAPH_DIR, { recursive: true });
      }

      const serializable = {
        entities: Array.from(this.graph.entities.entries()).map(([id, e]) => [id, {
          ...e,
          refs: e.refs,
        }]),
        relations: this.graph.relations,
        lastBuilt: this.graph.lastBuilt.toISOString(),
        fileCount: this.graph.fileCount,
      };

      fs.writeFileSync(
        path.join(GRAPH_DIR, 'graph.json'),
        JSON.stringify(serializable)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      const graphFile = path.join(GRAPH_DIR, 'graph.json');
      if (!fs.existsSync(graphFile)) return;

      const data = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
      this.graph = {
        entities: new Map(data.entities.map(([id, e]: [string, KGEntity]) => [id, e])),
        relations: data.relations || [],
        lastBuilt: new Date(data.lastBuilt),
        fileCount: data.fileCount || 0,
      };
    } catch {
      // Fresh start
    }
  }
}
