#!/usr/bin/env node
// src/cli.ts — CLI entry point for Shadow Brain v1.2.0

import { Command } from 'commander';
import chalk from 'chalk';
import Conf from 'conf';
import * as fs from 'fs';
import * as path from 'path';
import { Orchestrator } from './brain/orchestrator.js';
import { detectRunningAgents, createAdapter } from './adapters/index.js';
import { BaseAdapter } from './adapters/base-adapter.js';
import { BrainConfig, BrainInsight, AgentTool, BrainPersonality, LLMProvider } from './types.js';
import { checkForUpdate, formatUpdateNotice } from './brain/auto-update.js';

const VERSION = '1.2.0';

const config: any = new Conf({
  projectName: 'shadow-brain',
  defaults: {
    provider: 'ollama',
    model: undefined,
    agents: ['claude-code', 'kilo-code', 'cline', 'opencode', 'codex'],
    projectDir: process.cwd(),
    watchMode: true,
    autoInject: true,
    reviewDepth: 'standard',
    brainPersonality: 'balanced',
  },
});

function mergeConfig(cliOpts: any): BrainConfig {
  const saved = config.store;
  return {
    provider: (cliOpts.provider || saved.provider || 'ollama') as LLMProvider,
    apiKey: cliOpts.apiKey || saved.apiKey,
    model: cliOpts.model || saved.model,
    agents: (cliOpts.agents?.split(',') || saved.agents || ['claude-code']) as AgentTool[],
    projectDir: cliOpts.projectDir || cliOpts.args?.[0] || saved.projectDir || process.cwd(),
    watchMode: cliOpts.watch !== false && (saved.watchMode !== false),
    autoInject: cliOpts.inject !== false && (saved.autoInject !== false),
    reviewDepth: (cliOpts.depth || saved.reviewDepth || 'standard') as BrainConfig['reviewDepth'],
    brainPersonality: (cliOpts.personality || saved.brainPersonality || 'balanced') as BrainPersonality,
  };
}

