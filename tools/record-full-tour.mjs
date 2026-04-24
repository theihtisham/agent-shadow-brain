// tools/record-full-tour.mjs — Complete guided tour of every dashboard feature
// Records a single ~3 minute 1920x1080 MP4. Pair with generate-tour-narration.mjs
// to mux a voice-over track.

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const WEBM_TMP = path.resolve(OUT_DIR, '_full-tour-raw.webm');
const MP4_PATH = path.resolve(OUT_DIR, 'shadow-brain-full-tour.mp4');
const DASHBOARD_URL = 'http://localhost:7341/';
const W = 1920, H = 1080;

async function verify() {
  // Try both IPv4 and IPv6 loopback — Node http sometimes binds IPv6-only on Windows
  const tryUrls = ['http://localhost:7341/', 'http://127.0.0.1:7341/', 'http://[::1]:7341/'];
  for (const u of tryUrls) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2500);
      const r = await fetch(u, { signal: controller.signal });
      clearTimeout(t);
      if (r.ok) return;
    } catch { /* try next */ }
  }
  // Last resort: trust Playwright to drive it
  console.warn('! fetch pre-check failed — proceeding; Playwright will fail loudly if dashboard is down.');
}

async function clickAndWait(page, tab, waitMs = 4000) {
  const el = await page.$(`[data-tab="${tab}"]`);
  if (!el) return;
  await el.click();
  // Force a full data refresh so every card/table populates before we snap
  try {
    await page.evaluate(() => {
      if (typeof window.refresh === 'function') window.refresh();
      const active = document.querySelector('.nav-item.active');
      if (active && typeof window.onTabOpen === 'function') window.onTabOpen(active.dataset.tab);
    });
  } catch {}
  await page.waitForTimeout(waitMs);
}

async function drive(page) {
  // Scene 1 — Overview
  await page.waitForTimeout(5000);

  // Scene 2 — Live Graph (animations pop)
  await clickAndWait(page, 'graph', 8000);

  // Scene 3 — Agents panel
  await clickAndWait(page, 'agents', 5000);

  // Scene 4 — Chat with Brain
  await clickAndWait(page, 'chat', 2500);
  try {
    await page.fill('#chat-input', 'What did we decide about bcrypt?');
    await page.waitForTimeout(2000);
  } catch {}
  await page.waitForTimeout(2500);

  // Scene 5 — Memory Browser
  await clickAndWait(page, 'memory', 5000);

  // Scene 6 — SABB sliver generator
  await clickAndWait(page, 'sabb', 2000);
  try {
    await page.fill('#sabb-task', 'refactor auth middleware to use passkeys');
    await page.waitForTimeout(1000);
    const btn = await page.$('button:has-text("Generate")');
    if (btn) await btn.click();
    await page.waitForTimeout(3000);
  } catch {}

  // Scene 7 — Causal chains
  await clickAndWait(page, 'causal', 5500);

  // Scene 8 — Collision detective
  await clickAndWait(page, 'collision', 5000);

  // Scene 9 — Dream Engine (run a cycle)
  await clickAndWait(page, 'dream', 2000);
  try {
    const run = await page.$('button:has-text("Run Cycle")');
    if (run) await run.click();
    await page.waitForTimeout(4500);
  } catch {}

  // Scene 10 — Reputation
  await clickAndWait(page, 'reputation', 5500);

  // Scene 11 — Debate
  await clickAndWait(page, 'debate', 4000);

  // Scene 12 — Pre-Mortem
  await clickAndWait(page, 'premortem', 4500);

  // Scene 13 — Attention Heatmap
  await clickAndWait(page, 'attention', 4000);

  // Scene 14 — Token Economy (chart draws)
  await clickAndWait(page, 'tokens', 7000);

  // Scene 15 — Forgetting curve
  await clickAndWait(page, 'forget', 5000);

  // Scene 16 — Formal Verification Bridge
  await clickAndWait(page, 'formal', 4500);

  // Scene 17 — Calibration
  await clickAndWait(page, 'calibration', 4500);

  // Scene 18 — Branch Brains
  await clickAndWait(page, 'branch', 4000);

  // Scene 19 — Privacy & Safety
  await clickAndWait(page, 'privacy', 5500);

  // Scene 20 — Voice
  await clickAndWait(page, 'voice', 4000);

  // Scene 21 — Brain Garden
  await clickAndWait(page, 'garden', 6000);

  // Scene 22 — PR Review
  await clickAndWait(page, 'pr', 4500);

  // Scene 23 — Team Sync
  await clickAndWait(page, 'team', 4500);

  // Scene 24 — Brain Exchange
  await clickAndWait(page, 'exchange', 4500);

  // Scene 25 — Feature toggles
  await clickAndWait(page, 'features', 6500);

  // Scene 26 — Models & Intelligence
  await clickAndWait(page, 'models', 7500);

  // Scene 27 — Command palette demo
  try {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1000);
    await page.fill('#cmd-input', 'dream');
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  } catch {}

  // Scene 28 — Theme toggle (dark → light for contrast)
  try {
    await page.click('button[title="Toggle theme"]');
    await page.waitForTimeout(2000);
    await page.click('button[title="Toggle theme"]');
    await page.waitForTimeout(1500);
  } catch {}

  // Scene 29 — Back to overview for final frame
  await clickAndWait(page, 'overview', 6000);
}

