# Reddit Launch Posts

**Strategy:** post in 5 subreddits over 24 hours. Spacing matters — Reddit penalizes simultaneous cross-posts.

**Order:**
1. r/ClaudeAI (hour 0) — friendliest audience, your core users
2. r/LocalLLaMA (hour +2) — values open-source, technical depth
3. r/MachineLearning (hour +4) — only the [P] (project) flair, technical framing
4. r/programming (hour +6) — broad audience, lead with problem not features
5. r/webdev (hour +24) — pragmatic angle: "the missing layer for AI coding tools"

**General rules:**
- Read each subreddit's rules. Some ban self-promo on weekends.
- Don't link to npm in title — Reddit auto-flags as spam.
- ALWAYS engage with first 5 commenters within 30 minutes.
- Post Tuesday-Thursday morning local time of the largest user base (US East 9am EST).

---

## r/ClaudeAI

**Title:**
```
I built a "shadow brain" that gives Claude Code memory across sessions AND shares it with Cursor/Cline/Codex (open source)
```

**Body:**
```
Hey r/ClaudeAI 👋

Built this for myself because I kept switching between Claude Code, Cursor, and Cline depending on the task, and every new session was a clean slate. Solving the same problem twice. Re-explaining the codebase. You know the feeling.

**Agent Shadow Brain** is a singleton intelligence layer:

- One brain (`~/.shadow-brain/global.json`) shared across ALL your AI coding agents
- Auto-attaches to Claude Code via the SessionStart hook in `~/.claude/settings.json`
- Same brain is also read by Cursor (via `.cursor/rules`), Cline (via VS Code extension settings), Codex, Copilot, etc.
- "Subconscious Engine" proactively injects relevant context (recent decisions, similar past work, cross-agent insights) at the start of every session — within a 2K-token budget so it doesn't bloat your context

**Install (30 seconds):**

    npx @theihtisham/agent-shadow-brain attach-all

This detects every AI agent installed on your machine and wires them up.

**For Claude Code specifically:** it adds a `SessionStart` hook to your `~/.claude/settings.json` that runs `shadow-brain subconscious inject` before your first prompt of every session. You'll see the brain's briefing pop into Claude's context automatically.

**Source:** https://github.com/theihtisham/agent-shadow-brain
**License:** MIT, TypeScript, zero new runtime deps

Would love feedback — especially from anyone who runs Claude Code alongside another AI tool. Does the cross-agent angle resonate, or is it solving a problem only multi-tool users feel?
```

---

## r/LocalLLaMA

**Title:**
```
[Open source] Singleton brain that gives every AI coding agent shared memory — works with local models too (Ollama/LM Studio compatible)
```

**Body:**
```
Sharing a tool I built for my own workflow.

The problem: I run Claude Code with cloud Sonnet for hard tasks, Aider with a local Qwen-Coder for repetitive ones, and Cursor for UI work. Each had its own context. Each forgot everything between sessions. Each had no idea what the others had figured out.

Shadow Brain is a singleton intelligence layer:

- Stores everything in `~/.shadow-brain/global.json` (no SQLite native build, no Python, no Docker)
- Every supported agent reads/writes to it via that agent's native config mechanism
- Includes an MCP server so any MCP-aware agent can talk to the brain directly
- Local-first: nothing leaves your machine unless you explicitly export

For Aider users: it writes to `~/.aider.shadow-brain.md` and adds it to Aider's `read:` config. Briefing appears in your context every session.

For LM Studio / Ollama: works with whatever LLM provider you've got configured. Brain doesn't talk to the LLM — it gives the agent context, and the agent uses whatever LLM you've configured.

26 brain modules, 70+ CLI commands. Includes an LSP server for IDE diagnostics and a web dashboard.

GitHub: https://github.com/theihtisham/agent-shadow-brain
TypeScript, MIT, npm.

Especially curious: does anyone run a similar workflow across multiple tools? What's been your hack for cross-tool memory?
```

---

## r/MachineLearning [P]

**Title:**
```
[P] Agent Shadow Brain — singleton memory layer for cross-agent AI coding tools (TypeScript, MIT)
```

