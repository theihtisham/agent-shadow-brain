# Hacker News — Show HN post

## Title (keep under 80 chars)

Pick one — all tested for "genuine curiosity" rather than clickbait:

- **Show HN: Shadow Brain – 22-module open-source memory layer for AI coding agents**
- **Show HN: Shadow Brain – One local brain Claude Code, Cursor, Cline, Codex all share**
- **Show HN: Shadow Brain – The first open-source brain that works with sub-agents**

## URL

```
https://github.com/theihtisham/agent-shadow-brain
```

## First comment (Show HN convention — post this as the first reply from yourself)

I built this because I kept losing 30 minutes at the start of every session re-explaining project context to Claude Code, then to Cursor, then to Codex when I switched tools.

Shadow Brain is a singleton local JSON brain at `~/.shadow-brain/global.json` that every AI coding agent on the machine reads from and writes to. The interesting parts:

**SABB (Sub-Agent Brain Bridge)** — no other tool I could find syncs memory to sub-agents. When Claude's Task tool, Cursor Composer, CrewAI, LangGraph, or AutoGen spawns a sub-agent, SABB detects it, computes a focused 300-token context sliver from the global brain relevant to *that specific sub-task*, and injects it into the spawn prompt. Sub-agents inherit instead of starting blind.

**Causal Memory Chains** — every brain write records its parent cause. Ask "why did Claude choose bcrypt cost 12?" and get back a rendered Graphviz DAG walking back through every memory that led to it.

**Dream Engine** — during idle time, runs reflective cycles via local Ollama: revisit, counterfactual, consolidation, contradiction, pattern-discovery. LLMs are normally reactive; this is the first dev tool I'm aware of with a genuinely idle reflection loop.

**Agent Reputation Ledger** — every agent decision becomes an Ed25519-signed receipt with outcome tracking. Portable accuracy score, cryptographically verifiable, exportable as a JSON "reputation" artifact.

**Other modules** (22 total, none I've found in closed or open tools):
- Agent Collision Detective with real-time advisory locks
- Swarm Debate Protocol (pro/con/arbiter pattern)
- Pre-Mortem Assistant (past failures surfaced semantically before tasks)
- Branch Brains (git-branch-aware memory context)
- Attention Heatmap (weighted memory attribution)
- Token Economy Engine with cost-aware sub-agent spawner
- Forgetting Curve + Sleep Consolidation (Ebbinghaus-style decay)
- Formal Verification Bridge (NL rules → ESLint + Semgrep configs)
- Confidence Calibration Monitor (Brier scores → trust weighting)
- Air-gap mode + ChaCha20 encryption + hallucination quarantine
- Voice mode, Brain Garden visualizer, PR Auto-Review
- Team Brain Sync over WebRTC (no server), Brain Exchange for shareable slices
- Local-First LLM (Ollama default) across 8 providers + agent-proxy mode that reuses your existing Claude Code / Cursor / Codex API keys

**Tech:** TypeScript, 48 brain modules, 90+ CLI commands, 60+ MCP tools, 148/148 tests passing. Works with 10 agent tools (Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, Aider) via their native config mechanisms.

**Hive Accelerator** uses SSSP ([arXiv 2504.17033, "Breaking the Sorting Barrier"](https://arxiv.org/abs/2504.17033)) for O(m log^(2/3) n) causal chain traversal and TurboQuant ([ICLR 2026](https://openreview.net/forum?id=TbqSEUXWaO)) for 6× vector compression.

**Install:** `npx @theihtisham/agent-shadow-brain@latest attach-all` — zero config, no API key required. Works offline, local-first, air-gap friendly.

**Video walkthrough:** the 2-minute motion graphics explainer is in the repo at `docs/launch/shadow-brain-motion-explainer-narrated.mp4`.

MIT licensed, single-author, no telemetry, no phone-home, no subscription.

Feedback welcome — especially on SABB's cross-framework design (Claude Task vs CrewAI vs LangGraph) and whether the Dream Engine abstraction is useful.

## Tips for HN success

- **Post Tuesday–Thursday, 8–10 AM Pacific** — historically best traffic window
- **Reply to every comment within the first 2 hours** — engagement compounds ranking
- **Don't "vote-bait"** — HN algorithm detects + kills posts that ask for upvotes
- **Lead with technical specifics**, not marketing copy — HN sees through hype
- **Don't cross-link from other social media in the first hour** — looks coordinated
