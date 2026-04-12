// src/brain/code-metrics.ts — Code metrics: LOC, complexity, language breakdown, churn

import { CodeMetrics, FileChange } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
  '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C', '.cpp': 'C++', '.h': 'C/C++',
  '.cs': 'C#', '.php': 'PHP', '.scala': 'Scala', '.r': 'R', '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Shell', '.ps1': 'PowerShell',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.less': 'LESS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.md': 'Markdown', '.vue': 'Vue', '.svelte': 'Svelte',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.tox',
  'venv', '.venv', 'env', '.env', 'bin', 'obj', 'Pods', '.gradle',
]);

export class CodeMetricsEngine {
  private projectDir: string;
  private excludePaths: string[];
  private complexityThreshold: number;

  constructor(projectDir: string, opts?: { excludePaths?: string[]; complexityThreshold?: number }) {
    this.projectDir = projectDir;
    this.excludePaths = opts?.excludePaths || [];
    this.complexityThreshold = opts?.complexityThreshold || 15;
  }

  compute(changes?: FileChange[]): CodeMetrics {
    const files = this.walkDir(this.projectDir);
    const languages: Record<string, { files: number; lines: number; percentage: number }> = {};
    const fileTypes: Record<string, number> = {};
    const largestFiles: Array<{ path: string; lines: number }> = [];
    const complexityHotspots: Array<{ path: string; complexity: number; functions: number }> = [];

    let totalLines = 0;
    let codeLines = 0;
    let commentLines = 0;
    let blankLines = 0;

    for (const filePath of files) {
      const ext = path.extname(filePath);
      const lang = LANGUAGE_MAP[ext] || 'Other';
      const relPath = path.relative(this.projectDir, filePath);

      fileTypes[ext] = (fileTypes[ext] || 0) + 1;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const lineCount = lines.length;

        // Classify lines
        let fileCodeLines = 0;
        let fileCommentLines = 0;
        let fileBlankLines = 0;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') { fileBlankLines++; continue; }
          if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') ||
              trimmed.startsWith('*') || trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            fileCommentLines++;
          } else {
            fileCodeLines++;
          }
        }

        totalLines += lineCount;
        codeLines += fileCodeLines;
        commentLines += fileCommentLines;
        blankLines += fileBlankLines;

        // Track language stats
        if (!languages[lang]) languages[lang] = { files: 0, lines: 0, percentage: 0 };
        languages[lang].files++;
        languages[lang].lines += lineCount;

        // Track largest files
        largestFiles.push({ path: relPath, lines: lineCount });

