# 🚀 Launch Checklist — Shadow Brain v6.0

One-page runbook for going live. Follow in order.

---

## Pre-launch (do before posting anywhere)

- [ ] **Publish to npm**
  ```bash
  cd agent-shadow-brain
  npm publish --access public
  ```
- [ ] **Create GitHub Release**
  - https://github.com/theihtisham/agent-shadow-brain/releases/new
  - Tag: `v6.0.0`
  - Title: `🧠 v6.0 Hive Mind — 22 novel features for every AI coding agent`
  - Description: paste the v6.0 commit body
  - **Upload the video as a release asset:** `docs/launch/shadow-brain-motion-explainer-narrated.mp4`
  - Mark as "Latest release" + "Set as the most recent pre-release" (optional)
- [ ] **Add GitHub Topics** on repo settings → Topics:
  `ai, llm, claude-code, cursor, cline, codex, copilot, hive-mind, sub-agent, sabb, causal-chains, dream-engine, reputation-ledger, local-first, ollama, open-source, typescript`
- [ ] **Pin the repo** on your GitHub profile
- [ ] **Test install on a fresh machine / fresh shell** to confirm `npx @theihtisham/agent-shadow-brain attach-all` actually works end-to-end

---

## Launch day order (2-hour window)

### Hour 0 — Hacker News (Tuesday 8 AM PST recommended)
- [ ] Post to HN with title from `docs/launch/HACKER_NEWS_POST.md`
- [ ] Immediately add the first comment (the Show HN convention — explains the project)
- [ ] Open notifications, refresh every 5 min
- [ ] **Reply to every comment within 15 minutes** — algorithm weighs response velocity

### Hour 0:30 — Twitter/X
- [ ] Post the thread from `docs/launch/TWITTER_THREAD.md`
- [ ] Attach the video natively to tweet 1 (don't link)
- [ ] Quote-tweet with "launched this on HN too" linking the HN post
- [ ] Reply to the first 5 replies within 10 minutes

### Hour 1 — r/LocalLLaMA
- [ ] Post from `docs/launch/REDDIT_LOCALLAMA.md`
- [ ] Use `[P]` or `[Project]` flair
- [ ] Reply to every top-level comment

### Hour 1:30 — LinkedIn
- [ ] Post the body from `docs/launch/LINKEDIN_POST.md`
- [ ] **Put all links in the first comment** (LinkedIn demotes posts with external links in body)
- [ ] Tag 2–3 people who would genuinely care (no spam)

### Hour 2 — r/programming
- [ ] Post from `docs/launch/REDDIT_PROGRAMMING.md`
- [ ] Be ready for harder pushback than r/LocalLLaMA — the pre-written responses at the bottom of that file cover the common ones

### Hour 4+ — Dev.to
- [ ] Publish long-form article from `docs/launch/DEVTO_ARTICLE.md`
- [ ] Cross-link back to HN + repo
- [ ] Dev.to posts get discovered for days/weeks — no rush

---

## Day 2 — Product Hunt (launch at 12:01 AM PST on a Tuesday or Wednesday)

- [ ] Use everything in `docs/launch/PRODUCT_HUNT_POST.md`
- [ ] Video in the gallery is your #1 conversion asset
- [ ] Post your launch to Twitter + LinkedIn + Discord → "we're live on PH, love your feedback"
- [ ] Stay online 6–8 hours for comment replies

---

## Week 1 — follow-up content

- [ ] Blog post on your own site (repurpose `DEVTO_ARTICLE.md`)
- [ ] YouTube upload of the 2-minute video with detailed description + chapters
- [ ] Post to 2–3 niche Discord servers you're in (#dev-tools, #ai, #open-source)
- [ ] Tweet screenshots individually with #BuildInPublic stories
- [ ] Respond to any GitHub issues within 24 hours — good issue-response velocity attracts contributors

---

## Metrics to track (week 1)

- GitHub stars (target: 500+ in week 1 for a successful dev-tool launch)
- npm weekly downloads (target: 1K+ in week 1)
- HN ranking (target: front page for 2+ hours)
- Twitter impressions (target: 100K+)
- PH Product of the Day (stretch)

---

## If the launch stalls

- Don't panic. Posts take time to compound.
- Reply to any existing comments faster — engagement extends shelf life.
- Cross-post to niche subs: `r/ClaudeAI`, `r/cursor`, `r/singularity`, `r/ChatGPTCoding`.
- Submit to weekly newsletters: Bytes, JavaScript Weekly, TLDR, Hacker Newsletter.
- Ship a v6.1 with one small improvement → second wave of attention.

---

## Posts ready to copy-paste (all in `docs/launch/`)

| File | Platform |
|---|---|
| `HACKER_NEWS_POST.md` | Hacker News (Show HN) |
| `TWITTER_THREAD.md` | Twitter/X thread |
| `REDDIT_LOCALLAMA.md` | r/LocalLLaMA |
| `REDDIT_PROGRAMMING.md` | r/programming |
| `LINKEDIN_POST.md` | LinkedIn |
| `DEVTO_ARTICLE.md` | Dev.to long-form |
| `PRODUCT_HUNT_POST.md` | Product Hunt |

Every file has: the exact title/body, alt hooks for A/B testing, platform-specific timing tips, and a pre-written first comment where convention requires it.

**Good luck. Ship it.**
