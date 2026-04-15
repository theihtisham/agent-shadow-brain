// src/brain/project-config.ts — Load .shadow-brain.json project-level config

import { ProjectConfig, CustomRule } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILENAMES = ['.shadow-brain.json', 'shadow-brain.json'];
const DEFAULT_CONFIG: ProjectConfig = { version: '1.0' };

export class ProjectConfigLoader {
  private projectDir: string;
  private config: ProjectConfig = DEFAULT_CONFIG;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  load(): ProjectConfig {
    // Check project directory
    for (const name of CONFIG_FILENAMES) {
      const fp = path.join(this.projectDir, name);
      if (fs.existsSync(fp)) {
        try {
          this.config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(fp, 'utf-8')) };
          return this.config;
        } catch { /* use defaults */ }
      }
    }

    // Check package.json for "shadowBrain" key
    const pkgPath = path.join(this.projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.shadowBrain) {
          this.config = { ...DEFAULT_CONFIG, ...pkg.shadowBrain };
          return this.config;
        }
      } catch { /* ignore */ }
    }

    // Check pyproject.toml for Python projects
    const pyPath = path.join(this.projectDir, 'pyproject.toml');
    if (fs.existsSync(pyPath)) {
      try {
        const content = fs.readFileSync(pyPath, 'utf-8');
        const match = content.match(/\[tool\.shadow-brain\]\s*([\s\S]*?)(?=\[|$)/);
        if (match) {
          // Simple TOML-like parse for basic config
          const tomlSection = match[1];
          const ignoreMatch = tomlSection.match(/ignore_paths\s*=\s*\[([^\]]*)\]/);
          if (ignoreMatch) {
            const paths = ignoreMatch[1].split(',').map(s => s.trim().replace(/"/g, '').replace(/'/g, ''));
            this.config.rules = { ignorePaths: paths.filter(Boolean) };
          }
        }
      } catch { /* ignore */ }
    }

    return this.config;
  }

  get(): ProjectConfig {
    return this.config;
  }

  getIgnorePatterns(): string[] {
    const patterns: string[] = [];

    // From project config
    if (this.config.rules?.ignorePaths) {
      patterns.push(...this.config.rules.ignorePaths);
    }
    if (this.config.rules?.ignorePatterns) {
      patterns.push(...this.config.rules.ignorePatterns);
    }

    // From .shadow-brain-ignore file
    const ignoreFile = path.join(this.projectDir, '.shadow-brain-ignore');
    if (fs.existsSync(ignoreFile)) {
      const content = fs.readFileSync(ignoreFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    }

    // From .gitignore
    const gitignore = path.join(this.projectDir, '.gitignore');
    if (fs.existsSync(gitignore)) {
      const content = fs.readFileSync(gitignore, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    }

    return [...new Set(patterns)];
  }

  getCustomRules(): CustomRule[] {
    return this.config.rules?.customRules || [];
  }

  getNotificationConfig(): ProjectConfig['notifications'] {
    return this.config.notifications;
  }

  save(config: ProjectConfig): void {
    this.config = config;
    const fp = path.join(this.projectDir, '.shadow-brain.json');
    fs.writeFileSync(fp, JSON.stringify(config, null, 2), 'utf-8');
  }

  shouldIgnore(filePath: string): boolean {
    const patterns = this.getIgnorePatterns();
    for (const pattern of patterns) {
      if (pattern.startsWith('*')) {
        if (filePath.endsWith(pattern.slice(1))) return true;
      } else if (pattern.endsWith('*')) {
        if (filePath.startsWith(pattern.slice(0, -1))) return true;
      } else {
        if (filePath.includes(pattern)) return true;
      }
    }
    return false;
  }
}
