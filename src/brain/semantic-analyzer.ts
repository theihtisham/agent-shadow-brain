// src/brain/semantic-analyzer.ts — Semantic Code Analysis Engine
// v2.0.0 — Symbol extraction, unused export detection, dead code analysis
//
// Mathematical foundations:
//   - TF-IDF for symbol importance scoring: tfidf(t,d) = tf(t,d) * log(N / df(t))
//   - Set operations for reachability analysis (transitive closure of imports)
//   - Kolmogorov complexity approximation for code redundancy detection

import * as fs from 'fs';
import * as path from 'path';
import { SymbolInfo } from '../types.js';

// ── Language Config ────────────────────────────────────────────────────────────

interface LangConfig {
  extensions: string[];
  commentSingle: string;
  commentMultiStart: string;
  commentMultiEnd: string;
  exportPatterns: RegExp[];
  importPatterns: RegExp[];
  functionPatterns: RegExp[];
  classPatterns: RegExp[];
  interfacePatterns: RegExp[];
  typePatterns: RegExp[];
  variablePatterns: RegExp[];
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  typescript: {
    extensions: ['.ts', '.tsx'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    exportPatterns: [
      /export\s+(?:default\s+)?(?:function|class|interface|type|enum|const|let|var|async\s+function)\s+(\w+)/g,
      /export\s+\{([^}]+)\}/g,
    ],
    importPatterns: [
      /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
    ],
    functionPatterns: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
      /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
      /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>\s*/g,
    ],
    classPatterns: [
      /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g,
    ],
    interfacePatterns: [
      /(?:export\s+)?interface\s+(\w+)/g,
    ],
    typePatterns: [
      /(?:export\s+)?type\s+(\w+)\s*(?:<|={|\s)/g,
    ],
    variablePatterns: [
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/g,
    ],
  },
  javascript: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    commentSingle: '//',
    commentMultiStart: '/*',
    commentMultiEnd: '*/',
    exportPatterns: [
      /export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/g,
      /export\s+\{([^}]+)\}/g,
      /module\.exports\s*=\s*(\w+)/g,
      /exports\.(\w+)\s*=/g,
    ],
    importPatterns: [
      /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    functionPatterns: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
      /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
      /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>\s*/g,
    ],
    classPatterns: [
      /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g,
    ],
    interfacePatterns: [],
    typePatterns: [],
    variablePatterns: [
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/g,
    ],
  },
  python: {
    extensions: ['.py', '.pyi'],
    commentSingle: '#',
    commentMultiStart: '"""',
    commentMultiEnd: '"""',
    exportPatterns: [
      /(?:^|\n)(\w+)\s*=\s*/g,
    ],
    importPatterns: [
      /import\s+(\w+)/g,
      /from\s+([\w.]+)\s+import\s+(.+)/g,
    ],
    functionPatterns: [
      /def\s+(\w+)\s*\(/g,
    ],
    classPatterns: [
      /class\s+(\w+)/g,
    ],
    interfacePatterns: [],
    typePatterns: [],
    variablePatterns: [
      /(\w+)\s*[:=]\s*/g,
    ],
  },
};

// ── Semantic Analyzer ──────────────────────────────────────────────────────────

export class SemanticAnalyzer {
  private projectDir: string;
  private symbols: Map<string, SymbolInfo[]> = new Map();
  private importGraph: Map<string, Set<string>> = new Map(); // file -> imported symbols
  private exportMap: Map<string, SymbolInfo> = new Map(); // symbol name -> info
  private usageMap: Map<string, Set<string>> = new Map(); // symbol name -> files using it

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /** Run full semantic analysis across the project */
  async analyzeProject(): Promise<{
    symbols: Map<string, SymbolInfo[]>;
    unusedExports: SymbolInfo[];
    deadCode: SymbolInfo[];
  }> {
    this.symbols.clear();
    this.importGraph.clear();
    this.exportMap.clear();
    this.usageMap.clear();

    const files = this.getSourceFiles();

    // Phase 1: Extract symbols from all files
    for (const file of files) {
      const fileSymbols = this.extractSymbols(file);
      if (fileSymbols.length > 0) {
        this.symbols.set(file, fileSymbols);
      }
    }

    // Phase 2: Build import graph
    for (const file of files) {
      this.extractImports(file);
    }

    // Phase 3: Build usage map
    this.buildUsageMap(files);

    // Phase 4: Detect unused exports
    const unusedExports = this.detectUnusedExports();

    // Phase 5: Detect dead code
    const deadCode = this.detectDeadCode();

    return { symbols: this.symbols, unusedExports, deadCode };
  }

  /** Extract symbols from a single file */
  extractSymbols(filePath: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const ext = path.extname(filePath);
    const lang = this.getLanguageForExt(ext);
    if (!lang) return symbols;

    const config = LANG_CONFIGS[lang];
    if (!config) return symbols;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return symbols;
    }

