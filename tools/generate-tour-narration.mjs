// tools/generate-tour-narration.mjs — Voice-over for the full tour video
// Uses Microsoft Edge TTS (msedge-tts, free, no API key). Produces a time-
// aligned narration track and muxes it onto the full tour MP4.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const TMP_DIR = path.resolve(OUT_DIR, '_tour_tts_tmp');

const VOICE = 'en-US-AndrewNeural'; // natural professional voice
const RATE = '+2%';
const VOLUME = '+0%';

// Each entry is { start: seconds, text }. Timings match record-full-tour.mjs waits.
const SCRIPT = [
  { start:   0, text: "Shadow Brain v6 — the open-source Hive Mind that every AI coding agent on your machine can share. Here is the complete control panel." },
  { start:   6, text: "The overview shows live counters animating in real time. Thirty memories stored, fifteen sub-agent spawns, projected monthly spend — all driven by actual data on disk." },
  { start:  14, text: "The Live Graph view renders a real-time network of your agents and sub-agents, with animated signals pulsing as memory writes and sub-agent spawns happen." },
  { start:  24, text: "The Agents panel shows every supported coding assistant — Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, and more — with one-click connect and disconnect." },
  { start:  32, text: "The Chat with Brain tab lets you ask questions. Shadow Brain semantically retrieves relevant memories and cites them in the answer." },
  { start:  40, text: "The Memory Browser shows every memory across all projects and agents. Search by keyword, agent, category, or minimum importance." },
  { start:  48, text: "The Sub-Agent Brain Bridge generates focused context slivers so spawned sub-agents inherit knowledge instead of starting blind." },
  { start:  57, text: "Causal Memory Chains trace every decision back to its cause. Every AI choice becomes fully auditable and shareable." },
  { start:  65, text: "The Collision Detective catches two agents editing the same region before they conflict. Real-time advisory locks." },
  { start:  72, text: "The Dream Engine runs reflective cycles when agents are idle — revisiting decisions, running counterfactuals, strengthening patterns." },
  { start:  81, text: "The Reputation Ledger stores Ed25519-signed receipts of every agent decision. A portable, tamper-proof trust score." },
  { start:  89, text: "The Swarm Debate protocol spawns pro, con, and arbiter agents to weigh critical choices in parallel." },
  { start:  95, text: "The Pre-Mortem assistant surfaces past failures from your project before you start, ranked by semantic similarity to your task." },
  { start: 102, text: "The Attention Heatmap shows which memories shaped each decision — weighted attribution for full interpretability." },
  { start: 109, text: "The Token Economy tracks cross-agent spend with live charts and projects monthly cost. It surfaces routing opportunities to save money automatically." },
  { start: 118, text: "The Forgetting Curve implements biological memory decay. Important memories strengthen with access; irrelevant ones fade naturally." },
  { start: 126, text: "The Formal Verification Bridge translates plain-language rules into real ESLint and Semgrep configs — your knowledge becomes enforced code." },
  { start: 133, text: "The Calibration Monitor tracks Brier scores per agent per category, so overconfident agents automatically get trust-weighted down." },
  { start: 140, text: "Branch Brains give you per-git-branch memory context. Switch branches, and the relevant memories follow." },
  { start: 146, text: "Privacy and Safety lets you enable air-gap mode with one click. Zero outbound network, encrypted at rest, hallucinations quarantined." },
  { start: 154, text: "Voice Mode processes transcripts with natural language intent parsing. Ask your brain questions by speaking." },
  { start: 160, text: "The Brain Garden renders your memories as a living constellation. Healthy memories bloom; forgotten ones fade." },
  { start: 168, text: "PR Auto-Review generates GitHub comments for every pull request, citing relevant project memories." },
  { start: 175, text: "Team Brain Sync enables peer-to-peer shared memory across your team via WebRTC — no server, no central cloud." },
  { start: 182, text: "Brain Exchange lets you export curated memory packages and share them publicly, so teams can bootstrap expertise instantly." },
  { start: 190, text: "Feature Toggles give you real-time control over every one of the twenty-two v6 modules. Enable or disable any capability from the dashboard." },
  { start: 199, text: "The Models and Intelligence tab routes the brain through Ollama, Anthropic, OpenAI, OpenRouter, Moonshot, Gemini, DeepSeek, or Mistral. Or reuse your existing agent configurations — zero new API keys." },
  { start: 211, text: "Press Command-K anywhere to open the command palette. Search features, navigate, or run actions in milliseconds." },
  { start: 218, text: "Toggle the theme for dark or light mode — preferences persist across sessions." },
  { start: 224, text: "Shadow Brain v6. Free. Open source. Local-first. The Hive Mind for every AI coding agent on your machine." },
];

