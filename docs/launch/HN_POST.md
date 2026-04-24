# Hacker News — Show HN Submission

**URL:** https://news.ycombinator.com/submit
**Submit time:** Tuesday 9:00 AM PST (peak HN engagement)
**Category:** Show HN

---

## Title (80 char max — be ruthless)

Use ONE of these. A/B-test by trying the highest-scoring on a throwaway repost if first dies:

```
Show HN: One brain shared across Claude Code, Cursor, Cline, Codex, Copilot
```

```
Show HN: Shadow Brain – every AI coding agent shares the same memory
```

```
Show HN: My agents stopped forgetting between sessions (open source)
```

**My pick: #1** — it's specific, names the tools your audience uses, implies the value without overclaiming.

---

## URL field

```
https://github.com/theihtisham/agent-shadow-brain
```

---

## Text field (this is the comment YOU post immediately after submitting — pin it)

```
Hi HN,

I built this because I switch between Claude Code, Cursor, and Cline depending on the task — and every time I switch tools or open a new session, the agent has zero memory of what I've been working on. I'd just spent 2 hours debugging a tricky race condition in Cursor; opened Claude Code 10 minutes later, and it suggested the exact wrong fix I'd already disproved.

Shadow Brain is a singleton "brain" — one SQLite-style JSON store at ~/.shadow-brain/global.json — that every AI coding agent on your machine reads and writes to. What one agent learns, all agents know. Cross-session, cross-project, cross-agent.

What it does, concretely:

  - `npx @theihtisham/agent-shadow-brain attach-all` detects every installed AI agent
    on your machine (Claude Code, Cursor, Cline, Windsurf, Codex, Kilo, Roo, OpenCode,
    Aider, GitHub Copilot) and installs a SessionStart hook for each. Every new session
    of every agent calls Shadow Brain first.

  - On session start, the "Subconscious Engine" proactively injects a 2K-token briefing:
    recent decisions you made, active tasks, similar past work from other projects,
    cross-agent insights, warnings. The agent doesn't have to ask — it's just there.

  - L0 in-memory cache means hot recalls return in <1ms.

  - Auto-prune at 1GB, auto-vacuum at 500MB, so it stays infinite without bloating disk.

It's TypeScript, MIT, zero new runtime deps (just JSON files). 26 brain modules,
70+ CLI commands, 10 supported agents. Ships an MCP server, an LSP server, and a
web dashboard.

The hardest design problem was making the singleton brain handle concurrent writes
from multiple agents without conflicts. I ended up with a write queue + atomic file
replace pattern — simpler than native database setup and works without native deps.

I'd especially love feedback on:

  - Whether the "subconscious" framing is clearer than "automatic context injection"
  - The hook installation per agent — I researched each agent's actual extension
    mechanism but if you use one I got wrong, please tell me
  - Whether 2K tokens is the right default budget for the briefing

Source: https://github.com/theihtisham/agent-shadow-brain
Install: `npx @theihtisham/agent-shadow-brain attach-all`
```

---

## Posting Tips

- **DO NOT** title your post with hype words ("revolutionary", "world's first", "best ever") — HN will flag it.
- **DO NOT** ask for upvotes. HN auto-detects vote rings.
- **DO** reply to every comment in the first 4 hours. Engagement keeps you on front page.
- **DO** be honest about what's not great. If someone says "this is just X with Y added", agree if true.
- **DO** mention you're solo. HN loves solo builders.

---

## Anticipated Hostile Comments + Responses

**"This is just MCP with extra steps"** →
> "Fair — Shadow Brain uses MCP as one of several transports. The new thing isn't MCP itself, it's the singleton-brain-across-agents pattern. MCP solves the protocol; Shadow Brain solves the 'every agent has its own brain' problem."

**"Why do I need this when [tool X] has memory?"** →
> "Tool X's memory is per-session-per-tool. Shadow Brain's memory is shared across ALL your tools. If you only use one tool, you might not need this. If you use 2+, the savings compound."

**"Looks like overengineering — what's a basic use case?"** →
> "Honest answer: if you only use Claude Code on one project, this is overkill. The killer use case is: Cursor for UI work, Claude Code for backend, both in the same monorepo. Without Shadow Brain they don't know what each other has done. With it, they collaborate."

**"Where's the demo video?"** →
> "Honest answer: I'm a solo dev and didn't make one for this launch. README has a 30-second install GIF. Happy to ship a 2-min Loom by tonight if there's interest."
