# Shadow Brain — Viral Launch Playbook

> **For:** @theihtisham — execute personally; do NOT delegate
> **Goal:** v6.0.2 "Singularity" reaches **HN front page**, **#1 trending on GitHub**, **10k stars in 30 days**
> **Honest disclaimer:** Virality is not engineered, only set up. This playbook maximizes the chance, but timing + luck + thumbnail matter.

---

## The Thesis

Hermes Agent, Devin, Cursor, Cline didn't go viral because they were *more featured*. They went viral because they showed **one undeniable thing the world hadn't seen**. For Shadow Brain v6.0.2, that thing is:

> **"Your codebase becomes its own model. Watch your AI agents share a single brain — and produce shareable proof."**

The 5 viral features (Replay, DNA, Hive Voice, Time Capsule, Diff) are designed to **produce screenshots that people retweet**. The product is the marketing. Every artifact is a thumbnail.

---

## The 4-Phase Launch

### Phase 0 — T-7 days: Build the seed (in private)

- [ ] **Record the hero demo** — 90 seconds, no narration, just the dashboard + 3 viral features in action. Upload as MP4 to repo and to a Twitter-friendly host.
- [ ] **Generate 5 Brain DNA cards** — for 5 different real public repos (React, Django, your own repo, an Anthropic SDK, a Hacker News favorite). Save as PNG.
- [ ] **Generate Brain Replay SVG** for at least 1 mid-sized real project. Polish the gradient/colors so it looks like a poster.
- [ ] **Generate a Hive Voice SVG** answering a hot question ("Should you use Server Components by default in 2026?"). Make it look like an FOMC bar chart.
- [ ] **Run SWE-Bench-Lite once** locally if compute allows — get *real numbers*. "+33% resolution rate" beats "potentially huge."
- [ ] **Pre-seed 5 GitHub issues** with discussions / FAQs / known limitations — looks alive on day 1.
- [ ] **Update the README banner** with a still from the hero demo.
- [ ] **Buy the domain** `shadow-brain.dev` and `brain.dev` if available; just park them.

### Phase 1 — Launch day (Tuesday, 09:00 PT)

The launch tweet **leads with the SVG**, not the link.

#### Tweet 1 (with Brain DNA card image):
```
your codebase has a personality.

mine is "The Architect."

i built shadow brain — every AI coding agent on your machine shares one local brain.
v6.0.2 ships 5 things nobody else has.

🧵
```

#### Tweet 2 (with Brain Replay timeline SVG):
```
1/ Brain Replay

scrubbable timeline of every decision, memory, and insight your hive has made — since day zero.

drag the cursor. watch your project learn.

[gif of scrubbing the timeline]
```

#### Tweet 3 (with Hive Voice bar chart):
```
2/ Hive Voice

3 local models vote on every architecture decision.
you see consensus, dissent, and confidence distribution. live.

no more "the AI said so." now you see the AIs argue.
```

#### Tweet 4 (with Time Capsule screenshot):
```
3/ Brain Time Capsule

freeze your brain. label it. resurrect it in 6 months.

"here's what we knew about React in January."
"here's what we thought about Supabase before the migration."

git, but for intelligence.
```

#### Tweet 5 (with Brain Diff Venn):
```
4/ Brain Diff

diff two brains semantically.

"what did Team A learn that Team B didn't?"

[Venn diagram SVG]

now you know what to teach.
```

#### Tweet 6 (with sample LoRA conversation):
```
5/ Project-LoRA

every week, distill your brain into a LoRA adapter on Qwen2.5-Coder-1.5B.

your codebase becomes a model.

runs locally via Ollama. zero cloud. zero per-token cost.
```

#### Tweet 7 (the close):
```
shadow brain v6.0.2 — "Singularity"

local-first
free forever
MIT license
zero telemetry

$ npm i -g @theihtisham/agent-shadow-brain
$ shadow-brain demo

→ github.com/theihtisham/agent-shadow-brain
```

### Phase 1 — Launch day, simultaneous posts

#### Hacker News (Show HN, ~09:30 PT same morning):
```
Show HN: Shadow Brain — 5 features no other AI coding agent has

Title is honest, not clickbait. Body:

I got tired of explaining the same context to Claude Code, then Cursor, then Cline. Every session, every agent, from zero.

So I built Shadow Brain. One local brain. Every agent — Claude Code, Cursor, Cline, Aider, Copilot, Codex, Windsurf, OpenCode — shares it. What one agent learns, every agent inherits. 100% local. MIT.

v6.0.2 ships 5 things I haven't seen anywhere else:

1. Brain Replay — scrubbable timeline of every brain event since day zero. SVG exports.
2. Brain DNA — Spotify-Wrapped-style fingerprint card per codebase. Shareable PNG.
3. Hive Voice — multiple local models vote on every question. See dissent + confidence live.
4. Brain Time Capsule — freeze + resurrect brain states. "Here's what we knew in January."
5. Brain Diff — semantic diff between two brains. Venn diagram output.

Plus: real ANN vector index, Constitution layer, Confidence Gate, multimodal vision, LoRA distillation pipeline, SWE-Bench-Lite eval harness.

GitHub: github.com/theihtisham/agent-shadow-brain
npm: @theihtisham/agent-shadow-brain
30-second demo: $ npm i -g @theihtisham/agent-shadow-brain && shadow-brain demo

Honest about the limits in the README. Honest about the v7 roadmap. Honest that I'd love your feedback.

— theihtisham
```

#### Reddit /r/LocalLLaMA + /r/MachineLearning + /r/programming
Drop the same thread, customized last paragraph per sub.