// ─── START ────────────────────────────────────────────────────────────────────
const startCmd = new Command('start')
  .description('Start Shadow Brain in watch mode')
  .argument('[project-dir]', 'Project directory to watch', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider (anthropic|openai|ollama|openrouter)')
  .option('-m, --model <model>', 'LLM model name')
  .option('-k, --api-key <key>', 'API key for the LLM provider')
  .option('--personality <type>', 'Brain personality (mentor|critic|architect|security|performance|balanced)')
  .option('--no-inject', 'Disable auto-injection of insights')
  .option('--depth <depth>', 'Review depth (quick|standard|deep)')
  .option('--agents <agents>', 'Comma-separated list of agents to watch')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir });

    console.log(chalk.magenta.bold(`\n  SHADOW BRAIN v${VERSION}`));
    console.log(chalk.dim('  Watching: ') + chalk.cyan(brainConfig.projectDir));
    console.log(chalk.dim('  Provider: ') + chalk.cyan(brainConfig.provider));
    console.log(chalk.dim('  Personality: ') + chalk.cyan(brainConfig.brainPersonality));
    console.log(chalk.dim('  Agents: ') + chalk.cyan(brainConfig.agents.join(', ')));
    console.log();

    const orchestrator = new Orchestrator(brainConfig);

    // Forward health-score and fixes events to console when not in dashboard mode
    orchestrator.on('health-score', ({ score }) => {
      const color = score.overall >= 85 ? 'green' : score.overall >= 70 ? 'yellow' : 'red';
      console.log(chalk[color](`  ⬟ Health: ${score.overall}/100 (${score.grade})`));
    });

    orchestrator.on('fixes', ({ fixes }) => {
      console.log(chalk.cyan(`  🔧 ${fixes.length} smart fix suggestion(s) available — run: shadow-brain fix`));
    });

    const shutdown = async () => {
      console.log(chalk.yellow('\n  Shutting down Shadow Brain...'));
      await orchestrator.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      await orchestrator.start();
      const { renderDashboard } = await import('./ui/dashboard.js');
      await renderDashboard(orchestrator);
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── REVIEW ───────────────────────────────────────────────────────────────────
const reviewCmd = new Command('review')
  .description('Run a one-shot analysis of the project')
  .argument('[project-dir]', 'Project directory to review', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-m, --model <model>', 'LLM model name')
  .option('-k, --api-key <key>', 'API key')
  .option('--depth <depth>', 'Review depth (quick|standard|deep)')
  .option('--output <format>', 'Output format (text|json|markdown)', 'text')
  .option('--show-health', 'Also display health score after review')
  .option('--show-fixes', 'Also display smart fix suggestions')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Analyzing project...'));
      const insights = await orchestrator.reviewOnce();

      if (insights.length === 0) {
        console.log(chalk.dim('  No insights generated.'));
      } else {
        switch (opts.output) {
          case 'json':
            console.log(JSON.stringify(insights, null, 2));
            break;
          case 'markdown':
            for (const insight of insights) {
              const emoji = insight.priority === 'critical' ? '🚨' : insight.priority === 'high' ? '⚠️' : '💡';
              console.log(`\n## ${emoji} [${insight.type.toUpperCase()}] ${insight.title}\n`);
              console.log(`**Priority:** ${insight.priority} | **Type:** ${insight.type}`);
              if (insight.files?.length) console.log(`**Files:** ${insight.files.map(f => `\`${f}\``).join(', ')}`);
              console.log(`\n${insight.content}\n`);
            }
            break;
          default: // text
            console.log(chalk.bold(`\n  Shadow Brain Analysis (${insights.length} insights)\n`));
            for (const insight of insights) {
              const color = insight.priority === 'critical' ? 'red' : insight.priority === 'high' ? 'yellow' : insight.priority === 'medium' ? 'blue' : 'gray';
              console.log(chalk`  {${color}.bold [${insight.priority.toUpperCase()}]} ${insight.title}`);
              console.log(chalk.dim(`    Type: ${insight.type} | Files: ${insight.files?.join(', ') || 'none'}`));
              console.log(`    ${insight.content.slice(0, 200)}${insight.content.length > 200 ? '...' : ''}`);
              console.log();
            }
            break;
        }
      }

      // Optional: show health score inline
      if (opts.showHealth) {
        const score = orchestrator.getLastHealthScore();
        if (score) process.stdout.write(orchestrator.formatHealthScore(score));
      }

      // Optional: show fixes inline
      if (opts.showFixes) {
        const fixes = orchestrator.getLastFixes();
        process.stdout.write(orchestrator.formatFixes(fixes));
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── REPORT ───────────────────────────────────────────────────────────────────
const reportCmd = new Command('report')
  .description('Generate a comprehensive project report')
  .argument('[project-dir]', 'Project directory to analyze', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-k, --api-key <key>', 'API key')
  .option('-f, --format <format>', 'Report format: html|markdown|json', 'html')
  .option('-o, --output <file>', 'Output file path (default: shadow-brain-report.<ext>)')
  .option('--open', 'Open the HTML report in browser after generation')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    const fmt = (opts.format || 'html') as 'html' | 'markdown' | 'json';
    const extMap = { html: 'html', markdown: 'md', json: 'json' };
    const ext = extMap[fmt];
    const outPath = opts.output || path.join(process.cwd(), `shadow-brain-report.${ext}`);

    try {
      console.log(chalk.cyan('  Analyzing project...'));
      await orchestrator.reviewOnce();

      console.log(chalk.cyan(`  Generating ${fmt.toUpperCase()} report...`));
      const content = await orchestrator.generateReport(fmt);

      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, content, 'utf-8');

      console.log(chalk.green(`\n  ✓ Report saved to: ${outPath}`));
      console.log(chalk.dim(`    Format: ${fmt} | Size: ${(content.length / 1024).toFixed(1)}KB`));

      if (opts.open && fmt === 'html') {
        const { exec } = await import('child_process');
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${outPath}"`);
        console.log(chalk.dim('  Opening in browser...'));
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── HEALTH ───────────────────────────────────────────────────────────────────
const healthCmd = new Command('health')
  .description('Show code health score for the project')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-k, --api-key <key>', 'API key')
  .option('--badge', 'Print health badge as SVG to stdout')
  .option('--json', 'Output health score as JSON')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Computing health score...'));
      await orchestrator.reviewOnce();
      const score = orchestrator.getLastHealthScore();

      if (!score) {
        console.log(chalk.dim('  No health data available.'));
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(score, null, 2));
        return;
      }

      if (opts.badge) {
        // Import the health engine to generate badge
        const { HealthScoreEngine } = await import('./brain/health-score.js');
        const engine = new HealthScoreEngine();
        await engine.load();
        console.log(engine.generateBadgeSvg(score));
        return;
      }

      console.log(chalk.magenta.bold(`\n  SHADOW BRAIN Health Report\n`));
      process.stdout.write(orchestrator.formatHealthScore(score));
      console.log();
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── FIX ──────────────────────────────────────────────────────────────────────
const fixCmd = new Command('fix')
  .description('Show smart fix suggestions for current code changes')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-k, --api-key <key>', 'API key')
  .option('--json', 'Output fixes as JSON')
  .option('--markdown', 'Output fixes as markdown')
  .option('--category <cat>', 'Filter: security|performance|quality|architecture')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      await orchestrator.reviewOnce();
      let fixes = orchestrator.getLastFixes();

      // Filter by category
      if (opts.category) {
        fixes = fixes.filter(f => f.category === opts.category);
      }

      if (opts.json) {
        console.log(JSON.stringify(fixes, null, 2));
        return;
      }

      if (opts.markdown) {
        const { SmartFixEngine } = await import('./brain/smart-fix.js');
        const engine = new SmartFixEngine();
        console.log(engine.toMarkdown(fixes));
        return;
      }

      console.log(chalk.magenta.bold(`\n  SHADOW BRAIN Smart Fix Engine\n`));
      process.stdout.write(orchestrator.formatFixes(fixes));
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── CI ───────────────────────────────────────────────────────────────────────
const ciCmd = new Command('ci')
  .description('Generate GitHub Actions CI workflow for Shadow Brain')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('-o, --output <file>', 'Output file path', '.github/workflows/shadow-brain.yml')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      const yaml = await orchestrator.generateCIWorkflow();
      const outPath = path.resolve(projectDir, opts.output);
      const dir = path.dirname(outPath);

      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, yaml, 'utf-8');

      console.log(chalk.green(`\n  ✓ GitHub Actions workflow generated: ${outPath}`));
      console.log(chalk.dim('  Commit this file to enable Shadow Brain CI reviews on every PR.\n'));
      console.log(chalk.dim('  The workflow will:'));
      console.log(chalk.dim('    • Run Shadow Brain analysis on every push/PR'));
      console.log(chalk.dim('    • Post health score as a PR comment'));
      console.log(chalk.dim('    • Upload full HTML report as build artifact'));
      console.log(chalk.dim('    • Run language-specific lint/test jobs'));
      console.log();
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── HOOK ─────────────────────────────────────────────────────────────────────
const hookCmd = new Command('hook')
  .description('Install a pre-commit hook that runs Shadow Brain before each commit')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('--uninstall', 'Remove the pre-commit hook')
  .action(async (projectDir: string, opts: any) => {
    const hookPath = path.join(projectDir, '.git', 'hooks', 'pre-commit');

    if (opts.uninstall) {
      if (fs.existsSync(hookPath)) {
        const content = fs.readFileSync(hookPath, 'utf-8');
        if (content.includes('shadow-brain')) {
          fs.unlinkSync(hookPath);
          console.log(chalk.green('  ✓ Pre-commit hook removed.'));
        } else {
          console.log(chalk.yellow('  ⚠ Hook exists but was not created by Shadow Brain. Skipping.'));
        }
      } else {
        console.log(chalk.dim('  No pre-commit hook found.'));
      }
      return;
    }

    const gitDir = path.join(projectDir, '.git');
    if (!fs.existsSync(gitDir)) {
      console.error(chalk.red('  Error: Not a git repository. Run inside a git project.'));
      process.exit(1);
    }

    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf-8');
      if (existing.includes('shadow-brain')) {
        console.log(chalk.dim('  Pre-commit hook already installed. Run with --uninstall to remove.'));
        return;
      }
      console.log(chalk.yellow('  ⚠ A pre-commit hook already exists. Please add Shadow Brain manually.'));
      console.log(chalk.dim(`  Hook path: ${hookPath}`));
      return;
    }

    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);
    const script = orchestrator.generatePreCommitHook();

    fs.writeFileSync(hookPath, script, { encoding: 'utf-8', mode: 0o755 });

    console.log(chalk.green('\n  ✓ Pre-commit hook installed!'));
    console.log(chalk.dim(`  Location: ${hookPath}`));
    console.log(chalk.dim('  Shadow Brain will now analyze your changes before each commit.'));
    console.log(chalk.dim('  If critical issues are found, the commit will be blocked.'));
    console.log(chalk.dim('  To bypass: git commit --no-verify'));
    console.log();
  });