        // Estimate complexity for code files
        if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rs'].includes(ext)) {
          const complexity = this.estimateComplexity(content);
          const functions = this.countFunctions(content);
          if (complexity >= this.complexityThreshold) {
            complexityHotspots.push({ path: relPath, complexity, functions });
          }
        }
      } catch { /* binary or unreadable file */ }
    }

    // Calculate percentages
    for (const lang of Object.values(languages)) {
      lang.percentage = totalLines > 0 ? Math.round((lang.lines / totalLines) * 100) : 0;
    }

    // Sort largest files
    largestFiles.sort((a, b) => b.lines - a.lines);
    complexityHotspots.sort((a, b) => b.complexity - a.complexity);

    return {
      totalFiles: files.length,
      totalLines,
      codeLines,
      commentLines,
      blankLines,
      languages,
      largestFiles: largestFiles.slice(0, 20),
      complexityHotspots: complexityHotspots.slice(0, 10),
      fileTypes,
      avgFileSize: files.length > 0 ? Math.round(totalLines / files.length) : 0,
      timestamp: new Date(),
    };
  }

  private walkDir(dir: string, depth = 0): string[] {
    if (depth > 6) return [];
    const files: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          if (this.excludePaths.some(p => fullPath.includes(p))) continue;
          files.push(...this.walkDir(fullPath, depth + 1));
        } else if (entry.isFile()) {
          // Skip binary files
          const ext = path.extname(entry.name);
          if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
               '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.gz', '.tar', '.exe',
               '.dll', '.so', '.dylib', '.pyc', '.class', '.o', '.obj'].includes(ext)) {
            continue;
          }
          files.push(fullPath);
        }
      }
    } catch { /* permission error */ }

    return files;
  }

  private estimateComplexity(content: string): number {
    // Cyclomatic complexity estimation: count decision points
    const decisionPatterns = [
      /\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g,
      /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?\?/g,
      /\?\./g, /\bawait\b/g,
    ];
    let complexity = 1;
    for (const pattern of decisionPatterns) {
      const matches = content.match(pattern);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }

  private countFunctions(content: string): number {
    const patterns = [
      /function\s+\w+/g,
      /const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,
      /(?:async\s+)?\w+\s*\([^)]*\)\s*:\s*\w+/g,
      /def\s+\w+/g,
      /func\s+\w+/g,
      /fn\s+\w+/g,
      /public\s+\w+\s+\w+\s*\(/g,
      /private\s+\w+\s+\w+\s*\(/g,
    ];
    let count = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  formatConsole(metrics: CodeMetrics): string {
    let out = `\n  Code Metrics — ${metrics.totalFiles} files, ${metrics.totalLines.toLocaleString()} lines\n`;
    out += `  ${'─'.repeat(55)}\n\n`;

    out += `  Code:       ${metrics.codeLines.toLocaleString().padStart(8)} lines\n`;
    out += `  Comments:   ${metrics.commentLines.toLocaleString().padStart(8)} lines\n`;
    out += `  Blank:      ${metrics.blankLines.toLocaleString().padStart(8)} lines\n`;
    out += `  Avg/ file:  ${metrics.avgFileSize.toLocaleString().padStart(8)} lines\n`;

    out += `\n  Languages:\n`;
    const sortedLangs = Object.entries(metrics.languages)
      .sort((a, b) => b[1].lines - a[1].lines)
      .slice(0, 8);
    for (const [lang, data] of sortedLangs) {
      const bar = '█'.repeat(Math.round(data.percentage / 5)) + '░'.repeat(Math.max(0, 20 - Math.round(data.percentage / 5)));
      out += `    ${lang.padEnd(12)} ${bar} ${data.percentage}% (${data.files} files)\n`;
    }

    if (metrics.largestFiles.length > 0) {
      out += `\n  Largest files:\n`;
      for (const f of metrics.largestFiles.slice(0, 5)) {
        out += `    ${f.lines.toLocaleString().padStart(6)} lines  ${f.path}\n`;
      }
    }

    if (metrics.complexityHotspots.length > 0) {
      out += `\n  Complexity hotspots (>${this.complexityThreshold}):\n`;
      for (const f of metrics.complexityHotspots.slice(0, 5)) {
        out += `    complexity ${String(f.complexity).padStart(4)}  ${f.functions} functions  ${f.path}\n`;
      }
    }

    return out;
  }

  formatJSON(metrics: CodeMetrics): string {
    return JSON.stringify(metrics, null, 2);
  }

  toMarkdown(metrics: CodeMetrics): string {
    let md = `# Code Metrics\n\n`;
    md += `| Metric | Value |\n|---|---|\n`;
    md += `| Total files | ${metrics.totalFiles} |\n`;
    md += `| Total lines | ${metrics.totalLines.toLocaleString()} |\n`;
    md += `| Code lines | ${metrics.codeLines.toLocaleString()} |\n`;
    md += `| Comment lines | ${metrics.commentLines.toLocaleString()} |\n`;
    md += `| Avg file size | ${metrics.avgFileSize} lines |\n\n`;

    md += `## Languages\n\n| Language | Files | Lines | % |\n|---|---|---|---|\n`;
    for (const [lang, data] of Object.entries(metrics.languages).sort((a, b) => b[1].lines - a[1].lines).slice(0, 10)) {
      md += `| ${lang} | ${data.files} | ${data.lines.toLocaleString()} | ${data.percentage}% |\n`;
    }

    if (metrics.complexityHotspots.length > 0) {
      md += `\n## Complexity Hotspots\n\n| File | Complexity | Functions |\n|---|---|---|\n`;
      for (const f of metrics.complexityHotspots) {
        md += `| ${f.path} | ${f.complexity} | ${f.functions} |\n`;
      }
    }

    return md;
  }
}