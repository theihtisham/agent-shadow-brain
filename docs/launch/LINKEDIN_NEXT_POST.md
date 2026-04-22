After 3 months of work, just shipped Agent Shadow Brain v5.2.0 — the singleton intelligence layer that gives every AI coding agent on your machine shared memory.

The problem: I switch between Claude Code, Cursor, and Cline depending on the task. Every new session, every tool, starts from zero. Solving the same problem twice. Re-explaining the codebase.

The fix: one brain (`~/.shadow-brain/global.json`) that every AI agent reads from and writes to. What Cursor learns, Claude knows. What you discovered in project A is available in project B. Forever.

Install in 30 seconds:
npx @theihtisham/agent-shadow-brain attach-all

Auto-detects every AI coding agent installed on your machine — Claude Code, Cursor, Cline, Codex, GitHub Copilot, Windsurf, Aider, Kilo, Roo, OpenCode — and wires them to a singleton brain. Every new session, every agent, every project: relevant context proactively injected before the agent's first response.

26 brain modules. 70+ CLI commands. 10 supported AI agents. Zero new runtime dependencies. MIT licensed. Built solo.

Repo: github.com/theihtisham/agent-shadow-brain

If you use more than one AI coding tool, this is the missing layer between them.

#OpenSource #DeveloperTools #ClaudeCode #Cursor #AIAgents #AICoding #TypeScript #IndieHackers
