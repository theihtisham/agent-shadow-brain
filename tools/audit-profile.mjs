// tools/audit-profile.mjs — Read-only profile audit
// Lists every repo on the account, categorizes by origin/fork/archived/stars/
// activity, writes a markdown report to docs/launch/PROFILE_AUDIT.md.
// Also emits a JSON dataset for downstream scripts.

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_MD = path.join(ROOT, 'docs', 'launch', 'PROFILE_AUDIT.md');
const OUT_JSON = path.join(ROOT, 'docs', 'launch', 'profile-audit.json');

function gh(args) {
  const raw = execSync(`gh ${args}`, { encoding: 'utf-8', maxBuffer: 200 * 1024 * 1024 });
  return raw.trim();
}

console.log('→ Fetching all repos (paginated)...');
// Use gh api --paginate to get every repo in one pass
const reposRaw = gh(`api "user/repos?affiliation=owner&per_page=100&sort=pushed" --paginate --jq ".[] | {name,full_name,private,fork,archived,stargazers_count,forks_count,pushed_at,created_at,updated_at,size,description,language,topics:.topics,default_branch,homepage,has_issues,open_issues_count,parent:(.parent.full_name // null)}"`);

const lines = reposRaw.split('\n').filter(Boolean);
const repos = lines.map(l => JSON.parse(l));
console.log(`  got ${repos.length} repos`);

// Categorize
const now = Date.now();
const days = ms => (now - new Date(ms).getTime()) / (1000 * 60 * 60 * 24);

const pub = repos.filter(r => !r.private);
const priv = repos.filter(r => r.private);
const forks = repos.filter(r => r.fork);
const originals = repos.filter(r => !r.fork);
const archived = repos.filter(r => r.archived);

// Public originals ranked by stars (the "viral surface")
const publicOriginals = pub.filter(r => !r.fork).sort((a, b) => b.stargazers_count - a.stargazers_count);

// Public forks (appear on profile)
const publicForks = pub.filter(r => r.fork).sort((a, b) => b.stargazers_count - a.stargazers_count);

// Fork cleanup candidates — strict criteria to avoid accidental destruction
const strictForkCleanup = forks.filter(r =>
  !r.archived &&
  r.stargazers_count === 0 &&
  r.forks_count === 0 &&
  days(r.pushed_at) > 365 &&      // >1 year untouched
  r.size < 50000                   // <50MB (tiny = probably never modified)
);

// Ambiguous forks — need per-repo inspection before touching
const ambiguousForks = forks.filter(r =>
  !r.archived &&
  !strictForkCleanup.includes(r) &&
  (r.stargazers_count > 0 || r.size > 50000 || days(r.pushed_at) < 365)
);

// Archived + fork = definitely cleanup candidates
const archivedForks = forks.filter(r => r.archived);

// Open PR sampler — avoid pulling every PR (would be slow). Sample top 20 repos by stars.
console.log('→ Sampling open PRs on top 20 repos...');
const topRepos = publicOriginals.slice(0, 20).concat(publicForks.slice(0, 10));
const prs = [];
for (const r of topRepos) {
  try {
    const out = gh(`api "repos/${r.full_name}/pulls?state=open&per_page=30" --jq ".[] | {number,title,user:.user.login,created_at,draft}"`);
    if (out) {
      for (const line of out.split('\n').filter(Boolean)) {
        const p = JSON.parse(line);
        prs.push({ repo: r.full_name, ...p, age_days: Math.floor(days(p.created_at)) });
      }
    }
  } catch {
    // some repos may be archived or have issues disabled — skip
  }
}
const stalePRs = prs.filter(p => p.age_days > 90);

// Language breakdown
const byLang = {};
for (const r of repos) if (r.language) byLang[r.language] = (byLang[r.language] || 0) + 1;

// Write JSON dataset
fs.writeFileSync(OUT_JSON, JSON.stringify({
  totals: { all: repos.length, public: pub.length, private: priv.length, forks: forks.length, originals: originals.length, archived: archived.length },
  publicOriginals, publicForks, strictForkCleanup, ambiguousForks, archivedForks,
  prs, stalePRs, byLang,
  generatedAt: new Date().toISOString(),
}, null, 2));

