// src/brain/dead-code-eliminator.ts — Dead code path detection
// v3.0.0 — Identifies unreachable code, unused exports, unused variables, dead branches

import { BrainInsight, DeadCodeResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export class DeadCodeEliminator {
  private projectDir: string;
  private exportedSymbols: Map<string, { file: string; line: number; name: string }[]> = new Map();
  private importedSymbols: Set<string> = new Set();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 200): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];

    // Phase 1: Collect all exports and imports
    this.collectExportsImports(files);

    // Phase 2: Per-file analysis
    for (const filePath of files) {
      const relPath = path.relative(this.projectDir, filePath);
      const ext = path.extname(filePath);

      // Dead code after return/throw
      insights.push(...this.detectUnreachableCode(filePath, relPath));

      // Unused exports
      insights.push(...this.detectUnusedExports(filePath, relPath));

      // Unused variables
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        insights.push(...this.detectUnusedVariables(filePath, relPath));
        insights.push(...this.detectUnusedImports(filePath, relPath));
      }

      // Dead branches (always true/false conditions)
      insights.push(...this.detectDeadBranches(filePath, relPath));
    }

    return insights;
  }

  private collectExportsImports(files: string[]): void {
    this.exportedSymbols.clear();
    this.importedSymbols.clear();

    for (const filePath of files) {
      let content: string;
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
      const relPath = path.relative(this.projectDir, filePath);
      const lines = content.split('\n');

      // Collect exports
      const exportPatterns = [
        /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
        /export\s+\{\s*([^}]+)\s*\}/g,
      ];

      for (const pattern of exportPatterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const line = content.substring(0, match.index).split('\n').length;
          if (pattern.source.includes('\\{')) {
            // Named exports: export { foo, bar }
            const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean) as string[];
            for (const name of names) {
              if (!this.exportedSymbols.has(name)) this.exportedSymbols.set(name, []);
              this.exportedSymbols.get(name)!.push({ file: relPath, line, name });
            }
          } else {
            const name = match[1];
            if (!this.exportedSymbols.has(name)) this.exportedSymbols.set(name, []);
            this.exportedSymbols.get(name)!.push({ file: relPath, line, name });
          }
        }
      }

      // Collect imports
      const importPatterns = [
        /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g,
        /import\s*\(\s*['"][^'"]+['"]\s*\)/g, // dynamic imports
      ];

      for (let pi = 0; pi < importPatterns.length; pi++) {
        const pattern = importPatterns[pi];
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          if (pi === 0) {
            const namedImports = match[1]; // { foo, bar }
            const defaultImport = match[2]; // foo
            if (namedImports) {
              const names = namedImports.split(',').map(n => {
                const trimmed = n.trim();
                const asParts = trimmed.split(/\s+as\s+/);
                return asParts[0].trim();
              });
              for (const name of names) {
                if (name) this.importedSymbols.add(name);
              }
            }
            if (defaultImport) this.importedSymbols.add(defaultImport);
          }
        }
      }
    }
  }

  private detectUnreachableCode(filePath: string, relPath: string): BrainInsight[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const insights: BrainInsight[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();

      // After return, throw, continue, break in same block
      if (/^\s*(return\s|return;|throw\s|continue;|break;|break\s)/.test(line) && !line.startsWith('//')) {
        // Check if next non-empty line is in the same block
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine === '' || nextLine.startsWith('//')) continue;
          if (nextLine === '}' || nextLine.startsWith('}')) break;

          // Check if this is actually unreachable (same block level)
          if (nextLine.length > 0 && !nextLine.startsWith('case ') && !nextLine.startsWith('default:')) {
            insights.push({
              type: 'dead-code',
              priority: 'high',
              title: `[dead-code] Unreachable code after ${line.split(/\s/)[0]} in ${relPath}`,
              content:
                `Unreachable code detected in ${relPath}:${j + 1}\n` +
                `  After: ${line}\n` +
                `  Unreachable: ${nextLine}\n` +
                `  Code after return/throw/break/continue will never execute.\n` +
                `  Remove or refactor the dead code.`,
              files: [relPath],
              timestamp: new Date(),
              confidence: 0.92,
              metadata: { line: j + 1, deadCodeType: 'unreachable' },
            });
            break;
          }
        }
      }
    }

    return insights;
  }

  private detectUnusedExports(filePath: string, relPath: string): BrainInsight[] {
    const insights: BrainInsight[] = [];
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return insights;

    // Check for index.ts barrel exports — skip these
    if (path.basename(filePath) === 'index.ts' || path.basename(filePath) === 'index.tsx') return insights;

    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const exportPattern = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = exportPattern.exec(content)) !== null) {
      const name = match[1];
      const line = content.substring(0, match.index).split('\n').length;

      // Check if this export is imported anywhere
      if (!this.importedSymbols.has(name)) {
        // Exclude common patterns that might be used externally
        const commonExports = ['config', 'default', 'App', 'app', 'main', 'handler', 'middleware', 'plugin'];
        if (commonExports.includes(name)) continue;

        // Skip if it's a type that might be used in declarations
        const isType = /export\s+(?:interface|type)\s+/.test(match[0]);
        if (isType) continue; // types might be used implicitly

        insights.push({
          type: 'dead-code',
          priority: 'medium',
          title: `[dead-code] Unused export "${name}" in ${relPath}`,
          content:
            `Exported symbol \`${name}\` in ${relPath}:${line} is not imported by any other file.\n` +
            `  This could be dead code or an external API. Verify before removing.\n` +
            `  If unused internally, consider removing the export or marking as @internal.`,
          files: [relPath],
          timestamp: new Date(),
          confidence: 0.7, // lower confidence — might be external API
          metadata: { symbol: name, line, deadCodeType: 'unused-export' },
        });
      }
    }

    return insights;
  }

  private detectUnusedVariables(filePath: string, relPath: string): BrainInsight[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const insights: BrainInsight[] = [];
    const lines = content.split('\n');

    // Find variable declarations
    const varPattern = /(?:const|let|var)\s+(\w+)\s*=/g;
    let match: RegExpExecArray | null;

    while ((match = varPattern.exec(content)) !== null) {
      const name = match[1];
      const line = content.substring(0, match.index).split('\n').length;

      // Skip common patterns
      const skipNames = new Set(['_', 'err', 'error', 'e', 'req', 'res', 'next', 'ctx', 'config', 'options']);
      if (skipNames.has(name)) continue;
      if (name.startsWith('_')) continue; // convention for intentionally unused

      // Count usages (excluding the declaration itself)
      const usagePattern = new RegExp(`\\b${name}\\b`, 'g');
      const usages = content.match(usagePattern);
      if (usages && usages.length <= 1) {
        insights.push({
          type: 'dead-code',
          priority: 'low',
          title: `[dead-code] Unused variable "${name}" in ${relPath}:${line}`,
          content:
            `Variable \`${name}\` declared in ${relPath}:${line} appears to be unused.\n` +
            `  Consider removing it or prefixing with \`_\` if intentionally unused.`,
          files: [relPath],
          timestamp: new Date(),
          confidence: 0.75,
          metadata: { variable: name, line, deadCodeType: 'unused-variable' },
        });
      }
    }

    return insights;
  }

  private detectUnusedImports(filePath: string, relPath: string): BrainInsight[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const insights: BrainInsight[] = [];

    // Match import statements
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const imports = match[1].split(',').map(s => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });

      for (const name of imports) {
        if (!name) continue;
        // Skip type-only imports
        if (content.includes(`import type { ${name}`)) continue;

        // Count usage in the rest of the file
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const usageRegex = new RegExp(`\\b${escaped}\\b`, 'g');
        const usages = content.match(usageRegex);
        if (usages && usages.length <= 1) {
          const line = content.substring(0, match.index).split('\n').length;
          insights.push({
            type: 'dead-code',
            priority: 'low',
            title: `[dead-code] Unused import "${name}" in ${relPath}:${line}`,
            content:
              `Import \`${name}\` in ${relPath}:${line} is not used in the file.\n` +
              `  Remove unused imports to keep the codebase clean.`,
            files: [relPath],
            timestamp: new Date(),
            confidence: 0.9,
            metadata: { import: name, line, deadCodeType: 'unused-import' },
          });
        }
      }
    }

    return insights;
  }

  private detectDeadBranches(filePath: string, relPath: string): BrainInsight[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const insights: BrainInsight[] = [];
    const lines = content.split('\n');

    // Detect always-true/false conditions
    const deadConditions = [
      { regex: /\bif\s*\(\s*(true|!\s*false)\s*\)/g, branch: 'always-true' },
      { regex: /\bif\s*\(\s*(false|!\s*true)\s*\)/g, branch: 'always-false' },
      { regex: /\bif\s*\(\s*0\s*\)/g, branch: 'always-false' },
      { regex: /\bif\s*\(\s*1\s*\)/g, branch: 'always-true' },
      { regex: /\bif\s*\(\s*["'][^"']+["']\s*\)/g, branch: 'always-true' },
      { regex: /process\.env\.NODE_ENV\s*===\s*["']test["']/g, branch: 'environmental' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex, branch } of deadConditions) {
        regex.lastIndex = 0;
        if (regex.test(line) && !line.trim().startsWith('//')) {
          insights.push({
            type: 'dead-code',
            priority: branch === 'environmental' ? 'low' : 'high',
            title: `[dead-code] ${branch === 'always-true' ? 'Always-true' : 'Always-false'} branch in ${relPath}:${i + 1}`,
            content:
              `Condition in ${relPath}:${i + 1} is always ${branch === 'always-true' ? 'true' : 'false'}.\n` +
              `  Line: ${line.trim()}\n` +
              `  ${branch === 'always-true' ? 'The else branch will never execute.' : 'The if branch will never execute.'}\n` +
              `  Consider removing the dead branch or fixing the condition.`,
            files: [relPath],
            timestamp: new Date(),
            confidence: 0.95,
            metadata: { line: i + 1, branchType: branch, deadCodeType: 'dead-branch' },
          });
        }
      }
    }

    return insights;
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