// ─── INJECT ───────────────────────────────────────────────────────────────────
const injectCmd = new Command('inject')
  .description('Manually inject a message into agent memory')
  .argument('<message>', 'The insight message to inject')
  .option('-t, --type <type>', 'Insight type (review|suggestion|warning|context|pattern|instruction)', 'instruction')
  .option('--priority <level>', 'Priority level (critical|high|medium|low)', 'medium')
  .option('--agent <agent>', 'Target specific agent (default: all detected)')
  .option('--project-dir <dir>', 'Project directory', process.cwd())
  .action(async (message: string, opts: any) => {
    const insight: BrainInsight = {
      type: opts.type as BrainInsight['type'],
      priority: opts.priority as BrainInsight['priority'],
      title: message.slice(0, 100),
      content: message,
      files: [],
      timestamp: new Date(),
    };

    try {
      const detected = await detectRunningAgents(opts.projectDir || process.cwd());
      const targets: BaseAdapter[] = opts.agent
        ? detected.filter((a: any) => a.name === opts.agent) as BaseAdapter[]
        : detected as BaseAdapter[];

      if (targets.length === 0) {
        if (opts.agent) {
          const adapter = createAdapter(opts.agent as AgentTool) as BaseAdapter;
          adapter.setProjectDir(opts.projectDir || process.cwd());
          targets.push(adapter);
        } else {
          console.log(chalk.yellow('  No agents detected. Use --agent to specify a target.'));
          return;
        }
      }

      for (const adapter of targets) {
        const success = await adapter.injectContext(insight);
        console.log(success
          ? chalk.green(`  ✓ Injected into ${adapter.displayName}`)
          : chalk.red(`  ✗ Failed to inject into ${adapter.displayName}`)
        );
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
    }
  });

// ─── STATUS ───────────────────────────────────────────────────────────────────
const statusCmd = new Command('status')
  .description('Show current Shadow Brain configuration and status')
  .action(async () => {
    const saved = config.store;

    console.log(chalk.magenta.bold(`\n  SHADOW BRAIN v${VERSION} Status\n`));

    console.log(chalk.dim('  Provider:   ') + chalk.cyan(saved.provider || 'ollama'));
    console.log(chalk.dim('  Model:      ') + chalk.cyan(saved.model || '(default)'));
    console.log(chalk.dim('  API Key:    ') + chalk.cyan(saved.apiKey ? '••••••••' : '(not set)'));
    console.log(chalk.dim('  Personality:') + chalk.cyan(saved.brainPersonality || 'balanced'));
    console.log(chalk.dim('  Review:     ') + chalk.cyan(saved.reviewDepth || 'standard'));
    console.log(chalk.dim('  Auto-Inject:') + chalk.cyan(saved.autoInject !== false ? 'enabled' : 'disabled'));
    console.log(chalk.dim('  Agents:     ') + chalk.cyan((saved.agents || []).join(', ')));
    console.log(chalk.dim('  Project:    ') + chalk.cyan(saved.projectDir || process.cwd()));
    console.log();

    try {
      const detected = await detectRunningAgents(saved.projectDir || process.cwd());
      if (detected.length > 0) {
        console.log(chalk.green('  Detected agents:'));
        for (const a of detected) {
          console.log(chalk.green(`    ✓ ${a.displayName} (${a.name})`));
        }
      } else {
        console.log(chalk.dim('  No agents currently detected.'));
      }
    } catch {
      console.log(chalk.dim('  Could not detect running agents.'));
    }
    console.log();
  });

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const configCmd = new Command('config')
  .description('Configure Shadow Brain settings')
  .argument('[key]', 'Config key to set')
  .argument('[value]', 'Value to set')
  .option('--list', 'List all configuration values')
  .option('--reset', 'Reset to default configuration')
  .action(async (key?: string, value?: string, opts?: any) => {
    if (opts?.list) {
      console.log(chalk.magenta.bold('\n  SHADOW BRAIN Configuration\n'));
      const saved = config.store;
      for (const [k, v] of Object.entries(saved)) {
        const display = k === 'apiKey' && v ? '••••••••' : String(v);
        console.log(chalk.dim(`  ${k}: `) + chalk.cyan(display));
      }
      console.log();
      return;
    }

    if (opts?.reset) {
      config.clear();
      console.log(chalk.green('  Configuration reset to defaults.'));
      return;
    }

    if (key && value) {
      let parsedValue: any = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value))) parsedValue = Number(value);
      else if (value.includes(',')) parsedValue = value.split(',');

      config.set(key as any, parsedValue);
      console.log(chalk.green(`  Set ${key} = ${parsedValue}`));
      return;
    }

    console.log(chalk.dim('  Usage: shadow-brain config <key> <value>'));
    console.log(chalk.dim('         shadow-brain config --list'));
    console.log(chalk.dim('         shadow-brain config --reset'));
  });

