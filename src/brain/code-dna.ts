// src/brain/code-dna.ts — Code DNA fingerprinting for style analysis
// v6.0.0 — Codebase style genome extraction

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CodeGene {
  trait: string;
  value: number;  // 0-1 normalized
  samples: number;
  category: GeneCategory;
}

export type GeneCategory =
  | 'formatting' | 'naming' | 'structure' | 'complexity'
  | 'documentation' | 'error-handling' | 'testing' | 'imports'
  | 'typing' | 'async-patterns' | 'functional' | 'oop';

export interface DNAProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  genes: Map<string, CodeGene>;
  fingerprint: string;
  fileCount: number;
  totalLines: number;
  language: string;
  similarity: number; // Self-consistency score 0-1
}

export interface DNAComparison {
  similarity: number; // 0-1
  matchingGenes: string[];
  divergingGenes: Array<{ gene: string; profileA: number; profileB: number; delta: number }>;
  verdict: 'same-team' | 'similar-style' | 'different-style' | 'inconsistent';
}

export interface StyleConsistencyReport {
  overall: number; // 0-1
  fileScores: Array<{ file: string; score: number; violations: string[] }>;
  topViolations: Array<{ gene: string; expected: number; actual: number; files: string[] }>;
  recommendations: string[];
}

export interface CodeDNAStats {
  profiles: number;
  totalGenes: number;
  avgConsistency: number;
  dominantStyle: Record<string, number>;
  language: string;
}

// ── Gene Extractors ────────────────────────────────────────────────────────

interface GeneExtractor {
  name: string;
  category: GeneCategory;
  extract: (content: string, lines: string[]) => number; // returns 0-1
}

