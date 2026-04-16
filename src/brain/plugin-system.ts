// src/brain/plugin-system.ts — Extensible Plugin Architecture
// Hookable analysis pipeline for third-party extensions
// v5.0.1 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import {
  PluginManifest,
  PluginHook,
  PluginInstance,
  BrainInsight,
} from '../types.js';

const PLUGINS_DIR_NAME = 'shadow-brain-plugins';
const NPM_PLUGIN_KEYWORD = 'shadow-brain-plugin';

type HookEvent = PluginHook['event'];
type HookContext = Record<string, unknown>;

interface HookResult {
  insights?: BrainInsight[];
  modified?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * PluginSystem — extensible plugin architecture.
 *
 * Supports:
 * 1. Local plugins from project `shadow-brain-plugins/` directory
 * 2. npm packages with `shadow-brain-plugin` keyword
 * 3. Hookable analysis pipeline with priority ordering
 * 4. Plugin isolation — errors in one plugin don't crash others
 * 5. Hot-reload during development
 */
export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();
  private hooks: Map<HookEvent, Array<{ plugin: string; hook: PluginHook }>> = new Map();
  private projectDir: string;
  private pluginsDir: string;

  constructor(projectDir?: string) {
    this.projectDir = projectDir || process.cwd();
    this.pluginsDir = path.join(this.projectDir, PLUGINS_DIR_NAME);
  }

  // ── Plugin Management ──────────────────────────────────────────────────────

  /**
   * Discover and load all available plugins.
   */
  async loadAll(): Promise<{ loaded: number; errors: number }> {
    let loaded = 0;
    let errors = 0;

    // Load local plugins from project directory
    if (fs.existsSync(this.pluginsDir)) {
      const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(this.pluginsDir, entry.name);
        const result = await this.loadPlugin(pluginDir);
        if (result) loaded++;
        else errors++;
      }
    }

    // Load npm plugins from node_modules
    const npmPlugins = this.discoverNpmPlugins();
    for (const npmPlugin of npmPlugins) {
      const result = await this.loadPlugin(npmPlugin);
      if (result) loaded++;
      else errors++;
    }

