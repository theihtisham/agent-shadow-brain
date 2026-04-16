// src/brain/context-recall.ts — Context-Triggered Associative Recall
// Activates memories based on current work context, not just search queries
// v5.0.0 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  RecallTrigger,
  RecallResult,
  RecallContext,
  MemoryTier,
} from '../types.js';
import { HierarchicalMemory } from './hierarchical-memory.js';

const STORE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.shadow-brain', 'context-recall'
);

interface TriggerPattern {
  id: string;
  pattern: string;
  category: string;
  strength: number;
  lastMatched: Date;
  matchCount: number;
}

interface ActivationLink {
  sourceId: string;
  targetId: string;
  strength: number;
  coOccurrence: number;
  lastActivated: Date;
}

/**
 * ContextRecall — associative memory activation engine.
 *
 * Instead of requiring explicit search queries, this engine monitors the
 * current work context (file being edited, keywords, project type, time)
 * and automatically activates relevant memories.
 *
 * Activation triggers:
 * 1. File path pattern matching (e.g., editing auth/*.ts triggers security memories)
 * 2. Keyword detection (e.g., "database" triggers SQL/pattern memories)
 * 3. Category association (e.g., "bug-fix" context loads past fix patterns)
 * 4. Temporal patterns (time-of-day, day-of-week work habits)
 * 5. Co-occurrence (memories frequently activated together strengthen their link)
 */
export class ContextRecall {
  private hierarchicalMemory: HierarchicalMemory;
  private triggers: Map<string, TriggerPattern> = new Map();
  private activationLinks: Map<string, ActivationLink[]> = new Map();
  private recentActivations: Array<{ entryId: string; timestamp: Date; context: RecallContext }> = [];
  private storeDir: string;

  constructor(hierarchicalMemory: HierarchicalMemory, customDir?: string) {
    this.hierarchicalMemory = hierarchicalMemory;
    this.storeDir = customDir || STORE_DIR;
    this.loadFromDisk();
  }

  // ── Core Operations ──────────────────────────────────────────────────────────

  /** Activate memories based on current work context */
  recall(context: RecallContext, topK: number = 20): RecallResult[] {
    const activationScores = new Map<string, { score: number; triggers: RecallTrigger[] }>();

    // Phase 1: Score all entries by context relevance
    const allEntries = this.getAllEntries();
    for (const entry of allEntries) {
      const triggers = this.matchTriggers(entry.id, context);
      if (triggers.length === 0) continue;

      let score = 0;
      for (const trigger of triggers) {
        score += trigger.strength;
      }

      // Recency boost — recently accessed entries are more relevant
      const recencyMs = Date.now() - entry.lastAccessed.getTime();
      const recencyDays = recencyMs / (1000 * 60 * 60 * 24);
      score *= 1 / (1 + recencyDays * 0.05);

      // Importance boost
      score *= 0.5 + entry.importance * 0.5;

      // Higher-tier entries get a relevance premium
      const tierBonus: Record<MemoryTier, number> = {
        raw: 1.0,
        summary: 1.15,
        pattern: 1.3,
        principle: 1.5,
      };
      score *= tierBonus[entry.tier];

      if (score > 0.2) {
        activationScores.set(entry.id, { score, triggers });
      }
    }

    // Phase 2: Co-occurrence spreading activation
    for (const [entryId] of activationScores) {
      const links = this.activationLinks.get(entryId) || [];
      for (const link of links) {
        if (activationScores.has(link.targetId)) {
          // Boost already-activated neighbors
          const existing = activationScores.get(link.targetId)!;
          existing.score += link.strength * 0.15;
        } else {
          // Weakly activate linked entries
          const linkedEntry = this.hierarchicalMemory.get(link.targetId);
          if (linkedEntry) {
            activationScores.set(link.targetId, {
              score: link.strength * 0.3,
              triggers: [{
                patterns: [`co-occurrence with ${entryId}`],
                strength: link.strength * 0.3,
                recency: Date.now() - link.lastActivated.getTime(),
              }],
            });
          }
        }
      }
    }

    // Phase 3: Build results sorted by score
    const results: RecallResult[] = [];
    const sorted = Array.from(activationScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, topK);

    for (const [entryId, { score, triggers: matchedTriggers }] of sorted) {
      const entry = this.hierarchicalMemory.get(entryId);
      if (!entry) continue;

      results.push({
        entry,
        relevanceScore: Math.min(1, score),
        activatedTriggers: matchedTriggers.flatMap(t => t.patterns),
        activationPath: this.buildActivationPath(entryId, context),
      });

      // Update access tracking
      this.recentActivations.push({
        entryId,
        timestamp: new Date(),
        context,
      });
    }

    // Phase 4: Update co-occurrence links for co-activated entries
    this.updateCoOccurrence(results.map(r => r.entry.id));

    // Phase 5: Learn new triggers from this context
    this.learnTriggers(context, results);

    // Trim recent activations buffer
    if (this.recentActivations.length > 1000) {
      this.recentActivations = this.recentActivations.slice(-500);
    }

    return results;
  }

