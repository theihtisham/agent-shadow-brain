// src/brain/project-context.ts — Builds project context for analysis

import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { FileChange, ProjectContext } from '../types.js';

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.py': 'Python', '.pyi': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.dart': 'Dart',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++',
  '.c': 'C',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'CSS', '.less': 'CSS',
  '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.md': 'Markdown',
  '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.lua': 'Lua',
  '.r': 'R', '.R': 'R',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', '.idea', '.vscode',
  'vendor', '.cache', '.turbo', '.vercel',
]);

export class ProjectContextBuilder {
  private projectDir: string;
  private cache: { context: ProjectContext | null; timestamp: number } = { context: null, timestamp: 0 };
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  invalidateCache(): void {
    this.cache = { context: null, timestamp: 0 };
  }

  async build(changes: FileChange[]): Promise<ProjectContext> {
    const now = Date.now();
    if (this.cache.context && now - this.cache.timestamp < this.CACHE_TTL) {
      return { ...this.cache.context, recentChanges: changes };
    }

    const context: ProjectContext = {
      name: path.basename(this.projectDir),
      rootDir: this.projectDir,
      language: this.detectLanguages(),
      framework: this.detectFramework(),
      packageManager: this.detectPackageManager(),
      structure: this.getStructure(),
      recentChanges: changes,
      ...(await this.getGitInfo()),
    };

    this.cache = { context, timestamp: now };
    return context;
  }

  private detectLanguages(): string[] {
    const counts: Record<string, number> = {};

    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              walk(path.join(dir, entry.name), depth + 1);
            }
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            const lang = EXTENSION_MAP[ext];
            if (lang) counts[lang] = (counts[lang] || 0) + 1;
          }
        }
      } catch { /* permission */ }
    };

    walk(this.projectDir, 0);

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([lang]) => lang);
  }

  private detectFramework(): string | undefined {
    const root = this.projectDir;

    const checks: Array<[string, string]> = [
      ['next.config.js', 'Next.js'], ['next.config.mjs', 'Next.js'], ['next.config.ts', 'Next.js'],
      ['nuxt.config.js', 'Nuxt'], ['nuxt.config.ts', 'Nuxt'],
      ['angular.json', 'Angular'],
      ['vue.config.js', 'Vue'],
      ['svelte.config.js', 'Svelte'],
      ['manage.py', 'Django'],
      ['Cargo.toml', 'Rust'],
      ['go.mod', 'Go'],
      ['pubspec.yaml', 'Flutter'],
      ['Gemfile', 'Ruby on Rails'],
    ];

    for (const [file, framework] of checks) {
      if (fs.existsSync(path.join(root, file))) return framework;
    }

    // Check package.json for framework deps
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['next']) return 'Next.js';
        if (deps['nuxt']) return 'Nuxt';
        if (deps['@angular/core']) return 'Angular';
        if (deps['vue']) return 'Vue';
        if (deps['svelte']) return 'Svelte';
        if (deps['react']) return 'React';
        if (deps['express']) return 'Express';
        if (deps['fastify']) return 'Fastify';
        if (deps['@nestjs/core']) return 'NestJS';
        if (deps['ink']) return 'Ink CLI';
      } catch { /* skip */ }
    }

    // Check for Django via directory
    if (fs.existsSync(path.join(root, 'django')) || fs.existsSync(path.join(root, 'config', 'settings.py'))) {
      return 'Django';
    }

    // Check requirements.txt for Flask
    const reqPath = path.join(root, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        const req = fs.readFileSync(reqPath, 'utf-8');
        if (req.includes('flask') || req.includes('Flask')) return 'Flask';
        if (req.includes('fastapi') || req.includes('FastAPI')) return 'FastAPI';
        if (req.includes('django') || req.includes('Django')) return 'Django';
      } catch { /* skip */ }
    }

    return undefined;
  }

  private detectPackageManager(): string | undefined {
    const root = this.projectDir;
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(root, 'poetry.lock'))) return 'poetry';
    if (fs.existsSync(path.join(root, 'Pipfile'))) return 'pipenv';
    if (fs.existsSync(path.join(root, 'Cargo.lock'))) return 'cargo';
    return undefined;
  }

  private getStructure(): string[] {
    const entries: string[] = [];
    const MAX_ENTRIES = 100;

    const walk = (dir: string, depth: number, prefix: string) => {
      if (entries.length >= MAX_ENTRIES || depth > 3) return;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of items) {
          if (entries.length >= MAX_ENTRIES) break;
          if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          entries.push(rel);

          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), depth + 1, rel);
          }
        }
      } catch { /* permission */ }
    };

    walk(this.projectDir, 0, '');
    return entries;
  }

  private async getGitInfo(): Promise<{ gitBranch?: string; gitStatus?: string }> {
    try {
      const git: SimpleGit = simpleGit(this.projectDir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return {};

      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const status = await git.status();

      const parts: string[] = [];
      if (status.staged.length) parts.push(`${status.staged.length} staged`);
      if (status.modified.length) parts.push(`${status.modified.length} modified`);
      if (status.not_added.length) parts.push(`${status.not_added.length} untracked`);

      return {
        gitBranch: branch.trim(),
        gitStatus: parts.join(', ') || 'clean',
      };
    } catch {
      return {};
    }
  }
}
