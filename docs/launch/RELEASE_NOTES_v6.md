# 🧠 Shadow Brain v6.0 — "Hive Mind"

**The first cross-agent, cross-framework memory layer built for every AI coding assistant on your machine.**

One install → Claude Code, Cursor, Cline, Codex, Copilot, and Continue share the same persistent brain. Memories earned in one agent are instantly available to all.

```bash
npx @theihtisham/agent-shadow-brain@latest attach-all
```

---

## 🎬 Watch the 2-minute explainer

See it in motion: attached below as `shadow-brain-motion-explainer-narrated.mp4`.

---

## 🔥 22 novel features — none of these exist in any other tool

### Cross-agent infrastructure
1. **Sub-Agent Brain Bridge (SABB)** — Claude Task, Cursor Composer, CrewAI, LangGraph, AutoGen sub-agents all share memory with quarantine + graduation (confidence ≥ 0.7 before promotion)
2. **Multi-agent attach** — `attach-all` wires every detected agent in one command
3. **Agent firewall** — per-agent permission policies + audit log
4. **Agent handoff protocol** — hand a task between agents without losing context

### Memory architecture
5. **L0/L1/L2/L3 tiered cache** — hot recent, warm session, cold global, frozen archive
6. **Causal memory chains** — every memory links to what caused it → exportable Graphviz DOT
7. **SSSP routing** (arXiv 2504.17033) — finds the shortest causal path between memories in O(m log^(2/3) n)
8. **TurboQuant compression** (ICLR 2026) — 6× embedding compression with <2% recall loss
9. **Ebbinghaus forgetting curve** — memories decay like a real brain, important ones strengthen
10. **Brier calibration** — tracks confidence-vs-outcome, recalibrates itself weekly

### Intelligence layer
11. **Dream Engine** — idle-time reflection via local LLM consolidates patterns into insights
12. **Pattern memory** — detects and stores recurring code/bug/fix patterns automatically
13. **Reputation ledger** — tracks which sources/agents produce memories that turn out correct
14. **Brain chat** — RAG against your own brain with Ed25519-signed citations
15. **Session-aware recall** — memories surface at exactly the right moment in a session

### Privacy & security
16. **Local-first default** — Ollama, no data leaves your machine
17. **Ed25519 signing** — every memory cryptographically signed, tamper-evident
18. **ChaCha20-Poly1305 encryption** — optional at-rest encryption via scrypt key derivation
19. **Team brain sync (WebRTC)** — share memories with teammates without a server

### Integrations
20. **Multi-provider LLM registry** — Ollama, Anthropic, OpenAI, OpenRouter, Moonshot, Gemini, DeepSeek, Mistral + agent-proxy mode
21. **MCP server with 60+ tools** — every brain op exposed over Model Context Protocol
22. **Web admin dashboard** — 28 tabs, live graphs, signals feed, STOP button, real data only

---

## 🚀 Install

```bash
# One command — auto-detects every AI agent on your machine
npx @theihtisham/agent-shadow-brain@latest attach-all

# Then open the dashboard
npx @theihtisham/agent-shadow-brain dashboard
```

Works on Windows, macOS, Linux. No sign-up, no cloud, no account.

---

## 📊 By the numbers

- **22** novel features not found in any competing tool
- **8** LLM providers + agent-proxy auto-discovery
- **60+** MCP tools
- **28** admin dashboard tabs
- **1** command to wire every agent on your machine
- **0** data sent anywhere by default

---

## 🛠️ For every builder, researcher, and curious developer

Shadow Brain runs 100% on your machine by default — your memory never leaves your laptop unless you explicitly sync a team brain.

- **Open source** — MIT, single author, no VC, no telemetry
- **Local-first** — Ollama models handle embeddings + reflection
- **Extensible** — every memory op is an MCP tool you can call from any agent

---

## 📦 What's in this release

- `dist/` — published package (also live on npm: [@theihtisham/agent-shadow-brain@6.0.0](https://www.npmjs.com/package/@theihtisham/agent-shadow-brain))
- `shadow-brain-motion-explainer-narrated.mp4` — 2-minute narrated product demo

---

## ⚡ Quick links

- **npm:** https://www.npmjs.com/package/@theihtisham/agent-shadow-brain
- **Docs:** https://github.com/theihtisham/agent-shadow-brain#readme
- **Changelog:** [`CHANGELOG.md`](https://github.com/theihtisham/agent-shadow-brain/blob/main/CHANGELOG.md)
- **Report issues:** https://github.com/theihtisham/agent-shadow-brain/issues

---

**One person. One weekend. A memory layer every AI coding agent wanted but nobody built.**

Built entirely by [@theihtisham](https://github.com/theihtisham) — no co-authors, no AI attribution.
