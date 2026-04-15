// src/brain/cross-agent-protocol.ts — Cross-Agent Intelligence Protocol (CAIP)
// Enables Kilo Code, Cline, OpenCode, Claude Code, Roo Code, Aider, Cursor to
// communicate, share insights, and boost each other's intelligence.
// v4.0.0 — Hyper-Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AgentTool, BrainInsight,
  CAIPMessage, CAIPHandshake, CAIPChannel, AgentBoostPacket, CrossAgentBus,
} from '../types.js';

const CAIP_PORT = 7344;
const CAIP_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.shadow-brain-caip');
const MAX_PENDING = 1000;
const MESSAGE_TTL_MS = 300_000; // 5 minutes

/**
 * Cross-Agent Intelligence Protocol — the hub that makes all coding agents talk to each other.
 *
 * Transport:
 *   Primary: WebSocket on port 7344 (CAIP bus)
 *   Fallback: Shared filesystem at ~/.shadow-brain-caip/ (polling every 2s)
 *
 * Protocol:
 *   1. Handshake — each agent sends identity, version, capabilities
 *   2. Channels — broadcast (all), pair (two agents), team (subset)
 *   3. Boost Packet — high-value insight shared to all connected agents
 *   4. Deduplication — message hash ring prevents infinite loops
 */
export class CrossAgentProtocol {
  private wss: WebSocketServer | null = null;
  private clients: Map<AgentTool, WebSocket> = new Map();
  private bus: CrossAgentBus;
  private messageHashes: Set<string> = new Set();
  private boostHandlers: Map<AgentTool, Array<(packet: AgentBoostPacket) => void>> = new Map();
  private filePollTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor() {
    this.bus = {
      channels: [],
      pendingMessages: [],
      connectedAgents: new Map(),
      totalExchanged: 0,
      uptime: 0,
    };

    // Ensure broadcast channel exists
    this.bus.channels.push({
      id: 'broadcast',
      participants: [],
      created: new Date(),
      messageCount: 0,
      lastActivity: new Date(),
      type: 'broadcast',
    });
  }

  // ── Connection Management ───────────────────────────────────────────────────

