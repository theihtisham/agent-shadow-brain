# Shadow Brain v6.0 — Hive Mind 1-Minute Explainer

## Assets
- `hivemind-explainer.html` — standalone, fully-animated HTML composition (GSAP, 1280×720, 60 seconds, 6 scenes)
- `hivemind-captions.srt` — timed captions for all 6 scenes
- `VIRAL_VIDEO_SCRIPT.md` — the prior 45-second teaser (still valid for micro-cuts)

## How to generate the banner GIF + MP4

### Easiest path (browser recording)
1. Open `hivemind-explainer.html` in Chrome at 1280×720 window.
2. Click **⏺ Record WebM** (grants screen capture permission, records the tab).
3. Click **⏹ Stop** when "Free. Open. Yours." fades out.
4. Browser downloads `shadow-brain-v6-explainer.webm` (~4–6 MB).

### Convert WebM → MP4 + GIF (ffmpeg already installed on this system)
```bash
# MP4 for GitHub Releases + social
ffmpeg -i shadow-brain-v6-explainer.webm -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p shadow-brain-v6-explainer.mp4

# 6-second GIF for README banner (scene 2 = Hive Mind reveal)
ffmpeg -ss 10 -t 6 -i shadow-brain-v6-explainer.webm -vf "fps=20,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 banner.gif
```

## Scene storyboard (60 seconds)

| Time | Scene | Caption |
|---|---|---|
| 0:00–0:10 | The Problem — 4 agents fade to "memory: empty" | Every AI coding agent starts from zero. Every session. Every sub-agent. |
| 0:10–0:20 | Hive Mind — central brain + 4 orbiting agents | Shadow Brain v6.0 is the first open-source Hive Mind for AI agents. |
| 0:20–0:30 | SABB — parent → context sliver → sub-agent | Sub-Agent Brain Bridge syncs context to every framework's sub-agents. |
| 0:30–0:40 | Causal Chains — 4-node trace | Causal Memory Chains make every AI decision visible and auditable. |
| 0:40–0:50 | Collision + Dream — split panel | Collisions caught before they happen. The brain reflects while you sleep. |
| 0:50–1:00 | CTA — install command + badges | Free. Open. Local-first. npx @theihtisham/agent-shadow-brain attach-all. |

## Why this design

- 6 scenes × 10s — each feature gets air time
- Zero external assets — works fully offline; single HTML
- GSAP-based — smooth 60fps animations
- Browser-recorded — no Node/Puppeteer pipeline needed
- Accessible captions — SRT file included
