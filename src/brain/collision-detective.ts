// src/brain/collision-detective.ts — Agent Collision Detective
// v6.0.0 — Hive Mind Edition
//
// Real-time (not post-hoc git) detection of two+ agents about to edit the same
// file region. Agents declare their edit INTENT before touching the file, the
// detective maintains active intents, and any overlapping intent produces a
// CollisionAlert with a suggested resolution.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  AgentEditIntent,
  CollisionAlert,
  CollisionStats,
  AgentTool,
} from '../types.js';

const INTENTS_PATH = path.join(os.homedir(), '.shadow-brain', 'collision-intents.json');
const DEFAULT_INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PersistShape {
  schemaVersion: 1;
  intents: AgentEditIntent[];
  alerts: CollisionAlert[];
  stats: CollisionStats;
}

function emptyStats(): CollisionStats {
  return {
    totalIntents: 0,
    activeIntents: 0,
    collisionsDetected: 0,
    collisionsResolved: 0,
    collisionsByAgent: {},
    avgOverlapLines: 0,
  };
}

export class CollisionDetective {
  private intents: Map<string, AgentEditIntent> = new Map();
  private alerts: Map<string, CollisionAlert> = new Map();
  private stats: CollisionStats = emptyStats();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(INTENTS_PATH), { recursive: true });

    if (fs.existsSync(INTENTS_PATH)) {
      try {
        const raw = fs.readFileSync(INTENTS_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PersistShape;
        for (const intent of parsed.intents ?? []) {
          const r: AgentEditIntent = {
            ...intent,
            declaredAt: new Date(intent.declaredAt),
            expiresAt: new Date(intent.expiresAt),
          };
          if (r.expiresAt.getTime() > Date.now()) {
            this.intents.set(this.keyForIntent(r), r);
          }
        }
        for (const alert of parsed.alerts ?? []) {
          this.alerts.set(alert.id, {
            ...alert,
            detectedAt: new Date(alert.detectedAt),
            conflictingIntents: alert.conflictingIntents.map(i => ({
              ...i,
              declaredAt: new Date(i.declaredAt),
              expiresAt: new Date(i.expiresAt),
            })),
          });
        }
        if (parsed.stats) this.stats = { ...emptyStats(), ...parsed.stats };
      } catch {
        /* corrupt — start fresh */
      }
    }
    this.initialized = true;
  }

  /** Agent declares intent to edit a file range. Returns immediate collision alert if any. */
  async declareIntent(
    agentTool: AgentTool,
    sessionId: string,
    filePath: string,
    startLine: number,
    endLine: number,
    intent: string,
    ttlMs: number = DEFAULT_INTENT_TTL_MS,
  ): Promise<{ intent: AgentEditIntent; collision: CollisionAlert | null }> {
    await this.init();
    this.evictExpired();

    const abs = path.resolve(filePath);
    const declaration: AgentEditIntent = {
      agentTool,
      sessionId,
      filePath: abs,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
      intent,
      declaredAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    };

    const key = this.keyForIntent(declaration);
    this.intents.set(key, declaration);
    this.stats.totalIntents++;
    this.stats.activeIntents = this.intents.size;
    this.stats.collisionsByAgent[agentTool] = this.stats.collisionsByAgent[agentTool] ?? 0;

    const collision = this.detectForIntent(declaration);
    if (collision) {
      this.alerts.set(collision.id, collision);
      this.stats.collisionsDetected++;
      for (const conflict of collision.conflictingIntents) {
        this.stats.collisionsByAgent[conflict.agentTool] = (this.stats.collisionsByAgent[conflict.agentTool] ?? 0) + 1;
      }
      const overlapSize = collision.overlapEndLine - collision.overlapStartLine + 1;
      const n = this.stats.collisionsDetected;
      this.stats.avgOverlapLines = this.stats.avgOverlapLines + (overlapSize - this.stats.avgOverlapLines) / n;
    }

    await this.persist();
    return { intent: declaration, collision };
  }

  /** Release an intent — agent finished or cancelled. */
  async releaseIntent(agentTool: AgentTool, sessionId: string, filePath: string): Promise<number> {
    await this.init();
    const abs = path.resolve(filePath);
    let removed = 0;
    for (const [key, intent] of this.intents) {
      if (intent.agentTool === agentTool && intent.sessionId === sessionId && intent.filePath === abs) {
        this.intents.delete(key);
        removed++;
      }
    }
    if (removed) {
      this.stats.activeIntents = this.intents.size;
      await this.persist();
    }
    return removed;
  }

  /** Mark a collision as resolved (by reassignment, merge, or user action). */
  async resolveCollision(alertId: string, resolution: string): Promise<boolean> {
    await this.init();
    const alert = this.alerts.get(alertId);
    if (!alert) return false;
    alert.suggestedResolution = resolution;
    this.stats.collisionsResolved++;
    this.alerts.delete(alertId);
    await this.persist();
    return true;
  }

  /** All active (unresolved) alerts. */
  activeAlerts(): CollisionAlert[] {
    return Array.from(this.alerts.values()).sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  /** Current stats snapshot. */
  getStats(): CollisionStats {
    this.evictExpired();
    this.stats.activeIntents = this.intents.size;
    return JSON.parse(JSON.stringify(this.stats));
  }

  /** List active intents (for dashboards / debugging). */
  activeIntents(): AgentEditIntent[] {
    this.evictExpired();
    return Array.from(this.intents.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private detectForIntent(newIntent: AgentEditIntent): CollisionAlert | null {
    const conflicts: AgentEditIntent[] = [];
    let overlapStart = newIntent.startLine;
    let overlapEnd = newIntent.endLine;

    for (const existing of this.intents.values()) {
      if (this.sameSession(existing, newIntent)) continue;
      if (existing.filePath !== newIntent.filePath) continue;

      const intersectStart = Math.max(existing.startLine, newIntent.startLine);
      const intersectEnd = Math.min(existing.endLine, newIntent.endLine);
      if (intersectStart <= intersectEnd) {
        conflicts.push(existing);
        overlapStart = Math.max(overlapStart, intersectStart);
        overlapEnd = Math.min(overlapEnd, intersectEnd);
      }
    }

    if (!conflicts.length) return null;

    const severity: CollisionAlert['severity'] =
      conflicts.length >= 2 ? 'critical'
      : (overlapEnd - overlapStart + 1) >= 20 ? 'warning'
      : 'info';

    const suggestedResolution = this.buildResolutionSuggestion(newIntent, conflicts);

    return {
      id: `col-${crypto.randomBytes(6).toString('hex')}`,
      filePath: newIntent.filePath,
      conflictingIntents: [newIntent, ...conflicts],
      overlapStartLine: overlapStart,
      overlapEndLine: overlapEnd,
      severity,
      suggestedResolution,
      detectedAt: new Date(),
    };
  }

  private buildResolutionSuggestion(newIntent: AgentEditIntent, conflicts: AgentEditIntent[]): string {
    const others = conflicts.map(c => `${c.agentTool} (${c.intent})`).join(', ');
    const newer = newIntent;
    const agents = [...new Set([newer.agentTool, ...conflicts.map(c => c.agentTool)])].join(', ');
    return [
      `${agents} have overlapping edit intents on ${path.basename(newer.filePath)} lines ${newer.startLine}-${newer.endLine}.`,
      `Incoming: ${newer.agentTool} — ${newer.intent}`,
      `Existing: ${others}`,
      `Suggested: the newer intent waits 60s, re-plans around the in-flight edit, or spawns a merge-arbiter sub-agent.`,
    ].join(' ');
  }

  private keyForIntent(intent: AgentEditIntent): string {
    return `${intent.filePath}::${intent.agentTool}::${intent.sessionId}::${intent.startLine}-${intent.endLine}`;
  }

  private sameSession(a: AgentEditIntent, b: AgentEditIntent): boolean {
    return a.agentTool === b.agentTool && a.sessionId === b.sessionId;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, intent] of this.intents) {
      if (intent.expiresAt.getTime() <= now) this.intents.delete(key);
    }
    this.stats.activeIntents = this.intents.size;
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        intents: Array.from(this.intents.values()),
        alerts: Array.from(this.alerts.values()),
        stats: this.stats,
      };
      const tmp = INTENTS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, INTENTS_PATH);
    } catch {
      /* persistence non-fatal */
    }
  }
}

let _instance: CollisionDetective | null = null;

export function getCollisionDetective(): CollisionDetective {
  if (!_instance) _instance = new CollisionDetective();
  return _instance;
}

export function resetCollisionDetectiveForTests(): void {
  _instance = null;
}
