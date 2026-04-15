// src/brain/code-similarity.ts — Detect duplicate/near-duplicate code blocks across a project

import * as fs from 'fs';
import * as path from 'path';
import { CodeBlock, DuplicateGroup } from '../types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.cache', '.next', '.nuxt', 'vendor', '__pycache__',
]);

export class CodeSimilarityDetector {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /**
   * Scan all source files for duplicate code blocks.
   * Returns groups of blocks whose pairwise similarity >= minSimilarity.
   */
  async detectDuplicates(minSimilarity: number = 0.8): Promise<DuplicateGroup[]> {
    const allBlocks = this.collectAllBlocks();
    const groups: DuplicateGroup[] = [];

    // Only consider blocks with 6+ lines
    const eligible = allBlocks.filter(b => (b.endLine - b.startLine + 1) >= 6);

    // Track which blocks have already been grouped to avoid duplicates
    const assigned = new Set<string>();

    for (let i = 0; i < eligible.length; i++) {
      const keyA = this.blockKey(eligible[i]);
      if (assigned.has(keyA)) continue;

      const similar: CodeBlock[] = [eligible[i]];

      for (let j = i + 1; j < eligible.length; j++) {
        const keyB = this.blockKey(eligible[j]);
        if (assigned.has(keyB)) continue;

        // Skip self-comparison (same file + same line range)
        if (keyA === keyB) continue;

        const sim = this.computeSimilarity(eligible[i], eligible[j]);
        if (sim >= minSimilarity) {
          similar.push(eligible[j]);
          assigned.add(keyB);
        }
      }

      if (similar.length > 1) {
        assigned.add(keyA);
        groups.push({
          blocks: similar,
          similarity: minSimilarity,
          suggestedRefactor: this.suggestRefactor(similar),
        });
      }
    }

    return groups;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Walk the project tree, read each source file, and extract code blocks.
   */
  private collectAllBlocks(): CodeBlock[] {
    const files = this.walkDir(this.projectDir);
    const blocks: CodeBlock[] = [];

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const extracted = this.extractBlocks(filePath, content);
        blocks.push(...extracted);
      } catch {
        // unreadable file — skip
      }
    }

    return blocks;
  }

  /**
   * Split a single file into code blocks by tracking brace depth.
   * Recognises the block type (function, method, class, generic block).
   * Only returns blocks with >= 6 lines.
   */
  private extractBlocks(filePath: string, content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const lines = content.split('\n');

    let depth = 0;
    let blockStart = -1;
    let blockType: CodeBlock['type'] = 'block';
    let pendingType: CodeBlock['type'] = 'block';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect what kind of block is about to open
      if (depth === 0) {
        const trimmed = line.trim();
        if (/\bclass\b/.test(trimmed) && /\{/.test(trimmed)) {
          pendingType = 'class';
        } else if (
          /\b(function\b|=>\s*\{|async\s+function\b|\*\s*\w+\s*\()/.test(trimmed) &&
          /\{/.test(trimmed)
        ) {
          pendingType = 'function';
        } else if (
          /^\s*(public|private|protected|static|async|get|set|readonly)\s.*\{/.test(trimmed) ||
          /^\s*\*?\s*\w+\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\{/.test(trimmed)
        ) {
          pendingType = 'method';
        } else if (/\{/.test(trimmed)) {
          pendingType = 'block';
        }
      }

      // Track brace depth
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      const prevDepth = depth;
      depth += opens - closes;

      if (opens > 0 && prevDepth === 0) {
        // Entering a top-level block
        blockStart = i;
        blockType = pendingType;
      }

      if (prevDepth > 0 && depth === 0 && blockStart >= 0) {
        // Exiting a block
        const endLine = i;
        const lineCount = endLine - blockStart + 1;

        if (lineCount >= 6) {
          blocks.push({
            file: filePath,
            startLine: blockStart + 1, // 1-based
            endLine: endLine + 1,
            content: lines.slice(blockStart, endLine + 1).join('\n'),
            type: blockType,
          });
        }

        blockStart = -1;
        blockType = 'block';
      }
    }

    return blocks;
  }

  /**
   * Compute Jaccard similarity between two code blocks.
   * Tokenises content into word tokens, then calculates |intersection| / |union|.
   */
  private computeSimilarity(a: CodeBlock, b: CodeBlock): number {
    const tokensA = this.tokenize(a.content);
    const tokensB = this.tokenize(b.content);

    if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
    if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

    let intersectionSize = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersectionSize++;
    }

    const unionSize = tokensA.size + tokensB.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }

  /**
   * Split content into individual word tokens and return as a Set.
   * Strips punctuation and normalises to lowercase for comparison.
   */
  private tokenize(content: string): Set<string> {
    const words = content
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => w.toLowerCase());
    return new Set(words);
  }

  /**
   * Generate a refactoring suggestion based on the types of the duplicate blocks.
   */
  private suggestRefactor(blocks: CodeBlock[]): string {
    const types = new Set(blocks.map(b => b.type));
    const files = new Set(blocks.map(b => b.file));

    if (types.has('class')) {
      return 'Extract a shared base class or compose common behaviour into a mixin/trait';
    }

    if (types.has('method')) {
      if (files.size > 1) {
        return 'Extract shared method logic into a utility module and import it where needed';
      }
      return 'Extract shared method logic into a private helper method within the same class';
    }

    if (types.has('function')) {
      if (files.size > 1) {
        return 'Extract shared logic into a utility function in a common module and import it where needed';
      }
      return 'Extract shared logic into a utility function within the same module';
    }

    // Generic block
    if (files.size > 1) {
      return 'Extract shared logic into a utility function in a shared module';
    }
    return 'Extract shared logic into a utility function to reduce duplication';
  }

  /**
   * Walk a directory tree, returning full paths of source files.
   */
  private walkDir(dir: string): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          results.push(...this.walkDir(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // permission or access error — skip
    }

    return results;
  }

  /**
   * Produce a unique key for a block (file path + line range).
   */
  private blockKey(block: CodeBlock): string {
    return `${block.file}:${block.startLine}-${block.endLine}`;
  }
}