// ─── SETUP ────────────────────────────────────────────────────────────────────
const setupCmd = new Command('setup')
  .description('Interactive setup wizard for first-time configuration')
  .action(async () => {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

    console.log(chalk.magenta.bold(`\n  SHADOW BRAIN v${VERSION} Setup Wizard\n`));
    console.log(chalk.dim('  This will configure your Shadow Brain installation.\n'));

    console.log(chalk.cyan('  LLM Providers:'));
    console.log(chalk.dim('    1. ollama    (free, local — default)'));
    console.log(chalk.dim('    2. anthropic (Claude API)'));
    console.log(chalk.dim('    3. openai    (GPT-4o API)'));
    console.log(chalk.dim('    4. openrouter (multi-model gateway)'));
    const provider = await ask(chalk.yellow('  Choose provider [1-4] (default: 1): '));
    const providerMap: Record<string, string> = { '1': 'ollama', '2': 'anthropic', '3': 'openai', '4': 'openrouter' };
    const chosenProvider = providerMap[provider.trim() || '1'] || 'ollama';
    config.set('provider', chosenProvider);
    console.log(chalk.green(`  ✓ Provider: ${chosenProvider}\n`));

    if (chosenProvider !== 'ollama') {
      const apiKey = await ask(chalk.yellow(`  Enter ${chosenProvider} API key: `));
      if (apiKey.trim()) {
        config.set('apiKey', apiKey.trim());
        console.log(chalk.green('  ✓ API key saved\n'));
      } else {
        console.log(chalk.yellow('  ⚠ No API key provided — you can set it later with: shadow-brain config apiKey <key>\n'));
      }
    } else {
      console.log(chalk.dim('  Ollama runs locally — no API key needed.\n'));
    }

    console.log(chalk.cyan('  Brain Personalities:'));
    console.log(chalk.dim('    1. balanced    (all perspectives — default)'));
    console.log(chalk.dim('    2. mentor      (teaches & guides)'));
    console.log(chalk.dim('    3. critic      (thorough code review)'));
    console.log(chalk.dim('    4. architect   (big-picture design)'));
    console.log(chalk.dim('    5. security    (paranoid about vulns)'));
    console.log(chalk.dim('    6. performance (optimization focused)'));
    const personality = await ask(chalk.yellow('  Choose personality [1-6] (default: 1): '));
    const personalityMap: Record<string, string> = { '1': 'balanced', '2': 'mentor', '3': 'critic', '4': 'architect', '5': 'security', '6': 'performance' };
    const chosenPersonality = personalityMap[personality.trim() || '1'] || 'balanced';
    config.set('brainPersonality', chosenPersonality);
    console.log(chalk.green(`  ✓ Personality: ${chosenPersonality}\n`));

    console.log(chalk.cyan('  Review Depth:'));
    console.log(chalk.dim('    1. standard (balanced — default)'));
    console.log(chalk.dim('    2. quick    (fast, minimal context)'));
    console.log(chalk.dim('    3. deep     (thorough, full diffs)'));
    const depth = await ask(chalk.yellow('  Choose depth [1-3] (default: 1): '));
    const depthMap: Record<string, string> = { '1': 'standard', '2': 'quick', '3': 'deep' };
    config.set('reviewDepth', depthMap[depth.trim() || '1'] || 'standard');
    console.log(chalk.green('  ✓ Review depth saved\n'));

    const inject = await ask(chalk.yellow('  Enable auto-injection? [Y/n] (default: Y): '));
    config.set('autoInject', inject.trim().toLowerCase() !== 'n');
    console.log(chalk.green(`  ✓ Auto-injection: ${inject.trim().toLowerCase() !== 'n' ? 'enabled' : 'disabled'}\n`));

    rl.close();

    console.log(chalk.magenta.bold('  Setup complete!\n'));
    console.log(chalk.dim('  Configuration saved to: ') + chalk.cyan(config.path));
    console.log();
    console.log(chalk.dim('  Next steps:'));
    console.log(chalk.cyan('    shadow-brain start .') + chalk.dim('    # Start watching a project'));
    console.log(chalk.cyan('    shadow-brain review .') + chalk.dim('   # One-shot analysis'));
    console.log(chalk.cyan('    shadow-brain health .') + chalk.dim('   # Health score'));
    console.log(chalk.cyan('    shadow-brain fix .') + chalk.dim('      # Smart fix suggestions'));
    console.log(chalk.cyan('    shadow-brain report .') + chalk.dim('   # Generate HTML report'));
    console.log(chalk.cyan('    shadow-brain ci .') + chalk.dim('       # Generate GitHub Actions CI'));
    console.log(chalk.cyan('    shadow-brain hook .') + chalk.dim('     # Install pre-commit hook'));
    console.log(chalk.cyan('    shadow-brain doctor') + chalk.dim('     # Check health'));
    console.log();
  });

