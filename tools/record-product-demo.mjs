// tools/record-product-demo.mjs — Record a REAL product demo of the live dashboard
//
// Uses Playwright to drive the running dashboard at http://localhost:7341/ and
// captures a 1080p video showing actual product interactions — tab switches,
// live graph animation, command palette, feature toggles, real data.
//
// Output: docs/launch/shadow-brain-product-demo.mp4 (transcoded via ffmpeg)
//
// Prerequisites: dashboard must already be running on :7341.

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const WEBM_TMP = path.resolve(OUT_DIR, '_product-demo-raw.webm');
const MP4_PATH = path.resolve(OUT_DIR, 'shadow-brain-product-demo.mp4');

const DASHBOARD_URL = 'http://localhost:7341/';
const WIDTH = 1920; const HEIGHT = 1080;

async function verifyRunning() {
  try {
    const res = await fetch(DASHBOARD_URL);
    if (!res.ok) throw new Error('not OK');
  } catch {
    console.error('✗ Dashboard not reachable at ' + DASHBOARD_URL);
    console.error('  Run: CI=true node dist/cli.js dash . --no-open --port 7341 --provider ollama --no-inject');
    process.exit(1);
  }
}

async function drive(page) {
  console.log('→ 1: Overview (hero + live data)');
  await page.waitForSelector('.brain-hero svg', { timeout: 5000 });
  await page.waitForTimeout(4500);

  console.log('→ 2: Live Graph — animated signal flow');
  await page.click('[data-tab="graph"]');
  await page.waitForTimeout(7500);

  console.log('→ 3: Agents — connection table');
  await page.click('[data-tab="agents"]');
  await page.waitForTimeout(4500);

  console.log('→ 4: SABB — sub-agent bridge');
  await page.click('[data-tab="sabb"]');
  await page.waitForTimeout(1200);
  await page.fill('#sabb-task', 'refactor the auth middleware to use passkeys');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Generate")');
  await page.waitForTimeout(3500);

  console.log('→ 5: Causal Chains');
  await page.click('[data-tab="causal"]');
  await page.waitForTimeout(4500);

  console.log('→ 6: Dream Engine');
  await page.click('[data-tab="dream"]');
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Run Cycle")');
  await page.waitForTimeout(4000);

  console.log('→ 7: Token Economy — charts + savings');
  await page.click('[data-tab="tokens"]');
  await page.waitForTimeout(5000);

  console.log('→ 8: Reputation Ledger — Ed25519');
  await page.click('[data-tab="reputation"]');
  await page.waitForTimeout(4000);

  console.log('→ 9: Privacy & Safety — Air-Gap');
  await page.click('[data-tab="privacy"]');
  await page.waitForTimeout(3500);

  console.log('→ 10: Command Palette (Cmd+K)');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(900);
  await page.fill('#cmd-input', 'dream');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  console.log('→ 11: Feature Toggles — per-module control');
  await page.click('[data-tab="features"]');
  await page.waitForTimeout(5500);

  console.log('→ 12: Theme toggle (dark → light)');
  await page.click('button[title="Toggle theme"]');
  await page.waitForTimeout(2500);
  await page.click('button[title="Toggle theme"]');
  await page.waitForTimeout(2000);

  console.log('→ 13: Back to Overview — final frame');
  await page.click('[data-tab="overview"]');
  await page.waitForTimeout(4500);
}

async function record() {
  console.log('→ Launching Chromium headless (for screen record)...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  console.log('→ Navigating to dashboard...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' });

  // Remove the welcome toast so it doesn't block the demo
  try { await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); }); } catch { /* empty */ }

  await drive(page);

  console.log('→ Closing browser to flush video...');
  const videoPath = await page.video()?.path();
  await ctx.close();
  await browser.close();

  if (!videoPath) throw new Error('No video path returned');
  if (fs.existsSync(WEBM_TMP)) fs.unlinkSync(WEBM_TMP);
  fs.renameSync(videoPath, WEBM_TMP);
  console.log('→ WebM saved: ' + WEBM_TMP);
}

function run(cmd, args) {
  console.log('→ ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(cmd + ' exited with ' + r.status);
}

async function transcode() {
  run('ffmpeg', [
    '-y', '-i', WEBM_TMP,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-r', '30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    MP4_PATH,
  ]);
}

(async () => {
  await verifyRunning();
  await record();
  await transcode();
  const mp4 = fs.statSync(MP4_PATH);
  console.log('\n=== PRODUCT DEMO COMPLETE ===');
  console.log('  MP4: ' + MP4_PATH + '  (' + (mp4.size / 1024 / 1024).toFixed(2) + ' MB)');
  try { fs.unlinkSync(WEBM_TMP); } catch { /* empty */ }
})().catch(err => {
  console.error('Record failed:', err);
  process.exit(1);
});
