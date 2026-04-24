// src/brain/voice-mode.ts — Voice command entry point
// v6.0.0 — Hive Mind Edition
//
// Minimal voice integration surface — the CLI and dashboard accept transcribed
// text and route through the intent engine. Actual audio capture lives in the
// companion browser bundle (dashboard) or external tools like macOS Dictation.
// This module provides:
//   - Intent parsing for voice commands
//   - Structured response formatting (ready for TTS)
//   - Persisted command history for dashboard

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VoiceCommandResult } from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const HISTORY_PATH = path.join(os.homedir(), '.shadow-brain', 'voice-history.jsonl');

export interface VoiceProcessInput {
  transcript: string;
  confidence?: number;
  projectDir?: string;
}

export class VoiceMode {
  private brain: GlobalBrain;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async process(input: VoiceProcessInput): Promise<VoiceCommandResult> {
    await this.brain.init();
    const transcript = input.transcript.trim();
    const lower = transcript.toLowerCase();

    let intent = 'unknown';
    let response = '';

    if (/summariz(e|ed).*yesterday|recap yesterday|what did .+ learn yesterday/.test(lower)) {
      intent = 'recap-yesterday';
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      const events = this.brain
        .timeline({ limit: 50 })
        .filter(e => e.createdAt.getTime() >= yesterday);
      response = events.length
        ? `Yesterday: ${events.length} memory events. Top category: ${events[0].category}. First: ${events[0].content.slice(0, 140)}`
        : 'No brain activity from yesterday.';
    } else if (/show.*dreams?|what.*dream/.test(lower)) {
      intent = 'show-dreams';
      response = 'Listing recent dream insights via shadow-brain dream list.';
    } else if (/brain status|hive mind status|how.*brain/.test(lower)) {
      intent = 'status';
      const stats = this.brain.getStats();
      response = `Hive Mind v6.0: ${stats.totalEntries} memories across ${stats.totalProjects} projects and ${stats.totalAgents} agents. Hit rate ${Math.round(stats.hitRate * 100)}%.`;
    } else if (/stop watching|pause brain|quiet mode/.test(lower)) {
      intent = 'pause';
      response = 'Pausing Shadow Brain is not supported from voice in this build. Use: shadow-brain off.';
    } else if (/dash(board)?/.test(lower)) {
      intent = 'open-dashboard';
      response = 'The dashboard is at http://localhost:7341 when running.';
    } else {
      response = `I heard "${transcript.slice(0, 120)}". Try: "brain status", "recap yesterday", or "show dreams".`;
    }

    const result: VoiceCommandResult = {
      transcript,
      confidence: input.confidence ?? 0.9,
      intent,
      response,
      timestamp: new Date(),
    };

    try {
      fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
      fs.appendFileSync(HISTORY_PATH, JSON.stringify(result) + '\n');
    } catch {
      /* non-fatal */
    }
    return result;
  }

  history(limit = 20): VoiceCommandResult[] {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    try {
      const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
      const lines = raw.split('\n').filter(Boolean).slice(-limit);
      return lines.map(l => {
        const p = JSON.parse(l);
        return { ...p, timestamp: new Date(p.timestamp) };
      });
    } catch {
      return [];
    }
  }
}

let _instance: VoiceMode | null = null;

export function getVoiceMode(): VoiceMode {
  if (!_instance) _instance = new VoiceMode();
  return _instance;
}

export function resetVoiceModeForTests(): void {
  _instance = null;
}
