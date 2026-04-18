// src/brain/fine-tuning-engine.ts — Custom LLM fine-tuning on codebase patterns
// v6.0.0 — Zero-dependency pattern learning engine

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CodePattern {
  id: string;
  type: 'naming' | 'structure' | 'error-handling' | 'import' | 'comment' | 'test' | 'api' | 'state' | 'async' | 'type';
  pattern: string;
  examples: string[];
  frequency: number;
  confidence: number;
  context: string;
  firstSeen: number;
  lastSeen: number;
  files: string[];
}

export interface TrainingDataPoint {
  input: string;
  output: string;
  category: string;
  weight: number;
  source: string;
}

export interface FineTuneModel {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  patternCount: number;
  trainingPoints: number;
  accuracy: number;
  version: number;
  categories: Record<string, number>;
}

export interface FineTuneStats {
  totalPatterns: number;
  totalTrainingPoints: number;
  models: number;
  categories: Record<string, number>;
  topPatterns: Array<{ type: string; count: number }>;
  lastTrainingRun: number | null;
  accuracy: number;
  memoryUsageMB: number;
}

export interface CodeSuggestion {
  text: string;
  confidence: number;
  category: string;
  basedOn: string[];
  reasoning: string;
}

export interface StyleRule {
  id: string;
  rule: string;
  severity: 'info' | 'warning' | 'error';
  examples: { good: string; bad: string }[];
  frequency: number;
}

// ── Pattern Extractors ─────────────────────────────────────────────────────

