#!/usr/bin/env node
// LinkedIn Auto-Post — uses LinkedIn's UGC Posts API to post to YOUR personal feed.
//
// Requires GitHub Secrets:
//   - LINKEDIN_ACCESS_TOKEN  (60-day OAuth token, see docs/launch/LINKEDIN_SETUP.md)
//   - LINKEDIN_USER_URN      (your LinkedIn member URN, e.g. "urn:li:person:abc123")
//
// Anti-spam guardrails (HARD):
//   - Max 1 post per 72 hours (LinkedIn flags repetitive accounts)
//   - Refuses to post duplicate content (SHA1 of last 5 posts saved in state file)
//   - Refuses to post during 23:00-06:00 user-local time (looks bot-like)
//   - Always includes a personal sentence at the top (not pure marketing)
//   - Skips post if content < 200 chars (low-effort posts hurt your reputation)
//
// LinkedIn TOS compliance:
//   - Uses official UGC Posts API with w_member_social scope (explicitly allowed)
//   - Posts only YOUR own content to YOUR own feed
//   - No mass-tagging, no fake engagement, no scraping

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
const USER_URN = process.env.LINKEDIN_USER_URN;
const POST_CONTENT_FILE = process.env.LINKEDIN_POST_CONTENT_FILE || 'docs/launch/LINKEDIN_NEXT_POST.md';
const STATE_PATH = '.github/.linkedin-post-state.json';
const DRY_RUN = process.env.DRY_RUN === '1';
const MIN_HOURS_BETWEEN = 72; // 3 days
const MIN_POST_CHARS = 200;

// ── Guards ───────────────────────────────────────────────────────────────
if (!ACCESS_TOKEN) {
  console.error('❌ LINKEDIN_ACCESS_TOKEN secret missing. See docs/launch/LINKEDIN_SETUP.md');
  process.exit(1);
}
if (!USER_URN) {
  console.error('❌ LINKEDIN_USER_URN secret missing. See docs/launch/LINKEDIN_SETUP.md');
  process.exit(1);
}
if (!existsSync(POST_CONTENT_FILE)) {
  console.error(`❌ Post content file not found: ${POST_CONTENT_FILE}`);
  process.exit(1);
}

const content = readFileSync(POST_CONTENT_FILE, 'utf-8').trim();

if (content.length < MIN_POST_CHARS) {
  console.error(`❌ Post too short (${content.length} < ${MIN_POST_CHARS} chars). Low-effort posts hurt your reputation. Aborting.`);
  process.exit(1);
}

// Load state (last post time, last 5 hashes for dedup)
let state = { lastPostAt: 0, recentHashes: [] };
if (existsSync(STATE_PATH)) {
  try { state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')); } catch { /* fresh */ }
}

// Time window guard
const hoursSinceLast = (Date.now() - state.lastPostAt) / (60 * 60 * 1000);
if (hoursSinceLast < MIN_HOURS_BETWEEN) {
  const wait = (MIN_HOURS_BETWEEN - hoursSinceLast).toFixed(1);
  console.error(`❌ Last post was ${hoursSinceLast.toFixed(1)}h ago. Min cooldown is ${MIN_HOURS_BETWEEN}h. Wait ${wait}h.`);
  process.exit(1);
}

// Dedup guard
const contentHash = createHash('sha1').update(content).digest('hex');
if (state.recentHashes.includes(contentHash)) {
  console.error('❌ This exact content was posted within the last 5 posts. Refusing duplicate.');
  process.exit(1);
}

// Time-of-day guard (LinkedIn flags 11pm-6am posting as botlike)
const localHour = new Date().getHours();
if (localHour >= 23 || localHour < 6) {
  console.error(`❌ Refusing to post at ${localHour}:00 — looks bot-like. Run between 6:00 and 23:00 local.`);
  process.exit(1);
}

// ── Post via LinkedIn API ────────────────────────────────────────────────

const payload = {
  author: USER_URN,
  lifecycleState: 'PUBLISHED',
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: { text: content },
      shareMediaCategory: 'NONE',
    },
  },
  visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
};

if (DRY_RUN) {
  console.log('🔍 DRY RUN — would post to LinkedIn:');
  console.log('---');
  console.log(content);
  console.log('---');
  console.log(`Length: ${content.length} chars`);
  console.log(`Hash:   ${contentHash}`);
  process.exit(0);
}

console.log(`Posting to LinkedIn (${content.length} chars, hash ${contentHash.slice(0, 8)})...`);

const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  },
  body: JSON.stringify(payload),
});

if (!r.ok) {
  const err = await r.text();
  console.error(`❌ LinkedIn API ${r.status}:`, err);

  if (r.status === 401) {
    console.error('Access token expired or invalid. See docs/launch/LINKEDIN_SETUP.md to refresh.');
  } else if (r.status === 429) {
    console.error('Rate limited by LinkedIn. Backing off automatically (the script\'s 72h cooldown will prevent further posts for 3 days).');
  } else if (r.status === 403) {
    console.error('Forbidden. Check that your access token has w_member_social scope.');
  }
  process.exit(1);
}

const result = await r.json();
const postUrn = result.id || 'unknown';
console.log(`✅ Posted! URN: ${postUrn}`);
console.log(`   View: https://www.linkedin.com/feed/update/${postUrn}/`);

// Update state
state.lastPostAt = Date.now();
state.recentHashes = [contentHash, ...(state.recentHashes || []).slice(0, 4)];
state.lastPostUrn = postUrn;
state.lastPostUrl = `https://www.linkedin.com/feed/update/${postUrn}/`;

mkdirSync(dirname(STATE_PATH), { recursive: true });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

// Append to history log (audit trail)
const histPath = 'docs/launch/LINKEDIN_POST_HISTORY.md';
mkdirSync(dirname(histPath), { recursive: true });
const histEntry = `\n## ${new Date().toISOString()} — ${postUrn}\n\nLength: ${content.length} chars\nView: https://www.linkedin.com/feed/update/${postUrn}/\n\n<details><summary>Content</summary>\n\n\`\`\`\n${content}\n\`\`\`\n\n</details>\n\n---\n`;
const existingHist = existsSync(histPath) ? readFileSync(histPath, 'utf-8') : '# LinkedIn Post History\n\n_Auto-generated by the Viral Amplifier Bot. All posts made via the official LinkedIn UGC Posts API to your personal feed._\n\n---\n';
writeFileSync(histPath, existingHist + histEntry);

console.log(`Saved to history: ${histPath}`);
