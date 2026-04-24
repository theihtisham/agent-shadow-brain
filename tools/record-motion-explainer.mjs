// tools/record-motion-explainer.mjs — Render motion-explainer.html to MP4 + mux narration
import { chromium } from 'playwright';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const HTML_PATH = path.join(OUT_DIR, 'motion-explainer.html');
const TMP_WEBM = path.join(OUT_DIR, '_motion-raw.webm');
const SILENT_MP4 = path.join(OUT_DIR, 'shadow-brain-motion-explainer.mp4');
const NARRATED_MP4 = path.join(OUT_DIR, 'shadow-brain-motion-explainer-narrated.mp4');
const NARRATION_MP3 = path.join(OUT_DIR, 'motion-narration.mp3');
const TMP_DIR = path.join(OUT_DIR, '_motion_tts_tmp');

const W = 1920, H = 1080;
const VOICE = 'en-US-AndrewNeural';
const RATE = '+2%';
const TOTAL_SEC = 123; // matches the timeline in motion-explainer.html

// Scene-timed narration — matches the SCENES array in the HTML
const NARRATION = [
  { start:   0, text: "Meet Shadow Brain version 6 — the first open-source Hive Mind for AI coding agents. Twenty-two modules, completely free, licensed MIT." },
  { start:  13, text: "Every AI coding agent you use — Claude Code, Cursor, Cline, Codex, Copilot — starts every session from zero. They forget everything the moment you close them." },
  { start:  22, text: "Shadow Brain fixes this. One local brain at dot shadow brain slash global dot JSON is shared across every agent on your machine." },
  { start:  33, text: "The Sub-Agent Brain Bridge is unique to Shadow Brain. When agents spawn sub-agents, it injects a focused context sliver so sub-agents inherit knowledge instead of starting blind." },
  { start:  43, text: "Causal Memory Chains trace every AI decision back to every cause. And the Dream Engine runs reflective cycles while you sleep — strengthening patterns, running counterfactuals." },
  { start:  53, text: "Every agent decision is Ed25519 signed in the Reputation Ledger. The Token Economy tracks cross-agent spend and saves money automatically. Collisions are caught before they happen." },
  { start:  63, text: "This is the live control dashboard — twenty-eight tabs, real data, driven by actual memories on disk." },
  { start:  72, text: "Install Shadow Brain in thirty seconds. One npm command installs it globally. Another command wires up every AI agent on your machine. Then start the dashboard with shadow-brain dash." },
  { start:  87, text: "The dashboard opens instantly at localhost port seven three four one. Every memory, every agent, every sub-agent — all with real-time data visualization." },
  { start:  96, text: "Forty-eight brain modules. One hundred forty-eight tests passing. Ninety plus CLI commands. And zero cost to run — local-first by default." },
  { start: 106, text: "Shadow Brain. Free, open source, local-first. Install with npx at theihtisham slash agent-shadow-brain. Star it on GitHub, install from npm. The Hive Mind for every AI coding agent on your machine." },
];

async function synth(text, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { rate: RATE });
  const { audioStream } = await tts.toStream(text);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    audioStream.pipe(ws);
    audioStream.on('end', resolve);
    audioStream.on('error', reject);
    ws.on('error', reject);
  });
  return outPath;
}
function probeDuration(filePath) {
  const r = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', filePath], { encoding: 'utf-8' });
  return parseFloat((r.stdout || '0').trim()) || 0;
}
function run(cmd, args) {
  console.log('→ ' + cmd + ' ' + args.slice(0, 6).join(' ') + (args.length > 6 ? ' ...' : ''));
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
}

async function record() {
  console.log('=== Step 1: record motion HTML to WebM ===');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  await page.goto('file:///' + HTML_PATH.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  console.log(`  recording ${TOTAL_SEC}s of animation...`);
  await page.waitForTimeout(TOTAL_SEC * 1000);

  const videoPath = await page.video()?.path();
  await ctx.close();
  await browser.close();
  if (!videoPath) throw new Error('No video path returned');
  if (fs.existsSync(TMP_WEBM)) fs.unlinkSync(TMP_WEBM);
  fs.renameSync(videoPath, TMP_WEBM);
  console.log('  raw WebM saved');
}

async function transcode() {
  console.log('=== Step 2: transcode to H.264 MP4 (silent) ===');
  run('ffmpeg', [
    '-y', '-i', TMP_WEBM,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-r', '30', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    SILENT_MP4,
  ]);
}

async function narrate() {
  console.log('=== Step 3: synthesize narration ===');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const entries = [];
  for (let i = 0; i < NARRATION.length; i++) {
    const s = NARRATION[i];
    const out = path.join(TMP_DIR, `n-${String(i).padStart(2, '0')}.mp3`);
    console.log(`[TTS ${i}] ${s.text.slice(0, 70)}...`);
    await synth(s.text, out);
    entries.push({ start: s.start, path: out, duration: probeDuration(out) });
  }

  // one-second silence for padding
  const silence = path.join(TMP_DIR, 'silence.mp3');
  spawnSync('ffmpeg', ['-y','-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=24000','-t','1','-q:a','9','-acodec','libmp3lame', silence], { stdio: 'ignore' });

  // Build concat list with silence padding so each TTS clip starts at its scene start time
  const listPath = path.join(TMP_DIR, 'list.txt');
  const lines = [];
  let cursor = 0;
  for (const e of entries) {
    const gap = Math.max(0, e.start - cursor);
    if (gap > 0.05) {
      lines.push(`file '${silence.replace(/\\/g, '/')}'`);
      lines.push(`duration ${gap.toFixed(3)}`);
    }
    lines.push(`file '${e.path.replace(/\\/g, '/')}'`);
    cursor = e.start + e.duration;
  }
  const tail = Math.max(0, TOTAL_SEC - cursor);
  if (tail > 0.05) {
    lines.push(`file '${silence.replace(/\\/g, '/')}'`);
    lines.push(`duration ${tail.toFixed(3)}`);
  }
  fs.writeFileSync(listPath, lines.join('\n'));

  run('ffmpeg', ['-y','-f','concat','-safe','0','-i', listPath, '-c:a','libmp3lame','-b:a','128k','-t', String(TOTAL_SEC), NARRATION_MP3]);

  console.log('=== Step 4: mux narration + silent MP4 ===');
  run('ffmpeg', ['-y',
    '-i', SILENT_MP4, '-i', NARRATION_MP3,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', NARRATED_MP4,
  ]);

  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
  try { fs.unlinkSync(TMP_WEBM); } catch {}
}

(async () => {
  if (!fs.existsSync(HTML_PATH)) { console.error('Missing HTML: ' + HTML_PATH); process.exit(1); }
  await record();
  await transcode();
  await narrate();

  const silentSz = fs.statSync(SILENT_MP4).size;
  const narratedSz = fs.statSync(NARRATED_MP4).size;
  const narrSz = fs.statSync(NARRATION_MP3).size;
  console.log('\n=== MOTION EXPLAINER COMPLETE ===');
  console.log(`  Silent:   ${SILENT_MP4}   (${(silentSz/1024/1024).toFixed(2)} MB)`);
  console.log(`  Narrated: ${NARRATED_MP4} (${(narratedSz/1024/1024).toFixed(2)} MB)`);
  console.log(`  Audio:    ${NARRATION_MP3}        (${(narrSz/1024/1024).toFixed(2)} MB)`);
})().catch(err => { console.error(err); process.exit(1); });
