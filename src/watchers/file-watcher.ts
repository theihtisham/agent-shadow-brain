// src/watchers/file-watcher.ts — Watches project files for changes in real-time

import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { FileChange } from '../types.js';
import { diffLines } from 'diff';

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectDir: string;
  private fileCache: Map<string, string> = new Map();
  private changeQueue: FileChange[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private ignorePatterns: string[];

  constructor(projectDir: string) {
    super();
    this.projectDir = projectDir;
    this.ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/__pycache__/**',
      '**/*.pyc',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/.next/**',
      '**/.nuxt/**',
      '**/coverage/**',
      '**/.shadow-brain/**',
    ];
  }

  async start(): Promise<void> {
    // Pre-cache existing files
    await this.cacheExistingFiles();

    this.watcher = chokidar.watch(this.projectDir, {
      ignored: this.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher
      .on('add', (filePath: string) => this.handleChange(filePath, 'add'))
      .on('change', (filePath: string) => this.handleChange(filePath, 'modify'))
      .on('unlink', (filePath: string) => this.handleChange(filePath, 'delete'));

    this.emit('started', this.projectDir);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.emit('stopped');
  }

  private async cacheExistingFiles(): Promise<void> {
    const walkDir = (dir: string): string[] => {
      const results: string[] = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (this.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            results.push(...walkDir(fullPath));
          } else if (entry.isFile()) {
            results.push(fullPath);
          }
        }
      } catch { /* skip unreadable dirs */ }
      return results;
    };

    const files = walkDir(this.projectDir);
    for (const file of files.slice(0, 500)) { // cap at 500 files
      try {
        const content = fs.readFileSync(file, 'utf-8');
        this.fileCache.set(file, content);
      } catch { /* skip binary/unreadable files */ }
    }
  }

  private shouldIgnore(filePath: string): boolean {
    const rel = path.relative(this.projectDir, filePath);
    return this.ignorePatterns.some(pattern => {
      const clean = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
      return rel.includes(clean.replace(/\//g, path.sep));
    });
  }

  private async handleChange(filePath: string, type: 'add' | 'modify' | 'delete'): Promise<void> {
    const relPath = path.relative(this.projectDir, filePath);
    const change: FileChange = { path: relPath, type };

    if (type === 'modify' || type === 'add') {
      try {
        const newContent = fs.readFileSync(filePath, 'utf-8');
        const oldContent = this.fileCache.get(filePath) || '';

        if (type === 'modify' && oldContent) {
          const changes = diffLines(oldContent, newContent);
          const diffStr = changes
            .filter(c => c.added || c.removed)
            .map(c => (c.added ? `+${c.value}` : `-${c.value}`))
            .join('');
          change.diff = diffStr;
        }

        change.content = newContent;
        this.fileCache.set(filePath, newContent);
      } catch { /* binary file */ }
    } else if (type === 'delete') {
      this.fileCache.delete(filePath);
    }

    this.changeQueue.push(change);
    this.debouncedEmit();
  }

  private debouncedEmit(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const changes = [...this.changeQueue];
      this.changeQueue = [];
      this.emit('changes', changes);
    }, 500);
  }

  getFileContent(filePath: string): string | undefined {
    const fullPath = path.resolve(this.projectDir, filePath);
    return this.fileCache.get(fullPath);
  }
}
