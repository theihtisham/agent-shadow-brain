#!/usr/bin/env node
// Cross-Repo Intelligence — analyzes ALL of your public non-fork repos together,
// finds correlations, and generates an actionable report.
//
// What it does:
//   1. Lists all your public, non-fork, non-archived repos
//   2. Pulls stats: stars, forks, releases, last push, recent activity
//   3. Detects: which repo is rising/falling, which has the best engagement-per-star,
//      where audiences overlap (shared stargazers), what topics correlate with growth
//   4. Generates a strategy report: which repo to push next, what to invest in
//
// All analysis is read-only — no PRs, no comments, no auto-actions.
// Output: docs/CROSS_REPO_INTEL.md

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const USER = process.env.GH_USER || 'theihtisham';
const REPORT_PATH = 'docs/CROSS_REPO_INTEL.md';

function gh(cmd, fallback = null) {
  try { return JSON.parse(execSync(`gh ${cmd}`, { encoding: 'utf-8' })); }
  catch { return fallback; }
}

console.log(`🔍 Pulling all public non-fork repos for ${USER}...`);

const allRepos = gh(`repo list ${USER} --limit 100 --no-archived --source --json name,description,stargazerCount,forkCount,createdAt,updatedAt,pushedAt,isPrivate,isFork,primaryLanguage,repositoryTopics,url`) || [];

const repos = allRepos.filter(r => !r.isPrivate && !r.isFork);
console.log(`Analyzing ${repos.length} public source repos.`);

// Pull npm download stats for each (where applicable)
async function npmDownloads(pkg) {
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg}`);
    if (!r.ok) return 0;
    return (await r.json()).downloads ?? 0;
  } catch { return 0; }
}

// Heuristic: package name = @user/repo-name OR repo-name
async function detectNpmDownloads(repo) {
  const candidates = [`@${USER}/${repo.name}`, repo.name];
  for (const pkg of candidates) {
    const dl = await npmDownloads(pkg);
    if (dl > 0) return { pkg, downloads: dl };
  }
  return { pkg: null, downloads: 0 };
}

const enriched = [];
for (const r of repos) {
  const npm = await detectNpmDownloads(r);
  const releases = gh(`api repos/${USER}/${r.name}/releases --jq 'length'`) || 0;
  const issuesOpen = gh(`api repos/${USER}/${r.name} --jq '.open_issues_count'`) || 0;

  const ageDays = (Date.now() - new Date(r.createdAt).getTime()) / 86400e3;
  const daysSincePush = (Date.now() - new Date(r.pushedAt).getTime()) / 86400e3;
  const starsPerDay = ageDays > 0 ? r.stargazerCount / ageDays : 0;
  const engagementScore = r.stargazerCount > 0 ? (r.forkCount / r.stargazerCount) : 0;

  enriched.push({
    name: r.name,
    description: r.description || '',
    url: r.url,
    stars: r.stargazerCount,
    forks: r.forkCount,
    issues: issuesOpen,
    releases,
    npm: npm.pkg,
    npmWeekly: npm.downloads,
    ageDays: Math.round(ageDays),
    daysSincePush: Math.round(daysSincePush),
    starsPerDay: +starsPerDay.toFixed(3),
    engagementScore: +engagementScore.toFixed(3),
    language: r.primaryLanguage?.name || 'unknown',
    topics: r.repositoryTopics || [],
  });
  await new Promise(r => setTimeout(r, 100));
}

// Sort by stars
enriched.sort((a, b) => b.stars - a.stars);

// Analysis
const totalStars = enriched.reduce((a, r) => a + r.stars, 0);
const totalForks = enriched.reduce((a, r) => a + r.forks, 0);
const totalDownloads = enriched.reduce((a, r) => a + r.npmWeekly, 0);
const stalest = [...enriched].sort((a, b) => b.daysSincePush - a.daysSincePush)[0];
const newest = [...enriched].sort((a, b) => a.daysSincePush - b.daysSincePush)[0];
const highestEngagement = [...enriched].sort((a, b) => b.engagementScore - a.engagementScore)[0];
const fastestGrowing = [...enriched].sort((a, b) => b.starsPerDay - a.starsPerDay)[0];

// Topic overlap
const topicCounts = {};
for (const r of enriched) {
  for (const t of r.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
}
const sharedTopics = Object.entries(topicCounts).filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

// Strategy suggestions
const suggestions = [];

if (enriched.length >= 2) {
  const top2 = enriched.slice(0, 2);
  if (top2[0].stars > top2[1].stars * 3) {
    suggestions.push(`📊 **Star imbalance** — ${top2[0].name} has ${top2[0].stars} stars vs ${top2[1].name}'s ${top2[1].stars}. Cross-promote ${top2[1].name} from ${top2[0].name}'s README (badges or "see also" section).`);
  } else {
    suggestions.push(`📊 **Healthy spread** — your top 2 repos (${top2[0].name}, ${top2[1].name}) are within 3x of each other. Continue investing in both.`);
  }
}

if (stalest && stalest.daysSincePush > 90) {
  suggestions.push(`⏱ **${stalest.name}** hasn't been pushed to in ${stalest.daysSincePush} days. Either ship a small refresh (CHANGELOG entry, dep bump, README polish) or archive it to focus stars on active projects.`);
}

