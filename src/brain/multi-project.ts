// src/brain/multi-project.ts — Multi-project registry and aggregated health

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectInfo, AggregatedHealth } from '../types.js';

const REGISTRY_FILE = path.join(os.homedir(), '.shadow-brain-projects.json');

interface ProjectRegistry {
  version: number;
  projects: ProjectInfo[];
  lastUpdated: string;
}

export class MultiProjectManager {
  private registry: ProjectRegistry;

  constructor() {
    this.registry = {
      version: 1,
      projects: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private async loadRegistry(): Promise<void> {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.registry = {
          version: parsed.version ?? 1,
          projects: (parsed.projects ?? []).map((p: ProjectInfo) => ({
            ...p,
            lastAnalyzed: p.lastAnalyzed ? new Date(p.lastAnalyzed) : null,
          })),
          lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
        };
      }
    } catch {
      this.registry = { version: 1, projects: [], lastUpdated: new Date().toISOString() };
    }
  }

  private async saveRegistry(): Promise<void> {
    try {
      const dir = path.dirname(REGISTRY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.registry.lastUpdated = new Date().toISOString();
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence
    }
  }

  async addProject(dir: string): Promise<ProjectInfo> {
    await this.loadRegistry();

    const resolved = path.resolve(dir);
    const existing = this.registry.projects.find(p => path.resolve(p.dir) === resolved);
    if (existing) {
      return existing;
    }

    const name = path.basename(resolved);
    const info: ProjectInfo = {
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dir: resolved,
      name,
      status: 'stopped',
      lastHealth: null,
      lastAnalyzed: null,
      insightCount: 0,
    };

    this.registry.projects.push(info);
    await this.saveRegistry();
    return info;
  }

  async removeProject(dir: string): Promise<void> {
    await this.loadRegistry();

    const resolved = path.resolve(dir);
    this.registry.projects = this.registry.projects.filter(
      p => path.resolve(p.dir) !== resolved,
    );
    await this.saveRegistry();
  }

  async listProjects(): Promise<ProjectInfo[]> {
    await this.loadRegistry();

    // Refresh status by checking if directories still exist
    const refreshed: ProjectInfo[] = [];
    for (const project of this.registry.projects) {
      const exists = fs.existsSync(project.dir);
      refreshed.push({
        ...project,
        status: exists ? project.status : 'error',
      });
    }
    this.registry.projects = refreshed;
    return refreshed;
  }

  async scanDirectory(parentDir: string): Promise<string[]> {
    const resolved = path.resolve(parentDir);

    if (!fs.existsSync(resolved)) {
      return [];
    }

    const gitRepos: string[] = [];

    const walk = (currentDir: string, depth: number): void => {
      if (depth > 4) return; // Limit recursion depth

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return; // Permission denied or other error
      }

      // Check if current directory is a git repo
      const hasGitDir = entries.some(e => e.isDirectory() && e.name === '.git');
      if (hasGitDir) {
        gitRepos.push(currentDir);
        return; // Don't recurse into git repos
      }

      // Recurse into subdirectories, skipping common noise directories
      const skipDirs = new Set([
        'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
        'vendor', '__pycache__', '.tox', '.venv', 'venv', 'target',
        '.gradle', '.idea', '.vscode', 'coverage', '.cache', '.temp',
      ]);

      for (const entry of entries) {
        if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(currentDir, entry.name), depth + 1);
        }
      }
    };

    walk(resolved, 0);
    return gitRepos;
  }

  async getAggregatedHealth(): Promise<AggregatedHealth> {
    await this.loadRegistry();

    const projects = this.registry.projects;
    const activeProjects = projects.filter(p => p.lastHealth !== null);

    if (activeProjects.length === 0) {
      return {
        projects: projects.length,
        averageHealth: 0,
        bestProject: 'none',
        worstProject: 'none',
        criticalIssues: 0,
      };
    }

    const healthValues = activeProjects.map(p => p.lastHealth!);
    const averageHealth = Math.round(
      healthValues.reduce((sum, h) => sum + h, 0) / healthValues.length,
    );

    let bestProject = activeProjects[0].name;
    let bestHealth = activeProjects[0].lastHealth!;
    let worstProject = activeProjects[0].name;
    let worstHealth = activeProjects[0].lastHealth!;

    for (const p of activeProjects) {
      if (p.lastHealth! > bestHealth) {
        bestHealth = p.lastHealth!;
        bestProject = p.name;
      }
      if (p.lastHealth! < worstHealth) {
        worstHealth = p.lastHealth!;
        worstProject = p.name;
      }
    }

    const criticalIssues = activeProjects.filter(p => p.lastHealth !== null && p.lastHealth < 40).length;

    return {
      projects: projects.length,
      averageHealth,
      bestProject,
      worstProject,
      criticalIssues,
    };
  }
}
