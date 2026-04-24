// tools/build-slideshow-tour.mjs — Reliable slideshow video from existing
// screenshots + Edge TTS narration. Each PNG is held for the duration that
// matches its narration block, so the voice always describes what's on screen.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'launch');
const SHOTS = path.resolve(OUT_DIR, 'screenshots');
const TMP_DIR = path.resolve(OUT_DIR, '_slideshow_tmp');
const SLIDESHOW_MP4 = path.resolve(OUT_DIR, 'shadow-brain-tour-slideshow.mp4');
const NARRATION_MP3 = path.resolve(OUT_DIR, 'slideshow-narration.mp3');
const FINAL_MP4 = path.resolve(OUT_DIR, 'shadow-brain-tour-slideshow-narrated.mp4');

// One scene per tab — text is what the voice will say while that PNG is on screen.
const SCENES = [
  { png: '01-overview.png',         text: "Welcome to Shadow Brain version 6 — the open-source Hive Mind that every AI coding agent on your machine can share. The Overview shows live counters: thirty memories stored, fifteen sub-agent spawns, projected monthly cost — all from real data on disk." },
  { png: '02-graph.png',            text: "The Live Graph view renders a real-time network of your agents and sub-agents. Animated signal particles pulse along edges as the brain processes memory writes, sub-agent spawns, and collisions." },
  { png: '03-agents.png',           text: "The Agents panel shows every supported coding assistant — Claude Code, Cursor, Cline, Codex, Copilot, Windsurf, Kilo, Roo, OpenCode, and Aider — with one-click connect and disconnect for each one." },
  { png: '04-chat.png',             text: "Chat with Your Brain lets you ask questions in natural language. Shadow Brain semantically retrieves relevant memories from the global store and cites them in the answer." },
  { png: '05-memory.png',           text: "The Memory Browser shows every memory across all projects and agents. Filter by keyword, agent, category, or minimum importance to find any past decision instantly." },
  { png: '06-activity.png',         text: "The Activity Log streams every event in real time — memory writes, sub-agent spawns, collisions, dreams, quarantine, and firewall blocks — filterable by type." },
  { png: '07-sabb.png',             text: "The Sub-Agent Brain Bridge generates focused context slivers so spawned sub-agents inherit knowledge instead of starting blind. Quarantined memories appear here for review and graduation." },
  { png: '08-causal.png',           text: "Causal Memory Chains let you trace any decision back to every cause that influenced it. Generate Graphviz exports of the full causal DAG for any memory." },
  { png: '09-collision.png',        text: "The Collision Detective catches two agents about to edit the same file region in real time. Active intents are listed below; alerts include a suggested resolution." },
  { png: '10-dream.png',            text: "The Dream Engine runs reflective cycles when agents are idle — revisiting decisions, running counterfactuals, strengthening patterns. The chart shows the distribution of dream types." },
  { png: '11-reputation.png',       text: "The Reputation Ledger stores Ed25519-signed receipts of every agent decision. The leaderboard ranks agents by accuracy. Generate shareable badges for your README." },
  { png: '12-debate.png',           text: "Swarm Debate spawns pro, con, and arbiter agents to weigh critical decisions. Run a debate by entering a question and context — see the full transcript with the winning verdict." },
  { png: '13-premortem.png',        text: "The Pre-Mortem Assistant surfaces past failures from your project before you start a task — ranked by semantic similarity, with severity, probability, and mitigation for each risk." },
  { png: '14-branch.png',           text: "Branch Brains show git-branch-aware memory context. Switch branches, and only the relevant memories follow." },
  { png: '15-forget.png',           text: "The Forgetting Curve implements biological memory decay. Important memories strengthen with access; irrelevant ones fade. Run a sleep consolidation cycle to promote validated patterns." },
  { png: '16-attention.png',        text: "The Attention Heatmap shows weighted attribution — exactly which memories shaped a given AI decision. Full mechanistic interpretability for every output." },
  { png: '17-calibration.png',      text: "The Calibration Monitor tracks Brier scores per agent per category. Overconfident agents get trust-weighted down automatically, so their claims are discounted." },
  { png: '18-formal.png',           text: "The Formal Verification Bridge translates plain-language rules into real ESLint and Semgrep configs. Your knowledge becomes enforced code that catches violations at lint time." },
  { png: '19-tokens.png',           text: "The Token Economy tracks cross-agent spend with live charts. It projects monthly cost and surfaces routing opportunities to save money — automatic optimization without changing your workflow." },
  { png: '20-privacy.png',          text: "Privacy and Safety lets you toggle air-gap mode with one click — zero outbound network. Hallucinations are quarantined for review, and the brain is encrypted at rest with ChaCha20." },
  { png: '21-voice.png',            text: "Voice Mode processes transcripts with natural language intent parsing. Ask your brain questions by speaking instead of typing." },
  { png: '22-garden.png',           text: "The Brain Garden renders your memories as a living constellation. Healthy memories bloom bright; forgotten ones fade. A new way to feel the shape of your project's collective knowledge." },
  { png: '23-pr.png',               text: "PR Auto-Review generates GitHub pull request comments that cite relevant project memories — so reviewers see the context behind every change." },
  { png: '24-team.png',             text: "Team Brain Sync enables peer-to-peer shared memory across your team via WebRTC. No server, no central cloud, no subscription — pure peer-to-peer collaboration." },
  { png: '25-exchange.png',         text: "Brain Exchange lets you export curated memory packages and share them publicly. Other teams can install your brain slice with one command — bootstrap expertise instantly." },
  { png: '26-features.png',         text: "Feature Toggles give you real-time control over every one of the twenty-two version 6 modules. Enable or disable any capability live from the dashboard." },
  { png: '27-models.png',           text: "Models and Intelligence routes the brain through Ollama, Anthropic, OpenAI, OpenRouter, Moonshot, Gemini, DeepSeek, or Mistral. Or reuse your existing agent configurations — zero new API keys needed." },
  { png: '28-config.png',           text: "Configuration manages your LLM provider, API keys, and the MCP server. Save once and Shadow Brain remembers across restarts." },
  { png: '29-command-palette.png',  text: "Press Command-K anywhere to open the palette and search every feature, every action, every memory in milliseconds. Shadow Brain version 6. Free. Open source. Local-first. The Hive Mind for every AI coding agent on your machine." },
];