**Body:**
```
Sharing a project that solves a niche but persistent problem in AI-assisted development workflows.

**Problem:** Modern AI coding agents (Claude Code, Cursor, Cline, Codex, Copilot, etc.) each maintain their own context store. When a developer uses multiple tools (common for power users), insights from one tool aren't available to others. Cross-session memory within a single tool is also limited or vendor-locked.

**Approach:** A singleton brain stored at `~/.shadow-brain/global.json` with project-scoped views via stable hash IDs (`crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16)`). Each supported agent has a dedicated adapter that reads from + writes to the singleton via the agent's native config mechanism (e.g., `~/.claude/settings.json` `hooks.SessionStart` for Claude Code).

**Subconscious Engine:** A proactive context injection module that, on every session start, generates a relevance-ranked briefing (recent decisions, similar past work, cross-agent insights, warnings) within a hard token budget (default 2000). Injection is implicit — the agent doesn't query for it.

**Architecture:**
- Storage: append-friendly JSON store with atomic write-and-rename (no SQLite native dep)
- Concurrency: write queue + sync loop (default 5s flush interval)
- Performance: L0 in-memory Map LRU cache (default 64MB byte budget) for sub-millisecond hot recalls
- Auto-maintenance: prune low-importance, rarely-accessed entries when DB exceeds 1GB

**Repo:** https://github.com/theihtisham/agent-shadow-brain
**Stack:** TypeScript, Node 18+, npm
**Includes:** MCP server, LSP server, web dashboard, 26 brain modules, 70+ CLI commands, 10 agent adapters

Open to feedback on the singleton-vs-federated trade-off and any pointers to prior art on cross-tool agent memory architectures.
```

---

## r/programming

**Title:**
```
The missing layer between Claude Code, Cursor, Cline, and your other AI coding tools
```

**Body:**
```
Wrote this because I kept switching between AI coding agents (Claude Code for backend, Cursor for UI, Cline for refactors) and every switch meant re-explaining the codebase. Each tool had no idea what the others had figured out.

Shadow Brain is a singleton "brain" — one local store every AI coding agent reads from and writes to. Install once with:

    npx @theihtisham/agent-shadow-brain attach-all

It detects every AI agent installed on your machine (10 supported), installs the right SessionStart hook for each, and from then on every new session of every agent gets a 2K-token briefing of recent decisions, active tasks, cross-agent insights, and warnings — proactively injected before the agent's first response.

What I'm proud of: zero new runtime dependencies. The singleton brain is just a JSON file with atomic write-and-rename and an in-memory LRU cache. Concurrency works via a write queue. No SQLite native build, no Docker, no Python. `npm install` and you're done.

GitHub: https://github.com/theihtisham/agent-shadow-brain
License: MIT
Stack: TypeScript

Would love thoughts on the cross-tool angle. Most AI coding tools assume you're loyal to one — but every developer I know uses 2-3.
```

---

## r/webdev

**Title:**
```
Show: I made a tool so my AI assistants stop forgetting what they did yesterday
```

**Body:**
```
Quick share for fellow developers using AI assistants in their workflow.

If you've ever:
- Spent 10 minutes catching Claude up on a project you've been working on for weeks
- Used Cursor for UI and Claude Code for backend and noticed they don't share knowledge
- Wished your AI agent remembered the bug it fixed last week without you re-explaining

This might help. It's a tiny CLI tool that creates a shared "brain" all your AI coding tools read from and write to. Install:

    npx @theihtisham/agent-shadow-brain attach-all

It detects which AI tools you have installed (Claude Code, Cursor, Cline, Windsurf, Codex, Copilot, etc.) and wires them up. Every new session of every tool starts with a quick briefing of relevant project context.

Open source, TypeScript, MIT, no new runtime deps.

https://github.com/theihtisham/agent-shadow-brain
```

---

## Engagement Playbook (every subreddit)

For the first 4 hours after posting:

- **Reply to every comment within 15 minutes.** Reddit's algo measures reply rate.
- **Upvote thoughtful critiques** (signals you're not defensive).
- **Take feature requests seriously** — say "I'll add this to the v5.3 list" if reasonable.
- **DO NOT cross-post** until 6+ hours apart. Reddit detects spam.
- **DO NOT link to your other projects** in the same post. Looks self-promotional.
- **DO link to specific files/code** when answering technical questions. Builds credibility.
