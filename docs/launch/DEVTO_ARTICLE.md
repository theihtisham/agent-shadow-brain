# Dev.to long-form article

## Title
**I built an open-source Hive Mind for AI coding agents (22 novel features, 48 modules, MIT)**

## Alt titles (A/B)
- How I made Claude Code, Cursor, and Codex share one local brain
- Shadow Brain: The first open-source memory layer that works with sub-agents
- Why I stopped re-explaining my project to every AI agent (and built a brain that remembers)

## Cover image
Use `Banner (2).png` from the repo root.

## Tags
`ai` `opensource` `javascript` `productivity` `cursor` `typescript`

---

## Article body

## The problem I kept hitting

Three months ago I found myself running Claude Code, Cursor, and Codex simultaneously across two monitors. Each one was powerful. Each one was paid for. And each one was forgetting the same things I'd explained yesterday.

Worse: when Claude's `Task` tool spawned a sub-agent, the sub-agent started completely blind — even though the parent agent already had the project context fully loaded.

I did the math. Across 5–10 sessions per day, I was spending 30+ minutes just re-explaining my project to the same agents I'd used the day before. Over a month, that's 15 hours of my life lost to context re-entry.

So I built Shadow Brain.

## The core idea

One local JSON file at `~/.shadow-brain/global.json`. Every AI coding agent on my machine reads from it and writes to it. What one agent learns, every other agent knows. What one sub-agent discovers, every future sub-agent inherits.

Claude Code writes a memory. Cursor reads it next session. Codex reads it the session after. Copilot, Cline, Windsurf, Kilo, Roo, OpenCode, Aider — all ten agents I support, one shared brain.

Zero servers. Zero cloud. Zero subscription. Runs entirely on your laptop.

## What makes it different

Every existing "AI memory" tool I found was either (a) a wrapper around someone else's API, (b) per-agent only, or (c) cloud-dependent. None worked across agents. None worked with sub-agents. None let me audit why the AI made a decision.

Shadow Brain v6 ships 22 novel modules that don't exist in any other tool — open source or closed. A few favorites:

### Sub-Agent Brain Bridge (SABB)

When Claude's Task tool, Cursor Composer, CrewAI, LangGraph, or AutoGen spawns a sub-agent, SABB:

1. **Detects the spawn** via a hook or explicit API call
2. **Computes a context sliver** — the 3–5% of the global brain that's relevant to this specific sub-task (300 tokens by default, semantically re-ranked)
3. **Injects it** into the sub-agent's prompt automatically
4. **Quarantines** anything the sub-agent learns until confidence ≥ 0.7
5. **Graduates** verified memories back to the global brain, tagged `origin: subagent`

I genuinely could not find another tool that does cross-framework sub-agent memory bridging. Would love to be wrong — please email me prior art if you know of any.

### Causal Memory Chains

Every brain write can record its parent-cause ID. Over time this builds an audit DAG. Ask "why did Claude use bcrypt cost 12?" and get back:

```
Claude today
  ← memory #487 (decision · security)
    ← Cursor Mar 20 ← user prompt "use secure hashing"
      ← memory #203 (incident · Feb 14) weak hash in audit
```

Rendered as Graphviz DOT. Exportable. Shareable. No more "trust me, the AI knows what it's doing."

### Dream Engine

LLMs are always reactive — you ask, they answer. But humans consolidate memory during sleep. Why shouldn't your AI brain do the same?

Dream Engine runs reflective cycles when no agent is active: revisit recent decisions with fresh context, run counterfactual analysis ("what if we'd used Redis instead?"), strengthen validated patterns, weaken falsified ones, generate "dream insights" for next session.

By default it routes through local Ollama. Zero API calls. Zero cost. Runs while you sleep.

### Ed25519-signed Reputation Ledger

Every agent decision becomes a cryptographically-signed receipt stored in `~/.shadow-brain/reputation/ledger.jsonl`. Outcome tracking computes accuracy over time per agent per category. The result: a portable, tamper-proof trust score you can export and share.

Would-be badge for your repo:

```markdown
![Shadow Brain](https://img.shields.io/badge/claude--4.7-94%25_accuracy-brightgreen)
```

