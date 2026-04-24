# r/programming — Reddit post

## Subreddit
`/r/programming` — general dev audience, allergic to marketing copy. Must lead with the craft, not hype.

## Title

- **Shadow Brain: an open-source singleton memory layer so Claude Code, Cursor, Codex, and their sub-agents share one local brain**
- **Built an open-source brain that lets every AI coding agent on your machine share memory (22 modules, 148 tests, MIT)**

## Body

I had a frustrating realization: I was paying for Claude Code, Cursor, and Codex simultaneously, and all three were forgetting the same things at the start of every session. Worse — when Claude's Task tool spawned a sub-agent, the sub-agent started completely blind, even though the parent already knew the project cold.

So I built Shadow Brain.

**What it is, in one line:** a local TypeScript service at `~/.shadow-brain/global.json` that every AI coding agent on the machine reads from and writes to, plus a web dashboard at `localhost:7341` to inspect and control everything.

**The architectural idea:**

1. **Singleton global brain** — plain JSON store with atomic `.tmp` + rename writes for concurrency. No native deps, no database, no server required.
2. **L0 in-memory cache** — sub-millisecond recalls, LRU with byte budget.
3. **Per-agent adapters** — each agent tool's native config mechanism is used. Claude Code → `~/.claude/settings.json` SessionStart hook. Cursor → `.cursor/rules/` + `.cursor/mcp.json`. Cline → VS Code globalStorage MCP. Codex → `~/.codex/config.json`. Ten agents, ten adapters.
4. **SABB (Sub-Agent Brain Bridge)** — detects Claude Task / Cursor Composer / CrewAI / LangGraph / AutoGen sub-agent spawns, computes a focused 300-token context sliver via semantic re-ranking, injects it into the spawn prompt, quarantines new learnings until confidence ≥ 0.7.
5. **Causal Memory Chains** — each brain write can record its parent-cause ID, building an audit DAG. Graphviz export included.
6. **Dream Engine** — background setInterval that runs reflective cycles via whatever LLM is configured (Ollama default): revisit, counterfactual, consolidation, contradiction, pattern-discovery.
7. **Ed25519-signed Reputation Ledger** — every agent decision gets a signed receipt. Uses `node:crypto`.

**Production details that matter:**
- 148 vitest tests passing, including the v6 smoke suite covering every module
- 0 TypeScript errors, strict mode
- atomic writes everywhere — no partial-write corruption
- schema migration for the global brain format
- `repairClaudeHookBlocks()` auto-heals any malformed `settings.json` on attach/detach so bad installer output from older versions doesn't brick Claude Code
- MCP server exposes 60+ tools so MCP-native clients can call the brain directly
- LSP server for IDE integration
- 8 LLM providers supported out of the box: Ollama, Anthropic, OpenAI, OpenRouter, Moonshot/Kimi, Gemini, DeepSeek, Mistral. Plus an "agent-proxy" mode that auto-discovers existing agent config files and reuses their API keys, so Shadow Brain can work with zero new keys.
- Air-gap mode blocks all outbound network except localhost. ChaCha20-Poly1305 at rest.

**Research-grade accelerators:**
- SSSP routing based on [arXiv 2504.17033 "Breaking the Sorting Barrier"](https://arxiv.org/abs/2504.17033) for causal chain traversal — O(m log^(2/3) n) vs Dijkstra's O(m + n log n)
- TurboQuant ([ICLR 2026 Google Research](https://openreview.net/forum?id=TbqSEUXWaO)) for 6× vector compression (PolarQuant 2 bits + QJL residual 1 bit)

**What I'm proud of / what I hate:**

Proud: the SABB cross-framework abstraction — I genuinely cannot find prior art. Causal chains with real atomic persistence. The repair function that quietly fixes anyone upgrading from v5.

Hate: the dashboard HTML is still a single embedded template-string file (~3000 lines). Should migrate to a proper framework but wanted zero external build step so `npm i && npm run dev` just works.

**Install:**
```
npx @theihtisham/agent-shadow-brain@latest attach-all
```

**Code:** https://github.com/theihtisham/agent-shadow-brain (MIT, solo author)

Happy to discuss the trade-offs. Especially curious if anyone has seen cross-framework sub-agent memory syncing elsewhere — I want to know prior art.

## Comment responses prepared for common /r/programming pushback

**"This is just an MCP server wrapper":** No. MCP is one of many integration surfaces. Shadow Brain also has its own REST API, WebSocket push, LSP server, CLI, and per-agent native hooks. MCP is an exposure layer, not the core.

**"Why not use LangChain / LlamaIndex memory?":** LangChain's memory is per-graph-instance. Shadow Brain is machine-global. Also LC doesn't do sub-agent bridging, causal chains, or signed reputation.

**"Yet another AI tool":** Fair. The differentiator is cross-agent + cross-framework memory + 22 specific modules that genuinely don't exist elsewhere. If it's just duplicating prior art, I want to know.

**"Solo author, how do I trust it?":** MIT license. 148 tests. Inspect every line. No telemetry. No phone-home. Local-first. The whole thing is on disk in `~/.shadow-brain/` — you can delete it in one command.