// Write markdown report
function fmtSize(kb) {
  if (kb > 1024*1024) return (kb/1024/1024).toFixed(1) + ' GB';
  if (kb > 1024) return (kb/1024).toFixed(1) + ' MB';
  return kb + ' KB';
}
function fmtAge(iso) {
  const d = Math.floor(days(iso));
  if (d < 1) return 'today';
  if (d < 30) return d + 'd ago';
  if (d < 365) return Math.floor(d/30) + 'mo ago';
  return Math.floor(d/365) + 'y ago';
}
const linkRepo = r => `[${r.name}](https://github.com/${r.full_name})`;

const lines2 = [];
lines2.push('# Profile Audit — theihtisham');
lines2.push('');
lines2.push(`_Generated: ${new Date().toISOString()}_`);
lines2.push('');
lines2.push('## Executive summary');
lines2.push('');
lines2.push(`| Metric | Value |`);
lines2.push(`|---|---|`);
lines2.push(`| Total repos | **${repos.length}** |`);
lines2.push(`| Public | **${pub.length}** ← this is what profile visitors see |`);
lines2.push(`| Private | **${priv.length}** (zero virality impact) |`);
lines2.push(`| Forks | ${forks.length} (${((forks.length/repos.length)*100).toFixed(0)}%) |`);
lines2.push(`| Originals | ${originals.length} |`);
lines2.push(`| Archived | ${archived.length} |`);
lines2.push('');
lines2.push('## 🎯 The profile-visibility surface (what matters for virality)');
lines2.push('');
lines2.push('Profile visitors at https://github.com/theihtisham see only the **public** repos.');
lines2.push('**Your pin slots (6 max) are the single most important piece of profile real-estate.**');
lines2.push('');
lines2.push(`### Public originals ranked by stars (top candidates to pin, ${publicOriginals.length} total)`);
lines2.push('');
lines2.push(`| # | Repo | ⭐ | Forks | Last push | Size | Language |`);
lines2.push(`|---|---|---|---|---|---|---|`);
publicOriginals.slice(0, 30).forEach((r, i) => {
  lines2.push(`| ${i+1} | ${linkRepo(r)} | ${r.stargazers_count} | ${r.forks_count} | ${fmtAge(r.pushed_at)} | ${fmtSize(r.size)} | ${r.language || '—'} |`);
});
lines2.push('');
lines2.push(`### Public forks currently visible on profile (${publicForks.length})`);
lines2.push('');
if (publicForks.length === 0) {
  lines2.push('_None — your profile already only shows original repos. Great._');
} else {
  lines2.push(`| Repo | ⭐ | Upstream | Last push | Archived? |`);
  lines2.push(`|---|---|---|---|---|`);
  publicForks.forEach(r => {
    lines2.push(`| ${linkRepo(r)} | ${r.stargazers_count} | ${r.parent || '—'} | ${fmtAge(r.pushed_at)} | ${r.archived ? 'yes' : 'no'} |`);
  });
}
lines2.push('');
lines2.push('## 🧹 Private fork cleanup analysis');
lines2.push('');
lines2.push(`Private forks are invisible to profile visitors — cleanup helps only disk usage + your own dashboard clutter.`);
lines2.push('');
lines2.push(`### Strict cleanup candidates (${strictForkCleanup.length} repos)`);
lines2.push('');
lines2.push('Criteria: fork · not archived · zero stars · zero forks of it · >1y untouched · <50MB.');
lines2.push('**These are safest to archive — almost certainly never modified beyond the initial fork.**');
lines2.push('');
lines2.push(`Full list in \`profile-audit.json\`. Sample first 20:`);
lines2.push('');
lines2.push(`| Repo | Upstream | Last push | Size |`);
lines2.push(`|---|---|---|---|`);
strictForkCleanup.slice(0, 20).forEach(r => {
  lines2.push(`| \`${r.full_name}\` | ${r.parent || '—'} | ${fmtAge(r.pushed_at)} | ${fmtSize(r.size)} |`);
});
lines2.push('');
lines2.push(`### Ambiguous forks — DO NOT auto-delete (${ambiguousForks.length} repos)`);
lines2.push('');
lines2.push('Criteria: fork with either stars / recent push / non-trivial size. **Need per-repo review** because they may contain your work.');
lines2.push('');
lines2.push(`| Repo | ⭐ | Last push | Size |`);
lines2.push(`|---|---|---|---|`);
ambiguousForks.slice(0, 20).forEach(r => {
  lines2.push(`| \`${r.full_name}\` | ${r.stargazers_count} | ${fmtAge(r.pushed_at)} | ${fmtSize(r.size)} |`);
});
if (ambiguousForks.length > 20) lines2.push(`| … | … | … | … |`);
lines2.push('');
lines2.push(`### Already archived forks (${archivedForks.length})`);
lines2.push('');
lines2.push('These are already archived — safe to delete anytime without anti-abuse risk.');
lines2.push('');
lines2.push('## 📬 Open PR sampler (top 30 repos only)');
lines2.push('');
lines2.push(`Total open PRs: **${prs.length}** · Stale (>90d): **${stalePRs.length}**`);
lines2.push('');
if (stalePRs.length) {
  lines2.push(`| Repo | # | Title | Author | Age | Draft? |`);
  lines2.push(`|---|---|---|---|---|---|`);
  stalePRs.slice(0, 20).forEach(p => {
    lines2.push(`| ${p.repo} | #${p.number} | ${p.title.slice(0, 50)} | ${p.user} | ${p.age_days}d | ${p.draft ? 'yes' : 'no'} |`);
  });
}
lines2.push('');
lines2.push('## 🚀 Phase 2 profile optimization — recommended actions');
lines2.push('');
lines2.push('Based on this audit, here\'s what actually moves the needle:');
lines2.push('');
lines2.push('### Pin these 6 repos to your profile (browser: click "Customize your pins")');
lines2.push('');
const pinSuggestions = publicOriginals.slice(0, 6);
pinSuggestions.forEach((r, i) => {
  lines2.push(`${i+1}. **${r.name}** — ${r.stargazers_count}⭐ · ${r.language || 'multi'} · ${r.description || 'no description'}`);
});
lines2.push('');
lines2.push('### Fix these repos\' "About" section (topics + homepage missing)');
lines2.push('');
const needsAbout = publicOriginals.filter(r => !r.description || !r.homepage || !r.topics || r.topics.length === 0);
lines2.push(`${needsAbout.length} public originals are missing a description, homepage, or topics. First 10:`);
lines2.push('');
needsAbout.slice(0, 10).forEach(r => {
  const missing = [];
  if (!r.description) missing.push('description');
  if (!r.homepage) missing.push('homepage');
  if (!r.topics || r.topics.length === 0) missing.push('topics');
  lines2.push(`- ${linkRepo(r)} → missing: ${missing.join(', ')}`);
});
lines2.push('');
lines2.push('## 🗣️ Languages across portfolio');
lines2.push('');
lines2.push(`| Language | Repos |`);
lines2.push(`|---|---|`);
Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([l, c]) => {
  lines2.push(`| ${l} | ${c} |`);
});
lines2.push('');
lines2.push('---');
lines2.push('');
lines2.push('Full raw dataset: `docs/launch/profile-audit.json`');

fs.writeFileSync(OUT_MD, lines2.join('\n'));

console.log('✓ Audit written:');
console.log('  ' + OUT_MD);
console.log('  ' + OUT_JSON);
console.log('');
console.log(`Totals: ${pub.length} public (${publicOriginals.length} originals, ${publicForks.length} forks)`);
console.log(`        ${priv.length} private (${strictForkCleanup.length} strict-cleanup candidates, ${ambiguousForks.length} ambiguous)`);
console.log(`Stale PRs: ${stalePRs.length}`);
