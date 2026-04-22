# Changelog

All notable changes to `@theihtisham/agent-shadow-brain` are documented here.

This project follows [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/) conventions.

> For detailed release notes with migration guides, see the [docs/versions/](docs/versions/) directory.

---

## [5.2.0] — 2026-04-22 — Subconscious Singularity Edition (Current)

> **One brain. Every agent. Every project. Every session. Forever.**

### The Singularity

Before v5.2.0, every project had its own brain and every AI agent (Claude, Cursor, Cline...) had to be told what each project knew. Now there is **one brain** — a singleton global database at `~/.shadow-brain/global.db` that every agent reads from and writes to.

What Cursor learns in project A is instantly known to Claude Code in project B.

### Added

- **Singleton Global Brain** (`src/brain/global-brain.ts`) — one `~/.shadow-brain/global.db` is the source of truth for every project + agent on the machine. SQLite WAL mode + write queue handles concurrent multi-agent writes. Auto-vacuum at 500MB, auto-prune at 1GB. Project-scoped views via `GlobalBrain.projectIdFor(rootDir)`.
- **Subconscious Engine** (`src/brain/subconscious.ts`) — proactive context injection on every session start. The agent doesn't have to ask — the brain surfaces recent decisions, active tasks, similar past work, project state, cross-agent insights, and warnings. Hard-capped at 2K tokens, relevance-ranked, agent-configurable.
- **Universal Bootstrap** (`src/brain/session-hooks.ts`) — `asb attach-all` detects every installed AI agent on your machine and installs SessionStart hooks per agent's native mechanism (Claude Code settings.json, Cursor `.cursor/rules`, Cline VS Code extension, Windsurf `.windsurfrules`, Codex config.json, Aider `.aider.conf.yml`, Copilot `.github/copilot-instructions.md`, etc.). Every agent calls Shadow Brain on first prompt of every session.
- **L0 In-Memory Hot Tier** (`src/brain/l0-cache.ts`) — sub-millisecond recall via byte-budgeted Map LRU. Sits in front of the global SQLite brain. Per-namespace caches with `getCache(name)`. Default 64MB budget, configurable.
- **Cursor Adapter** (`src/adapters/cursor.ts`) — first-class adapter, no more falling back to ClineAdapter. Reads conversations from `~/.cursor/conversations`, injects into `.cursor/rules/shadow-brain-insights.md`, escalates critical insights to `.cursorrules`.
- **Windsurf Adapter** (`src/adapters/windsurf.ts`) — first-class adapter. Reads from `~/.windsurf/conversations`, writes to `.windsurfrules` with `# === Shadow Brain Insights ===` marker for safe re-injection.
- **GitHub Copilot Adapter** (`src/adapters/copilot.ts`) — workspace-level integration via `.github/copilot-instructions.md` (Copilot's official context file). Replaces a marker block on each update so injection is idempotent.
- **4 New CLI Commands**:
  - `asb attach-all` — universal bootstrap for every detected agent
  - `asb subconscious inject|status|configure` — manage proactive context injection
  - `asb global stats|recall|cache|sync` — inspect the singleton global brain
- **4 New MCP Tools** — `subconscious_inject`, `global_recall`, `global_stats`, `attach_status`. Now any MCP client can talk to the global brain directly.

### Changed

- **AgentTool union** now includes `'copilot'` — full type-safe support for 10 agents (was 9)
- **adapters/index.ts** — Cursor and Windsurf no longer alias ClineAdapter; each gets its own implementation
- **Description + 80 npm keywords** rewritten for v5.2.0 positioning and maximum discoverability
- **Total brain modules: 26** (4 new + 22 from v5.1.1)

### Performance

- Hot recalls now <1ms via L0 cache (was 10-30ms via SQLite)
- Cross-project queries replace per-project DB lookup overhead with a single indexed query

### Fixed

- Cursor and Windsurf adapters previously reused ClineAdapter — they now have correct path detection and conversation parsing for their actual file layouts

### Migration Notes

v5.2.0 is **fully backward-compatible** with v5.1.1. The global brain is created on first init and coexists with project-local brains. No breaking changes to existing CLI commands or MCP tools.

To opt into the new singleton model: run `asb attach-all` once and every future session of every agent will auto-bootstrap.

---

## [5.1.1] — 2026-04-18 — Hyper-Cognitive Intelligence Edition

### Added
- **Built-in LSP Server** — pure Node.js Language Server Protocol implementation with stdio + TCP transport modes, real-time diagnostics, hover info, and code actions
- **Custom LLM Fine-Tuning Engine** — automatic training data generation from code changes, JSONL export, multi-model training pipeline
- **Smart Cache** — 3-tier (hot/warm/cold) LRU cache with predictive prefetch via co-access graph, tag-based invalidation, and adaptive tier promotion
- **Intent Engine** — multi-strategy NLP command understanding with keyword, fuzzy, and context-aware matching strategies
- **Code DNA Fingerprinting** — 9-gene structural analysis covering structure, complexity, style, dependency, and evolution gene categories
- **Temporal Intelligence** — velocity metrics, file heatmaps, 5-factor bug prediction, anomaly detection, and peak hour/day analysis
- 6 new CLI commands: `lsp`, `fine-tune`, `cache`, `intent`, `dna`, `temporal`
- 27 README badges for maximum discoverability

### Changed
- Total brain modules: **22** (6 new + 16 from v5.0.1)
- All v5.0.1, v5.0.0, and v4.0.0 features included and enhanced
- Expanded npm keywords to 50+

### Fixed
- 18 TypeScript compilation errors in CLI — aligned property references with actual module interfaces

---

## [5.0.1] — 2026-04-15 — Zero-Config Intelligence Edition

### Added
- **Zero-Config Auto-Setup** — auto-detect project type, AI tools, languages, frameworks; auto-install MCP config + git hooks
- **MCP Server** — 19-tool Model Context Protocol server for Claude Code, Cursor, and all AI tools
- **Rich Web Dashboard** — real-time WebSocket dashboard with 8 panels (health, memory tiers, insights, fixes, AI tools, modules, stats, controls)
- **Natural Language Queries** — `shadow-brain ask "..."` for plain-English brain interaction
- **Plugin System** — hookable analysis pipeline with npm plugin discovery
- **Brain Export/Import** — full brain state portability for team sync and backup
- 5 new CLI commands: `off`, `ask`, `export`, `import`, `plugin`
- **Cursor MCP Compatibility** — root path POST + `/v1/chat` endpoint support
- **Postinstall Auto-Setup** — runs automatically after `npm install`

### Changed
- 50+ npm keywords for discoverability
- All v5.0.0 and v4.0.0 features included and enhanced

---

## [5.0.0] — 2026-04-12 — Infinite Intelligence Edition

### Added
- **Hierarchical Memory Compression** — 4-tier pyramid (raw -> summary -> pattern -> principle) with drill-down/up navigation
- **Context-Triggered Associative Recall** — automatic memory activation based on file paths, keywords, and categories
- **Multi-Agent Consensus Protocol** — trust-weighted voting, confidence intervals, conflict resolution across multiple AI agents
- **Collective Cross-Project Learning** — verified rule sharing, viral propagation, accuracy tracking across projects
- 5 new CLI commands: `memory`, `recall`, `consensus`, `collective`, `v5`

### Changed
- Memory architecture fully rewritten for infinite retention
- Cross-agent communication protocol standardized

---

## [4.0.0] — 2026-04-08 — Hyper-Intelligence Edition

### Added
- **TurboQuant Infinite Memory** — 6x compression, zero forgetting (based on Google Research, ICLR 2026)
- **SSSP BMSSP Routing** — O(m log^(2/3) n) deterministic routing (based on arXiv 2504.17033, Duan et al.)
- **Self-Evolving Genetic Rules** — tournament selection, Gaussian mutation, Bayesian meta-learning
- **Cross-Agent Intelligence Protocol (CAIP)** — 7 agents share insights in real-time via WebSocket
- **Adversarial Hallucination Defense** — cross-reference verification, evidence scoring, confidence thresholds
- **Swarm Intelligence** — Ant Colony Optimization pheromone-based file prioritization
- **Knowledge Graph + PageRank** — code entity impact radar with d=0.85 damping factor
- **Predictive Engine** — bug risk scoring, technical debt forecasting, anomaly detection
- 9 new CLI commands: `turbo`, `route`, `caip`, `evolve`, `predict`, `graph`, `swarm`, `defense`, `v4`

### Changed
- All v3.0.0 features included and enhanced
- Neural mesh upgraded with TurboMemory integration
- Pattern memory upgraded with compressed vector storage
- Learning engine upgraded with genetic optimization

---

## [3.0.0] — 2026-04-01 — Hyper-Intelligence Edition

### Added
- **Cognitive Load Analysis** — estimates mental complexity of code sections
- **Security Audit Engine** — vulnerability scanning, dependency risk assessment
- **Influence Map** — tracks which code changes ripple through the codebase
- Enhanced neural mesh with Shannon entropy and cosine similarity
- Bayesian confidence scoring for all insights

### Changed
- Analysis pipeline fully restructured for hyper-intelligence features
- CLI expanded with security and cognitive commands

---

## [2.1.0] — 2026-03-25 — Quantum Neural Mesh

### Added
- **Cross-Session Shared Intelligence** — persist and share insights across sessions
- **Shannon Entropy Analysis** — information-theoretic code complexity measurement
- **Cosine Similarity Matching** — semantic code comparison
- **Bayesian Confidence** — probabilistic confidence scoring for recommendations

### Changed
- Neural mesh architecture upgraded for cross-session persistence
- Insight quality improved with entropy-based scoring

---

## [2.0.0] — 2026-03-18 — Super-Intelligence Edition

### Added
- **Semantic Analyzer** — deep code understanding beyond syntax
- **Dependency Graph** — full project dependency visualization and analysis
- **Code Similarity Engine** — detect duplicated and near-duplicated code
- **MCP Server** — initial Model Context Protocol server implementation
- **Team Mode** — collaborative AI-assisted development

### Changed
- Complete architecture rewrite from v1.x
- CLI expanded from 15 to 35+ commands

---

## [1.x] — 2026-02 to 2026-03 — Foundation

### v1.2.0
- Added vulnerability scanning
- Added CI/CD integration hooks

### v1.1.0
- Added smart fix suggestions
- Added health scoring with weighted metrics

### v1.0.0
- Initial release
- 7 agent adapters (Claude Code, Cursor, Cline, Windsurf, Copilot, Kilo Code, Amp)
- Basic health scoring and analysis pipeline
- Vulnerability scanning
- CLI with 15 commands

---

[5.2.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v5.2.0
[5.1.1]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v5.1.1
[5.0.1]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v5.0.1
[5.0.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v5.0.0
[4.0.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v4.0.0
[3.0.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v3.0.0
[2.1.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v2.1.0
[2.0.0]: https://github.com/theihtisham/agent-shadow-brain/releases/tag/v2.0.0
