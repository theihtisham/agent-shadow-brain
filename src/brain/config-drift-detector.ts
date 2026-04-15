// src/brain/config-drift-detector.ts — Configuration drift detection
// v3.0.0 — Detects drift between expected and actual config across environments

import { BrainInsight, ConfigDrift } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

interface ConfigFile {
  path: string;
  required: boolean;
  schema?: Record<string, unknown>;
}

const TEMPLATES: ConfigFile[] = [
  { path: 'tsconfig.json', required: true },
  { path: '.eslintrc.json', required: false },
  { path: '.eslintrc.js', required: false },
  { path: '.prettierrc', required: false },
  { path: '.prettierrc.json', required: false },
  { path: 'jest.config.js', required: false },
  { path: 'jest.config.ts', required: false },
  { path: '.gitignore', required: true },
  { path: '.editorconfig', required: false },
  { path: '.npmrc', required: false },
  { path: '.nvmrc', required: false },
  { path: 'docker-compose.yml', required: false },
  { path: 'Dockerfile', required: false },
];

export class ConfigDriftDetector {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(): Promise<BrainInsight[]> {
    const drifts: ConfigDrift[] = [];

    // Phase 1: Missing required config files
    drifts.push(...this.detectMissingConfigs());

    // Phase 2: tsconfig.json drift
    drifts.push(...this.detectTsconfigDrift());

    // Phase 3: .gitignore drift
    drifts.push(...this.detectGitignoreDrift());

    // Phase 4: package.json consistency
    drifts.push(...this.detectPackageJsonDrift());

    // Phase 5: Editor config consistency
    drifts.push(...this.detectEditorConfigDrift());

    return drifts.map(d => this.driftToInsight(d));
  }

  private detectMissingConfigs(): ConfigDrift[] {
    const drifts: ConfigDrift[] = [];

    for (const template of TEMPLATES) {
      const fullPath = path.join(this.projectDir, template.path);
      const exists = fs.existsSync(fullPath);

      if (template.required && !exists) {
        drifts.push({
          file: template.path,
          expected: 'File should exist',
          actual: 'File is missing',
          severity: 'high',
          description: `Required config file ${template.path} is missing. This may cause inconsistent behavior across environments.`,
          autoFixable: true,
        });
      }
    }

    return drifts;
  }

  private detectTsconfigDrift(): ConfigDrift[] {
    const drifts: ConfigDrift[] = [];
    const tsconfigPath = path.join(this.projectDir, 'tsconfig.json');

    let tsconfig: Record<string, unknown>;
    try {
      tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    } catch {
      return drifts; // missing tsconfig handled above
    }

    const compilerOptions = (tsconfig.compilerOptions || {}) as Record<string, unknown>;

    // Check for recommended settings
    const recommended: Record<string, { value: unknown; reason: string }> = {
      'strict': { value: true, reason: 'Strict mode catches many common bugs' },
      'esModuleInterop': { value: true, reason: 'Enables proper interop between CJS and ESM' },
      'skipLibCheck': { value: true, reason: 'Speeds up compilation by skipping type checking of .d.ts files' },
      'forceConsistentCasingInFileNames': { value: true, reason: 'Ensures consistent file references across OS' },
      'resolveJsonModule': { value: true, reason: 'Allows importing JSON files' },
      'declaration': { value: true, reason: 'Generates .d.ts files for library consumers' },
      'declarationMap': { value: true, reason: 'Enables source maps for declarations' },
      'sourceMap': { value: true, reason: 'Enables debugging with source maps' },
    };

    for (const [key, { value, reason }] of Object.entries(recommended)) {
      if (compilerOptions[key] === undefined) {
        drifts.push({
          file: 'tsconfig.json',
          expected: `compilerOptions.${key}: ${JSON.stringify(value)}`,
          actual: `${key} is not set`,
          severity: 'medium',
          description: `Missing recommended tsconfig option: ${key}. ${reason}.`,
          autoFixable: true,
        });
      } else if (compilerOptions[key] !== value) {
        drifts.push({
          file: 'tsconfig.json',
          expected: `compilerOptions.${key}: ${JSON.stringify(value)}`,
          actual: `compilerOptions.${key}: ${JSON.stringify(compilerOptions[key])}`,
          severity: 'low',
          description: `tsconfig option ${key} is ${JSON.stringify(compilerOptions[key])}, recommended: ${JSON.stringify(value)}. ${reason}.`,
          autoFixable: true,
        });
      }
    }

    return drifts;
  }