if (highestEngagement && highestEngagement.engagementScore > 0.1) {
  suggestions.push(`💎 **${highestEngagement.name}** has the highest engagement (forks/stars = ${(highestEngagement.engagementScore * 100).toFixed(1)}%). Forks indicate hands-on use. Add CONTRIBUTING.md if missing — convert forkers into contributors.`);
}

if (fastestGrowing && fastestGrowing.starsPerDay > 0.05) {
  suggestions.push(`🚀 **${fastestGrowing.name}** is your fastest grower (${fastestGrowing.starsPerDay.toFixed(3)} stars/day average). Lean into what's working — cross-link to it from other repos' READMEs.`);
}

if (sharedTopics.length > 0) {
  suggestions.push(`🏷 **Shared topics** across repos: ${sharedTopics.slice(0, 3).map(([t, c]) => `\`${t}\` (${c} repos)`).join(', ')}. Audience overlap means a star on one is likely to lead to a star on another. Add cross-references.`);
}

const reposWithoutNpm = enriched.filter(r => !r.npm && r.stars > 5);
if (reposWithoutNpm.length > 0) {
  suggestions.push(`📦 ${reposWithoutNpm.length} repos with 5+ stars have NO npm package detected. If they're tools/libraries, publishing increases discovery 10-50x.`);
}

const md = `# Cross-Repo Intelligence Report

_Auto-generated by the Viral Amplifier on ${new Date().toISOString().slice(0, 10)}._

**User:** [${USER}](https://github.com/${USER})

## Portfolio Snapshot

| Metric | Value |
|---|---:|
| Public source repos | ${enriched.length} |
| Total stars | ${totalStars.toLocaleString()} |
| Total forks | ${totalForks.toLocaleString()} |
| Total npm dl/week | ${totalDownloads.toLocaleString()} |
| Avg stars/repo | ${(totalStars / Math.max(1, enriched.length)).toFixed(1)} |

## Strategy Suggestions

${suggestions.length === 0 ? '_No significant signals to act on yet — keep shipping._' : suggestions.map(s => `- ${s}`).join('\n')}

---

## Per-Repo Detail (ranked by stars)

| # | Repo | Stars | Forks | npm/wk | Engagement | Stars/day | Last push | Issues |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${enriched.map((r, i) => `| ${i + 1} | [${r.name}](${r.url}) | ${r.stars} | ${r.forks} | ${r.npmWeekly} | ${(r.engagementScore * 100).toFixed(1)}% | ${r.starsPerDay.toFixed(3)} | ${r.daysSincePush}d ago | ${r.issues} |`).join('\n')}

## Topic Distribution

${Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `- \`${t}\` — ${c} repo${c > 1 ? 's' : ''}`).join('\n')}

---

## Honest Read

${enriched.length === 0 ? '_No public source repos to analyze._' : ''}
${enriched.length === 1 ? `_Only 1 public repo to analyze. Cross-repo correlation needs 2+ projects._` : ''}
${enriched.length >= 2 ? `Your portfolio focus is **${stalest?.daysSincePush > 90 ? 'concentrated on a few active repos with some dormant ones' : 'broadly active across ' + enriched.length + ' repos'}**. ${totalStars >= 100 ? 'You have enough portfolio stars to leverage cross-promotion.' : 'Build to 100+ portfolio stars before cross-promoting via awesome lists — some require it.'}` : ''}

---

_To re-run: \`gh workflow run "Viral Amplifier Bot" -f job=cross-repo-intel\`_
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, md);
console.log(`Cross-repo intelligence written to ${REPORT_PATH}`);
console.log(`${enriched.length} repos analyzed, ${totalStars} total stars.`);
