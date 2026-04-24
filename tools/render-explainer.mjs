// tools/render-explainer.mjs — Render the 1-minute Hive Mind explainer to real MP4
//
// Uses Playwright to:
//   1. Open docs/launch/hivemind-explainer.html at 1920x1080
//   2. Wait for GSAP timeline to finish (60 seconds)
//   3. Use Playwright's built-in video recording → WebM
//   4. Convert WebM to polished MP4 via ffmpeg (H.264, high quality)
//   5. Also export a looping banner GIF from the Hive Mind reveal scene

import { chromium } from 'playwright';
import { spawnSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.resolve(ROOT, 'docs', 'launch', 'hivemind-explainer.html');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const WEBM_TMP = path.resolve(OUT_DIR, '_raw-recording.webm');
const MP4_PATH = path.resolve(OUT_DIR, 'shadow-brain-v6-explainer.mp4');
const GIF_PATH = path.resolve(OUT_DIR, 'banner.gif');
const BANNER_MP4 = path.resolve(OUT_DIR, 'banner.mp4');

const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_MS = 62_000;

async function record() {
  console.log('→ Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await ctx.newPage();
  console.log('→ Loading explainer HTML...');
  await page.goto('file:///' + HTML_PATH.replace(/\\/g, '/'));
  await page.waitForFunction(() => typeof window.play === 'function' && document.querySelector('.scene'), { timeout: 15000 });

  // Hide the floating controls so they don't appear in the final render
  await page.evaluate(() => {
    const ctrls = document.querySelector('.controls');
    if (ctrls) ctrls.style.display = 'none';
    const progress = document.querySelector('#progress');
    if (progress) progress.style.height = '4px';
    window.play();
  });

  console.log('→ Recording for 62 seconds (1:02 to catch the fade-out)...');
  await page.waitForTimeout(DURATION_MS);

  console.log('→ Closing browser and finalizing WebM...');
  // Close context to flush the video — the file appears as *.webm in OUT_DIR
  const videoPath = await page.video()?.path();
  await ctx.close();
  await browser.close();

  if (videoPath) {
    if (fs.existsSync(WEBM_TMP)) fs.unlinkSync(WEBM_TMP);
    fs.renameSync(videoPath, WEBM_TMP);
    console.log(`→ Raw WebM saved: ${WEBM_TMP}`);
  } else {
    throw new Error('No video path returned by Playwright');
  }
}

function run(cmd, args) {
  console.log(`→ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

async function transcode() {
  // Full MP4 — H.264, tuned for quality, 30fps stable
  run('ffmpeg', [
    '-y', '-i', WEBM_TMP,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '20',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    MP4_PATH,
  ]);

  // Banner MP4 — first 8 seconds, looping-friendly, smaller
  run('ffmpeg', [
    '-y', '-i', WEBM_TMP,
    '-ss', '10', '-t', '8',
    '-vf', 'scale=1200:-2:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-r', '30',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    BANNER_MP4,
  ]);

  // Banner GIF — same 8 second range, optimized
  run('ffmpeg', [
    '-y', '-i', WEBM_TMP,
    '-ss', '10', '-t', '8',
    '-vf', 'fps=20,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
    '-loop', '0',
    GIF_PATH,
  ]);
}

async function main() {
  if (!fs.existsSync(HTML_PATH)) throw new Error('Missing ' + HTML_PATH);
  await record();
  await transcode();
  const mp4 = fs.statSync(MP4_PATH);
  const gif = fs.statSync(GIF_PATH);
  const banner = fs.statSync(BANNER_MP4);
  console.log('\n=== RENDER COMPLETE ===');
  console.log(`Full MP4:  ${MP4_PATH}  (${(mp4.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Banner MP4: ${BANNER_MP4}  (${(banner.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Banner GIF: ${GIF_PATH}  (${(gif.size / 1024 / 1024).toFixed(2)} MB)`);
  // Clean up raw WebM
  try { fs.unlinkSync(WEBM_TMP); } catch { /* empty */ }
}

main().catch(err => {
  console.error('Render failed:', err);
  process.exit(1);
});
