#!/usr/bin/env node
// Trending Detector — runs every 6 hours, looks at the stats history,
// detects momentum spikes (stars/day acceleration), and opens an issue
// suggesting time-sensitive actions.
//
// Why hourly-ish: viral spikes have a 24-48h window. Catching them within
// 6h means you can pile on while the iron is hot (cross-link, share, etc).
//
// Detection logic:
//   - Compare last-24h star delta vs trailing 7-day average
//   - Spike threshold: 5x baseline OR 50+ stars in 24h (whichever lower)
//   - Cooldown: only fires once per 24h to avoid duplicate issues

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const REPO = process.env.REPO || 'theihtisham/agent-shadow-brain';
const HISTORY_PATH = 'docs/stats-history.json';
const STATE_PATH = '.github/.trending-state.json';
const SPIKE_MULT = 5;       // 5x trailing-7d average
const SPIKE_FLOOR = 50;     // OR 50+ stars in 24h
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

let history = [];
if (existsSync(HISTORY_PATH)) {
  try { history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')); } catch {}
}

if (history.length < 2) {
  console.log('Not enough stats history for trend detection. Need at least 2 days of data.');
  process.exit(0);
}

const today = history[history.length - 1];
const yesterday = history[history.length - 2];
const week = history.slice(-8, -1); // up to 7 days before today

const todayStars = today.stars ?? 0;
const yesterdayStars = yesterday.stars ?? 0;
const dayDelta = todayStars - yesterdayStars;

const trailingAvgDelta = week.length > 0
  ? week.reduce((sum, d, i) => sum + (i > 0 ? (d.stars ?? 0) - (week[i - 1].stars ?? 0) : 0), 0) / Math.max(1, week.length - 1)
  : 0;

const downloadsToday = today.npm?.last_week ?? 0;
const downloadsYesterday = yesterday.npm?.last_week ?? 0;
const dlDelta = downloadsToday - downloadsYesterday;

console.log(`Today: ${todayStars} stars (Δ ${dayDelta}), 7d avg Δ ${trailingAvgDelta.toFixed(1)}`);

const isStarsSpike = (trailingAvgDelta > 0 && dayDelta >= trailingAvgDelta * SPIKE_MULT) || dayDelta >= SPIKE_FLOOR;
const isDownloadsSpike = downloadsYesterday > 0 && downloadsToday > downloadsYesterday * 2;

if (!isStarsSpike && !isDownloadsSpike) {
  console.log('No spike detected.');
  process.exit(0);
}

// Cooldown check
let state = { lastFiredAt: 0 };
if (existsSync(STATE_PATH)) {
  try { state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')); } catch {}
}
if (Date.now() - state.lastFiredAt < COOLDOWN_MS) {
  console.log(`Cooldown active. Last fired ${((Date.now() - state.lastFiredAt) / 3600e3).toFixed(1)}h ago.`);
  process.exit(0);
}

// We have a spike. Build the alert.
const reasons = [];
if (isStarsSpike) {
  reasons.push(`⭐ **Stars spike**: ${dayDelta} new stars in 24h (vs 7d avg of ${trailingAvgDelta.toFixed(1)}/day) — ${trailingAvgDelta > 0 ? `${(dayDelta / trailingAvgDelta).toFixed(1)}x baseline` : 'first detected growth'}`);
}
if (isDownloadsSpike) {
  reasons.push(`📦 **Downloads spike**: ${downloadsToday} weekly downloads (vs ${downloadsYesterday} yesterday) — ${(downloadsToday / Math.max(1, downloadsYesterday)).toFixed(1)}x growth`);
}

// Where might it be coming from?
let referrers = [];
try {
  // GitHub doesn't expose referrer data via REST API for non-owners.
  // The owner can check manually at /graphs/traffic
  referrers = ['(GitHub Insights traffic data is owner-only — check manually at https://github.com/' + REPO + '/graphs/traffic)'];
} catch {}

const body = `# 🚀 Momentum Spike Detected

**Repo:** ${REPO}
**When:** ${new Date().toISOString()}

## What's Happening

${reasons.map(r => `- ${r}`).join('\n')}

## Time-Sensitive Actions (next 24-48h)

Viral spikes have a short window. Act FAST while the iron is hot:

### Within 1 hour
- [ ] Check [GitHub Insights → Traffic](https://github.com/${REPO}/graphs/traffic) — find the referrer source
- [ ] If a specific blog/HN/Reddit thread is driving it → reply/comment there to keep momentum
- [ ] Pin a relevant tweet/post if you have one queued

### Within 24 hours
- [ ] Reply to ANY new issue/PR within 1 hour (engagement keeps you on trending lists)
- [ ] Share to relevant communities you're already part of (your call where)
- [ ] If npm package: confirm latest version is solid (no broken builds, no critical bugs)

### Within 48 hours
- [ ] Update README hero with social proof (current star count, recent stargazer logos via [contrib.rocks](https://contrib.rocks))
- [ ] Cross-link from your other repos (audience overlap)
- [ ] Open the [\`awesome-pr-prepare\`](../actions/workflows/viral-amplifier.yml) workflow — viral momentum + 100+ stars = good time to submit to awesome lists

## Don't Do

- ❌ Buy stars (illegal, GitHub bans for it)
- ❌ Spam-DM stargazers thanking them (looks weird)
- ❌ Mass-tag people in posts (filters as spam)
- ❌ Resurrect stale issues just to ping for engagement (transparent and annoying)

## Stats Snapshot

| Metric | Today | Yesterday | 7d Avg Δ |
|---|---:|---:|---:|
| ⭐ Stars | ${todayStars} | ${yesterdayStars} | ${trailingAvgDelta.toFixed(1)}/day |
| 📦 Weekly DL | ${downloadsToday.toLocaleString()} | ${downloadsYesterday.toLocaleString()} | — |

---

_Auto-generated by the Trending Detector. Cooldown of 24h applied — won't open another spike issue until ${new Date(Date.now() + COOLDOWN_MS).toISOString()}._
`;

const tmpFile = '/tmp/trending-body.md';
writeFileSync(tmpFile, body);

try {
  execSync(`gh issue create --title "🚀 Momentum spike detected — act fast" --body-file "${tmpFile}" --label "viral-amplifier,trending"`, { stdio: 'inherit' });
} catch (e) {
  console.error('Could not create issue:', e.message);
  process.exit(1);
}

state.lastFiredAt = Date.now();
state.dayDelta = dayDelta;
state.trailingAvg = trailingAvgDelta;
mkdirSync('.github', { recursive: true });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

console.log(`Spike issue created. Cooldown active until ${new Date(state.lastFiredAt + COOLDOWN_MS).toISOString()}`);