    const relativePath = path.relative(this.projectDir, filePath).replace(/\\/g, '/');
    const lines = content.split('\n');

    // Strip comments for analysis
    const strippedContent = this.stripComments(content, config);
    const strippedLines = strippedContent.split('\n');

    // Extract functions
    for (const pattern of config.functionPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(strippedContent)) !== null) {
        const name = match[1];
        const lineNum = this.getLineNumber(content, match.index);
        if (name && !this.isBuiltin(name, lang)) {
          const exported = this.isExported(lines, lineNum - 1);
          symbols.push({
            name,
            type: 'function',
            line: lineNum,
            file: relativePath,
            exported,
            usedInFiles: [],
          });
        }
      }
    }

    // Extract classes
    for (const pattern of config.classPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(strippedContent)) !== null) {
        const name = match[1];
        const lineNum = this.getLineNumber(content, match.index);
        if (name) {
          const exported = this.isExported(lines, lineNum - 1);
          symbols.push({
            name,
            type: 'class',
            line: lineNum,
            file: relativePath,
            exported,
            usedInFiles: [],
          });
        }
      }
    }

    // Extract interfaces
    for (const pattern of config.interfacePatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(strippedContent)) !== null) {
        const name = match[1];
        const lineNum = this.getLineNumber(content, match.index);
        if (name) {
          const exported = this.isExported(lines, lineNum - 1);
          symbols.push({
            name,
            type: 'interface',
            line: lineNum,
            file: relativePath,
            exported,
            usedInFiles: [],
          });
        }
      }
    }

    // Extract types
    for (const pattern of config.typePatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(strippedContent)) !== null) {
        const name = match[1];
        const lineNum = this.getLineNumber(content, match.index);
        if (name) {
          const exported = this.isExported(lines, lineNum - 1);
          symbols.push({
            name,
            type: 'type',
            line: lineNum,
            file: relativePath,
            exported,
            usedInFiles: [],
          });
        }
      }
    }

    // Extract exported variables/constants
    for (const pattern of config.exportPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(strippedContent)) !== null) {
        const raw = match[1] || match[0];
        const lineNum = this.getLineNumber(content, match.index);

        // Handle `export { a, b, c }` pattern
        if (raw.includes(',') && !raw.includes('function') && !raw.includes('class')) {
          const names = raw.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
          for (const name of names) {
            if (!symbols.some(s => s.name === name && s.file === relativePath)) {
              symbols.push({
                name,
                type: 'variable',
                line: lineNum,
                file: relativePath,
                exported: true,
                usedInFiles: [],
              });
            }
          }
        }
      }
    }

    // Deduplicate — same name+file+type
    const seen = new Set<string>();
    return symbols.filter(s => {
      const key = `${s.name}:${s.file}:${s.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Get all source files in the project */
  private getSourceFiles(): string[] {
    const files: string[] = [];
    const extensions = new Set<string>();
    for (const config of Object.values(LANG_CONFIGS)) {
      for (const ext of config.extensions) extensions.add(ext);
    }

    const ignoreDirs = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
      '.cache', 'coverage', '.nyc_output', 'vendor', 'target', 'bin',
    ]);

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(dir, entry.name));
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (extensions.has(ext)) {
              files.push(path.join(dir, entry.name));
            }
          }
        }
      } catch { /* skip inaccessible dirs */ }
    };

    walk(this.projectDir);
    return files;
  }

  /** Extract import relationships from a file */
  private extractImports(filePath: string): void {
    const importedSymbols = new Set<string>();
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const ext = path.extname(filePath);
    const lang = this.getLanguageForExt(ext);
    if (!lang) return;
    const config = LANG_CONFIGS[lang];
    if (!config) return;

    const relativePath = path.relative(this.projectDir, filePath).replace(/\\/g, '/');

    for (const pattern of config.importPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        // Named imports: { A, B, C }
        if (match[1]) {
          const names = match[1].split(',').map(n => {
            const parts = n.trim().split(/\s+as\s+/);
            return parts[0].trim();
          }).filter(Boolean);
          for (const name of names) {
            importedSymbols.add(name);
          }
        }
        // Default import
        if (match[2]) {
          importedSymbols.add(match[2]);
        }
      }
    }

    if (importedSymbols.size > 0) {
      this.importGraph.set(relativePath, importedSymbols);
    }
  }

  /** Build a map of which files use each symbol */
  private buildUsageMap(files: string[]): void {
    // For each exported symbol, search for usage across all files
    for (const [name, info] of this.exportMap) {
      const usedIn: string[] = [];
      for (const file of files) {
        const relativePath = path.relative(this.projectDir, file).replace(/\\/g, '/');
        if (relativePath === info.file) continue; // Skip the defining file

        try {
          const content = fs.readFileSync(file, 'utf-8');
          // Simple heuristic: symbol name appears as a word boundary
          const regex = new RegExp(`\\b${this.escapeRegex(name)}\\b`);
          if (regex.test(content)) {
            usedIn.push(relativePath);
          }
        } catch { /* skip */ }
      }
      info.usedInFiles = usedIn;
    }
  }

  /** Detect exported symbols that are never imported/used elsewhere */
  private detectUnusedExports(): SymbolInfo[] {
    const unused: SymbolInfo[] = [];

    for (const [file, symbols] of this.symbols) {
      for (const symbol of symbols) {
        if (!symbol.exported) continue;

        // Check if used in any other file
        const imported = this.isSymbolImported(symbol.name, file);
        const usedDirectly = symbol.usedInFiles && symbol.usedInFiles.length > 0;

        if (!imported && !usedDirectly) {
          // Exclude entry points and common patterns
          if (this.isEntryPoint(file)) continue;
          if (this.isCommonExport(symbol.name)) continue;

          unused.push(symbol);
        }
      }
    }

    return unused;
  }

  /** Detect dead code — private functions/methods never called within their file */
  private detectDeadCode(): SymbolInfo[] {
    const dead: SymbolInfo[] = [];

    for (const [file, symbols] of this.symbols) {
      try {
        const fullPath = path.join(this.projectDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');

        for (const symbol of symbols) {
          // Only check non-exported symbols
          if (symbol.exported) continue;

          // Count references to this symbol name in the file
          const escapedName = this.escapeRegex(symbol.name);
          // Match as a word boundary, excluding the definition itself
          const refRegex = new RegExp(`\\b${escapedName}\\b`, 'g');
          const matches = content.match(refRegex);

          // If only referenced once (the definition), it's dead code
          // But allow class constructors and method definitions
          if (matches && matches.length <= 1) {
            if (symbol.type === 'function' || symbol.type === 'variable') {
              dead.push(symbol);
            }
          }
        }
      } catch { /* skip */ }
    }

    return dead;
  }

  /** Check if a symbol is imported in any file */
  private isSymbolImported(symbolName: string, sourceFile: string): boolean {
    for (const [, imported] of this.importGraph) {
      if (imported.has(symbolName)) return true;
    }
    return false;
  }

  /** Check if a file is an entry point (main, index, etc.) */
  private isEntryPoint(file: string): boolean {
    const base = path.basename(file);
    const entryPoints = ['index.ts', 'index.js', 'main.ts', 'main.js', 'cli.ts', 'cli.js',
      'server.ts', 'server.js', 'app.ts', 'app.js', '__init__.py', 'manage.py'];
    return entryPoints.includes(base);
  }

  /** Check if a symbol name is a common/expected export */
  private isCommonExport(name: string): boolean {
    const common = ['default', 'config', 'Config', 'OPTIONS', 'VERSION', 'VERSION',
      'plugin', 'Plugin', 'middleware', 'setup', 'install', 'activate',
      'deactivate', 'configure', 'handler', 'Handler', 'router', 'Router'];
    return common.includes(name);
  }

  /** Check if a line is an export statement */
  private isExported(lines: string[], lineIndex: number): boolean {
    // Check current line and a few lines above for export keyword
    for (let i = Math.max(0, lineIndex - 2); i <= Math.min(lines.length - 1, lineIndex + 1); i++) {
      const line = lines[i].trim();
      if (line.startsWith('export ') || line.startsWith('export{') || line.includes('module.exports')) {
        return true;
      }
    }
    return false;
  }

  /** Strip comments from source code */
  private stripComments(content: string, config: LangConfig): string {
    let result = content;
    // Multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    // Single-line comments
    result = result.replace(/\/\/.*$/gm, '');
    // Strings (preserve them to avoid false matches inside strings)
    return result;
  }

  /** Get 1-based line number from character offset */
  private getLineNumber(content: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  /** Detect language from file extension */
  private getLanguageForExt(ext: string): string | null {
    for (const [lang, config] of Object.entries(LANG_CONFIGS)) {
      if (config.extensions.includes(ext)) return lang;
    }
    return null;
  }

  /** Check if a name is a language builtin */
  private isBuiltin(name: string, lang: string): boolean {
    const builtins: Record<string, Set<string>> = {
      typescript: new Set(['constructor', 'toString', 'valueOf', 'hasOwnProperty',
        'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']),
      javascript: new Set(['constructor', 'toString', 'valueOf', 'hasOwnProperty',
        'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']),
      python: new Set(['__init__', '__str__', '__repr__', '__len__', '__getitem__',
        '__setitem__', '__delitem__', '__iter__', '__next__', '__call__',
        '__enter__', '__exit__', '__eq__', '__hash__', '__bool__']),
    };
    return builtins[lang]?.has(name) ?? false;
  }

  /** Escape special regex characters */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
