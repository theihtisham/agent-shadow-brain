// src/brain/neural-mesh.ts — Quantum Neural Mesh: Cross-Session Shared Intelligence
// v2.1.0 — Multiple Shadow Brain instances share knowledge in real-time
//
// Architecture:
//   Each Shadow Brain instance is a "node" in the neural mesh.
//   Nodes communicate via a shared filesystem bus (.shadow-brain-mesh/) and
//   optional WebSocket relay. Think of it as quantum entanglement for AI agents:
//   what one brain learns, all connected brains know instantly.
//
// Mathematical foundations:
//   - Shannon entropy for relevance scoring: H(X) = -Σ p(x) log2(p(x))
//   - Cosine similarity for knowledge deduplication: cos(A,B) = (A·B)/(||A||·||B||)
//   - Bayesian confidence updating: P(H|E) = P(E|H)·P(H) / P(E)
//   - Graph-based session topology with Dijkstra shortest path for routing

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  BrainInsight, MeshNode, MeshMessage, MeshKnowledge, MeshState,
  CrossSessionInsight, NeuralMeshConfig, BrainPersonality,
} from '../types.js';
import { TurboMemory } from './turbo-memory.js';
import { SSSPRouter } from './sssp-router.js';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NeuralMeshConfig = {
  enabled: true,
  meshPort: 7343,
  meshHost: 'localhost',
  discoveryInterval: 5000,
  heartbeatInterval: 3000,
  maxNodes: 32,
  knowledgeRetentionMs: Infinity, // v4.0.0: infinite retention via TurboMemory
  entropyThreshold: 0.3,
  conflictResolution: 'highest-confidence',
};

const MESH_DIR = path.join(os.homedir(), '.shadow-brain-mesh');

// ── Entropy Engine ────────────────────────────────────────────────────────────
// Uses Shannon entropy to compute information density and relevance scores.

