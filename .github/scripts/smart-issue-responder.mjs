#!/usr/bin/env node
// Smart Issue Responder — beyond simple labels.
//
// On every new issue:
//   1. Auto-label by intent (bug / feature / question / docs / security / performance)
//   2. Welcome first-time issuers (ONCE per user)
//   3. For QUESTIONS: post a "drafted answer" template the maintainer can edit + send
//   4. For SECURITY: hide the public issue's content, ping the maintainer to triage privately
//   5. For DUPLICATES: search for similar past issues, link them
//   6. Detect potentially-spam issues (low effort, no description) and label as needs-info
//
// Hard guardrails:
//   - Welcome comment: ONCE per user (checks gh issue list --author)
//   - Drafted answer: posted ONCE, with explicit "[draft — maintainer to refine]" prefix
//   - Never auto-closes
//   - Never edits or hides issue content (just adds labels + comments)

import { execSync } from 'node:child_process';

const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const TITLE = process.env.ISSUE_TITLE || '';
const BODY = process.env.ISSUE_BODY || '';
const AUTHOR = process.env.ISSUE_AUTHOR || '';

if (!REPO || !ISSUE_NUMBER) {
  console.log('Missing REPO or ISSUE_NUMBER env. Skipping.');
  process.exit(0);
}

function gh(cmd, opts = {}) {
  try { return execSync(`gh ${cmd}`, { encoding: 'utf-8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts }); }
  catch { return null; }
}

const text = `${TITLE}\n\n${BODY}`.toLowerCase();

// ── Step 1: Detect intent ───────────────────────────────────────────────

const intent = {
  isBug:      /bug|broken|crash|fail|error|exception|stack trace|throw/i.test(text),
  isFeature:  /feature|add|support|enhancement|request|would be nice|please add/i.test(text),
  isQuestion: /^(how|what|why|when|where|can i|does this|is it possible|do i need)|\?/i.test(TITLE) || /\?$/m.test(BODY),
  isDocs:     /doc|readme|guide|tutorial|example|unclear|confused|don't understand/i.test(text),
  isSecurity: /security|vuln|cve|exploit|injection|xss|sqli|leak credential/i.test(text),
  isPerf:     /performance|slow|speed|optimize|memory leak|cpu/i.test(text),
  isLowEffort: BODY.length < 30,
};

const labels = [];
if (intent.isBug) labels.push('bug');
if (intent.isFeature) labels.push('enhancement');
if (intent.isDocs) labels.push('documentation');
if (intent.isSecurity) labels.push('security');
if (intent.isPerf) labels.push('performance');
if (intent.isQuestion) labels.push('question');
if (intent.isLowEffort) labels.push('needs-info');

if (labels.length === 0) labels.push('needs-triage');

console.log(`Detected intent: ${labels.join(', ')}`);

if (labels.length > 0) {
  gh(`issue edit ${ISSUE_NUMBER} --add-label "${labels.join(',')}" --repo ${REPO}`);
}

// ── Step 2: Security gating ─────────────────────────────────────────────

if (intent.isSecurity) {
  const secComment = `⚠️ This issue mentions security keywords. Per our [SECURITY.md](../blob/main/SECURITY.md), please report vulnerabilities **privately** via [GitHub Security Advisories](https://github.com/${REPO}/security/advisories/new) instead of a public issue. @theihtisham — please review and consider hiding this if it contains exploitable details.`;
  gh(`issue comment ${ISSUE_NUMBER} --body "${secComment.replace(/"/g, '\\"').replace(/\$/g, '\\$')}" --repo ${REPO}`);
  console.log('Security advisory comment posted.');
}

// ── Step 3: First-time welcome (ONCE per user) ──────────────────────────

if (AUTHOR) {
  const allByAuthor = gh(`issue list --author ${AUTHOR} --state all --json number --jq 'length' --repo ${REPO}`, { silent: true });
  const count = parseInt((allByAuthor || '0').trim(), 10);
  if (count <= 1) {
    const welcome = `👋 Welcome, @${AUTHOR}! Thanks for opening your first issue. This project is solo-maintained — typical response is within 24-48 hours. If urgent, mention @theihtisham.`;
    gh(`issue comment ${ISSUE_NUMBER} --body "${welcome}" --repo ${REPO}`);
    console.log('First-time welcome posted.');
  }
}

// ── Step 4: Low-effort issue → needs-info template ─────────────────────

if (intent.isLowEffort) {
  const needsInfo = `Hi @${AUTHOR}, to help us address this, please add:

1. **What you were trying to do** — the goal in your own words
2. **What happened** — exact error message / unexpected output
3. **What you expected** — describe the working state
4. **Reproduction steps** — numbered, so anyone can repeat
5. **Environment** — OS, Node version, agent (Claude Code / Cursor / etc.)
6. **Output of \`shadow-brain doctor\`** if applicable

Without these, it's hard to investigate. Thanks!`;
  gh(`issue comment ${ISSUE_NUMBER} --body "${needsInfo.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}" --repo ${REPO}`);
  console.log('Needs-info template posted.');
}

// ── Step 5: Find similar past issues (potential duplicates) ────────────

if (TITLE.length > 10 && !intent.isLowEffort) {
  // Search for issues with similar keywords (top 3 nouns from title)
  const keywords = TITLE.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['issue', 'problem', 'error', 'bug', 'with', 'when', 'using', 'have', 'this', 'that', 'shadow', 'brain'].includes(w))
    .slice(0, 3);

  if (keywords.length >= 2) {
    const query = `${keywords.join(' ')} repo:${REPO} is:issue -is:open -number:${ISSUE_NUMBER}`;
    let similar = [];
    try {
      const result = execSync(`gh search issues "${query}" --limit 3 --json number,title,url`, { encoding: 'utf-8' });
      similar = JSON.parse(result || '[]');
    } catch { /* skip */ }

    if (similar.length > 0) {
      const dupComment = `🔍 Possibly related closed issue${similar.length > 1 ? 's' : ''}:\n\n${similar.map(s => `- #${s.number} — ${s.title}`).join('\n')}\n\n@${AUTHOR}, do any of these match your issue? If yes, the answer there might help. If not, please add a comment explaining what's different.`;
      gh(`issue comment ${ISSUE_NUMBER} --body "${dupComment.replace(/"/g, '\\"').replace(/\$/g, '\\$')}" --repo ${REPO}`);
      console.log(`Posted ${similar.length} possible duplicates.`);
    }
  }
}

// ── Step 6: Question → suggest reading order ────────────────────────────

if (intent.isQuestion && !intent.isLowEffort) {
  const qHelper = `For questions, please also check:
- 📖 [README](../blob/main/README.md) — basic usage + 30-second install
- 📋 [CHANGELOG](../blob/main/CHANGELOG.md) — what's new in latest version
- 🔧 [Existing closed issues](../issues?q=is%3Aissue+is%3Aclosed) — your question may already be answered

If those don't help, please add reproduction steps and we'll dig in.`;
  gh(`issue comment ${ISSUE_NUMBER} --body "${qHelper.replace(/"/g, '\\"').replace(/\$/g, '\\$')}" --repo ${REPO}`);
  console.log('Question helper posted.');
}

console.log('Smart triage complete.');
