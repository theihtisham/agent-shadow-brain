#!/usr/bin/env node
// Auto-PR Preparer.
//
// SAFE AUTOMATION:
//   - Reads docs/awesome-list-targets.md (output of awesome-list-targets.mjs)
//   - Picks the TOP-RANKED target NOT already including this project
//   - FORKS the awesome-list repo
//   - CLONES the fork to a temp dir
//   - EDITS the README to add this project's entry under the right section
//   - COMMITS the change with the user's identity
//   - PUSHES the branch to the user's fork
//   - PRINTS a 1-CLICK PR URL — does NOT auto-open the PR
//
// This is the ethical sweet spot: 95% of the work automated, the actual
// "open PR" gesture stays manual so you control your sender reputation.
//
// Hard guardrails:
//   - Star floor: 100 (won't prepare PRs below this)
//   - Cooldown: 7 days between any awesome-list PR prep
//   - Skip if inclusion-checker shows project already listed
//   - Skip if quality-scorecard < 80%

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.REPO || 'theihtisham/agent-shadow-brain';
const USER = REPO.split('/')[0];
const PROJECT_NAME = REPO.split('/')[1];
const PROJECT_URL = `https://github.com/${REPO}`;
const PKG_NAME = `@${USER}/${PROJECT_NAME}`;
const COOLDOWN_MARKER = '.github/.last-awesome-pr';
const STAR_FLOOR = 100;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function gh(cmd, fallback = null) {
  try { return JSON.parse(execSync(`gh ${cmd}`, { encoding: 'utf-8' })); }
  catch { return fallback; }
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

// ── Pre-flight checks ───────────────────────────────────────────────────

const stars = gh(`api repos/${REPO} --jq '.stargazers_count'`) || 0;
if (stars < STAR_FLOOR) {
  console.log(`⛔ ${PROJECT_NAME} has ${stars} stars — below the ${STAR_FLOOR}-star floor for awesome-list submissions. Build organic traction first.`);
  process.exit(0);
}

if (existsSync(COOLDOWN_MARKER)) {
  const lastPr = parseInt(readFileSync(COOLDOWN_MARKER, 'utf-8'), 10) || 0;
  const remainingHours = ((lastPr + COOLDOWN_MS) - Date.now()) / 3600e3;
  if (remainingHours > 0) {
    console.log(`⛔ Awesome-list PR cooldown active. ${remainingHours.toFixed(1)}h remaining. Bot will not prepare a new PR until ${new Date(lastPr + COOLDOWN_MS).toISOString()}.`);
    process.exit(0);
  }
}

// ── Pick the next target from the ranked list ───────────────────────────

if (!existsSync('docs/awesome-list-targets.md')) {
  console.log('⛔ docs/awesome-list-targets.md not found. Run awesome-list-targets.mjs first.');
  process.exit(1);
}

const targetsMd = readFileSync('docs/awesome-list-targets.md', 'utf-8');
const targets = [];
const re = /\[([^\]]+)\]\(https:\/\/github\.com\/([^/]+\/[^)]+)\)\s+—\s+Score:\s+\*\*([\d.]+)\*\*/g;
let m;
while ((m = re.exec(targetsMd)) !== null) {
  targets.push({ display: m[1], repo: m[2], score: parseFloat(m[3]) });
}

if (targets.length === 0) {
  console.log('⛔ No targets parsed from docs/awesome-list-targets.md.');
  process.exit(1);
}

// Skip targets already including this project
let alreadyIncluded = new Set();
if (existsSync('docs/INCLUSION_REPORT.md')) {
  const incl = readFileSync('docs/INCLUSION_REPORT.md', 'utf-8');
  const inclRe = /\[([^/\]]+\/[^/\]]+)\]/g;
  let im;
  while ((im = inclRe.exec(incl)) !== null) alreadyIncluded.add(im[1]);
}

const candidate = targets.find(t => !alreadyIncluded.has(t.repo));
if (!candidate) {
  console.log('⛔ All ranked targets already include the project (per inclusion report). Refresh inclusion-checker or expand target list.');
  process.exit(0);
}

console.log(`🎯 Selected target: ${candidate.repo} (score ${candidate.score})`);

// ── Verify quality scorecard ────────────────────────────────────────────

if (existsSync('docs/QUALITY_SCORECARD.md')) {
  const scorecard = readFileSync('docs/QUALITY_SCORECARD.md', 'utf-8');
  const pctMatch = scorecard.match(/(\d+)%/);
  if (pctMatch && parseInt(pctMatch[1], 10) < 80) {
    console.log(`⛔ Quality scorecard is ${pctMatch[1]}% (below 80%). Fix failures before submitting awesome-list PRs.`);
    process.exit(1);
  }
}

// ── Fork target ──────────────────────────────────────────────────────────

console.log(`🔱 Forking ${candidate.repo}...`);
try {
  sh(`gh repo fork ${candidate.repo} --clone=false --remote=false`, { silent: true });
} catch (e) {
  // Fork may already exist — that's fine
  console.log(`(Fork may already exist — continuing)`);
}

// Clone the fork
const tmp = mkdtempSync(join(tmpdir(), 'awesome-pr-'));
console.log(`📥 Cloning fork into ${tmp}...`);

try {
  sh(`git clone https://github.com/${USER}/${candidate.repo.split('/')[1]}.git "${tmp}"`, { silent: true });
} catch (e) {
  console.error(`❌ Clone failed:`, e.message);
  process.exit(1);
}

