// src/brain/air-gap.ts — Air-Gap Mode
// v6.0.0 — Hive Mind Edition
//
// Opt-in strict mode: block all outbound network from Shadow Brain. Only
// localhost targets (Ollama, dashboard) are allowed. Enterprise/government
// friendly — "the brain never leaves this machine."

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AirGapStatus } from '../types.js';

const STATUS_PATH = path.join(os.homedir(), '.shadow-brain', 'air-gap.json');

interface PersistShape {
  schemaVersion: 1;
  enabled: boolean;
  policy: 'strict' | 'loose';
  blockedOutboundCount: number;
  allowedLocalCount: number;
  lastAttempt: string | null;
}

export class AirGapMode {
  private enabled = false;
  private policy: 'strict' | 'loose' = 'strict';
  private blockedOutbound = 0;
  private allowedLocal = 0;
  private lastAttempt: Date | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    if (fs.existsSync(STATUS_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')) as PersistShape;
        this.enabled = parsed.enabled ?? false;
        this.policy = parsed.policy ?? 'strict';
        this.blockedOutbound = parsed.blockedOutboundCount ?? 0;
        this.allowedLocal = parsed.allowedLocalCount ?? 0;
        this.lastAttempt = parsed.lastAttempt ? new Date(parsed.lastAttempt) : null;
      } catch {
        /* skip */
      }
    }
    if (this.enabled) process.env.SHADOW_BRAIN_AIR_GAP = '1';
    this.initialized = true;
  }

  async enable(policy: 'strict' | 'loose' = 'strict'): Promise<void> {
    await this.init();
    this.enabled = true;
    this.policy = policy;
    process.env.SHADOW_BRAIN_AIR_GAP = '1';
    await this.persist();
  }

  async disable(): Promise<void> {
    await this.init();
    this.enabled = false;
    delete process.env.SHADOW_BRAIN_AIR_GAP;
    await this.persist();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if a URL is allowed. Call this before any fetch/http from Shadow Brain.
   * Returns false if air-gap is on and the URL is not localhost.
   */
  async gate(url: string): Promise<boolean> {
    await this.init();
    this.lastAttempt = new Date();
    if (!this.enabled) {
      this.allowedLocal++;
      await this.persist();
      return true;
    }
    try {
      const u = new URL(url);
      const host = u.hostname;
      const isLocal =
        host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host === '0.0.0.0'
        || /^10\./.test(host)
        || /^192\.168\./.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

      // Strict policy: refuse RFC1918 private ranges too (they may leave network)
      if (this.policy === 'strict' && !['localhost', '127.0.0.1', '::1'].includes(host)) {
        this.blockedOutbound++;
        await this.persist();
        return false;
      }
      if (!isLocal) {
        this.blockedOutbound++;
        await this.persist();
        return false;
      }
      this.allowedLocal++;
      await this.persist();
      return true;
    } catch {
      this.blockedOutbound++;
      await this.persist();
      return false;
    }
  }

  status(): AirGapStatus {
    return {
      enabled: this.enabled,
      blockedOutboundCount: this.blockedOutbound,
      allowedLocalCount: this.allowedLocal,
      lastAttempt: this.lastAttempt,
      policy: this.policy,
    };
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        enabled: this.enabled,
        policy: this.policy,
        blockedOutboundCount: this.blockedOutbound,
        allowedLocalCount: this.allowedLocal,
        lastAttempt: this.lastAttempt ? this.lastAttempt.toISOString() : null,
      };
      const tmp = STATUS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, STATUS_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: AirGapMode | null = null;

export function getAirGapMode(): AirGapMode {
  if (!_instance) _instance = new AirGapMode();
  return _instance;
}

export function resetAirGapModeForTests(): void {
  _instance = null;
}
