// src/brain/auto-setup.ts — Zero-Config Auto-Setup Engine
// Detects project type, AI tools, languages, frameworks on install
// v5.0.1 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import {
  AutoConfigResult,
  BrainConfig,
  AgentTool,
} from '../types.js';

/** AI tool config file patterns to detect */
const AI_TOOL_PATTERNS: Array<{
  name: string;
  files: string[];
  tool: AgentTool;
}> = [
  { name: 'Claude Code', files: ['.claude/CLAUDE.md', '.claude/settings.json'], tool: 'claude-code' },
  { name: 'Cursor', files: ['.cursorrules', '.cursor/rules', '.cursor/mcp.json'], tool: 'cursor' },
  { name: 'Kilo Code', files: ['.kilocode/rules', '.kilocode/settings.json'], tool: 'kilo-code' },
  { name: 'Cline', files: ['.clinerules', '.cline/settings.json'], tool: 'cline' },
  { name: 'OpenCode', files: ['.opencode/rules', '.opencode/settings.json'], tool: 'opencode' },
  { name: 'Codex', files: ['.codex/config.json', '.codex/rules'], tool: 'codex' },
  { name: 'Aider', files: ['.aider.conf.yml', '.aiderignore'], tool: 'aider' },
  { name: 'Windsurf', files: ['.windsurfrules', '.windsurf/rules'], tool: 'windsurf' },
];

/** Framework detection from package.json dependencies */
const FRAMEWORK_DETECTORS: Record<string, (deps: Record<string, string>) => boolean> = {
  'react': (d) => 'react' in d,
  'next.js': (d) => 'next' in d,
  'vue': (d) => 'vue' in d,
  'nuxt': (d) => 'nuxt' in d,
  'angular': (d) => '@angular/core' in d,
  'svelte': (d) => 'svelte' in d,
  'astro': (d) => 'astro' in d,
  'express': (d) => 'express' in d,
  'nestjs': (d) => '@nestjs/core' in d,
  'fastify': (d) => 'fastify' in d,
  'django': () => false, // detected by file existence
  'flask': () => false,
  'fastapi': () => false,
  'spring-boot': () => false,
  'rails': () => false,
  'gin': () => false,
  'actix': () => false,
  'flutter': (d) => 'flutter' in d || 'flutter_test' in d,
  'react-native': (d) => 'react-native' in d,
  'expo': (d) => 'expo' in d,
  'electron': (d) => 'electron' in d,
  'tauri': () => false,
  'three.js': (d) => 'three' in d,
  'unity': () => false,
  'unreal': () => false,
};

/** Language detection from file extensions */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  'typescript': ['.ts', '.tsx', '.mts', '.cts'],
  'javascript': ['.js', '.jsx', '.mjs', '.cjs'],
  'python': ['.py', '.pyi', '.ipynb'],
  'rust': ['.rs'],
  'go': ['.go'],
  'java': ['.java'],
  'kotlin': ['.kt', '.kts'],
  'swift': ['.swift'],
  'c#': ['.cs'],
  'c++': ['.cpp', '.cxx', '.cc', '.hpp'],
  'c': ['.c', '.h'],
  'ruby': ['.rb'],
  'php': ['.php'],
  'dart': ['.dart'],
  'scala': ['.scala'],
  'elixir': ['.ex', '.exs'],
  'haskell': ['.hs'],
  'lua': ['.lua'],
  'shell': ['.sh', '.bash', '.zsh'],
  'sql': ['.sql'],
  'html': ['.html', '.htm'],
  'css': ['.css', '.scss', '.sass', '.less'],
  'vue': ['.vue'],
  'svelte': ['.svelte'],
};

/** Test framework detection */
const TEST_DETECTORS: Record<string, (deps: Record<string, string>) => boolean> = {
  'vitest': (d) => 'vitest' in d,
  'jest': (d) => 'jest' in d || '@jest/core' in d,
  'mocha': (d) => 'mocha' in d,
  'pytest': () => false,
  'unittest': () => false,
  'cypress': (d) => 'cypress' in d,
  'playwright': (d) => '@playwright/test' in d || 'playwright' in d,
  'testing-library': (d) => '@testing-library/react' in d || '@testing-library/vue' in d,
  'ava': (d) => 'ava' in d,
  'tap': (d) => 'tap' in d,
  'jasmine': (d) => 'jasmine' in d,
  'karma': (d) => 'karma' in d,
  'pytorch-test': () => false,
  'junit': () => false,
};

