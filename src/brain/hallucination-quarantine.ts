// src/brain/hallucination-quarantine.ts — Suspect memory isolation
// v6.0.0 — Hive Mind Edition
//
// When Shadow Brain's adversarial defense flags a claim as potentially
// hallucinated, it goes here instead of the global brain. You can review,
// promote, or delete. Auto-deletes after 7 days by default.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { QuarantineEntry } from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const QUARANTINE_PATH = path.join(os.homedir(), '.shadow-brain', 'hallucination-quarantine.json');
const AUTO_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PersistShape {
  schemaVersion: 1;
  entries: QuarantineEntry[];
}

export class HallucinationQuarantine {
  private entries: Map<string, QuarantineEntry> = new Map();
  private brain: GlobalBrain;
  private initialized = false;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(QUARANTINE_PATH), { recursive: true });
    if (fs.existsSync(QUARANTINE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf-8')) as PersistShape;
        for (const e of parsed.entries ?? []) {
          this.entries.set(e.id, { ...e, quarantinedAt: new Date(e.quarantinedAt) });
        }
      } catch {
        /* skip */
      }
    }
    this.autoExpire();
    this.initialized = true;
  }

  async flag(source: string, claim: string, reasonFlagged: string, evidence: string[] = []): Promise<QuarantineEntry> {
    await this.init();
    const entry: QuarantineEntry = {
      id: `hq-${crypto.randomBytes(6).toString('hex')}`,
      source,
      claim: claim.slice(0, 800),
      evidence,
      reasonFlagged,
      quarantinedAt: new Date(),
      decision: 'pending',
    };
    this.entries.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  async promote(entryId: string, projectId: string, agentTool: string): Promise<boolean> {
    await this.init();
    const entry = this.entries.get(entryId);
    if (!entry) return false;
    await this.brain.init();
    this.brain.writeSync({
      projectId,
      projectName: 'promoted-quarantine',
      agentTool: agentTool as any,
      category: 'promoted-from-quarantine',
      content: entry.claim,
      importance: 0.6,
      metadata: { origin: 'quarantine-promoted', quarantineId: entryId, evidence: entry.evidence },
    });
    entry.decision = 'promoted';
    await this.persist();
    return true;
  }

  async reject(entryId: string): Promise<boolean> {
    await this.init();
    const entry = this.entries.get(entryId);
    if (!entry) return false;
    entry.decision = 'deleted';
    await this.persist();
    return true;
  }

  list(opts: { pendingOnly?: boolean; limit?: number } = {}): QuarantineEntry[] {
    this.autoExpire();
    const all = Array.from(this.entries.values())
      .filter(e => !opts.pendingOnly || e.decision === 'pending')
      .sort((a, b) => b.quarantinedAt.getTime() - a.quarantinedAt.getTime());
    return all.slice(0, opts.limit ?? 50);
  }

  stats(): { pending: number; promoted: number; deleted: number; total: number } {
    let pending = 0;
    let promoted = 0;
    let deleted = 0;
    for (const e of this.entries.values()) {
      if (e.decision === 'pending') pending++;
      else if (e.decision === 'promoted') promoted++;
      else deleted++;
    }
    return { pending, promoted, deleted, total: this.entries.size };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private autoExpire(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.decision === 'pending' && now - entry.quarantinedAt.getTime() > AUTO_DELETE_AFTER_MS) {
        entry.decision = 'deleted';
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        entries: Array.from(this.entries.values()),
      };
      const tmp = QUARANTINE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, QUARANTINE_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: HallucinationQuarantine | null = null;

export function getHallucinationQuarantine(): HallucinationQuarantine {
  if (!_instance) _instance = new HallucinationQuarantine();
  return _instance;
}

export function resetHallucinationQuarantineForTests(): void {
  _instance = null;
}