async function record() {
  console.log('→ Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  ctx.setDefaultNavigationTimeout(60000);
  const page = await ctx.newPage();
  // "networkidle" never fires because of the dashboard's WebSocket + poll loops.
  // Use "domcontentloaded" then wait for real selectors + data load.
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#ov-memories', { timeout: 15000 }).catch(() => {});

  console.log('→ Waiting for dashboard to fully load data...');
  await page.waitForTimeout(3000);
  try { await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); } catch {}

  // CRITICAL: stop dashboard's auto-refresh polling so it doesn't fight Playwright
  // and so each tab loads its data fresh on click.
  try {
    await page.evaluate(() => {
      // Cancel every interval that was registered
      const high = setTimeout(()=>{}, 1);
      for (let i = 1; i < high; i++) { try { clearInterval(i); clearTimeout(i); } catch {} }
      clearTimeout(high);
    });
  } catch {}

  // Pre-populate ALL key endpoints so the brain status state is hot
  try {
    await page.evaluate(async () => {
      const calls = [
        ['/api/v6/hive-status', null],
        ['/api/v6/agents-list', '{}'],
        ['/api/v6/memory-browser', '{}'],
        ['/api/v6/activity-log?limit=100', null],
        ['/api/v6/topology', '{}'],
        ['/api/v6/tokens-report', null],
        ['/api/v6/calibration-scores', null],
        ['/api/v6/dream-list', null],
        ['/api/v6/subagent-quarantine', null],
        ['/api/v6/collision-list', null],
        ['/api/v6/branch-state', null],
        ['/api/v6/airgap-status', null],
        ['/api/v6/quarantine-list?pendingOnly=true', null],
        ['/api/v6/garden-snapshot?limit=200', null],
        ['/api/v6/garden-stats', null],
        ['/api/v6/team-self', null],
        ['/api/v6/team-peers', null],
        ['/api/v6/exchange-list', null],
        ['/api/v6/features-config', null],
        ['/api/v6/providers', null],
      ];
      await Promise.all(calls.map(([p, b]) => fetch(p, b == null ? {} : { method: 'POST', headers: {'Content-Type':'application/json'}, body: b }).catch(() => null)));
    });
  } catch {}
  // Now do one full UI refresh so every visible card is hydrated
  try { await page.evaluate(() => { if (typeof window.refresh === 'function') window.refresh(); }); } catch {}
  await page.waitForTimeout(2500);

  console.log('→ Recording ~3 minute full tour...');
  await drive(page);

  const videoPath = await page.video()?.path();
  await ctx.close();
  await browser.close();

  if (!videoPath) throw new Error('No video path returned');
  if (fs.existsSync(WEBM_TMP)) fs.unlinkSync(WEBM_TMP);
  fs.renameSync(videoPath, WEBM_TMP);
  console.log('→ WebM: ' + WEBM_TMP);
}

function run(cmd, args) {
  console.log('→ ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
}

(async () => {
  await verify();
  await record();
  run('ffmpeg', ['-y', '-i', WEBM_TMP,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22',
    '-r', '30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    MP4_PATH,
  ]);
  const sz = fs.statSync(MP4_PATH);
  console.log('\n=== FULL TOUR RENDERED ===');
  console.log('  ' + MP4_PATH + '  (' + (sz.size / 1024 / 1024).toFixed(2) + ' MB)');
  try { fs.unlinkSync(WEBM_TMP); } catch {}
})().catch(err => { console.error(err); process.exit(1); });