/** CI/CD detection */
const CICD_FILES: Record<string, string[]> = {
  'github-actions': ['.github/workflows'],
  'gitlab-ci': ['.gitlab-ci.yml'],
  'jenkins': ['Jenkinsfile'],
  'circleci': ['.circleci/config.yml'],
  'travis-ci': ['.travis.yml'],
  'azure-pipelines': ['azure-pipelines.yml', '.azure-pipelines.yml'],
  'bitbucket-pipelines': ['bitbucket-pipelines.yml'],
  'drone': ['.drone.yml'],
};

/**
 * AutoSetup — zero-configuration project detection engine.
 *
 * Scans the project directory on install and automatically:
 * 1. Detects languages, frameworks, build tools
 * 2. Discovers AI coding tools already configured
 * 3. Identifies test frameworks, linters, formatters
 * 4. Checks for CI/CD, Git, Docker
 * 5. Generates optimal BrainConfig with sensible defaults
 * 6. Installs MCP integration for detected AI tools
 */
export class AutoSetup {
  private projectDir: string;

  constructor(projectDir?: string) {
    this.projectDir = projectDir || process.cwd();
  }

  /**
   * Run full auto-detection and configuration.
   * Call this from postinstall or `shadow-brain start`.
   */
  async detect(): Promise<AutoConfigResult> {
    const languages = this.detectLanguages();
    const packageJson = this.readPackageJson();
    const deps = this.extractDependencies(packageJson);
    const frameworks = this.detectFrameworks(deps);
    const buildTools = this.detectBuildTools(deps, packageJson);
    const packageManager = this.detectPackageManager();
    const aiTools = this.detectAITools();
    const testFrameworks = this.detectTestFrameworks(deps);
    const linters = this.detectLinters();
    const formatters = this.detectFormatters(deps);
    const cicd = this.detectCICD();
    const hasGit = this.detectGit();
    const hasDocker = this.detectDocker();

    const config = this.generateConfig({
      languages,
      frameworks,
      buildTools,
      packageManager,
      aiTools,
      testFrameworks,
      hasGit,
      hasDocker,
    });

    return {
      projectDir: this.projectDir,
      projectName: this.getProjectName(packageJson),
      projectType: this.inferProjectType(frameworks, languages),
      languages,
      frameworks,
      buildTools,
      packageManager,
      aiTools,
      testFrameworks,
      linters,
      formatters,
      cicd,
      hasGit,
      hasDocker,
      config,
      timestamp: new Date(),
    };
  }

  /**
   * Install MCP integration files for detected AI tools.
   */
  async installMCPForTools(result: AutoConfigResult): Promise<string[]> {
    const installed: string[] = [];

    for (const tool of result.aiTools) {
      if (!tool.detected) continue;

      try {
        switch (tool.name) {
          case 'Claude Code':
            await this.installClaudeMCP();
            installed.push('Claude Code');
            break;
          case 'Cursor':
            await this.installCursorMCP();
            installed.push('Cursor');
            break;
          case 'Kilo Code':
            await this.installKiloCodeMCP();
            installed.push('Kilo Code');
            break;
          case 'Cline':
            await this.installClineMCP();
            installed.push('Cline');
            break;
        }
      } catch {
        // Non-blocking — tool may not support MCP injection
      }
    }

    return installed;
  }

