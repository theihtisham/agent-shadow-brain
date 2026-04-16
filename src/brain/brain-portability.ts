// src/brain/brain-portability.ts — Brain Export/Import for State Portability
// Full brain state serialization for backup, migration, and team sync
// v5.0.1 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  BrainExportData,
  PluginManifest,
} from '../types.js';

const DEFAULT_EXPORT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.shadow-brain', 'exports'
);

/**
 * BrainPortability — export and import full brain state.
 *
 * Use cases:
 * 1. Backup brain before major refactors
 * 2. Migrate brain between machines
 * 3. Share brain state with team members
 * 4. Restore brain after clean install
 * 5. Transfer learning across projects
 */
export class BrainPortability {
  private exportDir: string;
  private projectDir: string;
  private storeDir: string;

  constructor(projectDir?: string, customDir?: string) {
    this.projectDir = projectDir || process.cwd();
    this.exportDir = customDir || DEFAULT_EXPORT_DIR;
    this.storeDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.shadow-brain'
    );
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  /**
   * Export full brain state to a JSON file.
   * Captures all module states for complete portability.
   */
  async exportBrain(options?: {
    includePatterns?: boolean;
    includeLearning?: boolean;
    includeConsensus?: boolean;
    includeRecall?: boolean;
    includeCollective?: boolean;
    includeTurbo?: boolean;
    includeKnowledge?: boolean;
    includeSwarm?: boolean;
    includeEvolution?: boolean;
    plugins?: PluginManifest[];
  }): Promise<{ filePath: string; sizeBytes: number; checksum: string }> {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }

    const projectName = path.basename(this.projectDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `brain-${projectName}-${timestamp}.json`;
    const filePath = path.join(this.exportDir, fileName);

    const data: BrainExportData = {
      version: '5.0.1',
      exportedAt: new Date(),
      projectName,
      projectDir: this.projectDir,
      hierarchicalMemory: this.readModuleState('hierarchical-memory'),
      patternMemory: options?.includePatterns !== false
        ? this.readModuleState('patterns')
        : null,
      learningEngine: options?.includeLearning !== false
        ? this.readModuleState('learning')
        : null,
      neuralMesh: this.readModuleState('neural-mesh'),
      consensusState: options?.includeConsensus !== false
        ? this.readModuleState('consensus')
        : null,
      recallState: options?.includeRecall !== false
        ? this.readModuleState('context-recall')
        : null,
      collectiveRules: options?.includeCollective !== false
        ? this.readModuleState('collective')
        : null,
      turboMemory: options?.includeTurbo !== false
        ? this.readModuleState('turbo-memory')
        : null,
      knowledgeGraph: options?.includeKnowledge !== false
        ? this.readModuleState('knowledge-graph')
        : null,
      swarmState: options?.includeSwarm !== false
        ? this.readModuleState('swarm')
        : null,
      evolutionState: options?.includeEvolution !== false
        ? this.readModuleState('evolution')
        : null,
      customRules: this.readModuleState('custom-rules'),
      plugins: options?.plugins || [],
    };

    const jsonStr = JSON.stringify(data, this.dateReplacer, 2);
    const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');

    fs.writeFileSync(filePath, jsonStr);

    return {
      filePath,
      sizeBytes: Buffer.byteLength(jsonStr, 'utf-8'),
      checksum,
    };
  }

  /**
   * Import brain state from an export file.
   * Restores all module states from the export.
   */
  async importBrain(
    filePath: string,
    options?: {
      merge?: boolean; // Merge with existing state instead of replacing
      skipModules?: string[]; // Module names to skip during import
    }
  ): Promise<{ imported: string[]; skipped: string[]; errors: string[] }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Export file not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: BrainExportData = JSON.parse(raw);

    // Version compatibility check
    if (data.version && !data.version.startsWith('5.')) {
      throw new Error(`Incompatible export version: ${data.version}. Expected 5.x`);
    }

    const skipSet = new Set(options?.skipModules || []);
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    // Ensure store directory exists
    if (!fs.existsSync(this.storeDir)) {
      fs.mkdirSync(this.storeDir, { recursive: true });
    }

    // Module state mapping
    const moduleMap: Array<{ name: string; data: unknown; subdir: string }> = [
      { name: 'hierarchicalMemory', data: data.hierarchicalMemory, subdir: 'hierarchical-memory' },
      { name: 'patternMemory', data: data.patternMemory, subdir: 'patterns' },
      { name: 'learningEngine', data: data.learningEngine, subdir: 'learning' },
      { name: 'neuralMesh', data: data.neuralMesh, subdir: 'neural-mesh' },
      { name: 'consensusState', data: data.consensusState, subdir: 'consensus' },
      { name: 'recallState', data: data.recallState, subdir: 'context-recall' },
      { name: 'collectiveRules', data: data.collectiveRules, subdir: 'collective' },
      { name: 'turboMemory', data: data.turboMemory, subdir: 'turbo-memory' },
      { name: 'knowledgeGraph', data: data.knowledgeGraph, subdir: 'knowledge-graph' },
      { name: 'swarmState', data: data.swarmState, subdir: 'swarm' },
      { name: 'evolutionState', data: data.evolutionState, subdir: 'evolution' },
      { name: 'customRules', data: data.customRules, subdir: 'custom-rules' },
    ];