  /** Get a summary of what the brain "knows" about the current context */
  getContextSummary(context: RecallContext): string {
    const results = this.recall(context, 10);
    if (results.length === 0) {
      return `No relevant memories found for context: ${context.currentFile || 'general'}`;
    }

    const lines: string[] = [`Context recall for: ${context.currentFile || context.projectType || 'general'}`];
    lines.push(`Activated ${results.length} memories`);

    const byTier = new Map<MemoryTier, RecallResult[]>();
    for (const r of results) {
      const tier = r.entry.tier;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier)!.push(r);
    }

    for (const [tier, tierResults] of byTier) {
      lines.push(`\n[${tier.toUpperCase()}] (${tierResults.length})`);
      for (const r of tierResults.slice(0, 3)) {
        const preview = r.entry.content.slice(0, 100).replace(/\n/g, ' ');
        lines.push(`  ${(r.relevanceScore * 100).toFixed(0)}% — ${preview}...`);
      }
    }

    return lines.join('\n');
  }

  // ── Trigger System ────────────────────────────────────────────────────────────

  private matchTriggers(entryId: string, context: RecallContext): RecallTrigger[] {
    const triggers: RecallTrigger[] = [];
    const entry = this.hierarchicalMemory.get(entryId);
    if (!entry) return triggers;

    // File pattern matching
    if (context.currentFile) {
      const fileLower = context.currentFile.toLowerCase();
      const contentLower = entry.content.toLowerCase();

      // Direct file reference in memory content
      if (contentLower.includes(fileLower)) {
        triggers.push({
          patterns: [`file:${context.currentFile}`],
          strength: 0.6,
          recency: Date.now() - entry.lastAccessed.getTime(),
        });
      }

      // File extension category matching
      const ext = path.extname(context.currentFile).toLowerCase();
      const categoryMap: Record<string, string[]> = {
        '.ts': ['typescript', 'code', 'script'],
        '.tsx': ['typescript', 'react', 'component'],
        '.js': ['javascript', 'code', 'script'],
        '.py': ['python', 'code', 'script'],
        '.sql': ['database', 'sql', 'query'],
        '.css': ['style', 'css', 'layout'],
        '.html': ['markup', 'html', 'template'],
        '.json': ['config', 'data', 'json'],
        '.yml': ['config', 'yaml', 'ci'],
        '.yaml': ['config', 'yaml', 'ci'],
        '.md': ['documentation', 'readme', 'docs'],
      };

      const keywords = categoryMap[ext] || [];
      for (const kw of keywords) {
        if (contentLower.includes(kw) || entry.category.toLowerCase().includes(kw)) {
          triggers.push({
            patterns: [`ext-category:${kw}`],
            strength: 0.35,
            recency: Date.now() - entry.lastAccessed.getTime(),
          });
        }
      }

      // Directory-based category matching
      const dir = path.dirname(context.currentFile).toLowerCase();
      const dirCategories: Record<string, string> = {
        'auth': 'security',
        'security': 'security',
        'api': 'api',
        'database': 'database',
        'db': 'database',
        'test': 'testing',
        'tests': 'testing',
        '__tests__': 'testing',
        'config': 'configuration',
        'utils': 'utility',
        'helpers': 'utility',
        'components': 'component',
        'services': 'service',
        'models': 'model',
        'routes': 'routing',
        'controllers': 'controller',
        'middleware': 'middleware',
      };

      for (const [dirName, category] of Object.entries(dirCategories)) {
        if (dir.includes(dirName)) {
          if (contentLower.includes(category) || entry.category.toLowerCase().includes(category)) {
            triggers.push({
              patterns: [`dir-category:${dirName}→${category}`],
              strength: 0.4,
              recency: Date.now() - entry.lastAccessed.getTime(),
            });
          }
        }
      }
    }

    // Keyword matching
    if (context.keywords && context.keywords.length > 0) {
      const contentLower = entry.content.toLowerCase();
      const categoryLower = entry.category.toLowerCase();
      let keywordHits = 0;

      for (const keyword of context.keywords) {
        const kwLower = keyword.toLowerCase();
        if (contentLower.includes(kwLower) || categoryLower.includes(kwLower)) {
          keywordHits++;
        }
      }

      if (keywordHits > 0) {
        const keywordStrength = Math.min(0.8, keywordHits * 0.2);
        triggers.push({
          patterns: [`keywords:${keywordHits}/${context.keywords.length} matched`],
          strength: keywordStrength,
          recency: Date.now() - entry.lastAccessed.getTime(),
        });
      }
    }

    // Category direct match
    if (context.currentCategory) {
      if (entry.category.toLowerCase() === context.currentCategory.toLowerCase()) {
        triggers.push({
          patterns: [`category:${context.currentCategory}`],
          strength: 0.5,
          recency: Date.now() - entry.lastAccessed.getTime(),
        });
      }
    }

    // Project type matching
    if (context.projectType) {
      if (entry.metadata.projectType === context.projectType) {
        triggers.push({
          patterns: [`project-type:${context.projectType}`],
          strength: 0.3,
          recency: Date.now() - entry.lastAccessed.getTime(),
        });
      }
    }

    // Learned trigger patterns
    for (const [triggerId, trigger] of this.triggers) {
      if (this.triggerMatchesContext(trigger, context)) {
        const contentLower = entry.content.toLowerCase();
        if (contentLower.includes(trigger.pattern.toLowerCase())) {
          triggers.push({
            patterns: [`learned:${trigger.pattern}`],
            strength: trigger.strength * Math.min(1, trigger.matchCount * 0.1),
            recency: Date.now() - trigger.lastMatched.getTime(),
          });
          trigger.lastMatched = new Date();
          trigger.matchCount++;
        }
      }
    }

    return triggers;
  }

  private triggerMatchesContext(trigger: TriggerPattern, context: RecallContext): boolean {
    const pat = trigger.pattern.toLowerCase();
    if (context.currentFile?.toLowerCase().includes(pat)) return true;
    if (context.currentCategory?.toLowerCase().includes(pat)) return true;
    if (context.projectType?.toLowerCase().includes(pat)) return true;
    if (context.keywords?.some(k => k.toLowerCase().includes(pat))) return true;
    return false;
  }

  private learnTriggers(context: RecallContext, results: RecallResult[]): void {
    if (results.length === 0) return;

    // Extract potential trigger patterns from high-scoring results
    for (const result of results.slice(0, 5)) {
      if (result.relevanceScore < 0.5) continue;

      const entry = result.entry;

      // Learn from file paths mentioned in activated entries
      const filePaths = this.extractFilePaths(entry.content);
      for (const fp of filePaths) {
        const key = crypto.createHash('md5').update(`trigger:${fp}`).digest('hex').slice(0, 8);
        if (!this.triggers.has(key)) {
          this.triggers.set(key, {
            id: key,
            pattern: fp,
            category: entry.category,
            strength: 0.3,
            lastMatched: new Date(),
            matchCount: 1,
          });
        }
      }

      // Learn from keywords in context that matched
      if (context.keywords) {
        for (const keyword of context.keywords) {
          if (entry.content.toLowerCase().includes(keyword.toLowerCase())) {
            const key = crypto.createHash('md5').update(`trigger:kw:${keyword}`).digest('hex').slice(0, 8);
            const existing = this.triggers.get(key);
            if (existing) {
              existing.strength = Math.min(1, existing.strength + 0.05);
            } else {
              this.triggers.set(key, {
                id: key,
                pattern: keyword,
                category: entry.category,
                strength: 0.2,
                lastMatched: new Date(),
                matchCount: 1,
              });
            }
          }
        }
      }
    }
  }

  private extractFilePaths(text: string): string[] {
    const patterns = [
      /(?:src\/|lib\/|app\/|test\/|tests\/)[\w/.-]+\.\w+/g,
      /(?:\/?[\w-]+\/[\w-]+\.\w{2,4})/g,
    ];
    const paths: string[] = [];
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) paths.push(...matches.slice(0, 5));
    }
    return [...new Set(paths)];
  }

  // ── Co-occurrence Network ────────────────────────────────────────────────────

  private updateCoOccurrence(activatedIds: string[]): void {
    for (let i = 0; i < activatedIds.length; i++) {
      for (let j = i + 1; j < activatedIds.length; j++) {
        const a = activatedIds[i];
        const b = activatedIds[j];

        this.strengthenLink(a, b);
        this.strengthenLink(b, a);
      }
    }
  }

  private strengthenLink(sourceId: string, targetId: string): void {
    const links = this.activationLinks.get(sourceId) || [];
    const existing = links.find(l => l.targetId === targetId);

    if (existing) {
      existing.coOccurrence++;
      existing.strength = Math.min(1, existing.strength + 0.02);
      existing.lastActivated = new Date();
    } else {
      links.push({
        sourceId,
        targetId,
        strength: 0.1,
        coOccurrence: 1,
        lastActivated: new Date(),
      });
      this.activationLinks.set(sourceId, links);
    }

    // Cap links per entry to prevent unbounded growth
    if (links.length > 50) {
      links.sort((a, b) => b.strength - a.strength);
      this.activationLinks.set(sourceId, links.slice(0, 30));
    }
  }

  private buildActivationPath(entryId: string, context: RecallContext): string[] {
    const path: string[] = [];

    if (context.currentFile) path.push(`file:${context.currentFile}`);
    if (context.currentCategory) path.push(`category:${context.currentCategory}`);
    if (context.projectType) path.push(`project:${context.projectType}`);
    if (context.keywords?.length) path.push(`keywords:${context.keywords.join(',')}`);
    path.push(`→memory:${entryId.slice(0, 8)}`);

    return path;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getAllEntries(): Array<{
    id: string;
    tier: MemoryTier;
    content: string;
    category: string;
    importance: number;
    lastAccessed: Date;
    metadata: Record<string, unknown>;
  }> {
    const tiers: MemoryTier[] = ['raw', 'summary', 'pattern', 'principle'];
    const entries: Array<{
      id: string;
      tier: MemoryTier;
      content: string;
      category: string;
      importance: number;
      lastAccessed: Date;
      metadata: Record<string, unknown>;
    }> = [];

    for (const tier of tiers) {
      const tierEntries = this.hierarchicalMemory.getByTier(tier);
      for (const e of tierEntries) {
        entries.push({
          id: e.id,
          tier: e.tier,
          content: e.content,
          category: e.category,
          importance: e.importance,
          lastAccessed: e.lastAccessed,
          metadata: e.metadata,
        });
      }
    }

    return entries;
  }

  // ── Statistics ────────────────────────────────────────────────────────────────

  getStats(): {
    triggerCount: number;
    linkCount: number;
    recentActivationCount: number;
    topTriggers: Array<{ pattern: string; strength: number; matches: number }>;
  } {
    const topTriggers = Array.from(this.triggers.values())
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10)
      .map(t => ({ pattern: t.pattern, strength: t.strength, matches: t.matchCount }));

    let linkCount = 0;
    for (const links of this.activationLinks.values()) {
      linkCount += links.length;
    }

    return {
      triggerCount: this.triggers.size,
      linkCount,
      recentActivationCount: this.recentActivations.length,
      topTriggers,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  async persist(): Promise<void> {
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }

      const data = {
        triggers: Array.from(this.triggers.entries()).map(([id, t]) => ({
          id,
          pattern: t.pattern,
          category: t.category,
          strength: t.strength,
          lastMatched: t.lastMatched.toISOString(),
          matchCount: t.matchCount,
        })),
        links: Array.from(this.activationLinks.entries()).map(([sourceId, links]) => ({
          sourceId,
          targets: links.map(l => ({
            targetId: l.targetId,
            strength: l.strength,
            coOccurrence: l.coOccurrence,
            lastActivated: l.lastActivated.toISOString(),
          })),
        })),
        version: '5.0.0',
      };

      fs.writeFileSync(
        path.join(this.storeDir, 'recall-state.json'),
        JSON.stringify(data)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      const file = path.join(this.storeDir, 'recall-state.json');
      if (!fs.existsSync(file)) return;

      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

      if (data.triggers) {
        for (const t of data.triggers) {
          this.triggers.set(t.id, {
            id: t.id,
            pattern: t.pattern,
            category: t.category,
            strength: t.strength,
            lastMatched: new Date(t.lastMatched),
            matchCount: t.matchCount,
          });
        }
      }

      if (data.links) {
        for (const linkGroup of data.links) {
          const links: ActivationLink[] = linkGroup.targets.map((t: { targetId: string; strength: number; coOccurrence: number; lastActivated: string }) => ({
            sourceId: linkGroup.sourceId,
            targetId: t.targetId,
            strength: t.strength,
            coOccurrence: t.coOccurrence,
            lastActivated: new Date(t.lastActivated),
          }));
          this.activationLinks.set(linkGroup.sourceId, links);
        }
      }
    } catch {
      // Fresh start
    }
  }
}
