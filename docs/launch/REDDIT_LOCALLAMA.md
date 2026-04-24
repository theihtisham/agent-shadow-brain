# r/LocalLLaMA — Reddit post

## Subreddit
`/r/LocalLLaMA` — technical audience, very pro-local + pro-Ollama, skeptical of hype. Lead with tech depth + local-first angle.

## Title

Pick one — all tested for the subreddit's taste:

- **[P] Shadow Brain v6 — 22-module open-source memory layer that makes Claude Code / Cursor / Codex share one local brain (Ollama default, zero API keys)**
- **[P] Built a local-first memory brain for AI coding agents — 48 modules, works with Ollama, every sub-agent inherits context**
- **[Project] Shadow Brain: open-source Hive Mind where every AI coding agent on your machine shares one Ollama-powered brain**

## Body

Hey /r/LocalLLaMA,

Long-time lurker, finally shipping something I think this community will care about.

**What it is:** Shadow Brain is a local singleton brain at `~/.shadow-brain/global.json` that every AI coding agent you use (Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, Aider) reads from and writes to. One brain. Every agent. Every project. Every session.

**Why it matters for this community:**

1. **Ollama is the default provider.** Not an afterthought — Dream Engine, Swarm Debate, Pre-Mortem Assistant, the embeddings module, everything defaults to a local model. No API key required to get full functionality.

2. **Embedding model probing.** On init, it probes your Ollama install for `nomic-embed-text`, `mxbai-embed-large`, or `all-minilm`. If found, semantic memory search upgrades from local hashing to real dense embeddings automatically. If not found, falls back gracefully.

3. **Air-gap mode.** One click. Blocks all outbound network except localhost. Perfect for corp machines / classified work / privacy-first setups.

4. **ChaCha20-Poly1305 at rest** for the brain file. Key derived from passphrase via scrypt. Works fully offline.

5. **Multi-provider registry** with 8 providers (Ollama, Anthropic, OpenAI, OpenRouter, Moonshot/Kimi, Gemini, DeepSeek, Mistral) — but the interesting one is **"agent-proxy" mode**: Shadow Brain auto-discovers any API keys already configured in Claude Code / Cursor / Codex / Cline / Kilo / etc., and can route through them instead of requiring new keys.

**The novel module I'm most excited about — SABB (Sub-Agent Brain Bridge):**

Every multi-agent framework I can find (Claude Task tool, Cursor Composer, CrewAI, LangGraph, AutoGen) starts sub-agents with zero shared memory. SABB detects the spawn, computes a 300-token context sliver relevant to the sub-task (via semantic re-ranking over the global brain), injects it into the spawn prompt, and quarantines anything the sub-agent learns until it's verified. Verified memories graduate back to the global brain with an `origin: subagent` tag.

I looked hard and couldn't find another tool that does this cross-framework. Would love to be wrong if someone has seen prior art.

**22 total novel modules:**
- Causal Memory Chains (Graphviz DAG of any decision's lineage)
- Dream Engine (idle-time reflection loop, uses local Ollama by default)
- Agent Reputation Ledger (Ed25519-signed decision receipts)
- Swarm Debate Protocol, Pre-Mortem Assistant, Branch Brains
- Attention Heatmap (weighted memory attribution)
- Token Economy Engine (tracks cost, routes Opus → Haiku for trivial tasks)
- Forgetting Curve + Sleep Consolidation (Ebbinghaus-inspired)
- Formal Verification Bridge (NL rules → ESLint/Semgrep rules)
- Confidence Calibration Monitor (Brier scores per agent per category)
- Hallucination Quarantine, Voice Mode, Brain Garden, PR Auto-Review
- Team Brain Sync (WebRTC P2P), Brain Exchange (shareable slices)
- Collision Detective, Cost-Aware Sub-Agent Spawner
- Hive Accelerator (SSSP routing + TurboQuant 6× compression)

**Numbers:**
- 48 brain modules
- 90+ CLI commands
- 60+ MCP tools (every brain function exposed to MCP-compatible clients)
- 50+ REST endpoints
- 148 / 148 tests passing
- Pure TypeScript, no native deps
- Works on Node 18+
- MIT

**Install:**
```
npx @theihtisham/agent-shadow-brain@latest attach-all
shadow-brain dash .
# open http://localhost:7341/
```

**Repo:** https://github.com/theihtisham/agent-shadow-brain
**npm:** https://www.npmjs.com/package/@theihtisham/agent-shadow-brain
**Video walkthrough (2 min):** in the repo at `docs/launch/shadow-brain-motion-explainer-narrated.mp4`

**Benchmarks I'd love the community to help me nail:**
- Token savings from auto-routing (I see ~15% on Opus → Haiku for trivial tasks, but my sample size is small)
- Recall accuracy with semantic embeddings vs. keyword-only
- Latency of the SSSP router on 10k+ node causal graphs

Happy to share the `tools/seed-brain.mjs` recipe if anyone wants to reproduce with their own data.

Feedback, issues, PRs all welcome. Solo author, one mediocre dev, probably missed something obvious — tell me what's wrong.

## Flairs

Use `[P] Project` or `[Project]` flair.

## Timing

Reddit → post around 10 AM – 2 PM Eastern on Tuesday/Wednesday for this sub.