    for (const { name, data: moduleData, subdir } of moduleMap) {
      if (skipSet.has(name)) {
        skipped.push(name);
        continue;
      }

      if (!moduleData) {
        skipped.push(name);
        continue;
      }

      try {
        if (options?.merge) {
          await this.mergeModuleState(subdir, moduleData);
        } else {
          this.writeModuleState(subdir, moduleData);
        }
        imported.push(name);
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { imported, skipped, errors };
  }

  // ── Query Operations ───────────────────────────────────────────────────────

  /**
   * List all available exports.
   */
  listExports(): Array<{
    fileName: string;
    filePath: string;
    sizeBytes: number;
    exportedAt: Date;
    projectName: string;
    version: string;
  }> {
    if (!fs.existsSync(this.exportDir)) return [];

    const files = fs.readdirSync(this.exportDir)
      .filter(f => f.startsWith('brain-') && f.endsWith('.json'));

    return files.map(fileName => {
      const filePath = path.join(this.exportDir, fileName);
      const stat = fs.statSync(filePath);

      let projectName = 'unknown';
      let version = 'unknown';
      let exportedAt = stat.mtime;

      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        projectName = content.projectName || 'unknown';
        version = content.version || 'unknown';
        if (content.exportedAt) {
          exportedAt = new Date(content.exportedAt);
        }
      } catch {
        // Use defaults
      }

      return { fileName, filePath, sizeBytes: stat.size, exportedAt, projectName, version };
    }).sort((a, b) => b.exportedAt.getTime() - a.exportedAt.getTime());
  }

  /**
   * Verify an export file's integrity.
   */
  verifyExport(filePath: string): {
    valid: boolean;
    version: string;
    projectName: string;
    moduleCount: number;
    totalSizeKB: number;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!fs.existsSync(filePath)) {
      return { valid: false, version: '', projectName: '', moduleCount: 0, totalSizeKB: 0, errors: ['File not found'] };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      let moduleCount = 0;
      const modules = [
        'hierarchicalMemory', 'patternMemory', 'learningEngine',
        'neuralMesh', 'consensusState', 'recallState', 'collectiveRules',
        'turboMemory', 'knowledgeGraph', 'swarmState', 'evolutionState',
      ];

      for (const mod of modules) {
        if (data[mod] !== null && data[mod] !== undefined) moduleCount++;
      }

      if (!data.version) errors.push('Missing version field');
      if (!data.projectName) errors.push('Missing projectName field');
      if (!data.exportedAt) errors.push('Missing exportedAt field');

      return {
        valid: errors.length === 0,
        version: data.version || 'unknown',
        projectName: data.projectName || 'unknown',
        moduleCount,
        totalSizeKB: Math.round(Buffer.byteLength(content, 'utf-8') / 1024),
        errors,
      };
    } catch (err) {
      return {
        valid: false,
        version: '',
        projectName: '',
        moduleCount: 0,
        totalSizeKB: 0,
        errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  /**
   * Delete an export file.
   */
  deleteExport(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  // ── Internal Helpers ────────────────────────────────────────────────────────

  private readModuleState(subdir: string): unknown {
    const moduleDir = path.join(this.storeDir, subdir);
    if (!fs.existsSync(moduleDir)) return null;

    try {
      const files = fs.readdirSync(moduleDir).filter(f => f.endsWith('.json'));
      if (files.length === 0) return null;

      const state: Record<string, unknown> = {};
      for (const file of files) {
        const filePath = path.join(moduleDir, file);
        const key = file.replace('.json', '');
        try {
          state[key] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          // Skip unreadable files
        }
      }

      return Object.keys(state).length > 0 ? state : null;
    } catch {
      return null;
    }
  }

  private writeModuleState(subdir: string, data: unknown): void {
    const moduleDir = path.join(this.storeDir, subdir);
    if (!fs.existsSync(moduleDir)) {
      fs.mkdirSync(moduleDir, { recursive: true });
    }

    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const filePath = path.join(moduleDir, `${key}.json`);
        fs.writeFileSync(filePath, JSON.stringify(value, this.dateReplacer, 2));
      }
    }
  }

  private async mergeModuleState(subdir: string, data: unknown): Promise<void> {
    const moduleDir = path.join(this.storeDir, subdir);
    if (!fs.existsSync(moduleDir)) {
      fs.mkdirSync(moduleDir, { recursive: true });
    }

    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const filePath = path.join(moduleDir, `${key}.json`);

        if (fs.existsSync(filePath)) {
          // Merge existing with imported
          try {
            const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const merged = this.deepMerge(existing, value);
            fs.writeFileSync(filePath, JSON.stringify(merged, this.dateReplacer, 2));
          } catch {
            // Overwrite if can't parse existing
            fs.writeFileSync(filePath, JSON.stringify(value, this.dateReplacer, 2));
          }
        } else {
          fs.writeFileSync(filePath, JSON.stringify(value, this.dateReplacer, 2));
        }
      }
    }
  }

  private deepMerge(target: unknown, source: unknown): unknown {
    if (typeof target !== 'object' || target === null || typeof source !== 'object' || source === null) {
      return source;
    }

    if (Array.isArray(target) && Array.isArray(source)) {
      // For arrays, merge by concatenating and deduplicating by id
      const merged = [...target, ...source];
      const seen = new Set<unknown>();
      return merged.filter(item => {
        if (typeof item === 'object' && item !== null && 'id' in (item as Record<string, unknown>)) {
          const id = (item as Record<string, unknown>).id;
          if (seen.has(id)) return false;
          seen.add(id);
        }
        return true;
      });
    }

    const result = { ...(target as Record<string, unknown>) };
    for (const key of Object.keys(source as Record<string, unknown>)) {
      if (key in result) {
        result[key] = this.deepMerge(result[key], (source as Record<string, unknown>)[key]);
      } else {
        result[key] = (source as Record<string, unknown>)[key];
      }
    }
    return result;
  }

  private dateReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }
}
