#!/usr/bin/env node
// Awesome-list PR target generator.
// Lists awesome-* repos that match this project's topic and don't already include it.
// Generates draft PR descriptions but does NOT auto-submit (user approval gate).

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REPO = process.env.REPO || 'theihtisham/agent-shadow-brain';
const PROJECT_NAME = REPO.split('/')[1];
const PROJECT_URL = `https://github.com/${REPO}`;
const REPORT_PATH = 'docs/awesome-list-targets.md';

// Hand-curated list of awesome repos relevant to AI coding tools.
// Includes both established lists AND new lists with high-reputation maintainers
// (a maintainer with 10k+ total stars across other repos signals quality even if the list is new).
const TARGETS = [
  // Claude / Claude Code (established)
  { repo: 'hesreallyhim/awesome-claude-code', section: 'MCP Servers', tier: 'established' },
  { repo: 'awesome-claude-code/awesome-claude-code', section: 'Tools & Plugins', tier: 'established' },
  { repo: 'CharlesCreativeContent/awesome-claude-skills', section: 'Skills & Plugins', tier: 'rising' },

  // MCP (established)
  { repo: 'punkpeye/awesome-mcp-servers', section: 'Productivity / Memory', tier: 'established' },
  { repo: 'wong2/awesome-mcp-servers', section: 'Memory & Context', tier: 'established' },
  { repo: 'appcypher/awesome-mcp-servers', section: 'Developer Tools', tier: 'established' },
  { repo: 'modelcontextprotocol/servers', section: 'Community Servers', tier: 'established' },

  // AI Coding (established)
  { repo: 'mahseema/awesome-ai-tools', section: 'Code Assistants', tier: 'established' },
  { repo: 'sourcegraph/awesome-code-ai', section: 'Memory / Context Layer', tier: 'established' },
  { repo: 'steven2358/awesome-generative-ai', section: 'Code Tools', tier: 'established' },

  // AI Agents (established)
  { repo: 'e2b-dev/awesome-ai-agents', section: 'Developer Tools', tier: 'established' },
  { repo: 'kaushikb11/awesome-llm-agents', section: 'Multi-agent Systems', tier: 'established' },
  { repo: 'slavakurilyak/awesome-ai-agents', section: 'Frameworks', tier: 'established' },

  // Cursor / Cline / Windsurf
  { repo: 'pkargupta/awesome-cursor', section: 'Extensions', tier: 'rising' },
  { repo: 'PatrickJS/awesome-cursorrules', section: 'Rule Sets / Tools', tier: 'established' },

  // General AI / DevTools (huge audience)
  { repo: 'sindresorhus/awesome', section: 'AI', tier: 'flagship' },
  { repo: 'jaywcjlove/awesome-mac', section: 'Developer Tools', tier: 'flagship' },
  { repo: 'awesome-selfhosted/awesome-selfhosted', section: 'AI Tools', tier: 'flagship' },
];

/**
 * Score a target by combining:
 *   - Stars on the awesome list itself
 *   - Maintainer's total stars across their other public repos (reputation signal)
 *   - Recency of last update (active = better)
 *
 * This catches NEW awesome lists by reputable maintainers (a 50-star list
 * by a 50k-star maintainer is often a better target than a 1k-star list
 * by a stale account).
 */
function scoreTarget(target) {
  const [owner, name] = target.repo.split('/');
  let listMeta = {};
  try { listMeta = JSON.parse(execSync(`gh api repos/${target.repo} --jq '{stars: .stargazers_count, pushed: .pushed_at, archived: .archived}'`, { encoding: 'utf-8' })); } catch {}
  if (listMeta.archived) return { ...target, score: -1, listStars: 0, ownerStars: 0, archived: true };

  let ownerMeta = {};
  try {
    const repos = JSON.parse(execSync(`gh api 'users/${owner}/repos?per_page=100&sort=updated' --jq '[.[] | {stars: .stargazers_count, fork: .fork, archived: .archived}]'`, { encoding: 'utf-8' }));
    const ownerStars = repos.filter(r => !r.fork && !r.archived).reduce((a, r) => a + r.stars, 0);
    ownerMeta = { ownerStars };
  } catch { ownerMeta = { ownerStars: 0 }; }

  const listStars = listMeta.stars ?? 0;
  const ownerStars = ownerMeta.ownerStars ?? 0;
  const pushedDays = listMeta.pushed ? (Date.now() - new Date(listMeta.pushed).getTime()) / 86400e3 : 9999;

  // Score formula:
  //   - List stars contribute log-scaled (diminishing returns)
  //   - Owner reputation contributes log-scaled
  //   - Recent activity (pushed in last 90 days) is a 1.5x multiplier
  //   - Stale (>1 year unpushed) is a 0.3x penalty
  let score = Math.log10(Math.max(1, listStars)) + Math.log10(Math.max(1, ownerStars)) * 0.7;
  if (pushedDays < 90) score *= 1.5;
  else if (pushedDays > 365) score *= 0.3;

  return { ...target, score: +score.toFixed(2), listStars, ownerStars, pushedDays: Math.round(pushedDays), archived: false };
}

console.log('Scoring awesome-list targets by list stars + maintainer reputation...');
const scored = TARGETS.map(scoreTarget).filter(t => !t.archived).sort((a, b) => b.score - a.score);

function entryMarkdown() {
  return `- [${PROJECT_NAME}](${PROJECT_URL}) — One singleton brain shared across Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, Aider. Subconscious context injection on session start. Cross-session, cross-project, cross-agent memory. Zero config: \`npx @theihtisham/agent-shadow-brain attach-all\`. MIT.`;
}

