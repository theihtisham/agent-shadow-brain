// tools/capture-screenshots.mjs — Screenshot every dashboard tab
// Prereq: dashboard running at http://localhost:7341/

import { chromium } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch', 'screenshots');
const DASHBOARD_URL = 'http://localhost:7341/';
const W = 1920, H = 1080;

const TABS = [
  'overview', 'graph', 'agents', 'chat', 'memory', 'activity',
  'sabb', 'causal', 'collision', 'dream', 'reputation', 'debate',
  'premortem', 'branch', 'forget', 'attention', 'calibration',
  'formal', 'tokens', 'privacy', 'voice', 'garden', 'pr', 'team',
  'exchange', 'features', 'models', 'config',
];

async function verify() {
  try {
    const res = await fetch(DASHBOARD_URL);
    if (!res.ok) throw new Error('bad status');
  } catch {
    console.error('✗ Dashboard not reachable at ' + DASHBOARD_URL);
    console.error('  Run: CI=true node dist/cli.js dash . --no-open --port 7341 --provider ollama --no-inject');
    process.exit(1);
  }
}

async function main() {
  await verify();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Dismiss any welcome toast
  try { await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); }); } catch {}

  let captured = 0;
  for (let i = 0; i < TABS.length; i++) {
    const tab = TABS[i];
    try {
      const clickable = await page.$(`[data-tab="${tab}"]`);
      if (!clickable) { console.log(`  ~ skip ${tab} (no nav button)`); continue; }
      await clickable.click();
      await page.waitForTimeout(900);
      // Give charts + graphs a moment to animate/render
      if (['tokens', 'dream', 'graph', 'garden'].includes(tab)) await page.waitForTimeout(1800);
      const out = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${tab}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`  ✓ ${tab} → ${path.basename(out)}`);
      captured++;
    } catch (err) {
      console.log(`  ✗ ${tab} failed: ${err.message}`);
    }
  }

  // Bonus: open command palette + capture it
  try {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    await page.fill('#cmd-input', 'dream');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, `29-command-palette.png`) });
    captured++;
    await page.keyboard.press('Escape');
  } catch {}

  await ctx.close();
  await browser.close();
  console.log(`\n=== CAPTURED ${captured} SCREENSHOTS ===`);
  console.log(`  Folder: ${OUT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
