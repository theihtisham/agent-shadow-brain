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

    console.log(chalk.magenta.bold('\n  SHADOW BRAIN v1.0.0'));
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

// Main program
const program = new Command();
program
  .name('shadow-brain')
  .description('Shadow Brain — AI agent watcher and intelligence injector')
  .version('1.0.0');

program.addCommand(startCmd);
program.addCommand(reviewCmd);
program.addCommand(injectCmd);
program.addCommand(statusCmd);
program.addCommand(configCmd);

program.parse();
