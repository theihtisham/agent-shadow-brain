# Product Hunt launch kit

## Product name
**Shadow Brain**

## Tagline (60 char max)
**The open-source Hive Mind every AI coding agent can share**

## Alt taglines
- One local brain. Every AI coding agent. Every sub-agent. Free.
- 22 novel features. $0 to run. Every AI agent gets smarter.
- The first open-source brain that works with sub-agents.

## Topics
AI · Developer Tools · Open Source · Artificial Intelligence · GitHub · Productivity

## Thumbnail
Use `Banner (2).png` from the repo root.

## Gallery images (upload all 4–6)
1. The 2-minute motion explainer video: `docs/launch/shadow-brain-motion-explainer-narrated.mp4` (most important — PH boosts video posts)
2. `docs/launch/screenshots/01-overview.png` — Dashboard overview with live counters
3. `docs/launch/screenshots/02-graph.png` — Live agent graph with pulsing signals
4. `docs/launch/screenshots/19-tokens.png` — Token Economy with Chart.js savings
5. `docs/launch/screenshots/07-sabb.png` — SABB sliver generator
6. `docs/launch/screenshots/27-models.png` — 8 LLM providers config

## Description (260 char max)

```
Shadow Brain makes every AI coding agent on your machine share one local brain.
Claude Code, Cursor, Cline, Codex, Copilot — all remember what the others learned. Sub-agents inherit context instead of starting blind. 22 novel features. Free + open source.
```

## Maker's first comment (longer, value-focused)

👋 Hi Product Hunt! Maker here.

I built Shadow Brain because every AI coding agent I used (Claude Code, Cursor, Codex) was forgetting the same project context every session. And when Claude's Task tool spawned a sub-agent, the sub-agent started completely blind. Multiply that across 10+ sessions a day and it's 15+ hours/month wasted.

**What Shadow Brain does in one line:** One local file at `~/.shadow-brain/global.json` that every AI coding agent on your machine reads from and writes to. Zero cloud. Zero subscription.

**The 3 things that make it different from anything else:**

1. **Sub-Agent Brain Bridge (SABB)** — no other tool syncs memory to sub-agents. Claude's Task tool, Cursor Composer, CrewAI, LangGraph, AutoGen — Shadow Brain bridges them all so sub-agents inherit context.

2. **Ed25519-signed Reputation Ledger** — every agent decision is cryptographically signed with outcome tracking. Portable, tamper-proof accuracy score per agent.

3. **Local-first default** — all AI features (Dream Engine, Swarm Debate, Pre-Mortem) route through Ollama by default. Zero API keys needed. Works offline. Air-gap mode for enterprise.

**22 novel features total** (none of them exist in any other tool): Causal Memory Chains, Collision Detective, Dream Engine, Pre-Mortem Assistant, Branch Brains, Attention Heatmap, Token Economy with auto-routing, Forgetting Curve + Sleep Consolidation, Formal Verification Bridge, Calibration Monitor, Voice Mode, Brain Garden visualizer, PR Auto-Review, Team Sync over WebRTC, Brain Exchange for shareable slices… + 8 more.

**Numbers:** 48 brain modules, 90+ CLI commands, 60+ MCP tools, 148/148 tests passing. Pure TypeScript, MIT license, solo author.

**Install in 30 seconds:**
```
npx @theihtisham/agent-shadow-brain@latest attach-all
```

**GitHub:** https://github.com/theihtisham/agent-shadow-brain
**npm:** https://www.npmjs.com/package/@theihtisham/agent-shadow-brain

Would love your honest feedback — especially on which feature you'd use first and what's missing. Replying to every comment today!

## FAQ (prepare answers, PH hunters will ask these)

**Q: Does it require an API key?**
A: No. Shadow Brain defaults to Ollama (local) and auto-discovers any API key already configured in your Claude Code / Cursor / Codex / etc. config files. Zero new keys.

**Q: What's the difference from LangChain memory or LlamaIndex?**
A: LangChain memory is per-graph. Shadow Brain is machine-global — shared across every AI agent you use, not just one framework. Also: 22 features LangChain doesn't have (SABB, Causal Chains, signed reputation, etc.).

**Q: Does it work with Windows / Mac / Linux?**
A: All three. Pure TypeScript, no native deps. Requires Node 18+.

**Q: Can I use it at work / with corp data?**
A: Yes. Air-gap mode blocks all outbound network. ChaCha20-Poly1305 encryption at rest. No telemetry, no phone-home. Everything stays on your machine.

**Q: Is this just an MCP server?**
A: No. Shadow Brain has an MCP server (60+ tools), but also its own REST API, WebSocket, LSP server, CLI, and per-agent native hook adapters. MCP is one integration surface, not the core.

**Q: Who's behind this?**
A: Solo indie project by @theihtisham, 100% open source, MIT licensed. No VCs, no company, no telemetry.

**Q: How does SABB work with Claude Code Task tool specifically?**
A: SABB registers a SessionStart hook that detects sub-agent spawns, computes a context sliver relevant to the sub-task, and injects it into the spawn prompt via the brain's MCP server. See `src/brain/subagent-bridge.ts` in the repo.

**Q: Where's the 2-minute video?**
A: In the repo at `docs/launch/shadow-brain-motion-explainer-narrated.mp4`. Or click the banner on the GitHub README.

## Launch day tactics

- **Launch Tuesday or Wednesday**, 12:01 AM PST (product appears on PH for 24 hours)
- **Email every friend/colleague you know** with a pre-written "hunt this if you think it's cool" message (one link, one sentence)
- **Be online the entire first 12 hours** to reply to comments — PH algorithm weighs response speed
- **Post your launch in your Twitter + LinkedIn + relevant Discord/Slack** (once, not spammy)
- **Don't use a PR agency / bots** — PH detects and demotes

## Launch day checklist

- [ ] All 6 gallery assets uploaded at 1080p+
- [ ] Video playing correctly in gallery
- [ ] First comment posted within 5 minutes of launch
- [ ] Twitter thread posted (see TWITTER_THREAD.md) with link back to PH
- [ ] LinkedIn post (see LINKEDIN_POST.md) with link back to PH
- [ ] Reply to every single comment within 1 hour for first 12 hours
- [ ] Share in 2-3 relevant Discord communities you're in (not spammy)

## What a successful PH launch looks like (day-1 targets)

- **Top 5 of the day** → realistic with a good video + active comment engagement
- **1,000+ upvotes** → achievable if first 12 hours are strong
- **100+ comments** → indicator of genuine interest
- **Product of the Day** → top 1 requires excellent maker engagement
- **Product of the Week** → bonus if you stay in top 5 across the week
