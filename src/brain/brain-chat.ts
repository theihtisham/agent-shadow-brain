// src/brain/brain-chat.ts — Chat with Your Brain (contextual RAG)
// v6.0.0 — Hive Mind Edition
//
// Conversational interface over the global brain. Retrieves the most relevant
// memories via semantic search, constructs a citation-aware prompt, sends it
// through ModelRegistry, and returns the answer + cited memories.
//
// The response is also written back to the brain as a new memory (category:
// "chat-query") so the conversation history becomes queryable.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getGlobalBrain } from './global-brain.js';
import { getEmbeddings } from './embeddings.js';
import { getModelRegistry } from './model-registry.js';
import { getPromptCache } from './prompt-cache.js';

const HIST_PATH = path.join(os.homedir(), '.shadow-brain', 'chat-history.json');

export interface BrainChatCitation {
  memoryId: string;
  content: string;
  category: string;
  agent: string;
  score: number;
}

export interface BrainChatTurn {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: BrainChatCitation[];
  provider?: string;
  model?: string;
  createdAt: Date;
  tokensUsed?: number;
  cached?: boolean;
}

interface ChatHistoryShape {
  schemaVersion: 1;
  conversations: Record<string, BrainChatTurn[]>;
}

export class BrainChat {
  private history: Map<string, BrainChatTurn[]> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(HIST_PATH), { recursive: true });
    if (fs.existsSync(HIST_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(HIST_PATH, 'utf-8')) as ChatHistoryShape;
        for (const [id, turns] of Object.entries(parsed.conversations ?? {})) {
          this.history.set(id, turns.map(t => ({ ...t, createdAt: new Date(t.createdAt) })));
        }
      } catch { /* skip */ }
    }
    this.initialized = true;
  }

  async ask(question: string, opts: { conversationId?: string; maxCitations?: number; projectDir?: string } = {}): Promise<BrainChatTurn> {
    await this.init();
    const brain = getGlobalBrain(); await brain.init();
    const emb = getEmbeddings(); await emb.init();
    const registry = getModelRegistry(); await registry.init();
    const cache = getPromptCache();

    const conversationId = opts.conversationId || `conv-${crypto.randomBytes(6).toString('hex')}`;
    const turns = this.history.get(conversationId) ?? [];
    const maxCitations = opts.maxCitations ?? 6;

    // Record user turn
    const userTurn: BrainChatTurn = {
      id: 'turn-' + crypto.randomBytes(4).toString('hex'),
      conversationId, role: 'user', content: question, createdAt: new Date(),
    };
    turns.push(userTurn);

    // Retrieve relevant memories via semantic search
    const candidates = brain.recall({ limit: 200, minImportance: 0.2 });
    const searchables = candidates.map(e => ({ id: e.id, text: `${e.category}: ${e.content}` }));
    const ranked = await emb.semanticSearch(question, searchables, maxCitations);

    const citations: BrainChatCitation[] = [];
    for (const r of ranked) {
      const entry = candidates.find(e => e.id === r.id);
      if (!entry) continue;
      citations.push({
        memoryId: entry.id,
        content: entry.content,
        category: entry.category,
        agent: String(entry.agentTool),
        score: +r.score.toFixed(4),
      });
    }

    const citationBlock = citations.length
      ? citations.map((c, i) => `[${i + 1}] (${c.agent}/${c.category}) ${c.content.slice(0, 260)}`).join('\n')
      : '(no relevant memories found)';

    const system = `You are Shadow Brain — the Hive Mind assistant for a developer's AI agents.
You answer from the brain's memory when possible. Cite sources with [N] matching the numbered list.
Be direct and terse. Never invent memories that aren't listed.`;

    const recentContext = turns.slice(-6, -1).map(t => `${t.role.toUpperCase()}: ${t.content}`).join('\n');
    const prompt = [
      recentContext ? 'Conversation so far:\n' + recentContext + '\n' : '',
      'Relevant brain memories:\n' + citationBlock,
      '\nUser question:\n' + question,
      '\nAnswer, citing memories like [1] [2] when you use them:',
    ].filter(Boolean).join('\n');

    const generate = () => registry.generate(prompt, { system, featureName: 'brain-chat', maxTokens: 600 });
    const start = Date.now();
    const response = await cache.wrap(
      { prompt, system, model: 'lead', provider: 'lead', estimatedTokens: Math.ceil(prompt.length / 4) + 400, estimatedCostUsd: 0.004 },
      generate,
    );

    const asstTurn: BrainChatTurn = {
      id: 'turn-' + crypto.randomBytes(4).toString('hex'),
      conversationId,
      role: 'assistant',
      content: response.text || '(no response)',
      citations,
      provider: response.provider,
      model: response.model,
      createdAt: new Date(),
      tokensUsed: (response.inputTokens ?? 0) + (response.outputTokens ?? 0),
    };
    turns.push(asstTurn);
    this.history.set(conversationId, turns);

    // Also store as a brain memory so future chats can find past conversations
    try {
      const projectId = 'brain-chat';
      brain.writeSync({
        projectId, projectName: 'brain-chat',
        agentTool: 'claude-code',
        category: 'chat-answer',
        content: `Q: ${question.slice(0, 220)}\nA: ${(response.text || '').slice(0, 380)}`,
        importance: 0.45,
        metadata: { conversationId, provider: response.provider, model: response.model, citationCount: citations.length },
      });
    } catch { /* non-fatal */ }

    // Record ms timing for observability
    (asstTurn as any).ms = Date.now() - start;

    this.persist().catch(() => {});
    return asstTurn;
  }

  listConversations(): Array<{ id: string; turnCount: number; lastActive: Date; preview: string }> {
    return Array.from(this.history.entries()).map(([id, turns]) => ({
      id,
      turnCount: turns.length,
      lastActive: turns[turns.length - 1]?.createdAt ?? new Date(),
      preview: turns[0]?.content.slice(0, 80) ?? '',
    })).sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  }

  getConversation(id: string): BrainChatTurn[] {
    return this.history.get(id) ?? [];
  }

  async clearConversation(id: string): Promise<boolean> {
    const ok = this.history.delete(id);
    if (ok) await this.persist();
    return ok;
  }

  async clearAll(): Promise<void> {
    this.history.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const shape: ChatHistoryShape = {
        schemaVersion: 1,
        conversations: Object.fromEntries(this.history.entries()),
      };
      const tmp = HIST_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(shape, null, 2));
      fs.renameSync(tmp, HIST_PATH);
    } catch { /* non-fatal */ }
  }
}

let _instance: BrainChat | null = null;
export function getBrainChat(): BrainChat {
  if (!_instance) _instance = new BrainChat();
  return _instance;
}
export function resetBrainChatForTests(): void { _instance = null; }