// ── Edit README ──────────────────────────────────────────────────────────

const readmePath = join(tmp, 'README.md');
if (!existsSync(readmePath)) {
  console.error(`❌ Target repo has no README.md at root.`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

let readme = readFileSync(readmePath, 'utf-8');

// Build the entry — try to match existing style
const existingEntry = readme.match(/^- \[([^\]]+)\]\(([^)]+)\)\s+—\s+(.+)$/m);
let entry;
if (existingEntry) {
  // Match observed style
  entry = `- [${PROJECT_NAME}](${PROJECT_URL}) — Singleton intelligence layer giving every AI coding agent (Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Aider) shared memory across sessions and projects. Auto-attaches in 30 seconds via \`npx ${PKG_NAME} attach-all\`. MIT.`;
} else {
  entry = `- [${PROJECT_NAME}](${PROJECT_URL}) - Singleton intelligence layer for cross-agent AI coding tool memory. Zero-config, MIT.`;
}

// Find a sensible insertion point — look for an "AI", "MCP", "Code", or "Tools" section
const sectionPatterns = [/^## .*MCP.*$/im, /^## .*AI Coding.*$/im, /^## .*Coding.*Tool.*$/im, /^## .*AI.*Tool.*$/im, /^## .*Developer.*Tool.*$/im, /^### .*MCP.*$/im, /^### .*AI.*$/im];
let insertPos = -1;
let sectionFound = '';
for (const pat of sectionPatterns) {
  const sm = readme.match(pat);
  if (sm) {
    sectionFound = sm[0];
    // Insert after the section heading + one line
    insertPos = readme.indexOf(sm[0]) + sm[0].length;
    // Skip past any blank line + intro paragraph to find first list item
    const restOfDoc = readme.slice(insertPos);
    const firstList = restOfDoc.search(/^- /m);
    if (firstList !== -1) insertPos += firstList;
    break;
  }
}

if (insertPos === -1) {
  console.warn(`⚠️ Could not auto-find a section to insert into. Will insert near top.`);
  insertPos = readme.indexOf('\n## ');
  if (insertPos === -1) insertPos = readme.length;
}

readme = readme.slice(0, insertPos) + entry + '\n' + readme.slice(insertPos);
writeFileSync(readmePath, readme);

console.log(`✏️  Edited README, inserted entry under section: ${sectionFound || '(near top)'}`);

// ── Commit + push ────────────────────────────────────────────────────────

const branchName = `add-${PROJECT_NAME}`;

try {
  sh(`git -C "${tmp}" config user.name "theihtisham"`);
  sh(`git -C "${tmp}" config user.email "theihtisham@users.noreply.github.com"`);
  sh(`git -C "${tmp}" checkout -b "${branchName}"`);
  sh(`git -C "${tmp}" add README.md`);
  sh(`git -C "${tmp}" commit -m "Add ${PROJECT_NAME}"`);
  sh(`git -C "${tmp}" push -u origin "${branchName}"`, { silent: false });
} catch (e) {
  console.error(`❌ Git operation failed:`, e.message);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

// ── Generate the 1-click PR URL ──────────────────────────────────────────

const prUrl = `https://github.com/${candidate.repo}/compare/main...${USER}:${candidate.repo.split('/')[1]}:${branchName}?expand=1&title=${encodeURIComponent('Add ' + PROJECT_NAME)}&body=${encodeURIComponent(`Adding [${PROJECT_NAME}](${PROJECT_URL}) — singleton intelligence layer for cross-agent AI coding tool memory. ${stars} GitHub stars, MIT licensed, TypeScript, zero new runtime deps. Happy to adjust the entry to match the list's conventions.`)}`;

const summary = `# Awesome-List PR Prepared

_Auto-generated by the Viral Amplifier on ${new Date().toISOString().slice(0, 10)}._

## Ready to Submit

**Target:** [${candidate.repo}](https://github.com/${candidate.repo})
**Score:** ${candidate.score}
**Your fork branch:** [${USER}/${candidate.repo.split('/')[1]}@${branchName}](https://github.com/${USER}/${candidate.repo.split('/')[1]}/tree/${branchName})

### 👉 1-Click PR URL

[**Open PR Now**](${prUrl})

This URL opens GitHub's PR creation page pre-filled with title and body. Review the README diff before clicking "Create pull request".

## Before You Click

1. Visit the target's [CONTRIBUTING.md](https://github.com/${candidate.repo}/blob/main/CONTRIBUTING.md) (or wherever they document submission rules)
2. Adjust the README entry on your branch if needed (style consistency)
3. Verify your project meets the list's criteria

## After You Submit

- Don't bump the PR for at least 7 days. Maintainers batch-merge.
- Reply promptly to any feedback.
- If rejected, learn from the reason and don't resubmit unless you address it.

## Cooldown Active

The bot will not prepare another awesome-list PR for 7 days. This protects your sender reputation.
`;

writeFileSync('docs/AWESOME_PR_READY.md', summary);
writeFileSync(COOLDOWN_MARKER, Date.now().toString());

rmSync(tmp, { recursive: true, force: true });

console.log(`\n✅ PR prepared. 1-click submit URL:\n${prUrl}\n`);
console.log(`Summary saved to docs/AWESOME_PR_READY.md`);
console.log(`Cooldown marker set — next PR available ${new Date(Date.now() + COOLDOWN_MS).toISOString()}`);