const VOICE = 'en-US-AndrewNeural';
const RATE = '+2%';

async function synth(voice, text, outPath) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { rate: RATE });
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
  console.log('→ ' + cmd + ' ' + args.slice(0, 8).join(' ') + (args.length > 8 ? ' ...' : ''));
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  console.log('=== Step 1: synthesize TTS for each scene ===');
  const scenes = [];
  for (let i = 0; i < SCENES.length; i++) {
    const s = SCENES[i];
    const pngPath = path.join(SHOTS, s.png);
    if (!fs.existsSync(pngPath)) { console.warn('  ! missing ' + s.png + ' — skip'); continue; }
    const mp3 = path.join(TMP_DIR, `scene-${String(i).padStart(2,'0')}.mp3`);
    console.log(`[TTS ${String(i).padStart(2,'0')}] ${s.text.slice(0, 60)}...`);
    await synth(VOICE, s.text, mp3);
    const audioDur = probeDuration(mp3);
    // Hold each frame for narration duration + 0.6s tail breathing room
    const holdSec = Math.max(4, audioDur + 0.6);
    scenes.push({ png: pngPath, mp3, audioDur, holdSec });
  }

  console.log('\n=== Step 2: build per-scene MP4 (image + audio) ===');
  // Each scene becomes its own h264 video clip with embedded audio matching its duration
  const sceneClips = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const clip = path.join(TMP_DIR, `clip-${String(i).padStart(2,'0')}.mp4`);
    run('ffmpeg', [
      '-y',
      '-loop', '1', '-i', s.png,
      '-i', s.mp3,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p,fps=30',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '160k',
      '-t', String(s.holdSec),
      '-shortest',
      clip,
    ]);
    sceneClips.push(clip);
  }

  console.log('\n=== Step 3: concat all scene clips ===');
  const concatList = path.join(TMP_DIR, 'concat.txt');
  fs.writeFileSync(concatList, sceneClips.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', FINAL_MP4]);

  console.log('\n=== Step 4: also produce silent slideshow (no narration) ===');
  const silentClips = sceneClips.map((c, i) => {
    const out = path.join(TMP_DIR, `silent-${String(i).padStart(2,'0')}.mp4`);
    spawnSync('ffmpeg', ['-y','-i', c, '-an', '-c:v', 'copy', out], { stdio: 'ignore' });
    return out;
  });
  const silentList = path.join(TMP_DIR, 'silent-concat.txt');
  fs.writeFileSync(silentList, silentClips.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', silentList, '-c', 'copy', SLIDESHOW_MP4]);

  console.log('\n=== Step 5: produce standalone narration MP3 ===');
  const audioList = path.join(TMP_DIR, 'audio-concat.txt');
  fs.writeFileSync(audioList, scenes.map(s => `file '${s.mp3.replace(/\\/g, '/')}'`).join('\n'));
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', audioList, '-c', 'copy', NARRATION_MP3]);

  const fSize = fs.statSync(FINAL_MP4).size;
  const sSize = fs.statSync(SLIDESHOW_MP4).size;
  const aSize = fs.statSync(NARRATION_MP3).size;
  console.log('\n=== SLIDESHOW TOUR COMPLETE ===');
  console.log(`  Narrated MP4: ${FINAL_MP4}  (${(fSize/1024/1024).toFixed(2)} MB)`);
  console.log(`  Silent MP4:   ${SLIDESHOW_MP4}  (${(sSize/1024/1024).toFixed(2)} MB)`);
  console.log(`  Narration:    ${NARRATION_MP3}  (${(aSize/1024/1024).toFixed(2)} MB)`);

  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
