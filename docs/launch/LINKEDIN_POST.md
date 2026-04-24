# LinkedIn — post template

## Format
LinkedIn rewards: long-form (1500+ chars), no external links in the body (put link in first comment), strong hook, personal stake, clear value prop.

---

## Post body

I spent the last three months building something I thought already existed — but didn't.

Every AI coding assistant I use (Claude Code, Cursor, Cline, Codex, Copilot) starts every session from zero. They forget everything I told them yesterday. When Claude's Task tool spawns a sub-agent, the sub-agent starts completely blind — even though the parent knew my project cold.

So I built Shadow Brain.

It's the first open-source brain that every AI coding agent on your machine can share. One local file. All ten supported agents read from it and write to it. What one agent learns, every other agent knows. What a sub-agent discovers, every future sub-agent inherits.

22 novel features — none of them exist in any other tool, open or closed source:

🔗 Sub-Agent Brain Bridge — sub-agents inherit context instead of starting blind
🧭 Causal Memory Chains — every AI decision traceable to its cause
💤 Dream Engine — runs reflection cycles while you sleep, strengthens patterns
🏆 Ed25519 Reputation Ledger — cryptographically-signed trust scores per agent
⚠️ Collision Detective — catches two agents editing the same file in real time
🗣️ Swarm Debate Protocol — pro/con/arbiter for critical decisions
🚨 Pre-Mortem Assistant — surfaces your past failures before you start a task
💰 Token Economy Engine — automatically routes to cheaper models, saves money
🔒 Air-gap mode + ChaCha20 encryption — enterprise privacy, zero telemetry
+ 13 more including voice mode, branch-aware memory, PR auto-review, team sync

The technical bits:
• 48 brain modules, 90+ CLI commands, 60+ MCP tools
• 148 tests passing
• TypeScript, MIT license, $0 to run
• Works with Ollama locally, or 7 other LLM providers
• Can reuse your existing Claude / Cursor / Codex API keys — zero new keys needed

The philosophy: local-first by default. No telemetry. No phone-home. No subscription. Works offline, in air-gapped environments, in privacy-constrained enterprises. You own every byte.

Install takes 30 seconds:

npx @theihtisham/agent-shadow-brain@latest attach-all

Then open the dashboard at localhost:7341 and you see every memory, every sub-agent spawn, every reputation receipt — live.

If this saves you 30 minutes of context re-explaining at the start of every session, please share it. Other developers are wasting the same time I was.

If you build with AI agents, star the repo (link in comments). PRs, issues, and "this is stupid" feedback all welcome.

#ai #openSource #softwareDevelopment #artificialIntelligence #claudeCode #cursorAI #llm #developerTools #opensource #startupLife

---

## First comment (links always go here on LinkedIn — post body gets boosted)

⭐ GitHub: https://github.com/theihtisham/agent-shadow-brain
📦 npm: https://www.npmjs.com/package/@theihtisham/agent-shadow-brain
🎬 2-minute explainer video in the repo

---

## Alt opener (test both — LinkedIn rewards hooks)

**Alt 1 (personal):**
I spent three months building the wrong thing, found out why, then spent two more months building the right thing. Here's what I learned. (Shadow Brain: the first open-source brain every AI coding agent on your machine can share.)

**Alt 2 (contrarian):**
Every "AI memory" tool on the market today is a wrapper around someone else's API. I got tired of that. So I built Shadow Brain — 48 modules, all first-party, all local, all open source. Here's what's inside.

**Alt 3 (outcome):**
What if Claude Code remembered what Cursor decided yesterday? What if every sub-agent inherited the parent's context? What if your AI bills dropped 15% automatically? I shipped it yesterday. It's called Shadow Brain.

## Engagement tactics
- Post Tuesday/Wednesday 9-11 AM in your target TZ
- Reply to every comment in first 6 hours — LinkedIn's algo weighs comment velocity
- Tag 2-3 people you know who work in AI/dev tools (genuinely, not spammy)
- DM a few specific friends with "thought you'd find this interesting" (not a "please engage" beg)