async function synth(voice, text, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { rate: RATE, volume: VOLUME });
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

function buildConcatList(entries, totalDur) {
  const lines = [];
  let cursor = 0;
  const silenceAbs = path.resolve(TMP_DIR, 'silence.mp3').replace(/\\/g, '/');
  for (const e of entries) {
    const gap = Math.max(0, e.start - cursor);
    if (gap > 0.05) {
      lines.push(`file '${silenceAbs}'`);
      lines.push(`duration ${gap.toFixed(3)}`);
    }
    lines.push(`file '${e.path.replace(/\\/g, '/')}'`);
    cursor = e.start + e.duration;
  }
  const tail = Math.max(0, totalDur - cursor);
  if (tail > 0.05) {
    lines.push(`file '${silenceAbs}'`);
    lines.push(`duration ${tail.toFixed(3)}`);
  }
  return lines.join('\n');
}

async function main() {
  const videoPath = path.join(OUT_DIR, 'shadow-brain-full-tour.mp4');
  if (!fs.existsSync(videoPath)) { console.error('✗ Missing ' + videoPath + ' — run record-full-tour.mjs first.'); process.exit(1); }

  fs.mkdirSync(TMP_DIR, { recursive: true });

  const entries = [];
  for (let i = 0; i < SCRIPT.length; i++) {
    const s = SCRIPT[i];
    const out = path.join(TMP_DIR, `scene-${String(i).padStart(2, '0')}.mp3`);
    console.log(`[TTS ${String(i).padStart(2, '0')}] ${s.text.slice(0, 70)}...`);
    await synth(VOICE, s.text, out);
    const d = probeDuration(out);
    entries.push({ start: s.start, text: s.text, path: out, duration: d });
  }

  const silence = path.join(TMP_DIR, 'silence.mp3');
  spawnSync('ffmpeg', ['-y','-f','lavfi','-i','anullsrc=channel_layout=mono:sample_rate=24000','-t','1','-q:a','9','-acodec','libmp3lame', silence], { stdio: 'inherit' });

  const videoDur = probeDuration(videoPath);
  console.log('[mix] video duration = ' + videoDur.toFixed(1) + 's');

  const listPath = path.join(TMP_DIR, 'list.txt');
  fs.writeFileSync(listPath, buildConcatList(entries, videoDur));

  const narrationPath = path.join(OUT_DIR, 'tour-narration.mp3');
  spawnSync('ffmpeg', ['-y','-f','concat','-safe','0','-i', listPath, '-c:a','libmp3lame','-b:a','128k','-t', String(videoDur), narrationPath], { stdio: 'inherit' });

  const finalPath = path.join(OUT_DIR, 'shadow-brain-full-tour-narrated.mp4');
  spawnSync('ffmpeg', ['-y','-i', videoPath, '-i', narrationPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest', finalPath,
  ], { stdio: 'inherit' });

  const sz = fs.statSync(finalPath);
  console.log('\n=== NARRATED FULL TOUR ===');
  console.log('  ' + finalPath + '  (' + (sz.size/1024/1024).toFixed(2) + ' MB)');
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