const PATTERN_EXTRACTORS = {
  naming: {
    camelCase: /\b[a-z][a-zA-Z0-9]*(?:get|set|is|has|can|should|will|did|on|handle|create|delete|update|fetch|load|save|parse|format|validate|convert|transform|build|render|compute|calculate|process|generate|init|start|stop|reset|clear|add|remove|find|filter|map|reduce|sort|merge|split|join|check|ensure|assert|log|debug|warn|error|throw|catch|try|retry|wait|sleep|delay|emit|listen|subscribe|observe|notify|trigger|dispatch|publish)\b/g,
    constants: /\b[A-Z][A-Z0-9_]{2,}\b/g,
    classNames: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g,
    interfaceNames: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g,
    typeNames: /\btype\s+([A-Z][a-zA-Z0-9]+)/g,
    enumNames: /\benum\s+([A-Z][a-zA-Z0-9]+)/g,
  },
  structure: {
    exportDefault: /export\s+default\s+(class|function|const)/g,
    namedExport: /export\s+(class|function|const|interface|type|enum)\s+/g,
    asyncFunction: /async\s+(function\s+\w+|\w+\s*=\s*async)/g,
    arrowFunction: /(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+)?\s*=>/g,
    destructuring: /(?:const|let|var)\s*\{[^}]+\}\s*=/g,
    spreadOperator: /\.{3}\w+/g,
    optionalChaining: /\?\./g,
    nullishCoalescing: /\?\?/g,
  },
  errorHandling: {
    tryCatch: /try\s*\{[\s\S]*?\}\s*catch\s*\(/g,
    throwNew: /throw\s+new\s+\w+Error/g,
    customError: /class\s+\w+Error\s+extends\s+Error/g,
    errorFirst: /\(err(?:or)?\s*(?:,|\))/g,
    promiseCatch: /\.catch\s*\(/g,
    asyncCatch: /try\s*\{[\s\S]*?await[\s\S]*?\}\s*catch/g,
  },
  import: {
    namedImport: /import\s*\{[^}]+\}\s*from/g,
    defaultImport: /import\s+\w+\s+from/g,
    sideEffect: /import\s+['"][^'"]+['"]/g,
    dynamicImport: /import\s*\(['"]/g,
    reExport: /export\s*\{[^}]+\}\s*from/g,
    typeImport: /import\s+type\s*\{/g,
  },
  comment: {
    jsdoc: /\/\*\*[\s\S]*?\*\//g,
    singleLine: /\/\/\s*.{10,}/g,
    todoFixme: /\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG|NOTE|OPTIMIZE):/gi,
    regionMarkers: /\/\/\s*(?:──|---|\*\*\*|===|###)/g,
  },
  test: {
    describe: /describe\s*\(\s*['"`]/g,
    it: /\bit\s*\(\s*['"`]/g,
    expect: /expect\s*\(/g,
    mock: /(?:jest\.mock|vi\.mock|sinon\.stub)\s*\(/g,
    beforeAfter: /(?:beforeEach|afterEach|beforeAll|afterAll)\s*\(/g,
    testUtil: /(?:render|screen|fireEvent|userEvent|waitFor)\s*[.(]/g,
  },
  api: {
    expressRoute: /(?:app|router)\.\s*(?:get|post|put|patch|delete|use)\s*\(/g,
    middleware: /\(req\s*,\s*res\s*,\s*next\)\s*=>/g,
    statusCode: /(?:res\.status|response\.status)\s*\(\s*\d{3}\s*\)/g,
    fetchCall: /(?:fetch|axios|got|superagent)\s*[.(]/g,
    restPattern: /\/api\/v\d+\//g,
  },
  async: {
    awaitExpression: /await\s+\w+/g,
    promiseAll: /Promise\.(?:all|allSettled|race|any)\s*\(/g,
    asyncIterator: /for\s+await\s+\(/g,
    callback: /\(\s*(?:err|error|e)\s*,\s*(?:data|result|response)\s*\)/g,
    eventEmitter: /\.(?:on|once|emit|addListener|removeListener)\s*\(/g,
  },
  type: {
    genericType: /<\s*[A-Z]\w*(?:\s*(?:extends|=)\s*[^>]+)?>/g,
    unionType: /:\s*\w+\s*\|\s*\w+/g,
    intersectionType: /:\s*\w+\s*&\s*\w+/g,
    typeGuard: /\w+\s+is\s+\w+/g,
    assertion: /as\s+\w+/g,
    recordType: /Record\s*<\s*\w+\s*,\s*\w+\s*>/g,
  },
  state: {
    useState: /useState\s*<?\s*\w*>?\s*\(/g,
    useReducer: /useReducer\s*\(/g,
    useEffect: /useEffect\s*\(/g,
    useMemo: /useMemo\s*\(/g,
    useCallback: /useCallback\s*\(/g,
    useRef: /useRef\s*\(/g,
    zustand: /create\s*<\s*\w+\s*>\s*\(/g,
    redux: /(?:createSlice|createAction|createReducer|createSelector)\s*\(/g,
  },
};

// ── Fine-Tuning Engine ──────────────────────────────────────────────────────

export class FineTuningEngine {
  private patterns: Map<string, CodePattern> = new Map();
  private trainingData: TrainingDataPoint[] = [];
  private models: Map<string, FineTuneModel> = new Map();
  private styleRules: Map<string, StyleRule> = new Map();
  private projectDir: string;
  private dataDir: string;
  private lastTrainingRun: number | null = null;
  private patternIndex: Map<string, Set<string>> = new Map(); // type -> pattern IDs

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.dataDir = path.join(projectDir, '.shadow-brain', 'fine-tuning');
  }

  // ── Core Training Pipeline ──────────────────────────────────────────────

  async trainOnDirectory(dir?: string): Promise<FineTuneModel> {
    const targetDir = dir || this.projectDir;
    const files = await this.collectSourceFiles(targetDir);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.length > 0 && content.length < 500_000) {
          this.extractPatterns(file, content);
          this.generateTrainingData(file, content);
        }
      } catch {
        // Skip unreadable files
      }
    }

    this.deriveStyleRules();
    const model = this.buildModel();
    this.lastTrainingRun = Date.now();

    await this.save();
    return model;
  }

  async trainOnFile(filePath: string, content: string): Promise<void> {
    this.extractPatterns(filePath, content);
    this.generateTrainingData(filePath, content);
    this.deriveStyleRules();
  }

  async trainOnChange(filePath: string, oldContent: string, newContent: string): Promise<void> {
    // Learn from the delta — what did the developer change?
    const oldPatterns = this.extractPatternsFromContent(oldContent);
    const newPatterns = this.extractPatternsFromContent(newContent);

    // Find new patterns (things the developer added)
    for (const [type, newSet] of newPatterns) {
      const oldSet = oldPatterns.get(type) || new Set();
      for (const p of newSet) {
        if (!oldSet.has(p)) {
          this.reinforcePattern(type, p, filePath);
        }
      }
    }

    // Find removed patterns (things the developer removed — negative signal)
    for (const [type, oldSet] of oldPatterns) {
      const newSet = newPatterns.get(type) || new Set();
      for (const p of oldSet) {
        if (!newSet.has(p)) {
          this.weakenPattern(type, p);
        }
      }
    }

    this.trainingData.push({
      input: oldContent.slice(0, 2000),
      output: newContent.slice(0, 2000),
      category: 'code-change',
      weight: 1.5, // Changes are high-value training data
      source: filePath,
    });
  }

  // ── Pattern Extraction ──────────────────────────────────────────────────

  private extractPatterns(filePath: string, content: string): void {
    const now = Date.now();
    const relPath = path.relative(this.projectDir, filePath);

    for (const [category, extractors] of Object.entries(PATTERN_EXTRACTORS)) {
      for (const [name, regex] of Object.entries(extractors)) {
        const matches = content.match(regex as RegExp);
        if (matches && matches.length > 0) {
          const patternId = `${category}:${name}`;
          const existing = this.patterns.get(patternId);

          if (existing) {
            existing.frequency += matches.length;
            existing.lastSeen = now;
            existing.examples = [...new Set([...existing.examples, ...matches.slice(0, 5)])].slice(0, 10);
            if (!existing.files.includes(relPath)) {
              existing.files.push(relPath);
              if (existing.files.length > 50) existing.files = existing.files.slice(-50);
            }
            existing.confidence = Math.min(1, existing.confidence + 0.01);
          } else {
            this.patterns.set(patternId, {
              id: patternId,
              type: category as CodePattern['type'],
              pattern: name,
              examples: matches.slice(0, 10),
              frequency: matches.length,
              confidence: Math.min(1, 0.3 + matches.length * 0.05),
              context: category,
              firstSeen: now,
              lastSeen: now,
              files: [relPath],
            });
          }

          // Update index
          if (!this.patternIndex.has(category)) {
            this.patternIndex.set(category, new Set());
          }
          this.patternIndex.get(category)!.add(patternId);
        }
      }
    }

    // Extract custom patterns from repeated structures
    this.extractCustomPatterns(filePath, content);
  }

  private extractPatternsFromContent(content: string): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();

    for (const [category, extractors] of Object.entries(PATTERN_EXTRACTORS)) {
      const matches = new Set<string>();
      for (const [_name, regex] of Object.entries(extractors)) {
        const found = content.match(regex as RegExp);
        if (found) {
          for (const m of found) matches.add(m);
        }
      }
      if (matches.size > 0) {
        result.set(category, matches);
      }
    }

    return result;
  }

  private extractCustomPatterns(filePath: string, content: string): void {
    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);

    // Detect function signature patterns
    const funcPatterns = lines.filter(l => /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+\w+/.test(l));
    for (const fp of funcPatterns.slice(0, 20)) {
      const trimmed = fp.trim();
      // Generalize: replace specific names with placeholders
      const generalized = trimmed
        .replace(/\b[a-z][a-zA-Z0-9]{2,}\b/g, '<name>')
        .replace(/['"][^'"]*['"]/g, '<string>')
        .replace(/\d+/g, '<num>');

      const patternId = `custom:func:${this.hashString(generalized)}`;
      const existing = this.patterns.get(patternId);
      if (existing) {
        existing.frequency++;
        existing.lastSeen = Date.now();
        if (!existing.files.includes(relPath)) existing.files.push(relPath);
      } else {
        this.patterns.set(patternId, {
          id: patternId,
          type: 'structure',
          pattern: generalized,
          examples: [trimmed],
          frequency: 1,
          confidence: 0.2,
          context: 'function-signature',
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          files: [relPath],
        });
      }
    }

    // Detect import ordering patterns
    const importBlock: string[] = [];
    for (const line of lines) {
      if (/^import\s/.test(line)) importBlock.push(line);
      else if (importBlock.length > 0 && line.trim() !== '') break;
    }
    if (importBlock.length >= 3) {
      const hasTypeImportFirst = importBlock[0].includes('import type');
      const hasNodeFirst = importBlock[0].includes("from 'node:") || importBlock[0].includes("from 'fs") || importBlock[0].includes("from 'path");
      const order = hasNodeFirst ? 'node-first' : hasTypeImportFirst ? 'type-first' : 'mixed';
      const patternId = `custom:import-order:${order}`;
      const existing = this.patterns.get(patternId);
      if (existing) {
        existing.frequency++;
      } else {
        this.patterns.set(patternId, {
          id: patternId,
          type: 'import',
          pattern: `import-order-${order}`,
          examples: importBlock.slice(0, 5),
          frequency: 1,
          confidence: 0.3,
          context: 'import-ordering',
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          files: [relPath],
        });
      }
    }

    // Detect error handling patterns
    const errorPatterns = content.match(/catch\s*\([^)]*\)\s*\{[^}]{0,500}\}/g);
    if (errorPatterns) {
      for (const ep of errorPatterns.slice(0, 5)) {
        const hasLogging = /console\.|logger\.|log\(/.test(ep);
        const hasRethrow = /throw\s/.test(ep);
        const hasReturn = /return\s/.test(ep);
        const isEmpty = /catch\s*\([^)]*\)\s*\{\s*\}/.test(ep);

        const style = isEmpty ? 'silent' : hasRethrow ? 'rethrow' : hasLogging ? 'log' : hasReturn ? 'return' : 'custom';
        const patternId = `custom:error-style:${style}`;
        const existing = this.patterns.get(patternId);
        if (existing) {
          existing.frequency++;
        } else {
          this.patterns.set(patternId, {
            id: patternId,
            type: 'error-handling',
            pattern: `error-${style}`,
            examples: [ep.slice(0, 200)],
            frequency: 1,
            confidence: 0.4,
            context: 'error-handling-style',
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            files: [relPath],
          });
        }
      }
    }
  }

  private reinforcePattern(type: string, pattern: string, filePath: string): void {
    const patternId = `${type}:${this.hashString(pattern).slice(0, 12)}`;
    const existing = this.patterns.get(patternId);
    if (existing) {
      existing.frequency++;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.lastSeen = Date.now();
    }
  }

  private weakenPattern(type: string, pattern: string): void {
    const patternId = `${type}:${this.hashString(pattern).slice(0, 12)}`;
    const existing = this.patterns.get(patternId);
    if (existing) {
      existing.confidence = Math.max(0, existing.confidence - 0.02);
    }
  }

  // ── Training Data Generation ──────────────────────────────────────────

  private generateTrainingData(filePath: string, content: string): void {
    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);
    const ext = path.extname(filePath);

    // Function-level training pairs (context → implementation)
    const funcRegex = /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>)/g;
    let match: RegExpExecArray | null;

    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1] || match[2];
      const startIdx = match.index;
      const funcBody = this.extractFunctionBody(content, startIdx);

      if (funcBody && funcBody.length > 50 && funcBody.length < 5000) {
        this.trainingData.push({
          input: `// Function: ${name} in ${relPath}`,
          output: funcBody,
          category: 'function-implementation',
          weight: 1.0,
          source: relPath,
        });
      }
    }

    // Comment → code pairs (doc comments preceding functions)
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].trim().startsWith('/**') || lines[i].trim().startsWith('//')) {
        let commentEnd = i;
        while (commentEnd < lines.length - 1 && (lines[commentEnd].trim().startsWith('*') || lines[commentEnd].trim().startsWith('//'))) {
          commentEnd++;
        }
        if (commentEnd < lines.length && /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|class|interface|type)/.test(lines[commentEnd])) {
          const comment = lines.slice(i, commentEnd).join('\n');
          const codeLines: string[] = [];
          for (let j = commentEnd; j < Math.min(commentEnd + 20, lines.length); j++) {
            codeLines.push(lines[j]);
            if (lines[j].trim() === '}' || lines[j].trim() === '};') break;
          }
          if (codeLines.length > 1) {
            this.trainingData.push({
              input: comment,
              output: codeLines.join('\n'),
              category: 'doc-to-code',
              weight: 1.2,
              source: relPath,
            });
          }
        }
      }
    }

    // Test pattern pairs (test name → test body)
    const testRegex = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s+)?\(\)\s*=>\s*\{/g;
    while ((match = testRegex.exec(content)) !== null) {
      const testName = match[1];
      const testBody = this.extractFunctionBody(content, match.index);
      if (testBody && testBody.length > 30) {
        this.trainingData.push({
          input: `// Test: ${testName}`,
          output: testBody.slice(0, 2000),
          category: 'test-pattern',
          weight: 1.1,
          source: relPath,
        });
      }
    }

    // Cap training data size
    if (this.trainingData.length > 10000) {
      // Keep highest-weight items
      this.trainingData.sort((a, b) => b.weight - a.weight);
      this.trainingData = this.trainingData.slice(0, 8000);
    }
  }

  private extractFunctionBody(content: string, startIdx: number): string | null {
    let braceCount = 0;
    let started = false;
    let bodyStart = startIdx;

    for (let i = startIdx; i < Math.min(startIdx + 5000, content.length); i++) {
      if (content[i] === '{') {
        if (!started) bodyStart = startIdx;
        braceCount++;
        started = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          return content.slice(bodyStart, i + 1);
        }
      }
    }
    return null;
  }

  // ── Style Rule Derivation ────────────────────────────────────────────

  private deriveStyleRules(): void {
    // Analyze patterns to create enforceable style rules
    for (const [id, pattern] of this.patterns) {
      if (pattern.frequency < 3 || pattern.confidence < 0.3) continue;

      const ruleId = `rule:${id}`;
      if (this.styleRules.has(ruleId)) continue;

      let rule: StyleRule | null = null;

      // Naming conventions
      if (pattern.type === 'naming' && pattern.pattern === 'camelCase' && pattern.frequency > 10) {
        rule = {
          id: ruleId,
          rule: 'Use camelCase for function and variable names',
          severity: 'warning',
          examples: [{ good: 'getUserById()', bad: 'get_user_by_id()' }],
          frequency: pattern.frequency,
        };
      }

      // Error handling style
      if (pattern.type === 'error-handling' && pattern.context === 'error-handling-style') {
        const style = pattern.pattern;
        if (style === 'error-silent' && pattern.frequency > 5) {
          rule = {
            id: ruleId,
            rule: 'Avoid empty catch blocks — log or handle errors',
            severity: 'warning',
            examples: [{ good: 'catch (e) { logger.error(e); }', bad: 'catch (e) { }' }],
            frequency: pattern.frequency,
          };
        }
      }

      // Import ordering
      if (pattern.type === 'import' && pattern.context === 'import-ordering') {
        rule = {
          id: ruleId,
          rule: `Import ordering: ${pattern.pattern}`,
          severity: 'info',
          examples: pattern.examples.map(e => ({ good: e, bad: '' })),
          frequency: pattern.frequency,
        };
      }

      // Async patterns
      if (pattern.type === 'async' && pattern.pattern === 'promiseAll' && pattern.frequency > 3) {
        rule = {
          id: ruleId,
          rule: 'Use Promise.all/allSettled for parallel async operations',
          severity: 'info',
          examples: [{ good: 'await Promise.all([a(), b()])', bad: 'await a(); await b();' }],
          frequency: pattern.frequency,
        };
      }

      if (rule) {
        this.styleRules.set(ruleId, rule);
      }
    }
  }

  // ── Model Building ──────────────────────────────────────────────────

  private buildModel(): FineTuneModel {
    const categories: Record<string, number> = {};
    for (const td of this.trainingData) {
      categories[td.category] = (categories[td.category] || 0) + 1;
    }

    const model: FineTuneModel = {
      id: crypto.randomUUID(),
      name: `shadow-brain-ft-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      patternCount: this.patterns.size,
      trainingPoints: this.trainingData.length,
      accuracy: this.calculateAccuracy(),
      version: this.models.size + 1,
      categories,
    };

    this.models.set(model.id, model);
    return model;
  }

  private calculateAccuracy(): number {
    if (this.patterns.size === 0) return 0;
    const totalConfidence = Array.from(this.patterns.values())
      .reduce((sum, p) => sum + p.confidence, 0);
    return Math.min(1, totalConfidence / this.patterns.size);
  }

  // ── Suggestion Generation ────────────────────────────────────────────

  suggest(context: string, type?: string): CodeSuggestion[] {
    const suggestions: CodeSuggestion[] = [];
    const contextLower = context.toLowerCase();

    for (const [_id, pattern] of this.patterns) {
      if (pattern.confidence < 0.4 || pattern.frequency < 3) continue;
      if (type && pattern.type !== type) continue;

      // Check if context is relevant to this pattern
      const relevant = pattern.files.some(f =>
        contextLower.includes(path.basename(f, path.extname(f)).toLowerCase())
      ) || pattern.examples.some(e =>
        contextLower.includes(e.slice(0, 20).toLowerCase())
      );

      if (relevant || !type) {
        suggestions.push({
          text: pattern.examples[0] || pattern.pattern,
          confidence: pattern.confidence,
          category: pattern.type,
          basedOn: pattern.files.slice(0, 3),
          reasoning: `Pattern "${pattern.pattern}" seen ${pattern.frequency} times across ${pattern.files.length} files`,
        });
      }
    }

    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  getStyleViolations(content: string): Array<{ rule: StyleRule; line: number; text: string }> {
    const violations: Array<{ rule: StyleRule; line: number; text: string }> = [];
    const lines = content.split('\n');

    for (const [_id, rule] of this.styleRules) {
      if (rule.severity === 'info') continue; // Only check warnings/errors

      for (let i = 0; i < lines.length; i++) {
        for (const example of rule.examples) {
          if (example.bad && lines[i].includes(example.bad)) {
            violations.push({ rule, line: i + 1, text: lines[i].trim() });
          }
        }
      }
    }

    return violations;
  }

  getPatternsByType(type: CodePattern['type']): CodePattern[] {
    const ids = this.patternIndex.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.patterns.get(id))
      .filter((p): p is CodePattern => p !== undefined)
      .sort((a, b) => b.frequency - a.frequency);
  }

  getTopPatterns(n: number = 20): CodePattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.frequency * b.confidence - a.frequency * a.confidence)
      .slice(0, n);
  }

  getStyleRules(): StyleRule[] {
    return Array.from(this.styleRules.values());
  }

  // ── File Collection ──────────────────────────────────────────────────

  private async collectSourceFiles(dir: string, maxFiles: number = 500): Promise<string[]> {
    const files: string[] = [];
    const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.vue', '.svelte']);
    const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '__pycache__', '.shadow-brain', 'vendor']);

    const walk = (currentDir: string, depth: number): void => {
      if (depth > 8 || files.length >= maxFiles) return;

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= maxFiles) break;

          if (entry.isDirectory()) {
            if (!ignore.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(currentDir, entry.name), depth + 1);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (extensions.has(ext)) {
              files.push(path.join(currentDir, entry.name));
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    walk(dir, 0);
    return files;
  }

  // ── Persistence ──────────────────────────────────────────────────────

  async save(): Promise<void> {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const data = {
        patterns: Array.from(this.patterns.entries()),
        trainingData: this.trainingData.slice(0, 5000), // Cap for disk
        models: Array.from(this.models.entries()),
        styleRules: Array.from(this.styleRules.entries()),
        lastTrainingRun: this.lastTrainingRun,
      };

      fs.writeFileSync(
        path.join(this.dataDir, 'model.json'),
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch {
      // Best-effort save
    }
  }

  async load(): Promise<void> {
    try {
      const dataPath = path.join(this.dataDir, 'model.json');
      if (!fs.existsSync(dataPath)) return;

      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

      if (raw.patterns) this.patterns = new Map(raw.patterns);
      if (raw.trainingData) this.trainingData = raw.trainingData;
      if (raw.models) this.models = new Map(raw.models);
      if (raw.styleRules) this.styleRules = new Map(raw.styleRules);
      if (raw.lastTrainingRun) this.lastTrainingRun = raw.lastTrainingRun;

      // Rebuild index
      this.patternIndex.clear();
      for (const [id, pattern] of this.patterns) {
        if (!this.patternIndex.has(pattern.type)) {
          this.patternIndex.set(pattern.type, new Set());
        }
        this.patternIndex.get(pattern.type)!.add(id);
      }
    } catch {
      // Start fresh
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────

  stats(): FineTuneStats {
    const categories: Record<string, number> = {};
    for (const p of this.patterns.values()) {
      categories[p.type] = (categories[p.type] || 0) + 1;
    }

    const typeCounts = new Map<string, number>();
    for (const p of this.patterns.values()) {
      typeCounts.set(p.type, (typeCounts.get(p.type) || 0) + p.frequency);
    }

    const topPatterns = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const rawSize = JSON.stringify(Array.from(this.patterns.values())).length;

    return {
      totalPatterns: this.patterns.size,
      totalTrainingPoints: this.trainingData.length,
      models: this.models.size,
      categories,
      topPatterns,
      lastTrainingRun: this.lastTrainingRun,
      accuracy: this.calculateAccuracy(),
      memoryUsageMB: Number((rawSize / (1024 * 1024)).toFixed(2)),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private hashString(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  }
}