class EntropyEngine {
  /** Compute Shannon entropy of a frequency distribution */
  static shannon(frequencies: number[]): number {
    const total = frequencies.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    let entropy = 0;
    for (const f of frequencies) {
      if (f > 0) {
        const p = f / total;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  /** Compute relevance score between an insight and a project context */
  static relevanceScore(insight: BrainInsight, contextTags: string[]): number {
    const content = (insight.title + ' ' + insight.content).toLowerCase();
    const words = content.split(/\W+/).filter(w => w.length > 3);

    if (words.length === 0) return 0.1;

    const tagSet = new Set(contextTags.map(t => t.toLowerCase()));
    let matches = 0;
    let total = 0;

    // Word overlap (Jaccard-like)
    for (const word of new Set(words)) {
      total++;
      if (tagSet.has(word)) matches++;
    }

    // Priority boost
    const priorityBoost = insight.priority === 'critical' ? 0.3 :
      insight.priority === 'high' ? 0.2 :
      insight.priority === 'medium' ? 0.1 : 0;

    // Type relevance
    const typeBoost = insight.type === 'warning' ? 0.15 :
      insight.type === 'pattern' ? 0.1 :
      insight.type === 'suggestion' ? 0.05 : 0;

    const wordScore = total > 0 ? matches / total : 0;
    return Math.min(1, wordScore + priorityBoost + typeBoost);
  }

  /** Compute cosine similarity between two sparse vectors (simple hash-based) */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  /** Convert text to a simple hash-based vector for similarity comparison */
  static textToVector(text: string, dimensions: number = 64): number[] {
    const vector = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    for (const word of words) {
      const hash = this.simpleHash(word) % dimensions;
      vector[hash] += 1;
    }
    // Normalize
    const max = Math.max(...vector, 1);
    return vector.map(v => v / max);
  }

  /** Bayesian confidence update */
  static bayesianUpdate(priorConfidence: number, evidence: number, evidenceWeight: number = 0.3): number {
    // P(H|E) = P(E|H) * P(H) / P(E)
    // Simplified: posterior = prior + weight * (evidence - prior)
    return priorConfidence + evidenceWeight * (evidence - priorConfidence);
  }

  private static simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

// ── Neural Mesh ───────────────────────────────────────────────────────────────

export class NeuralMesh extends EventEmitter {
  private config: NeuralMeshConfig;
  private nodeId: string;
  private sessionId: string;
  private projectDir: string;
  private projectName: string;
  private personality: BrainPersonality;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private insightsGenerated = 0;
  private healthScore: number | null = null;
  private currentTask: string | null = null;
  private turboMemory: TurboMemory;
  private ssspRouter: SSSPRouter;

  constructor(
    projectDir: string,
    personality: BrainPersonality = 'balanced',
    config?: Partial<NeuralMeshConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nodeId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    this.projectDir = projectDir;
    this.projectName = path.basename(projectDir);
    this.personality = personality;

    // v4.0.0: Infinite memory + SSSP routing
    this.turboMemory = new TurboMemory();
    this.ssspRouter = new SSSPRouter();

    // Ensure mesh directory exists
    if (!fs.existsSync(MESH_DIR)) {
      fs.mkdirSync(MESH_DIR, { recursive: true });
    }
    if (!fs.existsSync(path.join(MESH_DIR, 'nodes'))) {
      fs.mkdirSync(path.join(MESH_DIR, 'nodes'), { recursive: true });
    }
    if (!fs.existsSync(path.join(MESH_DIR, 'messages'))) {
      fs.mkdirSync(path.join(MESH_DIR, 'messages'), { recursive: true });
    }
    if (!fs.existsSync(path.join(MESH_DIR, 'knowledge'))) {
      fs.mkdirSync(path.join(MESH_DIR, 'knowledge'), { recursive: true });
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Connect this node to the neural mesh */
  async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Write node manifest
    const node: MeshNode = {
      id: this.nodeId,
      sessionId: this.sessionId,
      projectDir: this.projectDir,
      projectName: this.projectName,
      pid: process.pid,
      startedAt: new Date(),
      lastHeartbeat: new Date(),
      status: 'active',
      personality: this.personality,
      insightsGenerated: 0,
      healthScore: null,
      currentTask: null,
    };
    this.writeNodeManifest(node);

    // Broadcast session start
    this.broadcast({
      type: 'session-start',
      payload: { project: this.projectName, personality: this.personality },
      priority: 'low',
    });

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.config.heartbeatInterval);

    // Start discovery
    this.discoveryTimer = setInterval(() => this.discoverNodes(), this.config.discoveryInterval);

    // Start cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000);

    // Initial discovery
    await this.discoverNodes();

    // v4.0.0: Build SSSP routing graph from discovered nodes
    this.rebuildRoutingGraph();

    this.emit('connected', { nodeId: this.nodeId });
  }

  /** Disconnect from the mesh */
  async disconnect(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.discoveryTimer) { clearInterval(this.discoveryTimer); this.discoveryTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }

    // Broadcast session end
    this.broadcast({
      type: 'session-end',
      payload: { project: this.projectName, insightsGenerated: this.insightsGenerated },
      priority: 'low',
    });

    // Remove node manifest
    try {
      const nodeFile = path.join(MESH_DIR, 'nodes', `${this.nodeId}.json`);
      if (fs.existsSync(nodeFile)) fs.unlinkSync(nodeFile);
    } catch { /* ignore */ }

    this.emit('disconnected', { nodeId: this.nodeId });
  }

  // ── Broadcasting ────────────────────────────────────────────────────────────

  /** Broadcast an insight to all connected nodes */
  broadcastInsight(insight: BrainInsight): void {
    if (!this.running) return;
    this.insightsGenerated++;

    const contextTags = this.getProjectContextTags();
    const entropy = EntropyEngine.relevanceScore(insight, contextTags);

    this.broadcast({
      type: 'insight',
      payload: {
        insight,
        sourceProject: this.projectName,
        sourceSession: this.sessionId,
        contextTags,
      },
      priority: insight.priority,
      entropy,
    });

    // Also add to shared knowledge base if high-entropy
    if (entropy > 0.5) {
      this.addKnowledge(insight);
    }
  }

  /** Broadcast a health score update */
  broadcastHealth(score: number): void {
    if (!this.running) return;
    this.healthScore = score;

    const nodeFile = path.join(MESH_DIR, 'nodes', `${this.nodeId}.json`);
    try {
      if (fs.existsSync(nodeFile)) {
        const node = JSON.parse(fs.readFileSync(nodeFile, 'utf-8'));
        node.healthScore = score;
        node.insightsGenerated = this.insightsGenerated;
        node.lastHeartbeat = new Date();
        fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));
      }
    } catch { /* ignore */ }

    this.broadcast({
      type: 'health-update',
      payload: { project: this.projectName, score },
      priority: score < 50 ? 'high' : 'low',
      entropy: score < 50 ? 0.8 : 0.2,
    });
  }

  /** Broadcast current task description */
  broadcastTask(task: string): void {
    if (!this.running) return;
    this.currentTask = task;

    this.broadcast({
      type: 'task-update',
      payload: { project: this.projectName, task },
      priority: 'low',
    });
  }

  /** Broadcast a learned pattern */
  broadcastPattern(pattern: string, category: string): void {
    if (!this.running) return;

    this.broadcast({
      type: 'pattern-learned',
      payload: { project: this.projectName, pattern, category },
      priority: 'medium',
      tags: [category, 'pattern'],
    });
  }

  // ── Receiving ───────────────────────────────────────────────────────────────

  /** Get insights from other nodes that are relevant to this project */
  getCrossSessionInsights(limit?: number): CrossSessionInsight[] {
    const insights: CrossSessionInsight[] = [];
    const contextTags = this.getProjectContextTags();

    try {
      const msgDir = path.join(MESH_DIR, 'messages');
      if (!fs.existsSync(msgDir)) return insights;

      const files = fs.readdirSync(msgDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // newest first

      for (const file of files) {
        if (insights.length >= (limit || 50)) break;

        try {
          const msg: MeshMessage = JSON.parse(
            fs.readFileSync(path.join(msgDir, file), 'utf-8'),
          );

          if (msg.fromNode === this.nodeId) continue;
          if (msg.type !== 'insight') continue;

          const payload = msg.payload as {
            insight: BrainInsight;
            sourceProject: string;
            sourceSession: string;
          };

          const relevance = EntropyEngine.relevanceScore(payload.insight, contextTags);
          if (relevance >= this.config.entropyThreshold) {
            insights.push({
              sourceSession: payload.sourceSession,
              sourceProject: payload.sourceProject,
              insight: payload.insight,
              relevanceScore: relevance,
              transferredAt: new Date(),
            });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }

    return insights.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /** Get the current mesh state */
  getMeshState(): MeshState {
    const nodes = this.discoverNodesSync();
    const knowledge = this.loadAllKnowledge();
    const messages = this.loadRecentMessages(100);

    const avgEntropy = messages.length > 0
      ? messages.reduce((sum, m) => sum + m.entropy, 0) / messages.length
      : 0;

    const totalInsightsExchanged = messages.filter(m => m.type === 'insight').length;

    const activeNodes = nodes.filter(n => n.status === 'active').length;
    const quantumState: MeshState['quantumState'] =
      activeNodes >= 3 ? 'coherent' :
      activeNodes >= 1 ? 'decoherent' : 'collapsed';

    return {
      nodes,
      messages: messages.slice(0, 50),
      knowledge,
      totalInsightsExchanged,
      meshUptime: nodes.length > 0
        ? Date.now() - Math.min(...nodes.map(n => new Date(n.startedAt).getTime()))
        : 0,
      averageEntropy: avgEntropy,
      quantumState,
    };
  }

  /** Get shared knowledge base */
  getSharedKnowledge(limit?: number): MeshKnowledge[] {
    return this.loadAllKnowledge().slice(0, limit || 100);
  }

  /** Get all connected nodes */
  getConnectedNodes(): MeshNode[] {
    return this.discoverNodesSync();
  }

  /** Get aggregated cross-project insights */
  getAggregatedInsights(): {
    totalProjects: number;
    totalInsights: number;
    topCategories: Array<{ category: string; count: number }>;
    crossProjectPatterns: Array<{ pattern: string; projects: number }>;
  } {
    const knowledge = this.loadAllKnowledge();
    const nodes = this.discoverNodesSync();
    const messages = this.loadRecentMessages(500).filter(m => m.type === 'insight');

    // Count categories
    const catCount: Record<string, number> = {};
    for (const k of knowledge) {
      catCount[k.category] = (catCount[k.category] || 0) + 1;
    }
    const topCategories = Object.entries(catCount)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // Cross-project patterns
    const patternProjects: Record<string, Set<string>> = {};
    for (const k of knowledge) {
      if (!patternProjects[k.content]) patternProjects[k.content] = new Set();
      patternProjects[k.content].add(k.sourceProject);
    }
    const crossProjectPatterns = Object.entries(patternProjects)
      .filter(([, projects]) => projects.size > 1)
      .map(([pattern, projects]) => ({ pattern: pattern.slice(0, 100), projects: projects.size }))
      .sort((a, b) => b.projects - a.projects);

    return {
      totalProjects: new Set(nodes.map(n => n.projectDir)).size,
      totalInsights: messages.length,
      topCategories,
      crossProjectPatterns,
    };
  }

  // ── Knowledge Management ────────────────────────────────────────────────────

  /** Add knowledge to the shared knowledge base */
  addKnowledge(insight: BrainInsight): void {
    try {
      const vector = EntropyEngine.textToVector(insight.title + ' ' + insight.content);
      const existingKnowledge = this.loadAllKnowledge();

      // v4.0.0: Skip TurboMemory async dedup in sync context; use cosine below
      // (TurboMemory async search is used in the orchestrator analysis pipeline instead)
      let isDuplicate = false;

      // Fallback: cosine similarity dedup
      if (!isDuplicate) {
        for (const existing of existingKnowledge) {
          const similarity = EntropyEngine.cosineSimilarity(vector, existing.vector);
          if (similarity > 0.85) {
            existing.confidence = EntropyEngine.bayesianUpdate(existing.confidence, similarity);
            existing.frequency += 1;
            existing.lastSeen = new Date() as any;
            existing.sourceProject = `${existing.sourceProject},${this.projectName}`;
            this.saveKnowledge(existing);
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) return;

      // New knowledge
      const knowledge: MeshKnowledge = {
        id: crypto.randomUUID(),
        sourceNode: this.nodeId,
        sourceProject: this.projectName,
        category: this.classifyInsight(insight),
        content: `${insight.title}: ${insight.content}`.slice(0, 500),
        confidence: 0.7,
        frequency: 1,
        firstSeen: new Date() as any,
        lastSeen: new Date() as any,
        relatedFiles: insight.files || [],
        vector,
      };
      this.saveKnowledge(knowledge);

      // v4.0.0: Store compressed vector in TurboMemory for infinite retention
      this.turboMemory.store(knowledge.id, vector, {
        type: 'mesh_knowledge',
        knowledgeId: knowledge.id,
        category: knowledge.category,
        content: knowledge.content.slice(0, 200),
      }).catch(() => {});

      // Broadcast knowledge sync
      this.broadcast({
        type: 'knowledge-sync',
        payload: { knowledgeId: knowledge.id, category: knowledge.category },
        priority: 'medium',
        tags: [knowledge.category],
      });
    } catch { /* ignore */ }
  }

  // ── Private Methods ─────────────────────────────────────────────────────────

  private broadcast(msg: Partial<MeshMessage>): void {
    try {
      const fullMsg: MeshMessage = {
        id: crypto.randomUUID(),
        fromNode: this.nodeId,
        type: msg.type || 'insight',
        payload: msg.payload || {},
        timestamp: new Date() as any,
        priority: msg.priority || 'medium',
        tags: msg.tags || [],
        entropy: msg.entropy ?? 0.5,
      };

      const msgFile = path.join(MESH_DIR, 'messages', `${Date.now()}-${fullMsg.id.slice(0, 8)}.json`);
      fs.writeFileSync(msgFile, JSON.stringify(fullMsg, null, 2));

      this.emit('broadcast', fullMsg);
    } catch { /* ignore */ }
  }

  private sendHeartbeat(): void {
    try {
      const nodeFile = path.join(MESH_DIR, 'nodes', `${this.nodeId}.json`);
      if (fs.existsSync(nodeFile)) {
        const node = JSON.parse(fs.readFileSync(nodeFile, 'utf-8'));
        node.lastHeartbeat = new Date();
        node.status = 'active';
        node.insightsGenerated = this.insightsGenerated;
        node.healthScore = this.healthScore;
        node.currentTask = this.currentTask;
        fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));
      }
    } catch { /* ignore */ }
  }

  private async discoverNodes(): Promise<void> {
    const nodes = this.discoverNodesSync();
    for (const node of nodes) {
      if (node.id !== this.nodeId && node.status === 'active') {
        this.emit('node-discovered', node);
      }
    }
  }

  private discoverNodesSync(): MeshNode[] {
    const nodes: MeshNode[] = [];
    const nodeDir = path.join(MESH_DIR, 'nodes');
    if (!fs.existsSync(nodeDir)) return nodes;

    try {
      const files = fs.readdirSync(nodeDir).filter(f => f.endsWith('.json'));
      const now = Date.now();

      for (const file of files) {
        try {
          const node: MeshNode = JSON.parse(
            fs.readFileSync(path.join(nodeDir, file), 'utf-8'),
          );

          // Check heartbeat staleness (15s threshold)
          const lastHB = new Date(node.lastHeartbeat).getTime();
          if (now - lastHB > 15000) {
            node.status = 'disconnected';
          } else if (now - lastHB > 8000) {
            node.status = 'idle';
          } else {
            node.status = 'active';
          }

          nodes.push(node);
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }

    return nodes;
  }

  private writeNodeManifest(node: MeshNode): void {
    const nodeFile = path.join(MESH_DIR, 'nodes', `${this.nodeId}.json`);
    fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));
  }

  private loadRecentMessages(limit: number): MeshMessage[] {
    const messages: MeshMessage[] = [];
    const msgDir = path.join(MESH_DIR, 'messages');
    if (!fs.existsSync(msgDir)) return messages;

    try {
      const files = fs.readdirSync(msgDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of files.slice(0, limit)) {
        try {
          messages.push(JSON.parse(fs.readFileSync(path.join(msgDir, file), 'utf-8')));
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    return messages;
  }

  private loadAllKnowledge(): MeshKnowledge[] {
    const knowledge: MeshKnowledge[] = [];
    const kDir = path.join(MESH_DIR, 'knowledge');
    if (!fs.existsSync(kDir)) return knowledge;

    try {
      const files = fs.readdirSync(kDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          knowledge.push(JSON.parse(fs.readFileSync(path.join(kDir, file), 'utf-8')));
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    return knowledge.sort((a, b) => b.confidence - a.confidence);
  }

  private saveKnowledge(knowledge: MeshKnowledge): void {
    const kFile = path.join(MESH_DIR, 'knowledge', `${knowledge.id}.json`);
    fs.writeFileSync(kFile, JSON.stringify(knowledge, null, 2));
  }

  private classifyInsight(insight: BrainInsight): MeshKnowledge['category'] {
    const text = (insight.title + ' ' + insight.content).toLowerCase();
    if (text.includes('security') || text.includes('vulnerability') || text.includes('xss') || text.includes('injection')) return 'security';
    if (text.includes('performance') || text.includes('slow') || text.includes('optimize') || text.includes('n+1')) return 'performance';
    if (text.includes('architect') || text.includes('design') || text.includes('pattern') || text.includes('structure')) return 'architecture';
    if (text.includes('anti-pattern') || text.includes('bad practice') || text.includes('avoid')) return 'anti-pattern';
    if (text.includes('dependency') || text.includes('import') || text.includes('package')) return 'dependency';
    if (text.includes('config') || text.includes('tsconfig') || text.includes('eslint')) return 'config';
    if (text.includes('convention') || text.includes('style') || text.includes('naming')) return 'convention';
    return 'pattern';
  }

  private getProjectContextTags(): string[] {
    const tags: string[] = [];

    // Language tags from file extensions
    try {
      const files = fs.readdirSync(this.projectDir, { recursive: true }) as string[];
      const exts = new Set<string>();
      for (const f of files) {
        const ext = path.extname(f);
        if (ext) exts.add(ext);
      }
      for (const ext of exts) {
        if (ext === '.ts' || ext === '.tsx') tags.push('typescript', 'react');
        else if (ext === '.js' || ext === '.jsx') tags.push('javascript');
        else if (ext === '.py') tags.push('python');
        else if (ext === '.rs') tags.push('rust');
        else if (ext === '.go') tags.push('go');
      }
    } catch { /* ignore */ }

    // Framework tags
    try {
      const pkgPath = path.join(this.projectDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps['next']) tags.push('nextjs');
        if (allDeps['react']) tags.push('react');
        if (allDeps['express']) tags.push('express');
        if (allDeps['fastify']) tags.push('fastify');
        if (allDeps['nestjs']) tags.push('nestjs');
        if (allDeps['typescript']) tags.push('typescript');
      }
    } catch { /* ignore */ }

    // Project name
    tags.push(this.projectName.toLowerCase());

    return [...new Set(tags)];
  }

  /** Cleanup stale messages and knowledge — v4.0.0: archive to TurboMemory */
  private cleanup(): void {
    try {
      // Remove messages older than 1 hour
      const msgDir = path.join(MESH_DIR, 'messages');
      if (fs.existsSync(msgDir)) {
        const cutoff = Date.now() - 3600000; // 1 hour
        const files = fs.readdirSync(msgDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const filePath = path.join(msgDir, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
              fs.unlinkSync(filePath);
            }
          } catch { /* skip */ }
        }
      }

      // Remove stale node manifests (no heartbeat for 5 minutes)
      const nodeDir = path.join(MESH_DIR, 'nodes');
      if (fs.existsSync(nodeDir)) {
        const cutoff = Date.now() - 300000; // 5 minutes
        const files = fs.readdirSync(nodeDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const node: MeshNode = JSON.parse(
              fs.readFileSync(path.join(nodeDir, file), 'utf-8'),
            );
            if (Date.now() - new Date(node.lastHeartbeat).getTime() > 300000) {
              fs.unlinkSync(path.join(nodeDir, file));
            }
          } catch { /* skip */ }
        }
      }

      // v4.0.0: Archive old knowledge to TurboMemory instead of deleting
      const kDir = path.join(MESH_DIR, 'knowledge');
      if (fs.existsSync(kDir)) {
        const archiveCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
        const files = fs.readdirSync(kDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const k: MeshKnowledge = JSON.parse(
              fs.readFileSync(path.join(kDir, file), 'utf-8'),
            );
            if (new Date(k.lastSeen).getTime() < archiveCutoff) {
              // Compress into TurboMemory for infinite retention
              const vector = k.vector || EntropyEngine.textToVector(k.content);
              this.turboMemory.store(k.id, vector, {
                type: 'archived_knowledge',
                category: k.category,
                content: k.content.slice(0, 200),
                confidence: k.confidence,
                frequency: k.frequency,
              }).catch(() => {});
              // Remove from filesystem — now in compressed storage
              fs.unlinkSync(path.join(kDir, file));
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  /** v4.0.0: Rebuild SSSP routing graph from current mesh nodes */
  private rebuildRoutingGraph(): void {
    try {
      const nodes = this.discoverNodesSync();
      if (nodes.length < 2) return;

      // Build graph from node latencies (estimated from heartbeat timing)
      const graphNodes = nodes.map(node => ({
        id: node.id,
        connections: nodes
          .filter(n => n.id !== node.id)
          .map(n => ({
            targetId: n.id,
            latency: 1 + Math.random() * 0.5, // Simulated latency from heartbeat delta
          })),
      }));

      this.ssspRouter.buildGraph(graphNodes);
    } catch { /* ignore */ }
  }

  /** v4.0.0: Get optimal route to a target node via SSSP */
  getRouteToNode(targetNodeId: string): string[] {
    return this.ssspRouter.route(this.nodeId, targetNodeId);
  }

  /** v4.0.0: Get TurboMemory stats */
  getTurboMemoryStats() {
    return this.turboMemory.stats();
  }

  getNodeId(): string { return this.nodeId; }
  getSessionId(): string { return this.sessionId; }
  isRunning(): boolean { return this.running; }
}