  /**
   * Install git hooks for pre-commit/pre-push.
   */
  async installGitHooks(): Promise<boolean> {
    const gitDir = path.join(this.projectDir, '.git');
    if (!fs.existsSync(gitDir)) return false;

    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // Pre-commit hook
    const preCommit = path.join(hooksDir, 'pre-commit');
    const preCommitContent = `#!/bin/sh
# Agent Shadow Brain — Auto-installed pre-commit hook
npx shadow-brain scan --staged 2>/dev/null || true
`;
    fs.writeFileSync(preCommit, preCommitContent, { mode: 0o755 });

    // Pre-push hook
    const prePush = path.join(hooksDir, 'pre-push');
    const prePushContent = `#!/bin/sh
# Agent Shadow Brain — Auto-installed pre-push hook
npx shadow-brain health 2>/dev/null || true
`;
    fs.writeFileSync(prePush, prePushContent, { mode: 0o755 });

    return true;
  }

  /**
   * Generate a summary string for CLI display.
   */
  getSummary(result: AutoConfigResult): string {
    const lines: string[] = [];
    lines.push(`  Project: ${result.projectName} (${result.projectType})`);
    lines.push(`  Languages: ${result.languages.join(', ') || 'none detected'}`);
    lines.push(`  Frameworks: ${result.frameworks.join(', ') || 'none detected'}`);
    lines.push(`  Package Manager: ${result.packageManager}`);
    lines.push(`  Build Tools: ${result.buildTools.join(', ') || 'none detected'}`);
    lines.push(`  Test Frameworks: ${result.testFrameworks.join(', ') || 'none detected'}`);
    lines.push(`  AI Tools: ${result.aiTools.filter(t => t.detected).map(t => t.name).join(', ') || 'none detected'}`);
    lines.push(`  CI/CD: ${result.cicd.join(', ') || 'none detected'}`);
    lines.push(`  Git: ${result.hasGit ? 'yes' : 'no'}`);
    lines.push(`  Docker: ${result.hasDocker ? 'yes' : 'no'}`);
    return lines.join('\n');
  }

  // ── Detection Methods ──────────────────────────────────────────────────────