  private detectGitignoreDrift(): ConfigDrift[] {
    const drifts: ConfigDrift[] = [];
    const gitignorePath = path.join(this.projectDir, '.gitignore');

    let content: string;
    try { content = fs.readFileSync(gitignorePath, 'utf-8'); } catch { return drifts; }

    const entries = new Set(content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));

    // Recommended gitignore entries
    const recommended = [
      'node_modules', 'dist', 'build', '.env', '.env.local',
      '*.log', 'coverage', '.DS_Store', 'thumbs.db',
    ];

    for (const entry of recommended) {
      if (!entries.has(entry) && !entries.has(entry.replace('*', ''))) {
        drifts.push({
          file: '.gitignore',
          expected: `${entry} should be ignored`,
          actual: `${entry} is not in .gitignore`,
          severity: entry === '.env' || entry === '.env.local' ? 'high' : 'medium',
          description: `${entry} is missing from .gitignore. This may result in committing sensitive or generated files.`,
          autoFixable: true,
        });
      }
    }

    return drifts;
  }

  private detectPackageJsonDrift(): ConfigDrift[] {
    const drifts: ConfigDrift[] = [];
    const pkgPath = path.join(this.projectDir, 'package.json');

    let pkg: Record<string, unknown>;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch { return drifts; }

    // Check for missing recommended fields
    const recommendedFields: Record<string, { expected: string; reason: string }> = {
      'license': { expected: 'MIT or appropriate license', reason: 'Required for npm publishing and legal clarity' },
      'repository': { expected: '{ type: "git", url: "..." }', reason: 'Helps users find the source code' },
      'description': { expected: 'Short project description', reason: 'Improves discoverability on npm' },
      'keywords': { expected: 'Array of keywords', reason: 'Improves npm search results' },
      'engines': { expected: '{ node: ">=18" }', reason: 'Specifies compatible Node.js versions' },
    };

    for (const [field, { expected, reason }] of Object.entries(recommendedFields)) {
      if (!pkg[field]) {
        drifts.push({
          file: 'package.json',
          expected: `${field}: ${expected}`,
          actual: `${field} is missing`,
          severity: 'low',
          description: `Missing package.json field: ${field}. ${reason}.`,
          autoFixable: true,
        });
      }
    }

    return drifts;
  }

  private detectEditorConfigDrift(): ConfigDrift[] {
    const drifts: ConfigDrift[] = [];
    const editorConfigPath = path.join(this.projectDir, '.editorconfig');

    if (!fs.existsSync(editorConfigPath)) {
      // Not critical, but worth noting
      drifts.push({
        file: '.editorconfig',
        expected: 'Editor config file for consistent formatting',
        actual: 'No .editorconfig file found',
        severity: 'low',
        description: 'Missing .editorconfig. Team members may use different editor settings (indentation, line endings, etc.).',
        autoFixable: true,
      });
    }

    return drifts;
  }

  private driftToInsight(drift: ConfigDrift): BrainInsight {
    return {
      type: 'config-drift',
      priority: drift.severity === 'high' ? 'high' : drift.severity === 'medium' ? 'medium' : 'low',
      title: `[config-drift] ${drift.file}: ${drift.description.slice(0, 60)}`,
      content:
        `Configuration drift in ${drift.file}\n` +
        `  Expected: ${drift.expected}\n` +
        `  Actual: ${drift.actual}\n` +
        `  Severity: ${drift.severity}\n` +
        `  ${drift.autoFixable ? 'This can be auto-fixed.' : 'Manual review required.'}\n` +
        `  Description: ${drift.description}`,
      files: [drift.file],
      timestamp: new Date(),
      confidence: 0.9,
      metadata: { autoFixable: drift.autoFixable, severity: drift.severity },
    };
  }
}