const GENE_EXTRACTORS: GeneExtractor[] = [
  // Formatting genes
  {
    name: 'indent-spaces',
    category: 'formatting',
    extract: (_content, lines) => {
      const indented = lines.filter(l => /^\s+/.test(l));
      if (indented.length === 0) return 0.5;
      const spaces = indented.filter(l => /^ /.test(l)).length;
      return spaces / indented.length;
    },
  },
  {
    name: 'indent-size',
    category: 'formatting',
    extract: (_content, lines) => {
      const indentSizes: number[] = [];
      for (const line of lines) {
        const match = line.match(/^( +)/);
        if (match && match[1].length <= 8) indentSizes.push(match[1].length);
      }
      if (indentSizes.length === 0) return 0.5;
      const avg = indentSizes.reduce((s, v) => s + v, 0) / indentSizes.length;
      return Math.min(1, avg / 8); // Normalize: 2 spaces=0.25, 4=0.5, 8=1.0
    },
  },
  {
    name: 'semicolons',
    category: 'formatting',
    extract: (content) => {
      const statements = (content.match(/[^;{}\n]\s*$/gm) || []).length;
      const withSemicolons = (content.match(/;\s*$/gm) || []).length;
      const total = statements + withSemicolons;
      return total > 0 ? withSemicolons / total : 0.5;
    },
  },
  {
    name: 'single-quotes',
    category: 'formatting',
    extract: (content) => {
      const singles = (content.match(/'/g) || []).length;
      const doubles = (content.match(/(?<!=)"(?!=)/g) || []).length;
      const total = singles + doubles;
      return total > 0 ? singles / total : 0.5;
    },
  },
  {
    name: 'trailing-comma',
    category: 'formatting',
    extract: (content) => {
      const commaBeforeClose = (content.match(/,\s*[\]})\n]/g) || []).length;
      const noCommaBeforeClose = (content.match(/[^,\s]\s*[\]})\n]/g) || []).length;
      const total = commaBeforeClose + noCommaBeforeClose;
      return total > 0 ? commaBeforeClose / total : 0.5;
    },
  },
  {
    name: 'avg-line-length',
    category: 'formatting',
    extract: (_content, lines) => {
      const nonEmpty = lines.filter(l => l.trim().length > 0);
      if (nonEmpty.length === 0) return 0.5;
      const avg = nonEmpty.reduce((s, l) => s + l.length, 0) / nonEmpty.length;
      return Math.min(1, avg / 120); // Normalize to 120 char max
    },
  },

  // Naming genes
  {
    name: 'camel-case-ratio',
    category: 'naming',
    extract: (content) => {
      const camel = (content.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || []).length;
      const snake = (content.match(/\b[a-z][a-z0-9]*_[a-z][a-z0-9]*\b/g) || []).length;
      const total = camel + snake;
      return total > 0 ? camel / total : 0.5;
    },
  },
  {
    name: 'prefix-bool',
    category: 'naming',
    extract: (content) => {
      const boolNames = (content.match(/\b(?:is|has|can|should|will|did|was)\w+/g) || []).length;
      const allVars = (content.match(/(?:const|let|var)\s+\w+/g) || []).length;
      return allVars > 0 ? Math.min(1, boolNames / (allVars * 0.2)) : 0.5;
    },
  },
  {
    name: 'constant-naming',
    category: 'naming',
    extract: (content) => {
      const screaming = (content.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []).length;
      const allConst = (content.match(/const\s+\w+/g) || []).length;
      return allConst > 0 ? Math.min(1, screaming / (allConst * 0.3)) : 0.5;
    },
  },

  // Structure genes
  {
    name: 'arrow-fn-ratio',
    category: 'structure',
    extract: (content) => {
      const arrow = (content.match(/=>/g) || []).length;
      const regular = (content.match(/function\s+\w+/g) || []).length;
      const total = arrow + regular;
      return total > 0 ? arrow / total : 0.5;
    },
  },
  {
    name: 'destructuring-usage',
    category: 'structure',
    extract: (content) => {
      const destructured = (content.match(/(?:const|let)\s*\{[^}]+\}\s*=/g) || []).length;
      const allDecl = (content.match(/(?:const|let|var)\s+\w+/g) || []).length;
      return allDecl > 0 ? Math.min(1, destructured / (allDecl * 0.3)) : 0;
    },
  },
  {
    name: 'optional-chaining',
    category: 'structure',
    extract: (content) => {
      const optChain = (content.match(/\?\./g) || []).length;
      const dotAccess = (content.match(/\.\w+/g) || []).length;
      return dotAccess > 0 ? Math.min(1, optChain / (dotAccess * 0.1)) : 0;
    },
  },
  {
    name: 'spread-usage',
    category: 'structure',
    extract: (content) => {
      const spreads = (content.match(/\.{3}\w+/g) || []).length;
      return Math.min(1, spreads / 20);
    },
  },
  {
    name: 'export-style',
    category: 'structure',
    extract: (content) => {
      const named = (content.match(/export\s+(?:const|function|class|interface|type|enum)/g) || []).length;
      const defaultExport = (content.match(/export\s+default/g) || []).length;
      const total = named + defaultExport;
      return total > 0 ? named / total : 0.5; // 1 = all named, 0 = all default
    },
  },

  // Complexity genes
  {
    name: 'avg-fn-length',
    category: 'complexity',
    extract: (_content, lines) => {
      let fnCount = 0;
      let totalFnLines = 0;
      let depth = 0;
      let inFn = false;
      let fnStart = 0;

      for (let i = 0; i < lines.length; i++) {
        if (/(?:function|=>)\s*\{/.test(lines[i]) || /(?:function|=>)/.test(lines[i])) {
          if (!inFn) { inFn = true; fnStart = i; }
        }
        for (const ch of lines[i]) {
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth === 0 && inFn) { fnCount++; totalFnLines += i - fnStart; inFn = false; } }
        }
      }
      if (fnCount === 0) return 0.5;
      const avg = totalFnLines / fnCount;
      return Math.min(1, avg / 50); // Normalize to 50 lines
    },
  },
  {
    name: 'nesting-depth',
    category: 'complexity',
    extract: (_content, lines) => {
      let maxDepth = 0;
      let currentDepth = 0;
      for (const line of lines) {
        for (const ch of line) {
          if (ch === '{') { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
          if (ch === '}') currentDepth--;
        }
      }
      return Math.min(1, maxDepth / 8);
    },
  },

  // Documentation genes
  {
    name: 'jsdoc-coverage',
    category: 'documentation',
    extract: (content) => {
      const jsdocs = (content.match(/\/\*\*[\s\S]*?\*\//g) || []).length;
      const functions = (content.match(/(?:function|=>|class)\s/g) || []).length;
      return functions > 0 ? Math.min(1, jsdocs / functions) : 0;
    },
  },
  {
    name: 'inline-comments',
    category: 'documentation',
    extract: (_content, lines) => {
      const comments = lines.filter(l => /^\s*\/\//.test(l)).length;
      return lines.length > 0 ? Math.min(1, comments / (lines.length * 0.15)) : 0;
    },
  },

  // Error handling genes
  {
    name: 'try-catch-density',
    category: 'error-handling',
    extract: (content, lines) => {
      const tryCatch = (content.match(/try\s*\{/g) || []).length;
      return lines.length > 0 ? Math.min(1, tryCatch / (lines.length * 0.02)) : 0;
    },
  },
  {
    name: 'custom-errors',
    category: 'error-handling',
    extract: (content) => {
      const customErr = (content.match(/class\s+\w+Error\s+extends/g) || []).length;
      return Math.min(1, customErr / 3);
    },
  },

  // Typing genes
  {
    name: 'type-annotation-density',
    category: 'typing',
    extract: (content) => {
      const typeAnnotations = (content.match(/:\s*(?:string|number|boolean|any|unknown|void|never|null|undefined|\w+(?:<[^>]+>)?)\b/g) || []).length;
      const variables = (content.match(/(?:const|let|var|param|return)\s/g) || []).length;
      return variables > 0 ? Math.min(1, typeAnnotations / variables) : 0.5;
    },
  },
  {
    name: 'generic-usage',
    category: 'typing',
    extract: (content) => {
      const generics = (content.match(/<\s*[A-Z]\w*(?:\s*(?:extends|=)[^>]+)?>/g) || []).length;
      return Math.min(1, generics / 10);
    },
  },

  // Async patterns
  {
    name: 'async-await-ratio',
    category: 'async-patterns',
    extract: (content) => {
      const awaits = (content.match(/await\s/g) || []).length;
      const thenChains = (content.match(/\.then\s*\(/g) || []).length;
      const total = awaits + thenChains;
      return total > 0 ? awaits / total : 0.5;
    },
  },

  // Functional vs OOP
  {
    name: 'functional-style',
    category: 'functional',
    extract: (content) => {
      const funcPatterns = (content.match(/\.map\(|\.filter\(|\.reduce\(|\.flatMap\(|\.some\(|\.every\(|\.find\(/g) || []).length;
      const imperativePatterns = (content.match(/for\s*\(|while\s*\(|\.forEach\(/g) || []).length;
      const total = funcPatterns + imperativePatterns;
      return total > 0 ? funcPatterns / total : 0.5;
    },
  },
  {
    name: 'class-usage',
    category: 'oop',
    extract: (content) => {
      const classes = (content.match(/\bclass\s+\w+/g) || []).length;
      const functions = (content.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\()/g) || []).length;
      const total = classes + functions;
      return total > 0 ? classes / total : 0.5;
    },
  },
];

// ── Code DNA Engine ────────────────────────────────────────────────────────

export class CodeDNA {
  private profiles: Map<string, DNAProfile> = new Map();
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  // ── Profile Building ────────────────────────────────────────────────

  async buildProfile(name?: string, dir?: string): Promise<DNAProfile> {
    const targetDir = dir || this.projectDir;
    const profileName = name || path.basename(targetDir);
    const files = this.collectSourceFiles(targetDir);

    const genes = new Map<string, CodeGene>();
    let totalLines = 0;

    // Initialize genes
    for (const extractor of GENE_EXTRACTORS) {
      genes.set(extractor.name, {
        trait: extractor.name,
        value: 0,
        samples: 0,
        category: extractor.category,
      });
    }

    // Extract genes from each file
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        totalLines += lines.length;

        for (const extractor of GENE_EXTRACTORS) {
          const value = extractor.extract(content, lines);
          const gene = genes.get(extractor.name)!;
          // Running average
          gene.value = (gene.value * gene.samples + value) / (gene.samples + 1);
          gene.samples++;
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Detect dominant language
    const language = this.detectLanguage(files);

    // Calculate fingerprint
    const geneValues = Array.from(genes.values()).map(g => g.value.toFixed(3)).join(':');
    const fingerprint = crypto.createHash('sha256').update(geneValues).digest('hex').slice(0, 16);

    // Calculate self-consistency
    const similarity = this.calculateConsistency(genes);

    const profile: DNAProfile = {
      id: crypto.randomUUID(),
      name: profileName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      genes,
      fingerprint,
      fileCount: files.length,
      totalLines,
      language,
      similarity,
    };

    this.profiles.set(profile.id, profile);
    return profile;
  }

  analyzeFile(filePath: string, content: string): Map<string, number> {
    const lines = content.split('\n');
    const result = new Map<string, number>();

    for (const extractor of GENE_EXTRACTORS) {
      result.set(extractor.name, extractor.extract(content, lines));
    }

    return result;
  }

  // ── Comparison ──────────────────────────────────────────────────────

  compare(profileA: DNAProfile, profileB: DNAProfile): DNAComparison {
    const matchingGenes: string[] = [];
    const divergingGenes: DNAComparison['divergingGenes'] = [];
    let totalSimilarity = 0;
    let geneCount = 0;

    for (const [name, geneA] of profileA.genes) {
      const geneB = profileB.genes.get(name);
      if (!geneB) continue;

      const delta = Math.abs(geneA.value - geneB.value);
      geneCount++;

      if (delta < 0.15) {
        matchingGenes.push(name);
        totalSimilarity += 1 - delta;
      } else {
        divergingGenes.push({
          gene: name,
          profileA: geneA.value,
          profileB: geneB.value,
          delta,
        });
        totalSimilarity += 1 - delta;
      }
    }

    const similarity = geneCount > 0 ? totalSimilarity / geneCount : 0;
    divergingGenes.sort((a, b) => b.delta - a.delta);

    let verdict: DNAComparison['verdict'];
    if (similarity >= 0.85) verdict = 'same-team';
    else if (similarity >= 0.65) verdict = 'similar-style';
    else if (similarity >= 0.4) verdict = 'different-style';
    else verdict = 'inconsistent';

    return { similarity, matchingGenes, divergingGenes, verdict };
  }

  compareFileToProfile(filePath: string, content: string, profileId: string): DNAComparison | null {
    const profile = this.profiles.get(profileId);
    if (!profile) return null;

    const fileGenes = this.analyzeFile(filePath, content);
    const fileProfile: DNAProfile = {
      id: 'temp',
      name: path.basename(filePath),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      genes: new Map(),
      fingerprint: '',
      fileCount: 1,
      totalLines: content.split('\n').length,
      language: path.extname(filePath).slice(1),
      similarity: 1,
    };

    for (const [name, value] of fileGenes) {
      const extractor = GENE_EXTRACTORS.find(e => e.name === name);
      if (extractor) {
        fileProfile.genes.set(name, {
          trait: name,
          value,
          samples: 1,
          category: extractor.category,
        });
      }
    }

    return this.compare(profile, fileProfile);
  }

  // ── Style Consistency ───────────────────────────────────────────────

  async checkConsistency(dir?: string): Promise<StyleConsistencyReport> {
    const targetDir = dir || this.projectDir;
    const files = this.collectSourceFiles(targetDir);

    // First build the overall profile
    const profile = await this.buildProfile('consistency-check', targetDir);

    const fileScores: StyleConsistencyReport['fileScores'] = [];
    const geneViolations = new Map<string, { expected: number; actuals: number[]; files: string[] }>();

    for (const file of files.slice(0, 200)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const fileGenes = this.analyzeFile(file, content);
        const violations: string[] = [];
        let scoreSum = 0;
        let scoreCount = 0;

        for (const [name, value] of fileGenes) {
          const profileGene = profile.genes.get(name);
          if (!profileGene || profileGene.samples < 3) continue;

          const delta = Math.abs(value - profileGene.value);
          scoreSum += 1 - delta;
          scoreCount++;

          if (delta > 0.3) {
            violations.push(`${name}: expected ~${profileGene.value.toFixed(2)}, got ${value.toFixed(2)}`);

            if (!geneViolations.has(name)) {
              geneViolations.set(name, { expected: profileGene.value, actuals: [], files: [] });
            }
            const gv = geneViolations.get(name)!;
            gv.actuals.push(value);
            gv.files.push(path.relative(this.projectDir, file));
          }
        }

        const score = scoreCount > 0 ? scoreSum / scoreCount : 1;
        fileScores.push({
          file: path.relative(this.projectDir, file),
          score,
          violations,
        });
      } catch {
        // Skip
      }
    }

    const topViolations = Array.from(geneViolations.entries())
      .map(([gene, data]) => ({
        gene,
        expected: data.expected,
        actual: data.actuals.reduce((s, v) => s + v, 0) / data.actuals.length,
        files: data.files.slice(0, 5),
      }))
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 10);

    const overall = fileScores.length > 0
      ? fileScores.reduce((s, f) => s + f.score, 0) / fileScores.length
      : 1;

    const recommendations = this.generateRecommendations(topViolations, profile);

    return { overall, fileScores, topViolations, recommendations };
  }

  private generateRecommendations(violations: StyleConsistencyReport['topViolations'], profile: DNAProfile): string[] {
    const recs: string[] = [];

    for (const v of violations.slice(0, 5)) {
      switch (v.gene) {
        case 'semicolons':
          recs.push(v.expected > 0.7 ? 'Enforce semicolons consistently across all files' : 'Consider removing semicolons to match project style');
          break;
        case 'single-quotes':
          recs.push(v.expected > 0.7 ? 'Use single quotes consistently' : 'Use double quotes consistently');
          break;
        case 'indent-size':
          recs.push(`Standardize indentation to ${Math.round(v.expected * 8)} spaces`);
          break;
        case 'arrow-fn-ratio':
          recs.push(v.expected > 0.7 ? 'Prefer arrow functions over function declarations' : 'Use function declarations for consistency');
          break;
        case 'jsdoc-coverage':
          recs.push('Improve JSDoc coverage to match project standard');
          break;
        case 'try-catch-density':
          recs.push('Add more error handling to match project patterns');
          break;
        case 'type-annotation-density':
          recs.push('Add more type annotations for consistency');
          break;
        default:
          recs.push(`Standardize ${v.gene} across the codebase`);
      }
    }

    return recs;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private calculateConsistency(genes: Map<string, CodeGene>): number {
    // Consistency = how close gene values are to 0 or 1 (strong preference vs mixed)
    let totalClarity = 0;
    let count = 0;

    for (const gene of genes.values()) {
      if (gene.samples < 2) continue;
      // Distance from 0.5 (ambiguous) — higher = more consistent
      const clarity = Math.abs(gene.value - 0.5) * 2; // 0-1
      totalClarity += clarity;
      count++;
    }

    return count > 0 ? totalClarity / count : 0.5;
  }

  private collectSourceFiles(dir: string, maxFiles: number = 300): string[] {
    const files: string[] = [];
    const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.vue', '.svelte']);
    const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor']);

    const walk = (d: string, depth: number): void => {
      if (depth > 6 || files.length >= maxFiles) return;
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= maxFiles) break;
          if (entry.isDirectory() && !ignore.has(entry.name) && !entry.name.startsWith('.')) {
            walk(path.join(d, entry.name), depth + 1);
          } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
            files.push(path.join(d, entry.name));
          }
        }
      } catch { /* skip */ }
    };

    walk(dir, 0);
    return files;
  }

  private detectLanguage(files: string[]): string {
    const extCount = new Map<string, number>();
    for (const file of files) {
      const ext = path.extname(file);
      extCount.set(ext, (extCount.get(ext) || 0) + 1);
    }
    let maxExt = '.ts';
    let maxCount = 0;
    for (const [ext, count] of extCount) {
      if (count > maxCount) { maxExt = ext; maxCount = count; }
    }
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
      '.rb': 'ruby', '.vue': 'vue', '.svelte': 'svelte',
    };
    return langMap[maxExt] || 'unknown';
  }

  getProfile(id: string): DNAProfile | undefined {
    return this.profiles.get(id);
  }

  getAllProfiles(): DNAProfile[] {
    return Array.from(this.profiles.values());
  }

  stats(): CodeDNAStats {
    const profiles = Array.from(this.profiles.values());
    const totalGenes = profiles.reduce((s, p) => s + p.genes.size, 0);
    const avgConsistency = profiles.length > 0
      ? profiles.reduce((s, p) => s + p.similarity, 0) / profiles.length
      : 0;

    const dominantStyle: Record<string, number> = {};
    for (const profile of profiles) {
      for (const [name, gene] of profile.genes) {
        if (gene.samples >= 3) {
          dominantStyle[name] = gene.value;
        }
      }
    }

    return {
      profiles: profiles.length,
      totalGenes,
      avgConsistency,
      dominantStyle,
      language: profiles[0]?.language || 'unknown',
    };
  }
}
