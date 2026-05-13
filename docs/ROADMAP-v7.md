# Shadow Brain — Roadmap to v7.0 and Beyond

> **Status:** Living document
> **Last updated:** 2026-05-12
> **Author:** @theihtisham
> **Companion docs:** `RELEASE_NOTES_v6.0.2.md`, `VIRAL-PLAYBOOK.md`

This is the strategic plan. v6.0.2 ("Singularity") shipped the substrate. v7.0 is where Shadow Brain becomes the default infrastructure for every AI coding agent on Earth.

---

## North Star

> **"Every line of code an AI agent writes anywhere should be able to draw on every relevant lesson your team has ever learned — instantly, locally, privately."**

That's it. The roadmap exists to compound toward that.

---

## v7.0 — "Multiplayer" (target: Q3 2026)

The theme is *plurality*. v6 made the brain smart; v7 makes it social.

### 🟥 Tier-S (no v7 without these)

#### S1. CRDT real-time team sync (Yjs)
Replace `team-sync` JSON-stomp protocol with **Yjs**. Two engineers on the same brain, concurrent edits, conflict-free. Figma-for-knowledge.
- Yjs Y.Doc per project
- WebSocket relay (default: free, self-hosted) + optional Cloudflare relay
- Encrypted-at-rest via existing `brain-encryption.ts`
- Backwards-compat shim for v6 team-sync clients

#### S2. VS Code Marketplace launch
The repo has `vscode-extension/` — it's not on the marketplace yet.
- Inline memory highlights ("Agent X learned this from file Y")
- Hover for entity provenance ("learned 2 weeks ago by Cursor, confirmed 3× by Claude")
- One-click "ask brain about this function"
- Codelens for files: "12 brain memories · 3 ADRs · 1 collision pending"
- Status bar: brain health · forgetting curve · last sync
- Publisher account: needs theihtisham@ Microsoft Partner Center setup

#### S3. SWE-Bench-Verified public leaderboard
v6.0.2 shipped the harness. v7 runs it for real.
- 50-problem SWE-Bench-Verified subset
- Brain off vs brain on for: Claude 4.7, GPT-5, DeepSeek V3, Llama 4
- Published dashboard at `brain.dev/leaderboard` (domain TBD)
- Numbers become the marketing — if brain delivers +20pp resolution, that's the headline

#### S4. Brain Exchange seeded with 10 canonical packs
The marketplace exists; the content doesn't. Pre-build and curate:
- React 19 · Next.js 16 · Vue 4 · Svelte 6
- Django 5 · Rails 8 · FastAPI · NestJS
- Rust async (Tokio/axum) · Solidity · Unity 6
- K8s ops · Postgres ops · Solana programs
Each pack: 200-500 high-signal entities, signed, MIT-licensed.

### 🟧 Tier-A (high impact)

#### A1. Mobile companion (React Native + Expo)
"Brain in your pocket."
- Voice capture: hold-to-talk → transcribe → ingest as memory
- Photo capture: snap a whiteboard → llava → memory entity
- Dashboard read-only view
- Notifications: "Your brain forgot X yesterday — restore?"
- Syncs via team-sync (Yjs)

#### A2. Multimodal v2 — real OCR + diagrams
v6.0.2 stubs OCR. v7 wires tesseract-wasm (zero install) for clean text extraction. Plus diagram parsing (Mermaid/PlantUML detection).

#### A3. Project-LoRA — actually trained
v6.0.2 ships the pipeline. v7 actually trains + publishes:
- 5 reference adapters on Hugging Face (one per canonical brain pack)
- Per-user trained adapters via paid tier (compute pass-through, no margin)
- Ollama Modelfile auto-generation
- A/B vs base model in eval harness

#### A4. Constitution v2 — auto-evolution
v6.0.2 reads `constitution.md` statically. v7 lets the brain **propose new rules** when it sees repeated violations of patterns. User approves → rule added. Living constitution.

#### A5. Time-travel UI in dashboard
Brain Replay is currently CLI/SVG. v7 ships an interactive React panel: drag-scrub, play, slow-motion, jump-to-milestone, full-screen.

### 🟨 Tier-B (high-leverage smaller bets)

- **B1.** Brain Exchange CLI commands: `shadow-brain exchange install react@latest` → ready in 5 seconds
- **B2.** Pricing tier signal: free → pro ($10/mo for team sync relay + LoRA training compute)
- **B3.** Public homepage: `brain.dev` (or `shadow-brain.dev`) with live demos
- **B4.** SDK in 3 langs: TypeScript (have it), Python, Rust — for embedding brain in any tool
- **B5.** "Ask the Hive" public demo — drop in a code snippet on the homepage, see the brain answer live (with rate limit)
- **B6.** Cursor / Cline / Aider plugins-on-their-marketplace (where they have one)
- **B7.** GitHub Action: `shadow-brain/learn-from-pr@v1` — every merged PR ingests its lessons
- **B8.** Brain garden v2 — actual knowledge-graph editor, not just a viz

### 🟩 Quality of life (do anytime)

- 30-second `demo` enhancements: add 3 themed sample projects (React, Django, Rust) the user can pick
- Per-platform installers: Homebrew tap, scoop, winget
- One-click migration from Cursor/Cline-stored prompts (if those tools expose any local memory)
- Brain "health report" weekly email (opt-in)
- "What did my brain learn today?" daily digest

---

## v7.5 — "Distributed" (target: Q4 2026)

### Big swings

- **Federated brains** — multiple teams' brains can selectively share concepts without merging fully. Cross-org learning without leaks.
- **Constitution federation** — share rules across projects with diff-and-approve flow
- **Real-time co-debugging** — two engineers + their brains + shared cursor on a bug, with hive-voice for decisions
- **Brain forking** — `shadow-brain fork --from theihtisham/react-pack` like GitHub for brains
- **Brain pull requests** — propose a change to a public brain, peer-reviewed

---

## v8.0 — "Self-Aware" (target: 2027)

The brain becomes meta-cognitive.

- **Self-tuning forgetting curve** — brain decides what to keep based on observed agent behavior, not heuristics
- **Brain self-debugging** — brain detects its own degraded recall and proposes interventions
- **Cross-brain federated learning** — multi-team adapters fine-tuned across consenting brains, privacy-preserving (DP-SGD or LoRA federation)
- **Predictive memory** — brain pre-fetches likely-needed memories *before* the agent asks, based on session trajectory
- **Brain handoff to humans** — handoff briefing generator: when a human takes over from an agent, get a one-page "what the agent thinks it knows + what it's uncertain about"

---

## What we will NOT build

Explicit anti-list. Saves time arguing.

- **Hosted-only SaaS shell** — defeats the local-first thesis. Always local-first; cloud is a relay, not a brain.
- **Closed core, open shell** — the brain stays MIT. Always.
- **LLM provider lock-in** — must work with Ollama / vLLM / any OpenAI-compat / Anthropic API equally.
- **Replacing the agent** — Shadow Brain is *for* agents, not a competing agent. Hermes-Devin-AutoGen territory is theirs.
- **Surveillance features** — no telemetry. No "anonymous usage data." Ever.

---

## How to push back on this roadmap

This document changes. File an issue at `github.com/theihtisham/agent-shadow-brain/issues` with:
- The item you disagree with
- What you'd do instead
- Why (with evidence — your team's experience, paper citation, etc.)

Strongest arguments win. The author reserves the right to be wrong publicly.
