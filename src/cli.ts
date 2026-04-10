#!/usr/bin/env node
// src/cli.ts — CLI entry point for Shadow Brain

import { Command } from 'commander';
import chalk from 'chalk';
import Conf from 'conf';
import { Orchestrator } from './brain/orchestrator.js';
import { detectRunningAgents, createAdapter } from './adapters/index.js';
import { BaseAdapter } from './adapters/base-adapter.js';
import { BrainConfig, BrainInsight, AgentTool, BrainPersonality, LLMProvider } from './types.js';

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

// START command
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

    console.log(chalk.magenta.bold('\n  SHADOW BRAIN v1.1.0'));
    console.log(chalk.dim('  Watching: ') + chalk.cyan(brainConfig.projectDir));
    console.log(chalk.dim('  Provider: ') + chalk.cyan(brainConfig.provider));
    console.log(chalk.dim('  Personality: ') + chalk.cyan(brainConfig.brainPersonality));
    console.log(chalk.dim('  Agents: ') + chalk.cyan(brainConfig.agents.join(', ')));
    console.log();

    const orchestrator = new Orchestrator(brainConfig);

    // Handle graceful shutdown
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

// REVIEW command
const reviewCmd = new Command('review')
  .description('Run a one-shot analysis of the project')
  .argument('[project-dir]', 'Project directory to review', process.cwd())
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-m, --model <model>', 'LLM model name')
  .option('-k, --api-key <key>', 'API key')
  .option('--depth <depth>', 'Review depth (quick|standard|deep)')
  .option('--output <format>', 'Output format (text|json|markdown)', 'text')
  .action(async (projectDir: string, opts: any) => {
    const brainConfig = mergeConfig({ ...opts, projectDir, watchMode: false });

    const orchestrator = new Orchestrator(brainConfig);

    try {
      console.log(chalk.cyan('  Analyzing project...'));
      const insights = await orchestrator.reviewOnce();

      if (insights.length === 0) {
        console.log(chalk.dim('  No insights generated.'));
        return;
      }

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
    } catch (err: any) {
      console.error(chalk.red('  Error:'), err.message);
      process.exit(1);
    }
  });

// INJECT command
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
        // Create adapter for specified agent even if not detected
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