  private detectLanguages(): string[] {
    const detected = new Set<string>();
    const extensions = new Set<string>();

    const walkDir = (dir: string, depth: number = 0): void => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.git') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext) extensions.add(ext);
          }
        }
      } catch {
        // Permission denied, skip
      }
    };

    walkDir(this.projectDir);

    for (const [language, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
      for (const ext of exts) {
        if (extensions.has(ext)) {
          detected.add(language);
          break;
        }
      }
    }

    return Array.from(detected);
  }

  private readPackageJson(): Record<string, unknown> | null {
    const pkgPath = path.join(this.projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private extractDependencies(pkg: Record<string, unknown> | null): Record<string, string> {
    if (!pkg) return {};
    const deps: Record<string, string> = {};
    const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const field of depFields) {
      const fieldDeps = pkg[field];
      if (fieldDeps && typeof fieldDeps === 'object') {
        Object.assign(deps, fieldDeps as Record<string, string>);
      }
    }
    return deps;
  }

  private detectFrameworks(deps: Record<string, string>): string[] {
    const detected: string[] = [];
    for (const [framework, detector] of Object.entries(FRAMEWORK_DETECTORS)) {
      try {
        if (detector(deps)) {
          detected.push(framework);
        }
      } catch {
        // Skip
      }
    }

    // File-based framework detection
    if (fs.existsSync(path.join(this.projectDir, 'manage.py'))) detected.push('django');
    if (fs.existsSync(path.join(this.projectDir, 'app.py')) || fs.existsSync(path.join(this.projectDir, 'requirements.txt'))) {
      if (fs.existsSync(path.join(this.projectDir, 'requirements.txt'))) {
        const reqs = fs.readFileSync(path.join(this.projectDir, 'requirements.txt'), 'utf-8').toLowerCase();
        if (reqs.includes('flask')) detected.push('flask');
        if (reqs.includes('fastapi')) detected.push('fastapi');
      }
    }
    if (fs.existsSync(path.join(this.projectDir, 'pom.xml'))) detected.push('spring-boot');
    if (fs.existsSync(path.join(this.projectDir, 'Gemfile'))) detected.push('rails');
    if (fs.existsSync(path.join(this.projectDir, 'go.mod'))) detected.push('gin');
    if (fs.existsSync(path.join(this.projectDir, 'Cargo.toml'))) detected.push('actix');
    if (fs.existsSync(path.join(this.projectDir, 'src-tauri'))) detected.push('tauri');
    if (fs.existsSync(path.join(this.projectDir, 'Assets')) && fs.existsSync(path.join(this.projectDir, 'ProjectSettings'))) detected.push('unity');

    return [...new Set(detected)];
  }

  private detectBuildTools(deps: Record<string, string>, pkg: Record<string, unknown> | null): string[] {
    const detected = new Set<string>();

    if (deps['webpack']) detected.add('webpack');
    if (deps['vite']) detected.add('vite');
    if (deps['esbuild']) detected.add('esbuild');
    if (deps['rollup']) detected.add('rollup');
    if (deps['parcel']) detected.add('parcel');
    if (deps['turbo']) detected.add('turborepo');
    if (deps['@nrwl/cli'] || deps['nx']) detected.add('nx');
    if (deps['typescript']) detected.add('typescript');
    if (deps['swc'] || deps['@swc/core']) detected.add('swc');
    if (deps['rspack'] || deps['@rspack/core']) detected.add('rspack');

    // From scripts
    if (pkg && typeof pkg === 'object') {
      const scripts = (pkg as Record<string, unknown>).scripts as Record<string, string> | undefined;
      if (scripts) {
        for (const [, script] of Object.entries(scripts)) {
          if (typeof script === 'string') {
            if (script.includes('next build')) detected.add('next.js-build');
            if (script.includes('nuxt build')) detected.add('nuxt-build');
            if (script.includes('tsc')) detected.add('tsc');
          }
        }
      }
    }

    return Array.from(detected);
  }

  private detectPackageManager(): AutoConfigResult['packageManager'] {
    if (fs.existsSync(path.join(this.projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(this.projectDir, 'bun.lockb')) || fs.existsSync(path.join(this.projectDir, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(this.projectDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(this.projectDir, 'package-lock.json'))) return 'npm';
    return 'unknown';
  }

  private detectAITools(): Array<{ name: string; path: string; detected: boolean }> {
    const results: Array<{ name: string; path: string; detected: boolean }> = [];

    for (const pattern of AI_TOOL_PATTERNS) {
      let detected = false;
      let foundPath = '';
      for (const file of pattern.files) {
        const fullPath = path.join(this.projectDir, file);
        if (fs.existsSync(fullPath)) {
          detected = true;
          foundPath = file;
          break;
        }
      }
      results.push({ name: pattern.name, path: foundPath, detected });
    }

    return results;
  }

  private detectTestFrameworks(deps: Record<string, string>): string[] {
    const detected: string[] = [];
    for (const [framework, detector] of Object.entries(TEST_DETECTORS)) {
      try {
        if (detector(deps)) detected.push(framework);
      } catch {
        // Skip
      }
    }

    // File-based detection
    if (fs.existsSync(path.join(this.projectDir, 'pytest.ini')) || fs.existsSync(path.join(this.projectDir, 'setup.cfg'))) detected.push('pytest');
    if (fs.existsSync(path.join(this.projectDir, 'phpunit.xml'))) detected.push('phpunit');
    if (fs.existsSync(path.join(this.projectDir, 'jest.config.js')) || fs.existsSync(path.join(this.projectDir, 'jest.config.ts'))) {
      if (!detected.includes('jest')) detected.push('jest');
    }
    if (fs.existsSync(path.join(this.projectDir, 'vitest.config.ts')) || fs.existsSync(path.join(this.projectDir, 'vitest.config.js'))) {
      if (!detected.includes('vitest')) detected.push('vitest');
    }

    return [...new Set(detected)];
  }

  private detectLinters(): string[] {
    const detected: string[] = [];
    if (fs.existsSync(path.join(this.projectDir, '.eslintrc.js')) || fs.existsSync(path.join(this.projectDir, '.eslintrc.json')) || fs.existsSync(path.join(this.projectDir, '.eslintrc.yml')) || fs.existsSync(path.join(this.projectDir, 'eslint.config.js')) || fs.existsSync(path.join(this.projectDir, 'eslint.config.mjs'))) detected.push('eslint');
    if (fs.existsSync(path.join(this.projectDir, '.pylintrc')) || fs.existsSync(path.join(this.projectDir, 'pyproject.toml'))) detected.push('pylint');
    if (fs.existsSync(path.join(this.projectDir, '.flake8'))) detected.push('flake8');
    if (fs.existsSync(path.join(this.projectDir, '.rubocop.yml'))) detected.push('rubocop');
    if (fs.existsSync(path.join(this.projectDir, '.golangci.yml')) || fs.existsSync(path.join(this.projectDir, '.golangci.yaml'))) detected.push('golangci-lint');
    if (fs.existsSync(path.join(this.projectDir, '.clippy.toml'))) detected.push('clippy');
    return detected;
  }

  private detectFormatters(deps: Record<string, string>): string[] {
    const detected: string[] = [];
    if (deps['prettier'] || fs.existsSync(path.join(this.projectDir, '.prettierrc')) || fs.existsSync(path.join(this.projectDir, '.prettierrc.js'))) detected.push('prettier');
    if (fs.existsSync(path.join(this.projectDir, '.black')) || fs.existsSync(path.join(this.projectDir, 'pyproject.toml'))) detected.push('black');
    if (fs.existsSync(path.join(this.projectDir, '.rustfmt.toml'))) detected.push('rustfmt');
    if (deps['@biomejs/biome'] || fs.existsSync(path.join(this.projectDir, 'biome.json'))) detected.push('biome');
    return detected;
  }

  private detectCICD(): string[] {
    const detected: string[] = [];
    for (const [platform, files] of Object.entries(CICD_FILES)) {
      for (const file of files) {
        if (fs.existsSync(path.join(this.projectDir, file))) {
          detected.push(platform);
          break;
        }
      }
    }
    return detected;
  }

  private detectGit(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.git'));
  }

  private detectDocker(): boolean {
    return fs.existsSync(path.join(this.projectDir, 'Dockerfile')) || fs.existsSync(path.join(this.projectDir, 'docker-compose.yml')) || fs.existsSync(path.join(this.projectDir, 'docker-compose.yaml'));
  }

  // ── Config Generation ──────────────────────────────────────────────────────

  private generateConfig(ctx: {
    languages: string[];
    frameworks: string[];
    buildTools: string[];
    packageManager: AutoConfigResult['packageManager'];
    aiTools: Array<{ name: string; detected: boolean }>;
    testFrameworks: string[];
    hasGit: boolean;
    hasDocker: boolean;
  }): Partial<BrainConfig> {
    const config: Partial<BrainConfig> = {
      projectDir: this.projectDir,
    } as Partial<BrainConfig>;
    // Store project name in config for reference
    (config as Record<string, unknown>).projectName = this.getProjectName(this.readPackageJson());

    // Enable features based on detection
    if (ctx.hasGit) {
      (config as Record<string, unknown>).gitEnabled = true;
    }

    // Set analysis depth based on project complexity
    const complexity = ctx.frameworks.length + ctx.languages.length;
    if (complexity > 5) {
      (config as Record<string, unknown>).analysisDepth = 'deep';
    } else if (complexity > 2) {
      (config as Record<string, unknown>).analysisDepth = 'standard';
    } else {
      (config as Record<string, unknown>).analysisDepth = 'quick';
    }

    return config;
  }

  private inferProjectType(frameworks: string[], languages: string[]): string {
    if (frameworks.includes('react-native') || frameworks.includes('expo') || frameworks.includes('flutter')) return 'mobile';
    if (frameworks.includes('electron') || frameworks.includes('tauri')) return 'desktop';
    if (frameworks.includes('unity')) return 'game';
    if (frameworks.includes('next.js') || frameworks.includes('nuxt') || frameworks.includes('astro') || frameworks.includes('angular') || frameworks.includes('svelte') || frameworks.includes('vue')) return 'fullstack';
    if (frameworks.includes('express') || frameworks.includes('nestjs') || frameworks.includes('fastify') || frameworks.includes('django') || frameworks.includes('flask') || frameworks.includes('fastapi') || frameworks.includes('spring-boot') || frameworks.includes('rails') || frameworks.includes('gin') || frameworks.includes('actix')) return 'backend';
    if (frameworks.includes('react') || frameworks.includes('vue') || frameworks.includes('angular') || frameworks.includes('svelte')) return 'frontend';
    if (frameworks.includes('three.js')) return '3d-web';
    if (languages.includes('rust') && !frameworks.length) return 'systems';
    if (languages.includes('go') && !frameworks.length) return 'systems';
    if (languages.includes('python') && !frameworks.length) return 'data-science';
    if (languages.includes('c++') || languages.includes('c')) return 'systems';
    return 'generic';
  }

  private getProjectName(pkg: Record<string, unknown> | null): string {
    if (pkg && typeof pkg === 'object' && pkg.name && typeof pkg.name === 'string') {
      return (pkg.name as string).replace(/^@[^/]+\//, '');
    }
    return path.basename(this.projectDir);
  }

  // ── MCP Installation for AI Tools ──────────────────────────────────────────

  private async installClaudeMCP(): Promise<void> {
    const claudeDir = path.join(this.projectDir, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>;
    mcpServers['shadow-brain'] = {
      command: 'npx',
      args: ['-y', '@theihtisham/agent-shadow-brain', 'mcp'],
    };

    settings.mcpServers = mcpServers;

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  private async installCursorMCP(): Promise<void> {
    const cursorDir = path.join(this.projectDir, '.cursor');
    const mcpPath = path.join(cursorDir, 'mcp.json');

    let mcpConfig: Record<string, unknown> = {};
    if (fs.existsSync(mcpPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      } catch {
        mcpConfig = {};
      }
    }

    const mcpServers = (mcpConfig.mcpServers || {}) as Record<string, unknown>;
    mcpServers['shadow-brain'] = {
      command: 'npx',
      args: ['-y', '@theihtisham/agent-shadow-brain', 'mcp'],
    };

    mcpConfig.mcpServers = mcpServers;

    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  }

  private async installKiloCodeMCP(): Promise<void> {
    const kiloDir = path.join(this.projectDir, '.kilocode');
    const settingsPath = path.join(kiloDir, 'settings.json');

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>;
    mcpServers['shadow-brain'] = {
      command: 'npx',
      args: ['-y', '@theihtisham/agent-shadow-brain', 'mcp'],
    };

    settings.mcpServers = mcpServers;

    if (!fs.existsSync(kiloDir)) {
      fs.mkdirSync(kiloDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  private async installClineMCP(): Promise<void> {
    const clineDir = path.join(this.projectDir, '.cline');
    const settingsPath = path.join(clineDir, 'settings.json');

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>;
    mcpServers['shadow-brain'] = {
      command: 'npx',
      args: ['-y', '@theihtisham/agent-shadow-brain', 'mcp'],
    };

    settings.mcpServers = mcpServers;

    if (!fs.existsSync(clineDir)) {
      fs.mkdirSync(clineDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
}

// ── Standalone postinstall runner ──────────────────────────────────────────
// Runs automatically after npm install to detect project and set up MCP
async function postinstall(): Promise<void> {
  try {
    const setup = new AutoSetup();
    const result = await setup.detect();

    // Only install MCP for detected tools, silently
    if (result.aiTools.some(t => t.detected)) {
      await setup.installMCPForTools(result);
    }

    // Install git hooks if git repo detected
    if (result.hasGit) {
      await setup.installGitHooks();
    }

    // Output minimal setup info
    console.log(`\n  Shadow Brain v5.0.1 auto-configured for ${result.projectName} (${result.projectType})`);
    if (result.aiTools.some(t => t.detected)) {
      const tools = result.aiTools.filter(t => t.detected).map(t => t.name);
      console.log(`  AI tools detected: ${tools.join(', ')}`);
    }
    console.log(`  Run: shadow-brain start\n`);
  } catch {
    // Silent — never break npm install
  }
}

// Run when executed directly (postinstall)
if (
  process.argv[1] &&
  (process.argv[1].includes('auto-setup') || process.argv[1].includes('dist/brain/auto-setup'))
) {
  postinstall();
}