// ─── DOCTOR ───────────────────────────────────────────────────────────────────
const doctorCmd = new Command('doctor')
  .description('Run health check and diagnostics')
  .action(async () => {
    console.log(chalk.magenta.bold('\n  SHADOW BRAIN Doctor\n'));

    const checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = [];

    try {
      const saved = config.store;
      checks.push({ name: 'Configuration', status: 'ok', detail: `provider=${saved.provider}, personality=${saved.brainPersonality}` });
    } catch {
      checks.push({ name: 'Configuration', status: 'fail', detail: 'Could not read config. Run `shadow-brain setup`.' });
    }

    const provider = config.get('provider') as string || 'ollama';
    if (provider === 'ollama') {
      try {
        const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json() as any;
          const modelCount = data.models?.length || 0;
          checks.push({ name: 'Ollama', status: modelCount > 0 ? 'ok' : 'warn', detail: modelCount > 0 ? `${modelCount} model(s) available` : 'Ollama running but no models installed. Run: ollama pull llama3' });
        } else {
          checks.push({ name: 'Ollama', status: 'fail', detail: 'Ollama returned error. Is it running? Start with: ollama serve' });
        }
      } catch {
        checks.push({ name: 'Ollama', status: 'fail', detail: 'Cannot connect to Ollama at localhost:11434. Start with: ollama serve' });
      }
    } else {
      const apiKey = config.get('apiKey') as string;
      if (apiKey) {
        checks.push({ name: `${provider} API key`, status: 'ok', detail: 'Key is set (' + apiKey.slice(0, 4) + '...)' });
      } else {
        checks.push({ name: `${provider} API key`, status: 'fail', detail: 'No API key configured. Run: shadow-brain config apiKey <key>' });
      }
    }

    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    checks.push({ name: 'Node.js', status: major >= 18 ? 'ok' : 'warn', detail: `${nodeVersion} ${major >= 18 ? '(supported)' : '(recommend v18+)'}` });

    const projectDir = config.get('projectDir') as string || process.cwd();
    try {
      const stat = fs.statSync(projectDir);
      checks.push({ name: 'Project directory', status: stat.isDirectory() ? 'ok' : 'fail', detail: projectDir });
    } catch {
      checks.push({ name: 'Project directory', status: 'warn', detail: `${projectDir} (will use cwd at runtime)` });
    }

    // Check: git repo
    const gitDir = path.join(projectDir, '.git');
    checks.push({ name: 'Git repository', status: fs.existsSync(gitDir) ? 'ok' : 'warn', detail: fs.existsSync(gitDir) ? `${gitDir} found` : 'Not a git repository — git watching will be limited' });

    // Check: pre-commit hook
    const hookPath = path.join(projectDir, '.git', 'hooks', 'pre-commit');
    const hookInstalled = fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf-8').includes('shadow-brain');
    checks.push({ name: 'Pre-commit hook', status: hookInstalled ? 'ok' : 'warn', detail: hookInstalled ? 'Installed ✓' : 'Not installed — run: shadow-brain hook .' });

    // Check: GitHub Actions workflow
    const ciPath = path.join(projectDir, '.github', 'workflows', 'shadow-brain.yml');
    checks.push({ name: 'GitHub Actions CI', status: fs.existsSync(ciPath) ? 'ok' : 'warn', detail: fs.existsSync(ciPath) ? 'shadow-brain.yml found' : 'Not configured — run: shadow-brain ci .' });

    try {
      const detected = await detectRunningAgents(projectDir);
      checks.push({ name: 'Agent detection', status: detected.length > 0 ? 'ok' : 'warn', detail: detected.length > 0 ? `${detected.length} agent(s): ${detected.map((a: any) => a.displayName).join(', ')}` : 'No agents detected in current project' });
    } catch {
      checks.push({ name: 'Agent detection', status: 'warn', detail: 'Could not scan for agents' });
    }

    for (const check of checks) {
      const icon = check.status === 'ok' ? chalk.green('✓') : check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
      console.log(`  ${icon} ${chalk.bold(check.name)}: ${chalk.dim(check.detail)}`);
    }

    const failCount = checks.filter(c => c.status === 'fail').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;

    console.log();
    if (failCount === 0 && warnCount === 0) {
      console.log(chalk.green.bold('  All checks passed! Shadow Brain is fully configured.\n'));
    } else if (failCount === 0) {
      console.log(chalk.yellow(`  ${warnCount} warning(s). Shadow Brain will work — review items above.\n`));
    } else {
      console.log(chalk.red(`  ${failCount} issue(s) found. Fix them before running Shadow Brain.\n`));
    }
  });

