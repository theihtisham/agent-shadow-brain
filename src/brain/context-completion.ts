// src/brain/context-completion.ts — Context Completion Engine for Shadow Brain
// Analyzes project to build knowledge, identify gaps, and persist context.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProjectKnowledge, BrainInsight } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
}

/** Read directory entries safely, returning empty on failure. */
async function readDirSafe(dirPath: string): Promise<FileEntry[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      fullPath: path.join(dirPath, e.name),
      isDir: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/** Read a text file safely, returning null on failure. */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Check whether a file exists. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Check whether a directory exists. */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ── ContextCompletionEngine ──────────────────────────────────────────────────

export class ContextCompletionEngine {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Analyze the project directory to build a comprehensive ProjectKnowledge
   * object containing name, conventions, architecture, patterns, and deps.
   */
  async buildKnowledge(): Promise<ProjectKnowledge> {
    const [name, conventions, archResult, patternsResult, deps] = await Promise.all([
      this.detectProjectName(),
      this.detectConventions(),
      this.detectArchitecture(),
      this.detectPatterns(),
      this.detectDependencies(),
    ]);

    return {
      name,
      conventions,
      architecture: archResult.description,
      commonPatterns: patternsResult.common,
      avoidPatterns: patternsResult.avoid,
      dependencies: deps,
      lastUpdated: new Date(),
    };
  }

  /**
   * Persist the knowledge object to `.shadow-brain/knowledge.json` inside
   * the project directory.
   */
  async saveKnowledge(knowledge: ProjectKnowledge): Promise<void> {
    const brainDir = path.join(this.projectDir, '.shadow-brain');
    await fs.mkdir(brainDir, { recursive: true });

    const filePath = path.join(brainDir, 'knowledge.json');
    const data = JSON.stringify(knowledge, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  /**
   * Identify missing project context items (README, .gitignore, tsconfig,
   * CI/CD configs, etc.) and return them as prioritised BrainInsight array.
   */
  async getContextGaps(knowledge: ProjectKnowledge): Promise<BrainInsight[]> {
    const gaps: BrainInsight[] = [];
    const now = new Date();

    // 1. No README.md → critical
    if (!(await this.hasFile('README.md')) && !(await this.hasFile('README'))) {
      gaps.push({
        type: 'warning',
        priority: 'critical',
        title: 'Missing README.md',
        content:
          'The project has no README.md file. A README is essential for onboarding, documentation, and discoverability. Add one with a project description, setup instructions, and usage examples.',
        timestamp: now,
      });
    }

    // 2. No .gitignore → critical
    if (!(await this.hasFile('.gitignore'))) {
      gaps.push({
        type: 'warning',
        priority: 'critical',
        title: 'Missing .gitignore',
        content:
          'No .gitignore file found. Without it, build artifacts, node_modules, secrets, and editor configs may be committed accidentally. Create a .gitignore appropriate for this project type.',
        timestamp: now,
      });
    }

    // 3. No CONTRIBUTING.md in open-source projects → medium
    if (!(await this.hasFile('CONTRIBUTING.md'))) {
      // Heuristic: if there's a LICENSE file, assume open-source
      const hasLicense =
        (await this.hasFile('LICENSE')) ||
        (await this.hasFile('LICENSE.md')) ||
        (await this.hasFile('LICENSE.txt'));
      if (hasLicense) {
        gaps.push({
          type: 'suggestion',
          priority: 'medium',
          title: 'Missing CONTRIBUTING.md',
          content:
            'This project has a license (suggesting open-source) but no CONTRIBUTING.md. Adding contribution guidelines helps the community participate effectively.',
          timestamp: now,
        });
      }
    }

    // 4. No tsconfig.json for TS files → high
    const hasTsFiles = await this.hasFileExtension('.ts');
    if (hasTsFiles && !(await this.hasFile('tsconfig.json'))) {
      gaps.push({
        type: 'warning',
        priority: 'high',
        title: 'Missing tsconfig.json',
        content:
          'TypeScript files were found but no tsconfig.json exists. A tsconfig is required for proper type-checking, module resolution, and compiler options.',
        timestamp: now,
      });
    }

    // 5. No .env.example when .env exists → high (security)
    if (await this.hasFile('.env')) {
      if (
        !(await this.hasFile('.env.example')) &&
        !(await this.hasFile('.env.sample')) &&
        !(await this.hasFile('.env.template'))
      ) {
        gaps.push({
          type: 'warning',
          priority: 'high',
          title: 'Missing .env.example (security risk)',
          content:
            'A .env file exists but there is no .env.example. Collaborators may not know which environment variables are required. Create .env.example with dummy values so the project is documented and secrets are not accidentally shared.',
          timestamp: now,
        });
      }
    }

    // 6. No LICENSE file → medium
    if (
      !(await this.hasFile('LICENSE')) &&
      !(await this.hasFile('LICENSE.md')) &&
      !(await this.hasFile('LICENSE.txt'))
    ) {
      gaps.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Missing LICENSE file',
        content:
          'No license file detected. Without a license, the project defaults to full copyright reservation, which may prevent others from using or contributing. Add a LICENSE file (e.g., MIT, Apache-2.0).',
        timestamp: now,
      });
    }

    // 7. No CI/CD config → low
    const hasCI =
      (await this.hasFile('.github/workflows')) ||
      (await this.hasFile('.gitlab-ci.yml')) ||
      (await this.hasFile('.circleci')) ||
      (await this.hasFile('Jenkinsfile')) ||
      (await this.hasFile('azure-pipelines.yml'));
    if (!hasCI) {
      gaps.push({
        type: 'suggestion',
        priority: 'low',
        title: 'No CI/CD configuration',
        content:
          'No CI/CD pipeline configuration found. Adding automated testing and deployment (e.g., GitHub Actions) catches regressions early and improves code quality.',
        timestamp: now,
      });
    }

    // 8. Missing type definitions (no @types packages for TS) → medium
    if (hasTsFiles) {
      const pkgContent = await readFileSafe(path.join(this.projectDir, 'package.json'));
      if (pkgContent) {
        try {
          const pkg = JSON.parse(pkgContent);
          const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
          };
          // Check for common libraries that usually need @types
          const typeCandidates: Record<string, string> = {
            express: '@types/express',
            node: '@types/node',
            jest: '@types/jest',
            react: '@types/react',
            lodash: '@types/lodash',
            mongoose: '@types/mongoose',
            cors: '@types/cors',
          };

          const missingTypes: string[] = [];
          for (const [dep, typesPkg] of Object.entries(typeCandidates)) {
            if (allDeps[dep] && !allDeps[typesPkg]) {
              missingTypes.push(typesPkg);
            }
          }

          if (missingTypes.length > 0) {
            gaps.push({
              type: 'suggestion',
              priority: 'medium',
              title: 'Missing @types packages',
              content: `The following type definition packages are recommended but not installed: ${missingTypes.join(', ')}. Install them with: npm i -D ${missingTypes.join(' ')}`,
              timestamp: now,
            });
          }
        } catch {
          // Invalid package.json, skip this check
        }
      }
    }

    // 9. No test configuration → medium
    const hasTestConfig =
      (await this.hasFile('jest.config.js')) ||
      (await this.hasFile('jest.config.ts')) ||
      (await this.hasFile('vitest.config.ts')) ||
      (await this.hasFile('vitest.config.js')) ||
      (await this.hasFile('mocha.opts')) ||
      (await this.hasFile('.mocharc.yml')) ||
      (await this.hasFile('.mocharc.json')) ||
      (await this.hasFile('karma.conf.js')) ||
      (await this.hasFile('pytest.ini')) ||
      (await this.hasFile('pyproject.toml'));
    const hasTestDir =
      (await dirExists(path.join(this.projectDir, 'test'))) ||
      (await dirExists(path.join(this.projectDir, 'tests'))) ||
      (await dirExists(path.join(this.projectDir, '__tests__'))) ||
      (await dirExists(path.join(this.projectDir, 'spec')));
    if (!hasTestConfig && !hasTestDir) {
      gaps.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'No test configuration found',
        content:
          'No test framework configuration or test directories detected. Adding tests (unit, integration) is critical for maintainability and confidence in refactoring.',
        timestamp: now,
      });
    }

    // 10. Empty conventions → low
    if (knowledge.conventions.length === 0) {
      gaps.push({
        type: 'suggestion',
        priority: 'low',
        title: 'No coding conventions detected',
        content:
          'No linting, formatting, or style configuration files were found. Consider adding ESLint, Prettier, or an EditorConfig to enforce consistent code style across the project.',
        timestamp: now,
      });
    }

    return gaps;
  }

  // ── Private: Name Detection ───────────────────────────────────────────────

  private async detectProjectName(): Promise<string> {
    // Try package.json first
    const pkgContent = await readFileSafe(path.join(this.projectDir, 'package.json'));
    if (pkgContent) {
      try {
        const pkg = JSON.parse(pkgContent);
        if (pkg.name && typeof pkg.name === 'string') {
          // Strip scope prefix: @scope/name → name
          return pkg.name.replace(/^@[^/]+\//, '');
        }
      } catch {
        // Fall through
      }
    }

    // Fallback to directory name
    return path.basename(this.projectDir);
  }

  // ── Private: Convention Detection ─────────────────────────────────────────

  private async detectConventions(): Promise<string[]> {
    const conventions: string[] = [];

    // ESLint
    const eslintFiles = [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.ts',
    ];
    for (const f of eslintFiles) {
      const content = await readFileSafe(path.join(this.projectDir, f));
      if (content) {
        conventions.push(this.summarizeEslint(content, f));
        break; // Only one ESLint config matters
      }
    }

    // Also check package.json for eslintConfig
    const pkgContent = await readFileSafe(path.join(this.projectDir, 'package.json'));
    if (pkgContent && !conventions.some((c) => c.startsWith('ESLint'))) {
      try {
        const pkg = JSON.parse(pkgContent);
        if (pkg.eslintConfig) {
          conventions.push(this.summarizeEslint(JSON.stringify(pkg.eslintConfig), 'package.json#eslintConfig'));
        }
      } catch {
        // skip
      }
    }

    // Prettier
    const prettierFiles = ['.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml'];
    for (const f of prettierFiles) {
      const content = await readFileSafe(path.join(this.projectDir, f));
      if (content) {
        conventions.push(this.summarizePrettier(content, f));
        break;
      }
    }

    // Check package.json for prettier config
    if (pkgContent && !conventions.some((c) => c.startsWith('Prettier'))) {
      try {
        const pkg = JSON.parse(pkgContent);
        if (pkg.prettier) {
          conventions.push(this.summarizePrettier(JSON.stringify(pkg.prettier), 'package.json#prettier'));
        }
      } catch {
        // skip
      }
    }

    // EditorConfig
    if (await fileExists(path.join(this.projectDir, '.editorconfig'))) {
      const content = await readFileSafe(path.join(this.projectDir, '.editorconfig'));
      if (content) {
        conventions.push(this.summarizeEditorConfig(content));
      }
    }

    // tsconfig patterns
    const tsconfigContent = await readFileSafe(path.join(this.projectDir, 'tsconfig.json'));
    if (tsconfigContent) {
      conventions.push(this.summarizeTsconfig(tsconfigContent));
    }

    return conventions;
  }

  private summarizeEslint(content: string, fileName: string): string {
    const features: string[] = ['ESLint configured'];

    try {
      // Attempt to parse as JSON for structured configs
      const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const parsed = JSON.parse(cleaned);

      if (parsed.extends) {
        const exts = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
        for (const ext of exts) {
          if (typeof ext === 'string') {
            const base = path.basename(ext);
            features.push(`extends ${base}`);
          }
        }
      }
      if (parsed.parser) {
        features.push(`parser: ${parsed.parser}`);
      }
      if (parsed.rules) {
        const ruleNames = Object.keys(parsed.rules);
        features.push(`${ruleNames.length} custom rules`);
      }
    } catch {
      // JS/YAML config — summarize from text
      if (/typescript/.test(content)) features.push('TypeScript support');
      if (/react/.test(content)) features.push('React plugin');
      if (/import\//.test(content)) features.push('import plugin');
    }

    return `${features.join(', ')} (${fileName})`;
  }

  private summarizePrettier(content: string, fileName: string): string {
    const settings: string[] = ['Prettier configured'];

    try {
      const parsed = JSON.parse(content);
      if (parsed.semi === false) settings.push('no semicolons');
      if (parsed.singleQuote) settings.push('single quotes');
      if (parsed.tabWidth) settings.push(`tab width: ${parsed.tabWidth}`);
      if (parsed.printWidth) settings.push(`print width: ${parsed.printWidth}`);
      if (parsed.trailingComma) settings.push(`trailing comma: ${parsed.trailingComma}`);
    } catch {
      // JS config — best effort text scan
      if (/semi\s*:\s*false/.test(content)) settings.push('no semicolons');
      if (/singleQuote\s*:\s*true/.test(content)) settings.push('single quotes');
    }

    return `${settings.join(', ')} (${fileName})`;
  }

  private summarizeEditorConfig(content: string): string {
    const settings: string[] = ['EditorConfig'];
    if (/indent_style\s*=\s*space/.test(content)) settings.push('indent: spaces');
    if (/indent_style\s*=\s*tab/.test(content)) settings.push('indent: tabs');
    if (/end_of_line\s*=\s*lf/.test(content)) settings.push('LF line endings');
    if (/insert_final_newline\s*=\s*true/.test(content)) settings.push('final newline');
    if (/charset\s*=\s*utf-8/.test(content)) settings.push('UTF-8');
    return settings.join(', ');
  }

  private summarizeTsconfig(content: string): string {
    const features: string[] = ['TypeScript'];

    try {
      const parsed = JSON.parse(content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''));
      const co = parsed.compilerOptions || {};

      if (co.strict) features.push('strict mode');
      if (co.esModuleInterop) features.push('ESM interop');
      if (co.moduleResolution === 'bundler' || co.moduleResolution === 'node') {
        features.push(`${co.moduleResolution} module resolution`);
      }
      if (co.target) features.push(`target: ${co.target}`);
      if (co.module) features.push(`module: ${co.module}`);
      if (co.jsx) features.push(`JSX: ${co.jsx}`);
      if (co.declaration) features.push('declarations enabled');
      if (co.noUncheckedIndexedAccess) features.push('unchecked indexed access check');
      if (co.noImplicitReturns) features.push('implicit returns check');
    } catch {
      // Text-based heuristic
      if (/strict/.test(content)) features.push('strict mode');
      if (/esModuleInterop/.test(content)) features.push('ESM interop');
    }

    return features.join(', ');
  }

  // ── Private: Architecture Detection ───────────────────────────────────────

  private async detectArchitecture(): Promise<{ description: string }> {
    const rootEntries = await readDirSafe(this.projectDir);
    const dirNames = new Set(rootEntries.filter((e) => e.isDir).map((e) => e.name));
    const fileNames = new Set(rootEntries.filter((e) => !e.isDir).map((e) => e.name));

    // Read package.json for framework/library clues
    const pkgContent = await readFileSafe(path.join(this.projectDir, 'package.json'));
    let pkg: Record<string, any> = {};
    if (pkgContent) {
      try {
        pkg = JSON.parse(pkgContent);
      } catch {
        // ignore
      }
    }

    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // Detect architecture patterns
    const parts: string[] = [];

    // Monorepo detection
    if (dirNames.has('packages') || dirNames.has('apps')) {
      parts.push('monorepo');
      // Check for turborepo/nx
      if (fileNames.has('turbo.json') || allDeps['turbo']) parts.push('Turborepo');
      if (dirNames.has('nx.json') || allDeps['nx']) parts.push('Nx');
    }

    // Frontend frameworks
    if (allDeps['next']) parts.push('Next.js');
    else if (allDeps['nuxt'] || allDeps['nuxt3']) parts.push('Nuxt');
    else if (allDeps['gatsby']) parts.push('Gatsby');
    else if (allDeps['react']) parts.push('React');
    else if (allDeps['vue']) parts.push('Vue');
    else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) parts.push('Svelte');
    else if (allDeps['angular'] || allDeps['@angular/core']) parts.push('Angular');
    else if (allDeps['astro']) parts.push('Astro');

    // Backend frameworks
    if (allDeps['express']) parts.push('Express');
    else if (allDeps['fastify']) parts.push('Fastify');
    else if (allDeps['koa']) parts.push('Koa');
    else if (allDeps['nestjs'] || allDeps['@nestjs/core']) parts.push('NestJS');
    else if (allDeps['hono']) parts.push('Hono');
    else if (allDeps['hapi'] || allDeps['@hapi/hapi']) parts.push('Hapi');

    // Full-stack
    if (allDeps['@remix-run/react']) parts.push('Remix');

    // Databases / ORM
    if (allDeps['prisma'] || allDeps['@prisma/client']) parts.push('Prisma');
    else if (allDeps['mongoose']) parts.push('MongoDB/Mongoose');
    else if (allDeps['typeorm']) parts.push('TypeORM');
    else if (allDeps['drizzle-orm']) parts.push('Drizzle');
    else if (allDeps['pg']) parts.push('PostgreSQL');
    else if (allDeps['mysql2']) parts.push('MySQL');

    // Testing
    if (allDeps['jest']) parts.push('Jest');
    else if (allDeps['vitest']) parts.push('Vitest');
    else if (allDeps['mocha']) parts.push('Mocha');

    // Build tools
    if (allDeps['vite']) parts.push('Vite');
    else if (allDeps['webpack'] || allDeps['webpack-cli']) parts.push('Webpack');
    else if (allDeps['esbuild']) parts.push('esbuild');
    else if (allDeps['rollup']) parts.push('Rollup');
    else if (allDeps['tsup']) parts.push('tsup');

    // Language
    if (fileNames.has('tsconfig.json')) parts.unshift('TypeScript');
    else if (this.hasFileExtensionSync(fileNames, '.py')) parts.unshift('Python');
    else if (this.hasFileExtensionSync(fileNames, '.go')) parts.unshift('Go');
    else if (this.hasFileExtensionSync(fileNames, '.rs')) parts.unshift('Rust');

    // Directory structure hints
    if (dirNames.has('src')) {
      if (dirNames.has('src/routes') || dirNames.has('src/controllers')) {
        parts.push('MVC pattern');
      }
      if (dirNames.has('src/components')) {
        parts.push('component-based');
      }
      if (dirNames.has('src/services')) {
        parts.push('service layer');
      }
      if (dirNames.has('src/lib') || dirNames.has('src/utils')) {
        parts.push('utility module');
      }
    }

    if (dirNames.has('api') && dirNames.has('web')) {
      parts.push('API + frontend split');
    }

    // Docker
    if (fileNames.has('Dockerfile') || fileNames.has('docker-compose.yml') || fileNames.has('docker-compose.yaml')) {
      parts.push('Docker');
    }

    const description = parts.length > 0 ? parts.join(' + ') : 'Unknown project structure';

    return { description };
  }

  private hasFileExtensionSync(fileNames: Set<string>, ext: string): boolean {
    return Array.from(fileNames).some((f) => f.endsWith(ext));
  }

  // ── Private: Pattern Detection ────────────────────────────────────────────

  private async detectPatterns(): Promise<{ common: string[]; avoid: string[] }> {
    const common: string[] = [];
    const avoid: string[] = [];

    const srcDir = path.join(this.projectDir, 'src');
    const scanDir = (await dirExists(srcDir)) ? srcDir : this.projectDir;

    // Collect source files (limit to 200 for performance)
    const sourceFiles = await this.collectSourceFiles(scanDir, 200);
    if (sourceFiles.length === 0) {
      return { common, avoid };
    }

    // Sample up to 30 files for content analysis
    const sampleFiles = sourceFiles.slice(0, 30);
    const contents: Map<string, string> = new Map();

    for (const filePath of sampleFiles) {
      const content = await readFileSafe(filePath);
      if (content) {
        contents.set(filePath, content);
      }
    }

    // Analyze import patterns
    const importPatterns: Map<string, number> = new Map();
    for (const [, content] of Array.from(contents.entries())) {
      const importMatches = Array.from(
        content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g),
      );
      for (const match of importMatches) {
        const mod = match[1];
        // Normalize relative imports to pattern
        const pattern = mod.startsWith('.')
          ? 'relative-import'
          : mod.startsWith('@')
            ? `scoped-import:${mod.split('/').slice(0, 2).join('/')}`
            : `external-import:${mod.split('/')[0]}`;
        importPatterns.set(pattern, (importPatterns.get(pattern) || 0) + 1);
      }

      // CommonJS require
      const requireMatches = Array.from(
        content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      );
      for (const match of requireMatches) {
        const mod = match[1];
        const pattern = mod.startsWith('.')
          ? 'relative-require'
          : `external-require:${mod.split('/')[0]}`;
        importPatterns.set(pattern, (importPatterns.get(pattern) || 0) + 1);
      }
    }

    // Report frequent import patterns
    for (const [pattern, count] of Array.from(importPatterns.entries())) {
      if (count >= 3) {
        if (pattern === 'relative-import') {
          common.push('ES module relative imports');
        } else if (pattern === 'relative-require') {
          common.push('CommonJS relative requires');
        } else {
          common.push(`Uses ${pattern.replace(/-/g, ' ')} (${count} occurrences)`);
        }
      }
    }

    // Code style patterns
    let arrowFnCount = 0;
    let asyncAwaitCount = 0;
    let classCount = 0;
    let exportDefaultCount = 0;
    let namedExportCount = 0;
    let typeOnlyImportCount = 0;
    let consoleLogCount = 0;
    let anyTypeCount = 0;
    let evalCount = 0;
    let varCount = 0;

    for (const [, content] of Array.from(contents.entries())) {
      if (/=>\s*\{/.test(content) || /=>\s*[^\{]/.test(content)) arrowFnCount++;
      if (/async\s+/.test(content) && /await\s+/.test(content)) asyncAwaitCount++;
      if (/class\s+\w+/.test(content)) classCount++;
      if (/export\s+default\s+/.test(content)) exportDefaultCount++;
      if (/export\s+(const|function|class|interface|type)\s/.test(content)) namedExportCount++;
      if (/import\s+type\s+/.test(content) || /type\s+.*\s+from/.test(content)) typeOnlyImportCount++;
      if (/console\.log/.test(content)) consoleLogCount++;
      if (/:\s*any\b/.test(content)) anyTypeCount++;
      if (/\beval\s*\(/.test(content)) evalCount++;
      if (/\bvar\s+\w/.test(content)) varCount++;
    }

    const fileCount = contents.size || 1;

    if (arrowFnCount > fileCount * 0.3) common.push('arrow functions preferred');
    if (asyncAwaitCount > fileCount * 0.2) common.push('async/await pattern');
    if (classCount > fileCount * 0.2) common.push('class-based modules');
    if (exportDefaultCount > namedExportCount) common.push('default exports');
    else if (namedExportCount > exportDefaultCount) common.push('named exports');
    if (typeOnlyImportCount > 0) common.push('type-only imports (isolatedModules compatible)');

    // Anti-patterns
    if (consoleLogCount > fileCount * 0.5) {
      avoid.push('excessive console.log — consider a proper logging library');
    }
    if (anyTypeCount > fileCount * 0.3) {
      avoid.push('excessive use of `any` type — use specific types for safety');
    }
    if (evalCount > 0) {
      avoid.push('use of eval() — security and performance risk');
    }
    if (varCount > fileCount * 0.2) {
      avoid.push('use of var — prefer const or let');
    }

    // Detect naming conventions from filenames
    const fileBasenames = sourceFiles.map((f) => path.basename(f, path.extname(f)));
    const kebabCount = fileBasenames.filter((n) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n)).length;
    const camelCount = fileBasenames.filter((n) => /^[a-z][a-zA-Z0-9]+$/.test(n)).length;
    const pascalCount = fileBasenames.filter((n) => /^[A-Z][a-zA-Z0-9]+$/.test(n)).length;
    const snakeCount = fileBasenames.filter((n) => /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(n)).length;

    if (kebabCount > fileBasenames.length * 0.5) common.push('kebab-case file naming');
    else if (camelCount > fileBasenames.length * 0.5) common.push('camelCase file naming');
    else if (pascalCount > fileBasenames.length * 0.5) common.push('PascalCase file naming');
    else if (snakeCount > fileBasenames.length * 0.5) common.push('snake_case file naming');

    return { common, avoid };
  }

  // ── Private: Dependency Detection ─────────────────────────────────────────

  private async detectDependencies(): Promise<string[]> {
    const pkgContent = await readFileSafe(path.join(this.projectDir, 'package.json'));
    if (!pkgContent) {
      // Try other package managers
      const cargoContent = await readFileSafe(path.join(this.projectDir, 'Cargo.toml'));
      if (cargoContent) {
        return this.parseCargoDeps(cargoContent);
      }
      const requirementsContent = await readFileSafe(path.join(this.projectDir, 'requirements.txt'));
      if (requirementsContent) {
        return requirementsContent
          .split('\n')
          .map((l) => l.split('==')[0].split('>=')[0].split('~=')[0].trim())
          .filter((l) => l && !l.startsWith('#'));
      }
      const goModContent = await readFileSafe(path.join(this.projectDir, 'go.mod'));
      if (goModContent) {
        return goModContent
          .split('\n')
          .filter((l) => l.includes('/'))
          .map((l) => l.trim().split(' ')[0])
          .filter((l) => l && !l.startsWith('module') && !l.startsWith('go '));
      }
      return [];
    }

    try {
      const pkg = JSON.parse(pkgContent);
      const deps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      return Object.keys(deps).sort();
    } catch {
      return [];
    }
  }

  private parseCargoDeps(content: string): string[] {
    const deps: string[] = [];
    let inDeps = false;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '[dependencies]') {
        inDeps = true;
        continue;
      }
      if (trimmed.startsWith('[')) {
        inDeps = false;
        continue;
      }
      if (inDeps && trimmed.includes('=')) {
        const name = trimmed.split('=')[0].trim();
        if (name) deps.push(name);
      }
    }

    return deps;
  }

  // ── Private: File Utilities ───────────────────────────────────────────────

  private async hasFile(name: string): Promise<boolean> {
    return fileExists(path.join(this.projectDir, name));
  }

  private async hasFileExtension(ext: string): Promise<boolean> {
    // Check top-level src directory
    const candidates = [this.projectDir];

    const srcDir = path.join(this.projectDir, 'src');
    if (await dirExists(srcDir)) {
      candidates.push(srcDir);
    }

    for (const dir of candidates) {
      const entries = await readDirSafe(dir);
      for (const entry of entries) {
        if (!entry.isDir && entry.name.endsWith(ext)) {
          return true;
        }
        // Check one level deep
        if (entry.isDir && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subEntries = await readDirSafe(entry.fullPath);
          for (const sub of subEntries) {
            if (!sub.isDir && sub.name.endsWith(ext)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Recursively collect source files up to a limit.
   * Skips node_modules, .git, dist, build, coverage, and hidden directories.
   */
  private async collectSourceFiles(dir: string, limit: number): Promise<string[]> {
    const results: string[] = [];
    const skipDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      '.cache',
      '.turbo',
      '__pycache__',
      'target',
      'vendor',
    ]);

    const sourceExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.rb',
    ]);

    const queue: string[] = [dir];

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      const entries = await readDirSafe(current);

      for (const entry of entries) {
        if (results.length >= limit) break;

        if (entry.isDir) {
          if (!entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
            queue.push(entry.fullPath);
          }
        } else {
          const ext = path.extname(entry.name);
          if (sourceExtensions.has(ext)) {
            results.push(entry.fullPath);
          }
        }
      }
    }

    return results;
  }
}