#### LinkedIn (longer-form post):
- Lead with "Why I built this" (1 paragraph)
- The 5 features
- Link

#### Bluesky + Mastodon (same as Twitter, formatted)

### Phase 2 — Day 1-3 amplification

- [ ] **Respond to every HN comment within 30 minutes** for the first 6 hours
- [ ] **Live-tweet the metrics** ("Hour 4: 500 stars · 12 PRs · 3 issues fixed")
- [ ] **DM the 50 most-relevant influencers personally** (no spam, only if their bio screams "AI coding tools" — and only AFTER they've posted publicly today)
- [ ] **Reply to every Twitter mention** for 48 hours
- [ ] **Open 5 RFC issues** for community design input — makes it look like a project, not a launch
- [ ] **Submit to Product Hunt** on day 2 (separate hit, different audience)
- [ ] **Submit to Indie Hackers** end of day 2

### Phase 3 — Week 1-2 follow-through

- [ ] **Blog post** on Substack/dev.to: "How I built Shadow Brain" — technical deep-dive
- [ ] **Podcast outreach** — DM 5 podcasts (Latent Space, ThePrimeagen, Lex if you're bold, etc.)
- [ ] **YouTube long-form** — 20-minute "build a brain pack for X" walkthrough
- [ ] **Twitter Spaces / X Space** — host a "build your brain" hour
- [ ] **GitHub Discussions** — pin 3 community challenges
- [ ] **Brain Exchange seed launch** — week 2: 5 starter packs go live

---

## What to NOT do

These are the most common launch mistakes. Don't.

- ❌ **Don't lead with a wall of text.** Lead with the SVG/PNG. Image-first, always.
- ❌ **Don't oversell.** "Disrupts AI coding forever" reads as cringe. "5 things no one else has" reads as confident.
- ❌ **Don't @ random influencers in your launch tweet.** Looks needy. They'll find it if it's good.
- ❌ **Don't argue with cynics in the replies.** Pin the demo GIF instead. Let the artifact do the talking.
- ❌ **Don't gate features behind sign-up.** Anything that asks for an email before showing value gets memed.
- ❌ **Don't claim numbers you didn't measure.** "+33% resolution on 10 SWE-Bench-Lite problems" is fine. "5× faster than Cursor" without a benchmark is not.
- ❌ **Don't ship the launch tweet during US lunch / European evening / Asian sleep.** 09:00 PT Tuesday. Otherwise wait.

---

## The Metrics That Matter

Track these. Post them publicly when they hit milestones.

| Metric | Day 1 target | Week 1 target | Month 1 target |
|---|---|---|---|
| GitHub stars | 500 | 3,000 | 10,000 |
| npm weekly downloads | 200 | 2,000 | 10,000 |
| HN front page rank | top 30 | — | — |
| Twitter impressions | 100k | 500k | 2M |
| Reddit upvotes (combined) | 200 | 1,000 | 3,000 |
| Brain Exchange packs (community) | 0 | 3 | 10 |
| GitHub forks | 50 | 200 | 800 |
| Public users (npm install) | 200 | 2,000 | 10,000 |

If you don't hit Day 1 targets — don't panic, but **post a public retrospective**. Honesty about a flat launch wins later goodwill.

---

## The "Crazy" Quote-Tweets To Pre-Write

People retweet *because of a quote*. Pre-write 10 of these so you can drop them when momentum picks up.

1. *"AI coding tools today: every session, every agent, from zero. Shadow Brain: one brain, every agent, infinite memory. Local. Free. MIT."*
2. *"I think Cursor / Cline / Aider are great. None of them remember anything across sessions. Shadow Brain fixes that — for all of them simultaneously."*
3. *"The hot take: AI coding 'memory' is a solved problem. We just hadn't built it open-source yet."*
4. *"Your codebase has a personality. Mine is 'The Architect.' Generate yours."*
5. *"Hive Voice is what the AI safety community has been asking for, packaged in a way devs will actually use."*
6. *"Brain Time Capsule is git for intelligence. We git'd code in 2005. We're git'ing intelligence in 2026."*
7. *"Project-LoRA: every week, your codebase becomes a model. Try doing that with a SaaS coding tool. (You can't.)"*
8. *"The honest pitch: this is the AI memory infrastructure I wish existed when I started. So I built it. MIT."*
9. *"No telemetry. No cloud. No surveillance. Just one local brain your agents share."*
10. *"Devin proved the agent. Cursor proved the editor. Shadow Brain proves the memory."*

---

## After Launch — The Compounding Plays

Once the initial surge is over, what makes the project keep growing?

1. **Brain Exchange marketplace** — UGC content compounds organically
2. **VS Code extension** — discoverability bump from Marketplace
3. **GitHub Action** — every PR that merges advertises the brain
4. **Public leaderboard** — SWE-Bench numbers updated monthly
5. **Conference talks** — submit to ML conferences with the LoRA distillation paper
6. **Academic paper** — publish "Local-First Shared Memory for AI Coding Agents" on arXiv

---

## Final Honesty

This playbook maximizes chance, not certainty. Most launches don't pop. The ones that do, do because:

1. The *thing itself* is genuinely new (yes, here)
2. The *artifacts* are inherently shareable (yes, the 5 SVGs)
3. The *timing* lines up (Tuesday 09:00 PT, not during a major event)
4. The *narrative* is clear in 1 sentence ("every AI agent shares one local brain")
5. The *founder shows up* in the replies for 48 hours (this is on you)

If 1-4 are in place and you do 5 — the upside is real. If you skip 5, the upside is 80% smaller.

Go.

— playbook generated by the brain for the brain