// ─── DASH ─────────────────────────────────────────────────────────────────────
const dashCmd = new Command('dash')
  .description('Start Shadow Brain with a real-time web dashboard')
  .argument('[project-dir]', 'Project directory to watch', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider (anthropic|openai|ollama|openrouter)')
  .option('-m, --model <model>', 'LLM model name')
  .option('-k, --api-key <key>', 'API key for the LLM provider')
  .option('--personality <type>', 'Brain personality (mentor|critic|architect|security|performance|balanced)')
  .option('--no-inject', 'Disable auto-injection of insights')
  .option('--depth <depth>', 'Review depth (quick|standard|deep)')
  .option('--agents <agents>', 'Comma-separated list of agents to watch')
  .option('--port <port>', 'Dashboard port', '7341')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir });
    const port = parseInt(opts.port || '7341', 10);

    console.log(chalk.magenta.bold(`\n  SHADOW BRAIN v${VERSION} — Web Dashboard`));
    console.log(chalk.dim('  Watching: ') + chalk.cyan(brainConfig.projectDir));
    console.log(chalk.dim('  Provider: ') + chalk.cyan(brainConfig.provider));
    console.log(chalk.dim('  Personality: ') + chalk.cyan(brainConfig.brainPersonality));
    console.log();

    const orchestrator = new Orchestrator(brainConfig);

    const { DashboardServer } = await import('./dashboard/server.js');
    const dashboard = new DashboardServer(orchestrator, {
      port,
      openBrowser: opts.open !== false,
    });

    const shutdown = async () => {
      console.log(chalk.yellow('\n  Shutting down...'));
      await orchestrator.stop();
      await dashboard.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      const url = await dashboard.start();
      console.log(chalk.green(`  ✓ Dashboard running at ${url}`));
      console.log(chalk.dim(`  Open in browser: ${url}`));
      console.log(chalk.dim('  Press Ctrl+C to stop\n'));

      // Auto-open browser
      if (opts.open !== false) {
        try {
          const { exec } = await import('child_process');
          const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          exec(`${openCmd} "${url}"`);
        } catch { /* ignore */ }
      }

      await orchestrator.start();
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── METRICS ──────────────────────────────────────────────────────────────────
const metricsCmd = new Command('metrics')
  .description('Compute and display code metrics for the project')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('--json', 'Output as JSON')
  .option('--markdown', 'Output as markdown')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Computing code metrics...'));
      const metrics = await orchestrator.computeMetrics();

      if (opts.json) {
        console.log(orchestrator.formatMetrics(metrics, 'json'));
      } else if (opts.markdown) {
        console.log(orchestrator.formatMetrics(metrics, 'markdown'));
      } else {
        console.log(chalk.magenta.bold(`\n  SHADOW BRAIN Code Metrics\n`));
        process.stdout.write(orchestrator.formatMetrics(metrics, 'text'));
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── SCAN (Vulnerability Scanner) ────────────────────────────────────────────
const scanCmd = new Command('scan')
  .description('Scan for dependency vulnerabilities and exposed secrets')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('--json', 'Output as JSON')
  .option('--markdown', 'Output as markdown')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Scanning for vulnerabilities...'));
      const vulns = await orchestrator.runVulnScan();

      if (opts.json) {
        console.log(orchestrator.formatVulns(vulns, 'json'));
      } else if (opts.markdown) {
        console.log(orchestrator.formatVulns(vulns, 'markdown'));
      } else {
        console.log(chalk.magenta.bold(`\n  SHADOW BRAIN Vulnerability Scanner\n`));
        process.stdout.write(orchestrator.formatVulns(vulns, 'text'));
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── PR (PR Description Generator) ───────────────────────────────────────────
const prCmd = new Command('pr')
  .description('Generate a PR description from current changes')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-k, --api-key <key>', 'API key')
  .option('-b, --branch <branch>', 'Target branch name')
  .option('--json', 'Output as JSON')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Generating PR description...'));
      await orchestrator.reviewOnce();
      const changes = await (orchestrator as any).getGitChanges();
      const pr = await orchestrator.generatePRDescription(changes, opts.branch);

      if (opts.json) {
        console.log(JSON.stringify(pr, null, 2));
      } else {
        console.log(chalk.magenta.bold('\n  SHADOW BRAIN PR Generator\n'));
        console.log(chalk.bold(`  Title: ${pr.title}`));
        console.log(chalk.dim(`  Type: ${pr.type}${pr.scope ? ` (${pr.scope})` : ''}${pr.breaking ? ' ⚠ BREAKING' : ''}`));
        console.log(`\n${pr.body}\n`);
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── COMMIT-MSG (Commit Message Generator) ───────────────────────────────────
const commitMsgCmd = new Command('commit-msg')
  .description('Generate a conventional commit message from current changes')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-k, --api-key <key>', 'API key')
  .option('--json', 'Output as JSON')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Generating commit message...'));
      await orchestrator.reviewOnce();
      const changes = await (orchestrator as any).getGitChanges();
      const msg = await orchestrator.generateCommitMessage(changes);

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(chalk.magenta.bold('\n  SHADOW BRAIN Commit Message Generator\n'));
        console.log(chalk.green.bold(`  Conventional: ${msg.conventional}`));
        console.log(chalk.cyan(`  Short:        ${msg.short}`));
        console.log(chalk.dim(`  Detailed:     ${msg.detailed}`));
        console.log();
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── RULES (Custom Rules Management) ─────────────────────────────────────────
const rulesCmd = new Command('rules')
  .description('Manage custom analysis rules')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('--add <json>', 'Add a rule (JSON string)')
  .option('--remove <id>', 'Remove a rule by ID')
  .option('--json', 'Output as JSON')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      if (opts.add) {
        const rule = JSON.parse(opts.add);
        orchestrator.addCustomRule(rule);
        console.log(chalk.green(`  ✓ Rule added: ${rule.name || rule.id}`));
        return;
      }

      if (opts.remove) {
        orchestrator.removeCustomRule(opts.remove);
        console.log(chalk.green(`  ✓ Rule removed: ${opts.remove}`));
        return;
      }

      const rules = orchestrator.getCustomRules();

      if (opts.json) {
        console.log(JSON.stringify(rules, null, 2));
        return;
      }

      console.log(chalk.magenta.bold(`\n  SHADOW BRAIN Custom Rules (${rules.length})\n`));

      if (rules.length === 0) {
        console.log(chalk.dim('  No custom rules configured.'));
        console.log(chalk.dim('  Add rules via --add or in .shadow-brain.json'));
      } else {
        for (const rule of rules) {
          const icon = rule.enabled ? chalk.green('✓') : chalk.red('✗');
          const severity = rule.severity === 'critical' ? chalk.red(rule.severity) :
            rule.severity === 'high' ? chalk.yellow(rule.severity) : chalk.blue(rule.severity);
          console.log(`  ${icon} ${chalk.bold(rule.name)} [${severity}] ${chalk.dim(`(${rule.category})`)}`);
          console.log(chalk.dim(`    ${rule.description}`));
          console.log(chalk.dim(`    Pattern: /${rule.pattern}/${rule.flags || ''}`));
          if (rule.suggestion) console.log(chalk.dim(`    Suggestion: ${rule.suggestion}`));
          console.log();
        }
      }
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── NOTIFY (Test Notifications) ─────────────────────────────────────────────
const notifyCmd = new Command('notify')
  .description('Test notification channels (webhook/Slack/Discord)')
  .argument('[project-dir]', 'Project directory', process.cwd())
  .option('--test', 'Send a test notification to all configured channels')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ projectDir, watchMode: false });
    const orchestrator = new Orchestrator(brainConfig);

    try {
      if (opts.test) {
        console.log(chalk.cyan('  Sending test notifications...'));
        const results = await orchestrator.testNotifications();

        if (results.length === 0) {
          console.log(chalk.yellow('  No notification channels configured.'));
          console.log(chalk.dim('  Add channels in .shadow-brain.json under "notifications"'));
          return;
        }

        for (const r of results) {
          const icon = r.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${icon} ${r.channel}: ${r.success ? 'success' : r.error}`);
        }
        return;
      }

      const projectConfig = orchestrator.getProjectConfig();
      const nc = projectConfig.notifications;

      console.log(chalk.magenta.bold('\n  SHADOW BRAIN Notification Config\n'));

      if (!nc) {
        console.log(chalk.dim('  No notifications configured.'));
        console.log(chalk.dim('  Add to .shadow-brain.json:'));
        console.log(chalk.dim('  { "notifications": { "slack": "...", "discord": "..." } }'));
      } else {
        console.log(chalk.dim('  Webhook: ') + chalk.cyan(nc.webhook || '(not set)'));
        console.log(chalk.dim('  Slack:   ') + chalk.cyan(nc.slack ? 'configured' : '(not set)'));
        console.log(chalk.dim('  Discord: ') + chalk.cyan(nc.discord ? 'configured' : '(not set)'));
        console.log(chalk.dim('  On health drop: ') + chalk.cyan(nc.onHealthDrop !== false ? 'enabled' : 'disabled'));
        console.log(chalk.dim('  On critical:    ') + chalk.cyan(nc.onCriticalInsight !== false ? 'enabled' : 'disabled'));
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const program = new Command();
program
  .name('shadow-brain')
  .description('Shadow Brain — AI agent watcher and intelligence injector')
  .version(VERSION);

program.addCommand(startCmd);
program.addCommand(reviewCmd);
program.addCommand(reportCmd);
program.addCommand(healthCmd);
program.addCommand(fixCmd);
program.addCommand(ciCmd);
program.addCommand(hookCmd);
program.addCommand(dashCmd);
program.addCommand(injectCmd);
program.addCommand(statusCmd);
program.addCommand(configCmd);
program.addCommand(setupCmd);
program.addCommand(doctorCmd);
program.addCommand(metricsCmd);
program.addCommand(scanCmd);
program.addCommand(prCmd);
program.addCommand(commitMsgCmd);
program.addCommand(rulesCmd);
program.addCommand(notifyCmd);

program.parse();