### The rest

- **Agent Collision Detective** — real-time detection of 2+ agents editing the same file region, with advisory locks
- **Swarm Debate Protocol** — pro/con/arbiter sub-agents for critical decisions
- **Pre-Mortem Assistant** — surfaces past failures from your project (semantically ranked) before you start a task
- **Branch Brains** — git-branch-aware memory context
- **Attention Heatmap** — weighted attribution showing which memories shaped a decision
- **Token Economy** — cross-agent spend tracking + automatic routing to cheaper models
- **Forgetting Curve + Sleep Consolidation** — Ebbinghaus-inspired biological memory
- **Formal Verification Bridge** — converts natural-language rules into ESLint and Semgrep configs
- **Confidence Calibration Monitor** — Brier scores per agent per category, auto-adjusts trust weights
- **Hallucination Quarantine** — suspect memories isolated, auto-deleted after 7 days
- **Air-gap Mode** — zero outbound network, localhost-only
- **E2E Encryption** — ChaCha20-Poly1305 at rest with scrypt key derivation
- **Voice Mode** — transcript + intent parsing
- **Brain Garden** — visualizer for your memory as a living constellation
- **PR Auto-Review** — generates GitHub PR comments citing project memories
- **Team Brain Sync** — peer-to-peer shared brain over WebRTC, no server
- **Brain Exchange** — export/import curated brain slices as shareable packages

## Technical details

- **48 brain modules**, **90+ CLI commands**, **60+ MCP tools**, **50+ REST endpoints**, **148/148 tests passing**
- Pure TypeScript, no native dependencies
- Works with Node 18+
- MIT licensed
- **10 agent tools supported**: Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, Aider
- **8 LLM providers**: Ollama (default, local), Anthropic, OpenAI, OpenRouter, Moonshot/Kimi, Gemini, DeepSeek, Mistral
- **Agent-proxy mode** — auto-discovers existing agent API keys so you don't need new ones

## Install in 30 seconds

```bash
# Method 1 — one command wires every agent + launches dashboard
npx @theihtisham/agent-shadow-brain@latest attach-all

# Method 2 — global install
npm install -g @theihtisham/agent-shadow-brain
shadow-brain attach-all
shadow-brain dash .
# open http://localhost:7341/
```

Zero config. Zero API key required. Zero telemetry.

## The dashboard

`shadow-brain dash .` opens a full web control panel at `http://localhost:7341/` with 28 tabs. Real-time charts, command palette (⌘K), dark/light theme, responsive mobile layout. You can inspect every memory, every sub-agent spawn, every causal chain, every reputation receipt — live.

There's a **real stop button** that actually stops the Node process. **Real feature toggles** that persist to disk. **Real agent connect/disconnect** that runs the hook installer.

## Philosophy

**Local-first by default.** All AI features (Dream Engine, Swarm Debate, Pre-Mortem, Voice) route to Ollama first. No API keys required to get full functionality. Remote providers are opt-in.

**Free forever.** MIT licensed. Zero subscription tiers. Zero feature gating. Zero trial expiration.

**Open source moat.** Closed tools can't match local-first because their business model depends on API consumption. Shadow Brain doesn't.

## What's next

**v6.1** roadmap: reasoning loops (o1-style reflection), browser computer-use integration, real-time voice pipeline (STT→LLM→TTS), Graph-RAG over the knowledge graph, automated evaluation harness with LLM-as-judge.

## Links

- **GitHub:** https://github.com/theihtisham/agent-shadow-brain
- **npm:** https://www.npmjs.com/package/@theihtisham/agent-shadow-brain
- **Video (2 min):** in the repo at `docs/launch/shadow-brain-motion-explainer-narrated.mp4`
- **Docs:** `docs/versions/v6.0.0.md` in the repo

---

If this saves you time, please star the repo. PRs, issues, and honest criticism all welcome.

What's the first feature you'd use? Let me know in the comments.

---

## SEO meta description
Shadow Brain is an open-source Hive Mind for AI coding agents. One local brain every agent — Claude Code, Cursor, Cline, Codex, Copilot — shares. 22 novel features, 48 modules, MIT licensed, local-first.