    return { loaded, errors };
  }

  /**
   * Load a single plugin from its directory.
   */
  async loadPlugin(pluginDir: string): Promise<boolean> {
    try {
      const manifestPath = path.join(pluginDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return false;

      const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const manifest: PluginManifest = {
        name: manifestData.name,
        version: manifestData.version || '1.0.0',
        description: manifestData.description || '',
        author: manifestData.author || 'unknown',
        main: manifestData.main || 'index.js',
        hooks: (manifestData.hooks || []).map((h: Record<string, unknown>) => ({
          event: h.event as HookEvent,
          handler: h.handler as string,
          priority: (h.priority as number) || 50,
        })),
        dependencies: manifestData.dependencies || [],
      };

      if (!manifest.name || manifest.hooks.length === 0) return false;

      // Validate handler files exist
      for (const hook of manifest.hooks) {
        const handlerPath = path.join(pluginDir, hook.handler);
        if (!fs.existsSync(handlerPath)) {
          return false;
        }
      }

      // Register plugin
      const instance: PluginInstance = {
        manifest,
        enabled: true,
        loadedAt: new Date(),
        errorCount: 0,
      };

      this.plugins.set(manifest.name, instance);

      // Register hooks
      for (const hook of manifest.hooks) {
        const hookEntry = { plugin: manifest.name, hook };
        const existing = this.hooks.get(hook.event) || [];
        existing.push(hookEntry);
        existing.sort((a, b) => (a.hook.priority ?? 50) - (b.hook.priority ?? 50));
        this.hooks.set(hook.event, existing);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unload a plugin by name.
   */
  unloadPlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // Remove hooks
    for (const [event, hookList] of this.hooks.entries()) {
      this.hooks.set(
        event,
        hookList.filter(h => h.plugin !== name)
      );
    }

    this.plugins.delete(name);
    return true;
  }

  /**
   * Enable/disable a plugin.
   */
  setPluginEnabled(name: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = enabled;
    return true;
  }

  // ── Hook Execution ─────────────────────────────────────────────────────────

  /**
   * Execute hooks for a given event, passing context to each handler.
   */
  async executeHooks(event: HookEvent, context: HookContext = {}): Promise<HookResult[]> {
    const hookList = this.hooks.get(event) || [];
    const results: HookResult[] = [];

    for (const { plugin: pluginName, hook } of hookList) {
      const plugin = this.plugins.get(pluginName);
      if (!plugin || !plugin.enabled) continue;

      try {
        const result = await this.executeHandler(plugin, hook, context);
        results.push(result);

        // If handler modified context, pass updated context to next hook
        if (result.modified && result.data) {
          Object.assign(context, result.data);
        }
      } catch (err) {
        plugin.errorCount++;
        plugin.lastError = err instanceof Error ? err.message : String(err);
        results.push({ error: plugin.lastError });

        // Disable plugin after 5 consecutive errors
        if (plugin.errorCount >= 5) {
          plugin.enabled = false;
        }
      }
    }

    return results;
  }

  /**
   * Execute pre-analysis hooks — can filter/modify files before analysis.
   */
  async preAnalysis(context: { files: string[]; projectDir: string }): Promise<{
    files: string[];
    extraInsights: BrainInsight[];
  }> {
    const results = await this.executeHooks('pre-analysis', context as unknown as HookContext);

    let files = context.files;
    const extraInsights: BrainInsight[] = [];

    for (const result of results) {
      if (result.insights) extraInsights.push(...result.insights);
      if (result.data?.files && Array.isArray(result.data.files)) {
        files = result.data.files as string[];
      }
    }

    return { files, extraInsights };
  }

  /**
   * Execute post-analysis hooks — can modify/filter insights after analysis.
   */
  async postAnalysis(context: { insights: BrainInsight[]; healthScore: number }): Promise<{
    insights: BrainInsight[];
  }> {
    const results = await this.executeHooks('post-analysis', context as unknown as HookContext);

    let insights = context.insights;

    for (const result of results) {
      if (result.insights) {
        insights = [...insights, ...result.insights];
      }
      if (result.data?.filteredInsights && Array.isArray(result.data.filteredInsights)) {
        const filteredTitles = new Set(
          (result.data.filteredInsights as Array<{ title?: string }>).map(i => i.title)
        );
        insights = insights.filter(i => !filteredTitles.has(i.title));
      }
    }

    return { insights };
  }

  // ── Plugin Discovery ───────────────────────────────────────────────────────

  /**
   * Discover npm packages with the shadow-brain-plugin keyword.
   */
  private discoverNpmPlugins(): string[] {
    const plugins: string[] = [];
    const nodeModules = path.join(this.projectDir, 'node_modules');

    if (!fs.existsSync(nodeModules)) return plugins;

    try {
      // Check top-level packages
      const packages = fs.readdirSync(nodeModules, { withFileTypes: true });
      for (const pkg of packages) {
        if (!pkg.isDirectory()) continue;
        if (pkg.name.startsWith('.')) continue;

        const pkgPath = path.join(nodeModules, pkg.name);
        const manifestPath = path.join(pkgPath, 'manifest.json');
        const pkgJsonPath = path.join(pkgPath, 'package.json');

        // Check if it's a shadow-brain plugin
        if (fs.existsSync(manifestPath)) {
          plugins.push(pkgPath);
          continue;
        }

        // Check package.json for keyword
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
            if (Array.isArray(pkgJson.keywords) && pkgJson.keywords.includes(NPM_PLUGIN_KEYWORD)) {
              plugins.push(pkgPath);
            }
          } catch {
            // Skip
          }
        }
      }

      // Check scoped packages
      const scopedDirs = packages.filter(p => p.isDirectory() && p.name.startsWith('@'));
      for (const scoped of scopedDirs) {
        const scopedPath = path.join(nodeModules, scoped.name);
        try {
          const subPackages = fs.readdirSync(scopedPath, { withFileTypes: true });
          for (const sub of subPackages) {
            if (!sub.isDirectory()) continue;
            const pkgJsonPath = path.join(scopedPath, sub.name, 'package.json');
            const manifestPath = path.join(scopedPath, sub.name, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              plugins.push(path.join(scopedPath, sub.name));
            } else if (fs.existsSync(pkgJsonPath)) {
              try {
                const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                if (Array.isArray(pkgJson.keywords) && pkgJson.keywords.includes(NPM_PLUGIN_KEYWORD)) {
                  plugins.push(path.join(scopedPath, sub.name));
                }
              } catch {
                // Skip
              }
            }
          }
        } catch {
          // Permission denied
        }
      }
    } catch {
      // node_modules not accessible
    }

    return plugins;
  }

  /**
   * Execute a plugin handler function.
   */
  private async executeHandler(
    plugin: PluginInstance,
    hook: PluginHook,
    context: HookContext
  ): Promise<HookResult> {
    const pluginDir = this.getPluginDir(plugin.manifest.name);
    const handlerPath = path.join(pluginDir, hook.handler);

    if (!fs.existsSync(handlerPath)) {
      return { error: `Handler not found: ${hook.handler}` };
    }

    // Dynamic import of handler module
    try {
      const module = await import(`file://${handlerPath.replace(/\\/g, '/')}`);
      const handler = module.default || module.handler || module[Object.keys(module)[0]];

      if (typeof handler === 'function') {
        const result = await handler(context);
        return {
          insights: result?.insights || [],
          modified: result?.modified || false,
          data: result?.data || {},
        };
      }

      return { error: `No valid handler function in ${hook.handler}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private getPluginDir(pluginName: string): string {
    // Check local plugins first
    const localDir = path.join(this.pluginsDir, pluginName);
    if (fs.existsSync(localDir)) return localDir;

    // Check node_modules
    const nodeModulesDir = path.join(this.projectDir, 'node_modules', pluginName);
    if (fs.existsSync(nodeModulesDir)) return nodeModulesDir;

    return localDir;
  }

  // ── Query & Stats ──────────────────────────────────────────────────────────

  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  getHooks(event?: HookEvent): Array<{ plugin: string; hook: PluginHook }> {
    if (event) return this.hooks.get(event) || [];
    const all: Array<{ plugin: string; hook: PluginHook }> = [];
    for (const [, hooks] of this.hooks) {
      all.push(...hooks);
    }
    return all;
  }

  getStats(): {
    totalPlugins: number;
    enabledPlugins: number;
    disabledPlugins: number;
    totalHooks: number;
    hooksByEvent: Record<string, number>;
    errors: number;
  } {
    let enabled = 0;
    let disabled = 0;
    let errors = 0;
    let totalHooks = 0;
    const hooksByEvent: Record<string, number> = {};

    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) enabled++;
      else disabled++;
      if (plugin.errorCount > 0) errors++;
    }

    for (const [event, hooks] of this.hooks) {
      hooksByEvent[event] = hooks.length;
      totalHooks += hooks.length;
    }

    return {
      totalPlugins: this.plugins.size,
      enabledPlugins: enabled,
      disabledPlugins: disabled,
      totalHooks,
      hooksByEvent,
      errors,
    };
  }

  /**
   * Create a template plugin in the project's plugins directory.
   */
  createTemplate(name: string): string {
    const pluginDir = path.join(this.pluginsDir, name);
    if (fs.existsSync(pluginDir)) {
      throw new Error(`Plugin "${name}" already exists`);
    }

    fs.mkdirSync(pluginDir, { recursive: true });

    // manifest.json
    const manifest: PluginManifest = {
      name,
      version: '1.0.0',
      description: `Shadow Brain plugin: ${name}`,
      author: 'anonymous',
      main: 'index.js',
      hooks: [
        { event: 'post-analysis', handler: 'index.js', priority: 50 },
      ],
    };
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // index.js template
    const handlerCode = `// Shadow Brain Plugin: ${name}
// Hook: post-analysis
// Modify the context to add custom insights or filter existing ones

export default async function handler(context) {
  const { insights, healthScore } = context;

  // Example: Add a custom insight
  const customInsight = {
    priority: 'info',
    type: 'custom',
    title: '${name} plugin active',
    content: 'This is a custom insight from the ${name} plugin.',
    file: '',
    line: 0,
  };

  return {
    insights: [customInsight],
    modified: true,
    data: {},
  };
}
`;
    fs.writeFileSync(path.join(pluginDir, 'index.js'), handlerCode);

    return pluginDir;
  }
}
