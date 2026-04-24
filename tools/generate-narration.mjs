// tools/generate-narration.mjs — Generate voice-over via Microsoft Edge TTS (free, no API key)
//
// Uses msedge-tts which taps Edge's free Neural TTS service. Produces one MP3
// per scene, then concatenates them with silence padding that matches the
// video scene durations from record-product-demo.mjs.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const TMP_DIR = path.resolve(OUT_DIR, '_tts_tmp');

// Neural voice — professional, American English
const VOICE = 'en-US-AndrewNeural'; // alternatives: GuyNeural, AriaNeural, JennyNeural, BrianNeural
const RATE = '+3%';
const VOLUME = '+0%';

// Scene-by-scene narration timed to the product demo recording
// Scene timings should match record-product-demo.mjs (in seconds)
const SCRIPT = [
  { start: 0,  text: "Meet Shadow Brain — the first open-source Hive Mind for AI coding agents. One brain shared across Claude Code, Cursor, Cline, Codex, and more." },
  { start: 5,  text: "This is the live control dashboard. Every agent, every memory, every sub-agent — all in one place." },
  { start: 12, text: "The live graph shows real-time signal flow. Watch memory writes, sub-agent spawns, and collisions pulse through the brain." },
  { start: 22, text: "The Agents panel lets you connect or disconnect any AI tool with a single click. Hooks install into each agent's native config." },
  { start: 30, text: "SABB — the Sub-Agent Brain Bridge — generates focused context slivers so sub-agents inherit project knowledge instead of starting blind." },
  { start: 38, text: "Causal Memory Chains trace every AI decision back to its cause. Auditable, explainable, shareable." },
  { start: 44, text: "The Dream Engine runs reflective cycles when idle — revisiting decisions, running counterfactuals, strengthening patterns." },
  { start: 52, text: "Token Economy tracks spend across agents, projects real monthly cost, and suggests savings opportunities." },
  { start: 60, text: "Every agent decision is Ed25519-signed in the reputation ledger — a portable, verifiable trust score." },
  { start: 66, text: "Air-gap mode blocks all outbound network. Local-first by default. Zero API keys needed." },
  { start: 71, text: "Press Command-K anywhere to open the command palette. Search features, navigate, run actions in milliseconds." },
  { start: 77, text: "Feature toggles give you real-time control over all twenty-two v6 modules. Theme, local mode, any provider — your choice." },
  { start: 86, text: "Shadow Brain version six. Free. Open source. Local-first. The Hive Mind for every AI coding agent on your machine." },
];

async function synth(voice, text, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { rate: RATE, volume: VOLUME });
  // Use the stream API — pipe directly to our MP3 file
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
  const d = parseFloat((r.stdout || '').trim());
  return isFinite(d) ? d : 0;
}

function buildConcatList(entries, totalDuration) {
  const lines = [];
  let cursor = 0;
  for (const e of entries) {
    const gap = Math.max(0, e.start - cursor);
    if (gap > 0.05) {
      lines.push(`file '${path.resolve(TMP_DIR, 'silence.mp3').replace(/\\/g, '/')}'`);
      lines.push(`duration ${gap.toFixed(3)}`);
    }
    lines.push(`file '${e.path.replace(/\\/g, '/')}'`);
    cursor = e.start + e.duration;
  }
  const tail = Math.max(0, totalDuration - cursor);
  if (tail > 0.05) {
    lines.push(`file '${path.resolve(TMP_DIR, 'silence.mp3').replace(/\\/g, '/')}'`);
    lines.push(`duration ${tail.toFixed(3)}`);
  }
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Synthesize one MP3 per scene
  const entries = [];
  for (let i = 0; i < SCRIPT.length; i++) {
    const s = SCRIPT[i];
    const out = path.join(TMP_DIR, `scene-${String(i).padStart(2,'0')}.mp3`);
    console.log(`[TTS] scene ${i}: ${s.text.slice(0, 70)}...`);
    const audioPath = await synth(VOICE, s.text, out);
    const dur = probeDuration(audioPath);
    entries.push({ start: s.start, text: s.text, path: audioPath, duration: dur });
  }

  // One-second silence clip for padding
  const silence = path.join(TMP_DIR, 'silence.mp3');
  spawnSync('ffmpeg', ['-y','-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=24000','-t','1','-q:a','9','-acodec','libmp3lame', silence], { stdio: 'inherit' });

  // Total target duration: match the video
  const videoPath = path.join(OUT_DIR, 'shadow-brain-product-demo.mp4');
  const videoDur = probeDuration(videoPath) || 90;
  console.log('[mix] video duration = ' + videoDur + 's');

  // Build concat demuxer list (needs absolute durations for the silence pads)
  const listPath = path.join(TMP_DIR, 'list.txt');
  fs.writeFileSync(listPath, buildConcatList(entries, videoDur));

  // Produce the merged narration track
  const narrationPath = path.join(OUT_DIR, 'narration.mp3');
  spawnSync('ffmpeg', ['-y','-f','concat','-safe','0','-i', listPath,'-c:a','libmp3lame','-b:a','128k','-t', String(videoDur), narrationPath], { stdio: 'inherit' });
  console.log('[done] narration → ' + narrationPath);

  // Mix onto video
  const finalPath = path.join(OUT_DIR, 'shadow-brain-product-demo-narrated.mp4');
  spawnSync('ffmpeg', [
    '-y', '-i', videoPath, '-i', narrationPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    finalPath,
  ], { stdio: 'inherit' });
  console.log('[done] narrated video → ' + finalPath);

  // Clean up tmp
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
