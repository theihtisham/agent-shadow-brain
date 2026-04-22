#!/usr/bin/env node
// Daily stats monitor — fetches stars/forks/issues/npm downloads, appends to history.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REPO = process.env.REPO || 'theihtisham/agent-shadow-brain';
const NPM_PKG = '@theihtisham/agent-shadow-brain';
const HISTORY_PATH = 'docs/stats-history.json';
const STATS_MD = 'docs/STATS.md';

function gh(cmd) {
  try { return JSON.parse(execSync(`gh ${cmd}`, { encoding: 'utf-8' })); }
  catch (e) { console.error(`gh failed: ${cmd}`, e.message); return null; }
}

async function npmDownloads(pkg, period) {
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/point/${period}/${pkg}`);
    if (!r.ok) return 0;
    return (await r.json()).downloads ?? 0;
  } catch { return 0; }
}

async function npmTotal(pkg) {
  // Sum monthly downloads back to package creation as a "total" estimate.
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/range/2026-01-01:${new Date().toISOString().slice(0,10)}/${pkg}`);
    if (!r.ok) return 0;
    const data = await r.json();
    return (data.downloads ?? []).reduce((a, d) => a + (d.downloads ?? 0), 0);
  } catch { return 0; }
}

const meta = gh(`api repos/${REPO} --jq '{stars: .stargazers_count, forks: .forks_count, watchers: .subscribers_count, issues: .open_issues_count, size: .size, pushed: .pushed_at}'`) || {};
const issues = gh(`api repos/${REPO}/issues?state=all&per_page=1 --jq '.[0].number // 0'`) || 0;
const releases = gh(`api repos/${REPO}/releases --jq 'length'`) || 0;

const dlDay = await npmDownloads(NPM_PKG, 'last-day');
const dlWeek = await npmDownloads(NPM_PKG, 'last-week');
const dlMonth = await npmDownloads(NPM_PKG, 'last-month');
const dlTotal = await npmTotal(NPM_PKG);

const today = {
  date: new Date().toISOString().slice(0, 10),
  timestamp: Date.now(),
  stars: meta.stars ?? 0,
  forks: meta.forks ?? 0,
  watchers: meta.watchers ?? 0,
  open_issues: meta.issues ?? 0,
  total_issues: issues,
  releases,
  size_kb: meta.size ?? 0,
  npm: {
    last_day: dlDay,
    last_week: dlWeek,
    last_month: dlMonth,
    total: dlTotal,
  },
};

let history = [];
if (existsSync(HISTORY_PATH)) {
  try { history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')); } catch {}
}
const last = history[history.length - 1];
if (!last || last.date !== today.date) history.push(today);
else history[history.length - 1] = today;

mkdirSync(dirname(HISTORY_PATH), { recursive: true });
writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

const prev7 = history[Math.max(0, history.length - 8)] ?? today;
const starsDelta = today.stars - (prev7.stars ?? 0);
const dlDelta = (today.npm.last_week) - (prev7.npm?.last_week ?? 0);

const md = `# Agent Shadow Brain — Live Stats

_Auto-updated daily by the Viral Amplifier Bot. Last refresh: ${today.date}._

| Metric | Value | 7d Δ |
|---|---:|---:|
| ⭐ GitHub Stars | **${today.stars}** | ${starsDelta >= 0 ? '+' : ''}${starsDelta} |
| 🍴 Forks | ${today.forks} | — |
| 👀 Watchers | ${today.watchers} | — |
| 📬 Issues (open) | ${today.open_issues} | — |
| 🔖 Releases | ${today.releases} | — |
| 📦 npm — last 24h | ${today.npm.last_day.toLocaleString()} | — |
| 📦 npm — last 7d | ${today.npm.last_week.toLocaleString()} | ${dlDelta >= 0 ? '+' : ''}${dlDelta} |
| 📦 npm — last 30d | ${today.npm.last_month.toLocaleString()} | — |
| 📦 npm — total | ${today.npm.total.toLocaleString()} | — |

[![Star History Chart](https://api.star-history.com/svg?repos=${REPO}&type=Date)](https://star-history.com/#${REPO}&Date)

History: [\`stats-history.json\`](./stats-history.json) — full timeseries.
`;

writeFileSync(STATS_MD, md);
console.log(`Stats refreshed: ${today.stars} stars, ${today.npm.last_week} dl/week`);
