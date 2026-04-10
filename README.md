# Agent Shadow Brain

[![npm version](https://img.shields.io/npm/v/@theihtisham/agent-shadow-brain.svg)](https://www.npmjs.com/package/@theihtisham/agent-shadow-brain)
[![license](https://img.shields.io/npm/l/@theihtisham/agent-shadow-brain.svg)](https://github.com/theihtisham/agent-shadow-brain/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@theihtisham/agent-shadow-brain.svg)](https://www.npmjs.com/package/@theihtisham/agent-shadow-brain)

A shadow AI brain that runs alongside your coding agent — watching, reviewing, and injecting intelligence in real-time.

Works with **Claude Code**, **Kilo Code**, **Cline**, **OpenCode**, **Codex CLI**, and more.

## Install

```bash
npm install -g @theihtisham/agent-shadow-brain
```

Or use directly:

```bash
npx @theihtisham/agent-shadow-brain start .
```

## CLI Reference

### `shadow-brain start [project-dir]`

Start watching a project in real-time with a live terminal dashboard.

```bash
shadow-brain start .                          # Watch current directory
shadow-brain start . -p anthropic -k $API_KEY # Use Anthropic as LLM
shadow-brain start . --personality security   # Security-focused reviews
shadow-brain start . --depth deep             # Deep analysis
shadow-brain start . --agents claude-code,codex  # Watch specific agents
```

Options:
- `-p, --provider <provider>` — LLM provider: `anthropic`, `openai`, `ollama`, `openrouter`
- `-m, --model <model>` — LLM model name
- `-k, --api-key <key>` — API key
- `--personality <type>` — Brain personality (see below)
- `--depth <depth>` — Review depth: `quick`, `standard`, `deep`
- `--agents <agents>` — Comma-separated agent list
- `--no-inject` — Disable auto-injection of insights

### `shadow-brain review [project-dir]`

One-shot project analysis without watch mode.

```bash
shadow-brain review .                  # Text output
shadow-brain review . --output json    # JSON output
shadow-brain review . --output markdown # Markdown output
shadow-brain review . --depth deep     # Thorough analysis
```

### `shadow-brain inject <message>`

Manually inject a message into agent memory.

```bash
shadow-brain inject "Always use TypeScript strict mode"
shadow-brain inject "Check for SQL injection" --type warning --priority high
shadow-brain inject "Follow REST conventions" --agent claude-code
```

### `shadow-brain status`

Show current configuration and detected agents.

### `shadow-brain config`

Manage persistent configuration.

```bash
shadow-brain config --list
shadow-brain config provider openai
shadow-brain config apiKey sk-xxx
shadow-brain config personality architect
shadow-brain config --reset
```

## Supported Agents

| Agent | Detection | Injection Target |
|-------|-----------|-----------------|
| **Claude Code** | `.claude/` directory, process | `.claude/memory/`, `.claude/rules/` |
| **Kilo Code** | VS Code extension data, `.kilocode/` | `.kilocode/rules/`, `.kilocode/memory/` |
| **Cline** | VS Code extension data, `.clinerules` | `.clinerules`, `.cline/memory/` |
| **OpenCode** | `.opencode/`, `opencode.json`, process | `.opencode/rules/`, `AGENTS.md` |
| **Codex CLI** | `.codex/`, `AGENTS.md`, process | `AGENTS.md` |

## Brain Personalities

| Personality | Focus |
|------------|-------|
| `mentor` | Teaches and explains — focuses on code quality and best practices |
| `critic` | Thorough code reviews — catches bugs, logic errors, edge cases |
| `architect` | Big-picture thinking — modularity, scalability, design patterns |
| `security` | Paranoid about vulnerabilities — OWASP top 10, attack vectors |
| `performance` | Optimization focused — N+1 queries, memory leaks, bundle size |
| `balanced` | Mix of all perspectives (default) |

## How It Works

```
┌─────────────────────────────────────────────────┐
│                  Shadow Brain                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  File     │  │  Git     │  │  Agent        │  │
│  │  Watcher  │  │  Watcher │  │  Adapters     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │            │
│       └──────┬───────┘               │            │
│              ▼                       │            │
│       ┌──────────────┐              │            │
│       │  Orchestrator │              │            │
│       │  (debounce)   │              │            │
│       └──────┬───────┘              │            │
│              ▼                       │            │
│       ┌──────────────┐              │            │
│       │   Analyzer   │              │            │
│       │ (LLM + rules)│              │            │
│       └──────┬───────┘              │            │
│              │    Insights          │            │
│              └──────────────────────┘            │
│                     ▼                            │
│            Inject into agent memory              │
└─────────────────────────────────────────────────┘
```

Shadow Brain watches your project files and git activity, reads what your coding agent is doing, and uses an LLM (with rule-based fallback) to generate insights. It then injects those insights directly into the agent's memory files so the agent picks them up automatically.

## LLM Providers

- **Ollama** (default, free) — runs locally, no API key needed
- **Anthropic** — Claude models via API
- **OpenAI** — GPT-4o via API
- **OpenRouter** — Access to many models through one API

## Programmatic API

```typescript
import { Orchestrator, createAdapter, LLMClient } from '@theihtisham/agent-shadow-brain';

const orchestrator = new Orchestrator({
  provider: 'ollama',
  projectDir: '/path/to/project',
  agents: ['claude-code'],
  watchMode: true,
  autoInject: true,
  reviewDepth: 'standard',
  brainPersonality: 'balanced',
});

orchestrator.on('insights', ({ insights }) => {
  console.log('Generated insights:', insights);
});

await orchestrator.start();
```

## License

MIT
