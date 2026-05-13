// src/brain/brain-sonification.ts — Brain Sonification (viral feature)
// v6.0.2
//
// Turns brain events into music. Each event type gets a different timbre
// (memory.write = sine "piano", agent.collision = sawtooth, decision.recorded =
// bell). Pitch derives from a deterministic SHA-1 hash of the entity ID so the
// same brain always sounds the same. Modes (major/minor/phrygian) bias the
// scale degrees for mood.
//
// Storage:
//   ~/.shadow-brain/sonification/<project_hash>-<timestamp>.wav
//
// Zero new npm deps — synthesizes waveforms into a Float32 buffer, mixes,
// normalizes, then writes a 16-bit PCM RIFF/WAVE file from scratch.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BrainReplay, getBrainReplay, ReplayEvent } from './brain-replay.js';

const SONIFY_DIR = path.join(os.homedir(), '.shadow-brain', 'sonification');
const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const DEFAULT_DURATION_S = 60;
const DEFAULT_TEMPO = 96;
const EMPTY_DURATION_S = 10;

// ── Types ────────────────────────────────────────────────────────────────────

export type SonifyMode = 'major' | 'minor' | 'phrygian';
export type Timbre = 'sine' | 'saw' | 'triangle' | 'square' | 'bell';

export interface SonifyOptions {
  durationS?: number;
  tempo?: number;
  mode?: SonifyMode;
}

export interface SonifyManifest {
  durationMs: number;
  eventsRendered: number;
  tempo: number;
  mode: SonifyMode;
  sampleRate: number;
  channels: number;
  totalSamples: number;
}

export interface Note {
  freq: number;
  dur: number;
  timbre: Timbre;
}

interface VoiceDef {
  eventType: string;
  timbre: Timbre;
  baseFreq: number;
}

// ── Voice mapping (event-type → instrument profile) ─────────────────────────

const VOICE_TABLE: VoiceDef[] = [
  { eventType: 'memory.write',        timbre: 'sine',     baseFreq: 261.63 }, // C4 — piano
  { eventType: 'brain.remember',      timbre: 'sine',     baseFreq: 261.63 },
  { eventType: 'memory.decay',        timbre: 'triangle', baseFreq: 130.81 }, // C3 — soft
  { eventType: 'forget',              timbre: 'triangle', baseFreq: 110.00 },
  { eventType: 'agent.collision',     timbre: 'saw',      baseFreq: 220.00 }, // A3 — gritty
  { eventType: 'collision',           timbre: 'saw',      baseFreq: 220.00 },
  { eventType: 'agent.handoff',       timbre: 'square',   baseFreq: 329.63 }, // E4
  { eventType: 'decision.recorded',   timbre: 'bell',     baseFreq: 523.25 }, // C5
  { eventType: 'decision',            timbre: 'bell',     baseFreq: 523.25 },
  { eventType: 'adr.created',         timbre: 'bell',     baseFreq: 587.33 }, // D5
  { eventType: 'hallucination',       timbre: 'square',   baseFreq: 196.00 }, // G3 — uneasy
  { eventType: 'quarantine',          timbre: 'square',   baseFreq: 174.61 },
  { eventType: 'cache.hit',           timbre: 'sine',     baseFreq: 783.99 }, // G5 — chime
  { eventType: 'cache.miss',          timbre: 'triangle', baseFreq: 392.00 }, // G4
];