const prTitle = `Add ${PROJECT_NAME} — singleton brain shared across all AI coding agents`;
const prBody = `## Adding [${PROJECT_NAME}](${PROJECT_URL})

Hi! Submitting [Agent Shadow Brain](${PROJECT_URL}) for inclusion.

**What it is:** A singleton intelligence layer that gives every AI coding agent (Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, Aider) shared memory across sessions and projects. One \`~/.shadow-brain/global.json\` is the source of truth; each agent's adapter wires it in via the agent's native config.

**Why it fits this list:** Solves a real problem in the [insert relevant theme — AI coding / agent memory / MCP] space, MIT-licensed, zero new runtime deps, actively maintained.

**Suggested entry:**

\`\`\`markdown
${entryMarkdown()}
\`\`\`

**Project links:**
- Repository: ${PROJECT_URL}
- npm: https://www.npmjs.com/package/@theihtisham/agent-shadow-brain
- Documentation: ${PROJECT_URL}#readme
- Maintainer: [@theihtisham](https://github.com/theihtisham)

Happy to adjust the entry format / placement to match your list's conventions. Thanks for considering!
`;

// Anti-spam check: skip if a recent awesome-list PR was already filed this week
const LAST_PR_MARKER = '.github/.last-awesome-pr';
let lastPrTime = 0;
if (existsSync(LAST_PR_MARKER)) {
  try { lastPrTime = parseInt(readFileSync(LAST_PR_MARKER, 'utf-8'), 10); } catch {}
}
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
const tooSoon = (Date.now() - lastPrTime) < ONE_WEEK;

let stars = 0;
try {
  stars = JSON.parse(execSync(`gh api repos/${REPO} --jq '.stargazers_count'`, { encoding: 'utf-8' }));
} catch {}

const STAR_FLOOR = 100;
const skipReason = stars < STAR_FLOOR
  ? `Project has ${stars} stars; awesome-list maintainers typically reject submissions below ${STAR_FLOOR}. Build organic traction first.`
  : tooSoon
  ? `Last awesome-list PR was filed within the last 7 days. Cooling off to avoid looking like spam.`
  : null;

const md = `# Awesome-List PR Targets

_Auto-generated by the Viral Amplifier Bot. Last refresh: ${new Date().toISOString().slice(0, 10)}._

**Current ${PROJECT_NAME} stars: ${stars}**

${skipReason ? `## ⛔ Hold Off This Week\n\n${skipReason}\n\nThe Viral Amplifier is intentionally conservative — being patient now keeps your sender reputation clean and avoids looking like spam.` : '## ✅ You\'re Ready to Submit\n\nProject has enough traction and the cooldown has passed. Pick ONE target below and submit a single, well-crafted PR. Do not submit to multiple lists in the same day.'}

> ⚠️ Most awesome lists require a minimum star threshold (often 100-500) before accepting submissions. Don't submit until you have ≥100 stars unless the list explicitly accepts new projects.

---

## Suggested Entry (use as-is, or adapt per list)

\`\`\`markdown
${entryMarkdown()}
\`\`\`

## Reusable PR Title

\`\`\`
${prTitle}
\`\`\`

## Reusable PR Body Template

<details>
<summary>Click to expand PR body</summary>

\`\`\`markdown
${prBody}
\`\`\`

</details>

---

## Target Repos (ranked by combined score: list traction + maintainer reputation + activity)

> Score is logarithmic. A new list (50 stars) by a high-reputation maintainer (50k+ total stars) often outranks a bigger but stale list. Recent activity (pushed in last 90 days) gets a 1.5x boost; stale repos (>1 year) get penalized 0.7x.

${scored.slice(0, 20).map((t, i) => `### ${i + 1}. [${t.repo}](https://github.com/${t.repo})  —  Score: **${t.score}**

- **Tier:** ${t.tier}
- **List stars:** ${t.listStars.toLocaleString()}
- **Maintainer reputation:** ${t.ownerStars.toLocaleString()} total stars across their other repos
- **Last pushed:** ${t.pushedDays} days ago ${t.pushedDays > 365 ? '⚠️ STALE' : t.pushedDays < 90 ? '🟢 ACTIVE' : '🟡'}
- **Suggested section:** ${t.section}
- **Action:**
  1. Read [${t.repo}'s CONTRIBUTING.md](https://github.com/${t.repo}/blob/main/CONTRIBUTING.md) (or whatever rules they have)
  2. Fork → edit README.md → add entry under **${t.section}**
  3. Open a PR with the title and body templates above
`).join('\n---\n\n')}

---

## Submission Workflow

For each target, run:

\`\`\`bash
TARGET="punkpeye/awesome-mcp-servers"
gh repo fork "$TARGET" --clone --remote
cd "$(basename $TARGET)"
# Manually edit README.md to add the entry
git checkout -b add-${PROJECT_NAME}
git add README.md
git -c user.name="theihtisham" -c user.email="theihtisham@users.noreply.github.com" commit -m "Add ${PROJECT_NAME}"
git push -u origin "add-${PROJECT_NAME}"
gh pr create --title "${prTitle}" --body-file ../docs/awesome-list-pr-body.md
\`\`\`

## Anti-Patterns (don't do these)

- ❌ Submit before you have 100 stars
- ❌ Submit to >5 lists in one day (looks spammy)
- ❌ Open a PR without reading the list's CONTRIBUTING.md
- ❌ Use the same generic blurb for every list — adapt for the list's theme
- ❌ Bump your PR after 24h. Wait at least a week before any follow-up.
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, md);
writeFileSync('docs/awesome-list-pr-body.md', prBody);
console.log(`Awesome-list targets written: ${TARGETS.length} candidates.`);