// STATUS command
const statusCmd = new Command('status')
  .description('Show current Shadow Brain configuration and status')
  .action(async () => {
    const saved = config.store;

    console.log(chalk.magenta.bold('\n  SHADOW BRAIN Status\n'));

    console.log(chalk.dim('  Provider:   ') + chalk.cyan(saved.provider || 'ollama'));
    console.log(chalk.dim('  Model:      ') + chalk.cyan(saved.model || '(default)'));
    console.log(chalk.dim('  API Key:    ') + chalk.cyan(saved.apiKey ? '••••••••' : '(not set)'));
    console.log(chalk.dim('  Personality:') + chalk.cyan(saved.brainPersonality || 'balanced'));
    console.log(chalk.dim('  Review:     ') + chalk.cyan(saved.reviewDepth || 'standard'));
    console.log(chalk.dim('  Auto-Inject:') + chalk.cyan(saved.autoInject !== false ? 'enabled' : 'disabled'));
    console.log(chalk.dim('  Agents:     ') + chalk.cyan((saved.agents || []).join(', ')));
    console.log(chalk.dim('  Project:    ') + chalk.cyan(saved.projectDir || process.cwd()));
    console.log();

    // Try to detect running agents
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

// CONFIG command
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

// SETUP command — interactive first-time setup
const setupCmd = new Command('setup')
  .description('Interactive setup wizard for first-time configuration')
  .action(async () => {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

    console.log(chalk.magenta.bold('\n  SHADOW BRAIN Setup Wizard\n'));
    console.log(chalk.dim('  This will configure your Shadow Brain installation.\n'));

    // Provider
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

    // API key (if not ollama)
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

    // Personality
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

    // Review depth
    console.log(chalk.cyan('  Review Depth:'));
    console.log(chalk.dim('    1. standard (balanced — default)'));
    console.log(chalk.dim('    2. quick    (fast, minimal context)'));
    console.log(chalk.dim('    3. deep     (thorough, full diffs)'));
    const depth = await ask(chalk.yellow('  Choose depth [1-3] (default: 1): '));
    const depthMap: Record<string, string> = { '1': 'standard', '2': 'quick', '3': 'deep' };
    config.set('reviewDepth', depthMap[depth.trim() || '1'] || 'standard');
    console.log(chalk.green('  ✓ Review depth saved\n'));

    // Auto-inject
    const inject = await ask(chalk.yellow('  Enable auto-injection? [Y/n] (default: Y): '));
    config.set('autoInject', inject.trim().toLowerCase() !== 'n');
    console.log(chalk.green(`  ✓ Auto-injection: ${inject.trim().toLowerCase() !== 'n' ? 'enabled' : 'disabled'}\n`));

    rl.close();

    // Summary
    console.log(chalk.magenta.bold('  Setup complete!\n'));
    console.log(chalk.dim('  Configuration saved to: ') + chalk.cyan(config.path));
    console.log();
    console.log(chalk.dim('  Next steps:'));
    console.log(chalk.cyan('    shadow-brain start .') + chalk.dim('    # Start watching a project'));
    console.log(chalk.cyan('    shadow-brain review .') + chalk.dim('   # One-shot analysis'));
    console.log(chalk.cyan('    shadow-brain doctor') + chalk.dim('    # Check health'));
    console.log();
  });

// DOCTOR command — health check and diagnostics
const doctorCmd = new Command('doctor')
  .description('Run health check and diagnostics')
  .action(async () => {
    console.log(chalk.magenta.bold('\n  SHADOW BRAIN Doctor\n'));

    const checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = [];

    // Check 1: Config exists
    try {
      const saved = config.store;
      checks.push({ name: 'Configuration', status: 'ok', detail: `provider=${saved.provider}, personality=${saved.brainPersonality}` });
    } catch {
      checks.push({ name: 'Configuration', status: 'fail', detail: 'Could not read config. Run `shadow-brain setup`.' });
    }

    // Check 2: Provider connectivity
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

    // Check 3: Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    checks.push({ name: 'Node.js', status: major >= 18 ? 'ok' : 'warn', detail: `${nodeVersion} ${major >= 18 ? '(supported)' : '(recommend v18+)'}` });

    // Check 4: Project directory
    const projectDir = config.get('projectDir') as string || process.cwd();
    try {
      const fs = await import('fs');
      const stat = fs.statSync(projectDir);
      checks.push({ name: 'Project directory', status: stat.isDirectory() ? 'ok' : 'fail', detail: projectDir });
    } catch {
      checks.push({ name: 'Project directory', status: 'warn', detail: `${projectDir} (will use cwd at runtime)` });
    }

    // Check 5: Agent detection
    try {
      const detected = await detectRunningAgents(projectDir);
      checks.push({ name: 'Agent detection', status: detected.length > 0 ? 'ok' : 'warn', detail: detected.length > 0 ? `${detected.length} agent(s) detected: ${detected.map((a: any) => a.displayName).join(', ')}` : 'No agents detected in current project' });
    } catch {
      checks.push({ name: 'Agent detection', status: 'warn', detail: 'Could not scan for agents' });
    }

    // Display results
    for (const check of checks) {
      const icon = check.status === 'ok' ? chalk.green('✓') : check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
      console.log(`  ${icon} ${chalk.bold(check.name)}: ${chalk.dim(check.detail)}`);
    }

    const failCount = checks.filter(c => c.status === 'fail').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;

    console.log();
    if (failCount === 0 && warnCount === 0) {
      console.log(chalk.green.bold('  All checks passed! Shadow Brain is ready.\n'));
    } else if (failCount === 0) {
      console.log(chalk.yellow(`  ${warnCount} warning(s). Shadow Brain will work but review the items above.\n`));
    } else {
      console.log(chalk.red(`  ${failCount} issue(s) found. Fix them before running Shadow Brain.\n`));
    }
  });

// Main program
const program = new Command();
program
  .name('shadow-brain')
  .description('Shadow Brain — AI agent watcher and intelligence injector')
  .version('1.1.0');

program.addCommand(startCmd);
program.addCommand(reviewCmd);
program.addCommand(injectCmd);
program.addCommand(statusCmd);
program.addCommand(configCmd);
program.addCommand(setupCmd);
program.addCommand(doctorCmd);

program.parse();