// Scale-degree intervals (semitones from root) per mode
const SCALES: Record<SonifyMode, number[]> = {
  major:    [0, 2, 4, 5, 7, 9, 11],
  minor:    [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// ── Class ────────────────────────────────────────────────────────────────────

export class BrainSonification {
  private replay: BrainReplay;

  constructor(replay?: BrainReplay) {
    this.replay = replay ?? getBrainReplay();
    try { fs.mkdirSync(SONIFY_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  /** Generate a WAV buffer from a project's replay events. */
  async generate(project: string, opts: SonifyOptions = {}): Promise<{ wav: Buffer; manifest: SonifyManifest }> {
    const durationS = Math.max(1, opts.durationS ?? DEFAULT_DURATION_S);
    const tempo = Math.max(30, opts.tempo ?? DEFAULT_TEMPO);
    const mode: SonifyMode = opts.mode ?? 'phrygian';

    let events: ReplayEvent[] = [];
    try { events = this.replay.listEvents(project); } catch { /* empty */ }

    if (!events.length) {
      return this.renderEmptyWav(mode, tempo);
    }

    const totalSamples = Math.floor(durationS * SAMPLE_RATE);
    const buffer = new Float32Array(totalSamples);

    // Map each event to a time slot in [0, durationS)
    const t0 = events[0].ts;
    const t1 = events[events.length - 1].ts;
    const span = Math.max(1, t1 - t0);

    // Note duration governed by tempo (sixteenth notes feel rhythmic)
    const noteSeconds = Math.max(0.05, Math.min(0.6, (60 / tempo) / 4));
    const noteSamples = Math.floor(noteSeconds * SAMPLE_RATE);

    for (const ev of events) {
      const note = this.eventToNote(ev, mode);
      const startSec = ((ev.ts - t0) / span) * (durationS - noteSeconds);
      const startSample = Math.floor(startSec * SAMPLE_RATE);
      this.mixNote(buffer, startSample, noteSamples, note.freq, note.timbre, 0.18);
    }

    // Add a quiet drone pad as bass for cohesion
    this.mixDrone(buffer, this.rootFreqFor(mode), durationS, 0.04);

    // Normalize to prevent clipping
    this.normalize(buffer, 0.92);

    const wav = this.encodeWav(buffer);
    this.persist(project, wav);

    const manifest: SonifyManifest = {
      durationMs: durationS * 1000,
      eventsRendered: events.length,
      tempo,
      mode,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      totalSamples,
    };
    return { wav, manifest };
  }

  /** Convert a single event to a note (public for tooling). */
  eventToNote(event: { type: string; payload?: unknown; ts?: number; agent?: string; project?: string } | ReplayEvent, mode: SonifyMode = 'phrygian'): Note {
    const voice = this.voiceFor(event.type);
    const key = this.entityKeyOf(event as ReplayEvent) ?? event.type;
    const hash = crypto.createHash('sha1').update(key).digest();
    const scale = SCALES[mode];
    const degree = scale[hash[0] % scale.length];
    const octaveShift = (hash[1] % 3) - 1; // -1, 0, +1
    const semis = degree + octaveShift * 12;
    const freq = voice.baseFreq * Math.pow(2, semis / 12);
    const dur = 0.08 + ((hash[2] % 8) / 8) * 0.12; // 0.08–0.20s
    return { freq, dur, timbre: voice.timbre };
  }

  /** Available voice mappings (public for tooling/UI). */
  listVoices(): Array<{ eventType: string; timbre: string; baseFreq: number }> {
    return VOICE_TABLE.map(v => ({ eventType: v.eventType, timbre: v.timbre, baseFreq: v.baseFreq }));
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private voiceFor(eventType: string): VoiceDef {
    const exact = VOICE_TABLE.find(v => v.eventType === eventType);
    if (exact) return exact;
    // Fuzzy match by substring
    for (const v of VOICE_TABLE) {
      if (eventType.includes(v.eventType) || v.eventType.includes(eventType)) return v;
    }
    // Default voice for unknown events
    return { eventType, timbre: 'sine', baseFreq: 293.66 }; // D4
  }

  private entityKeyOf(ev: ReplayEvent): string | null {
    const p = ev.payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== 'object') return null;
    return (p.entity as string) || (p.id as string) || (p.name as string) || null;
  }

  private rootFreqFor(mode: SonifyMode): number {
    if (mode === 'major') return 130.81; // C3
    if (mode === 'minor') return 110.00; // A2
    return 87.31;                        // F2 — dark phrygian root
  }

  private mixNote(buffer: Float32Array, start: number, samples: number, freq: number, timbre: Timbre, amp: number): void {
    if (start >= buffer.length) return;
    const end = Math.min(buffer.length, start + samples);
    const phaseInc = (2 * Math.PI * freq) / SAMPLE_RATE;
    const attackSamples = Math.floor(samples * 0.05);
    const releaseSamples = Math.floor(samples * 0.4);
    let phase = 0;

    for (let i = start; i < end; i++) {
      const idx = i - start;
      let sample = 0;
      if (timbre === 'sine') {
        sample = Math.sin(phase);
      } else if (timbre === 'saw') {
        // band-limited-ish sawtooth via phase fraction
        const t = (phase / (2 * Math.PI)) % 1;
        sample = 2 * t - 1;
      } else if (timbre === 'triangle') {
        const t = (phase / (2 * Math.PI)) % 1;
        sample = 4 * Math.abs(t - 0.5) - 1;
      } else if (timbre === 'square') {
        sample = Math.sin(phase) >= 0 ? 0.8 : -0.8;
      } else if (timbre === 'bell') {
        // FM-style bell — carrier + 2 partials with decay
        const decay = Math.exp(-idx / (SAMPLE_RATE * 0.4));
        sample = (Math.sin(phase) + 0.5 * Math.sin(phase * 2.76) + 0.25 * Math.sin(phase * 5.4)) * decay;
      }
      // ADSR-lite envelope
      let env = 1;
      if (idx < attackSamples) env = idx / attackSamples;
      else if (idx > samples - releaseSamples) env = Math.max(0, (samples - idx) / releaseSamples);
      buffer[i] += sample * amp * env;
      phase += phaseInc;
    }
  }

  private mixDrone(buffer: Float32Array, freq: number, durationS: number, amp: number): void {
    const totalSamples = Math.min(buffer.length, Math.floor(durationS * SAMPLE_RATE));
    const phaseInc = (2 * Math.PI * freq) / SAMPLE_RATE;
    const fadeSamples = Math.floor(SAMPLE_RATE * 1.5);
    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      let env = 1;
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > totalSamples - fadeSamples) env = Math.max(0, (totalSamples - i) / fadeSamples);
      // Soft drone: detuned sines stacked
      const s = Math.sin(phase) * 0.6 + Math.sin(phase * 1.004) * 0.4;
      buffer[i] += s * amp * env;
      phase += phaseInc;
    }
  }

  private normalize(buffer: Float32Array, target: number): void {
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const a = Math.abs(buffer[i]);
      if (a > peak) peak = a;
    }
    if (peak <= 0) return;
    const scale = target / peak;
    if (scale >= 1) return;
    for (let i = 0; i < buffer.length; i++) buffer[i] *= scale;
  }

  private encodeWav(samples: Float32Array): Buffer {
    const dataBytes = samples.length * (BITS_PER_SAMPLE / 8);
    const totalSize = 44 + dataBytes;
    const buf = Buffer.alloc(totalSize);

    // RIFF header
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8, 'ascii');

    // fmt sub-chunk
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);                                   // sub-chunk size
    buf.writeUInt16LE(1, 20);                                    // PCM format
    buf.writeUInt16LE(CHANNELS, 22);
    buf.writeUInt32LE(SAMPLE_RATE, 24);
    buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28); // byte rate
    buf.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);     // block align
    buf.writeUInt16LE(BITS_PER_SAMPLE, 34);

    // data sub-chunk
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataBytes, 40);

    // 16-bit PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      const intSample = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
      buf.writeInt16LE(intSample, offset);
      offset += 2;
    }
    return buf;
  }

  private renderEmptyWav(mode: SonifyMode, tempo: number): { wav: Buffer; manifest: SonifyManifest } {
    const totalSamples = EMPTY_DURATION_S * SAMPLE_RATE;
    const buffer = new Float32Array(totalSamples);
    // A single soft tone at the root, fading in and out, as "your brain is brand new"
    this.mixDrone(buffer, this.rootFreqFor(mode), EMPTY_DURATION_S, 0.08);
    const wav = this.encodeWav(buffer);
    return {
      wav,
      manifest: {
        durationMs: EMPTY_DURATION_S * 1000,
        eventsRendered: 0,
        tempo,
        mode,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        totalSamples,
      },
    };
  }

  private persist(project: string, wav: Buffer): void {
    try {
      const ts = Date.now();
      const id = crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
      const file = path.join(SONIFY_DIR, id + '-' + ts + '.wav');
      fs.writeFileSync(file, wav);
    } catch { /* persistence non-fatal */ }
  }
}

let _instance: BrainSonification | null = null;
export function getBrainSonification(): BrainSonification {
  if (!_instance) _instance = new BrainSonification();
  return _instance;
}
export function resetBrainSonificationForTests(): void { _instance = null; }
