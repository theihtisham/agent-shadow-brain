// src/brain/team-brain-sync.ts — Peer-to-peer team brain sync (no server)
// v6.0.0 — Hive Mind Edition
//
// Team brain sync primitive: a peer discovery + message packaging layer. The
// transport is pluggable (WebRTC in the dashboard browser bundle, or HTTP
// loopback for server-less ops testing). This module maintains the STATE
// (peer list, last-sync-hashes) and the CONTENT envelope for memory sync.
//
// NOTE: This is the signaling/state layer. The actual WebRTC data channel
// lives in the browser dashboard (dashboard/server.ts serves the static
// bundle which uses native RTCPeerConnection).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  TeamPeerInfo,
  TeamSyncMessage,
  AgentTool,
} from '../types.js';

const TEAM_PATH = path.join(os.homedir(), '.shadow-brain', 'team-sync.json');

interface PersistShape {
  schemaVersion: 1;
  peerId: string;
  displayName: string;
  peers: TeamPeerInfo[];
  outbox: TeamSyncMessage[];
}

export class TeamBrainSync {
  private peerId: string;
  private displayName: string;
  private peers: Map<string, TeamPeerInfo> = new Map();
  private outbox: TeamSyncMessage[] = [];
  private initialized = false;

  constructor() {
    this.peerId = crypto.randomBytes(8).toString('hex');
    this.displayName = os.userInfo().username || 'unknown';
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(TEAM_PATH), { recursive: true });
    if (fs.existsSync(TEAM_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(TEAM_PATH, 'utf-8')) as PersistShape;
        this.peerId = parsed.peerId ?? this.peerId;
        this.displayName = parsed.displayName ?? this.displayName;
        for (const p of parsed.peers ?? []) {
          this.peers.set(p.peerId, {
            ...p,
            connectedAt: new Date(p.connectedAt),
            lastSeenAt: new Date(p.lastSeenAt),
          });
        }
        this.outbox = (parsed.outbox ?? []).map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  setDisplayName(name: string): void {
    this.displayName = name || 'unknown';
  }

  selfInfo(): TeamPeerInfo {
    return {
      peerId: this.peerId,
      displayName: this.displayName,
      agentTools: [],
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      sharedMemoryCount: 0,
    };
  }

  async registerPeer(peer: Omit<TeamPeerInfo, 'connectedAt' | 'lastSeenAt'>): Promise<TeamPeerInfo> {
    await this.init();
    const full: TeamPeerInfo = {
      ...peer,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.peers.set(full.peerId, full);
    await this.persist();
    return full;
  }

  async heartbeat(peerId: string, agentTools?: AgentTool[]): Promise<boolean> {
    await this.init();
    const p = this.peers.get(peerId);
    if (!p) return false;
    p.lastSeenAt = new Date();
    if (agentTools) p.agentTools = agentTools;
    await this.persist();
    return true;
  }

  async enqueue(message: Omit<TeamSyncMessage, 'timestamp'>): Promise<TeamSyncMessage> {
    await this.init();
    const full: TeamSyncMessage = { ...message, timestamp: new Date() };
    this.outbox.push(full);
    if (this.outbox.length > 500) this.outbox = this.outbox.slice(-500);
    await this.persist();
    return full;
  }

  drainOutbox(): TeamSyncMessage[] {
    const drained = [...this.outbox];
    this.outbox = [];
    this.persist().catch(() => {});
    return drained;
  }

  listPeers(): TeamPeerInfo[] {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  getPeerId(): string {
    return this.peerId;
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        peerId: this.peerId,
        displayName: this.displayName,
        peers: Array.from(this.peers.values()),
        outbox: this.outbox,
      };
      const tmp = TEAM_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, TEAM_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: TeamBrainSync | null = null;

export function getTeamBrainSync(): TeamBrainSync {
  if (!_instance) _instance = new TeamBrainSync();
  return _instance;
}

export function resetTeamBrainSyncForTests(): void {
  _instance = null;
}