  /** Start the CAIP WebSocket server + filesystem fallback */
  async start(): Promise<void> {
    if (this.running) return;

    try {
      // Start WebSocket server
      this.wss = new WebSocketServer({ port: CAIP_PORT });
      this.running = true;

      this.wss.on('connection', (ws, req) => {
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as CAIPMessage;
            this.handleMessage(message, ws);
          } catch {
            // Invalid message format — ignore
          }
        });

        ws.on('close', () => {
          // Remove disconnected agent
          for (const [agent, socket] of this.clients) {
            if (socket === ws) {
              this.clients.delete(agent);
              this.bus.connectedAgents.delete(agent);
              break;
            }
          }
        });
      });

      // Start filesystem fallback
      this.startFilePolling();
    } catch {
      // WebSocket failed — rely on filesystem only
      this.running = true;
      this.startFilePolling();
    }
  }

  /** Stop the CAIP server */
  async stop(): Promise<void> {
    this.running = false;
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.filePollTimer) {
      clearInterval(this.filePollTimer);
      this.filePollTimer = null;
    }
    this.clients.clear();
  }

  /** Register an agent via handshake */
  async connect(handshake: CAIPHandshake): Promise<CAIPChannel> {
    this.bus.connectedAgents.set(handshake.agentTool, handshake);

    // Add to broadcast channel
    const broadcastChannel = this.bus.channels[0];
    if (broadcastChannel && !broadcastChannel.participants.includes(handshake.agentTool)) {
      broadcastChannel.participants.push(handshake.agentTool);
    }

    // Create inbox directory for filesystem fallback
    const inboxDir = path.join(CAIP_DIR, 'in', handshake.agentTool);
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    // Create outbox directory
    const outboxDir = path.join(CAIP_DIR, 'out', handshake.agentTool);
    if (!fs.existsSync(outboxDir)) {
      fs.mkdirSync(outboxDir, { recursive: true });
    }

    const channel: CAIPChannel = {
      id: `${handshake.agentTool}-connected`,
      participants: [handshake.agentTool],
      created: new Date(),
      messageCount: 0,
      lastActivity: new Date(),
      type: 'pair',
    };

    return channel;
  }

  // ── Message Delivery ────────────────────────────────────────────────────────

  /** Broadcast a message to all connected agents */
  async broadcast(from: AgentTool, payload: unknown, priority: CAIPMessage['priority'] = 'medium'): Promise<void> {
    const message: CAIPMessage = {
      id: crypto.randomUUID(),
      from,
      to: 'broadcast',
      type: 'insight',
      payload,
      timestamp: new Date(),
      priority,
    };

    this.deliverMessage(message);
  }

  /** Send a boost packet — high-value insights shared across agents */
  async sendBoostPacket(packet: AgentBoostPacket): Promise<void> {
    const message: CAIPMessage = {
      id: crypto.randomUUID(),
      from: packet.fromAgent,
      to: 'broadcast',
      type: 'boost',
      payload: packet,
      timestamp: new Date(),
      priority: 'high',
    };

    this.deliverMessage(message);

    // Notify boost handlers
    const handlers = this.boostHandlers.get(packet.fromAgent) || [];
    for (const handler of handlers) {
      try { handler(packet); } catch { /* handler error */ }
    }
  }

  /** Send targeted message to specific agent */
  async sendDirect(from: AgentTool, to: AgentTool, payload: unknown): Promise<void> {
    const message: CAIPMessage = {
      id: crypto.randomUUID(),
      from,
      to,
      type: 'insight',
      payload,
      timestamp: new Date(),
      priority: 'medium',
    };
    this.deliverMessage(message);
  }

  /** Subscribe to boost packets from a specific agent */
  subscribeToBoosts(agent: AgentTool, handler: (packet: AgentBoostPacket) => void): void {
    if (!this.boostHandlers.has(agent)) {
      this.boostHandlers.set(agent, []);
    }
    this.boostHandlers.get(agent)!.push(handler);
  }

  /** Get all connected agents */
  getConnectedAgents(): AgentTool[] {
    return Array.from(this.bus.connectedAgents.keys());
  }

  /** Get bus statistics */
  getBusStats(): CrossAgentBus {
    return { ...this.bus, connectedAgents: new Map(this.bus.connectedAgents) };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private handleMessage(message: CAIPMessage, ws?: WebSocket): void {
    // Deduplication
    const hash = this.hashMessage(message);
    if (this.messageHashes.has(hash)) return;
    this.messageHashes.add(hash);

    // Prune old hashes
    if (this.messageHashes.size > 10000) {
      const entries = Array.from(this.messageHashes);
      this.messageHashes = new Set(entries.slice(-5000));
    }

    // Handle handshake
    if (message.type === 'handshake' && ws) {
      const handshake = message.payload as CAIPHandshake;
      this.clients.set(handshake.agentTool, ws);
      this.bus.connectedAgents.set(handshake.agentTool, handshake);
      return;
    }

    // Deliver
    this.deliverMessage(message);
  }

  private deliverMessage(message: CAIPMessage): void {
    this.bus.totalExchanged++;
    this.bus.pendingMessages.push(message);

    // Cap pending
    if (this.bus.pendingMessages.length > MAX_PENDING) {
      this.bus.pendingMessages = this.bus.pendingMessages.slice(-MAX_PENDING / 2);
    }

    // WebSocket delivery
    if (message.to === 'broadcast') {
      for (const [agent, ws] of this.clients) {
        if (agent !== message.from && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify(message)); } catch { /* send failed */ }
        }
      }
    } else {
      const targetWs = this.clients.get(message.to as AgentTool);
      if (targetWs?.readyState === WebSocket.OPEN) {
        try { targetWs.send(JSON.stringify(message)); } catch { /* send failed */ }
      }
    }

    // Filesystem fallback delivery
    this.writeFileMessage(message);
  }

  private writeFileMessage(message: CAIPMessage): void {
    try {
      const targets = message.to === 'broadcast'
        ? Array.from(this.bus.connectedAgents.keys()).filter(a => a !== message.from)
        : [message.to as AgentTool];

      for (const target of targets) {
        const inboxDir = path.join(CAIP_DIR, 'in', target);
        if (!fs.existsSync(inboxDir)) {
          fs.mkdirSync(inboxDir, { recursive: true });
        }
        const filePath = path.join(inboxDir, `${Date.now()}-${message.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(message));
      }
    } catch {
      // Filesystem delivery failed — non-critical
    }
  }

  private startFilePolling(): void {
    // Poll outbox directories for messages from agents
    this.filePollTimer = setInterval(() => {
      try {
        const outDir = path.join(CAIP_DIR, 'out');
        if (!fs.existsSync(outDir)) return;

        const agentDirs = fs.readdirSync(outDir);
        for (const agent of agentDirs) {
          const agentOutDir = path.join(outDir, agent);
          if (!fs.statSync(agentOutDir).isDirectory()) continue;

          const files = fs.readdirSync(agentOutDir).sort();
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(agentOutDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              this.handleMessage(data);
              fs.unlinkSync(filePath); // Processed — remove
            } catch {
              // Corrupt file — remove
              try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            }
          }
        }
      } catch {
        // Polling error — non-critical
      }
    }, 2000);
  }

  private hashMessage(message: CAIPMessage): string {
    const content = `${message.from}:${message.to}:${message.type}:${JSON.stringify(message.payload)}`;
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
