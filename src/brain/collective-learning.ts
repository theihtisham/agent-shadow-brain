// src/brain/collective-learning.ts — Cross-Project Collective Intelligence
// Verified rules, viral propagation, accuracy tracking
// v5.0.0 — Infinite Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  CollectiveRule,
  CollectiveLearningStats,
} from '../types.js';

const STORE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.shadow-brain', 'collective'
);

const MAX_RULES = 10000;
const VERIFICATION_THRESHOLD = 2; // Needs 2+ verifications to be "verified"
const ACCURACY_THRESHOLD = 0.7; // 70% accuracy required for viral propagation

/**
 * CollectiveLearning — cross-project knowledge sharing with verified rules.
 *
 * When an insight or pattern is discovered in one project, it can be shared
 * as a "rule" to all other projects. Rules go through:
 *
 * 1. **Proposal**: A pattern is extracted and proposed as a general rule
 * 2. **Verification**: Other agents/projects test the rule and report results
 * 3. **Adoption**: Rules that pass verification threshold are adopted
 * 4. **Tracking**: Accuracy is continuously tracked — rules decay if inaccurate
 * 5. **Viral Propagation**: High-accuracy rules spread to more projects
 *
 * Trust model: Rules start with low trust and earn trust through verification.
 */
export class CollectiveLearning {
  private rules: Map<string, CollectiveRule> = new Map();
  private projectRules: Map<string, Set<string>> = new Map(); // projectId → rule IDs
  private storeDir: string;
  private projectId: string;

  constructor(projectId: string, customDir?: string) {
    this.projectId = projectId;
    this.storeDir = customDir || STORE_DIR;
    this.loadFromDisk();
  }

  // ── Rule Management ──────────────────────────────────────────────────────────

  /** Propose a new rule from a discovered pattern */
  proposeRule(
    content: string,
    category: string,
    originAgent: string,
    evidence: string[] = [],
    exceptions: string[] = []
  ): string {
    // Check for duplicate rules
    const contentHash = crypto
      .createHash('sha256')
      .update(content.toLowerCase().trim())
      .digest('hex');

    for (const existing of this.rules.values()) {
      const existingHash = crypto
        .createHash('sha256')
        .update(existing.content.toLowerCase().trim())
        .digest('hex');
      if (existingHash === contentHash) {
        // Already exists — verify it from this project
        this.verifyRule(existing.id, true);
        return existing.id;
      }
    }

    const id = crypto.randomUUID();

    const rule: CollectiveRule = {
      id,
      content,
      category,
      originProject: this.projectId,
      originAgent,
      verifiedBy: [],
      verifiedCount: 0,
      contradictCount: 0,
      trustScore: 0.3, // Start with low trust
      applicability: this.inferApplicability(content, category),
      exceptions,
      createdAt: new Date(),
      lastVerifiedAt: new Date(),
      timesApplied: 0,
      timesCorrect: 0,
      accuracy: 0.5,
      viralScore: 0,
    };

    this.rules.set(id, rule);

    // Track which rules this project knows about
    if (!this.projectRules.has(this.projectId)) {
      this.projectRules.set(this.projectId, new Set());
    }
    this.projectRules.get(this.projectId)!.add(id);

    // Cap total rules
    if (this.rules.size > MAX_RULES) {
      this.evictWeakestRules();
    }

    this.persistToDisk();
    return id;
  }

  /** Verify a rule (confirm or contradict from another project/agent) */
  verifyRule(ruleId: string, confirmed: boolean): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;

    if (confirmed) {
      rule.verifiedCount++;
      if (!rule.verifiedBy.includes(this.projectId)) {
        rule.verifiedBy.push(this.projectId);
      }
    } else {
      rule.contradictCount++;
    }

    rule.lastVerifiedAt = new Date();

    // Recalculate trust score
    const totalEvidence = rule.verifiedCount + rule.contradictCount;
    if (totalEvidence > 0) {
      const verificationRate = rule.verifiedCount / totalEvidence;
      rule.trustScore = Math.min(1, verificationRate * 0.7 + Math.min(totalEvidence * 0.03, 0.3));
    }

    // Track accuracy
    rule.accuracy = totalEvidence > 0
      ? rule.timesCorrect / Math.max(1, rule.timesApplied)
      : 0.5;

    // Update viral score
    rule.viralScore = this.calculateViralScore(rule);

    this.persistToDisk();
    return true;
  }

  /** Record that a rule was applied and whether it was correct */
  recordApplication(ruleId: string, wasCorrect: boolean): void {
    const rule = this.rules.get(ruleId);
    if (!rule) return;

    rule.timesApplied++;
    if (wasCorrect) {
      rule.timesCorrect++;
    }

    rule.accuracy = rule.timesApplied > 0
      ? rule.timesCorrect / rule.timesApplied
      : 0;

    // Auto-verify based on application outcome
    this.verifyRule(ruleId, wasCorrect);
  }

  // ── Rule Retrieval ────────────────────────────────────────────────────────────

  /** Get rules applicable to a given context */
  getApplicableRules(
    context: {
      files?: string[];
      category?: string;
      projectType?: string;
      keywords?: string[];
    },
    topK: number = 20
  ): CollectiveRule[] {
    const candidates: Array<{ rule: CollectiveRule; score: number }> = [];

    for (const rule of this.rules.values()) {
      let score = rule.trustScore * 0.4 + rule.accuracy * 0.3 + rule.viralScore * 0.2;

      // Category match
      if (context.category && rule.category === context.category) {
        score += 0.2;
      }

      // Applicability match
      if (context.projectType && rule.applicability.includes(context.projectType)) {
        score += 0.15;
      }

      // Keyword overlap
      if (context.keywords) {
        const ruleLower = rule.content.toLowerCase();
        const matches = context.keywords.filter(k => ruleLower.includes(k.toLowerCase())).length;
        score += Math.min(0.2, matches * 0.05);
      }

      // File path relevance
      if (context.files) {
        for (const file of context.files) {
          if (rule.content.toLowerCase().includes(path.extname(file).slice(1))) {
            score += 0.1;
          }
        }
      }

      // Only include rules with minimum trust
      if (score > 0.3) {
        candidates.push({ rule, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK).map(c => c.rule);
  }

  /** Get rules proposed by a specific project */
  getByOrigin(projectId: string): CollectiveRule[] {
    return Array.from(this.rules.values())
      .filter(r => r.originProject === projectId);
  }

  /** Get rules verified by a specific project */
  getVerifiedBy(projectId: string): CollectiveRule[] {
    return Array.from(this.rules.values())
      .filter(r => r.verifiedBy.includes(projectId));
  }

  /** Get all verified rules (above verification threshold) */
  getVerifiedRules(): CollectiveRule[] {
    return Array.from(this.rules.values())
      .filter(r => r.verifiedCount >= VERIFICATION_THRESHOLD && r.accuracy >= ACCURACY_THRESHOLD);
  }

  /** Get a specific rule by ID */
  get(ruleId: string): CollectiveRule | undefined {
    return this.rules.get(ruleId);
  }

  // ── Viral Propagation ────────────────────────────────────────────────────────

  /** Export high-value rules for sharing with other projects/agents */
  exportViralRules(): CollectiveRule[] {
    return this.getVerifiedRules()
      .filter(r => r.viralScore > 0.5)
      .sort((a, b) => b.viralScore - a.viralScore);
  }

  /** Import rules from another project/agent */
  importRules(rules: CollectiveRule[]): number {
    let imported = 0;

    for (const rule of rules) {
      const existing = this.rules.get(rule.id);
      if (existing) {
        // Merge verification data
        existing.verifiedCount = Math.max(existing.verifiedCount, rule.verifiedCount);
        existing.contradictCount = Math.max(existing.contradictCount, rule.contradictCount);
        existing.trustScore = Math.max(existing.trustScore, rule.trustScore);

        // Merge verifiedBy
        for (const verifier of rule.verifiedBy) {
          if (!existing.verifiedBy.includes(verifier)) {
            existing.verifiedBy.push(verifier);
          }
        }

        // Take higher accuracy
        existing.accuracy = Math.max(existing.accuracy, rule.accuracy);
        existing.viralScore = Math.max(existing.viralScore, rule.viralScore);
      } else {
        this.rules.set(rule.id, { ...rule });
        imported++;
      }
    }

    if (imported > 0) {
      this.persistToDisk();
    }

    return imported;
  }

  // ── Internal Helpers ─────────────────────────────────────────────────────────

  private calculateViralScore(rule: CollectiveRule): number {
    const verificationScore = Math.min(1, rule.verifiedCount * 0.15);
    const accuracyScore = rule.accuracy;
    const reachScore = Math.min(1, rule.verifiedBy.length * 0.1);
    const ageBonus = Math.min(0.1, (Date.now() - rule.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30) * 0.02);

    return verificationScore * 0.3 + accuracyScore * 0.4 + reachScore * 0.2 + ageBonus;
  }

  private inferApplicability(content: string, category: string): string[] {
    const applicability: string[] = ['general'];
    const lower = content.toLowerCase();

    const techMap: Record<string, string[]> = {
      'typescript': ['typescript', 'frontend', 'backend'],
      'javascript': ['javascript', 'frontend', 'backend'],
      'python': ['python', 'backend', 'ml'],
      'react': ['react', 'frontend'],
      'vue': ['vue', 'frontend'],
      'angular': ['angular', 'frontend'],
      'node': ['node', 'backend'],
      'express': ['express', 'backend'],
      'sql': ['database', 'sql'],
      'mongodb': ['database', 'mongodb'],
      'docker': ['devops', 'docker'],
      'kubernetes': ['devops', 'kubernetes'],
      'aws': ['cloud', 'aws'],
      'gcp': ['cloud', 'gcp'],
      'security': ['security'],
      'performance': ['performance'],
      'testing': ['testing'],
    };

    for (const [keyword, tags] of Object.entries(techMap)) {
      if (lower.includes(keyword) || category.includes(keyword)) {
        applicability.push(...tags);
      }
    }

    return [...new Set(applicability)];
  }

  private evictWeakestRules(): void {
    const sorted = Array.from(this.rules.entries())
      .sort((a, b) => a[1].trustScore * a[1].accuracy - b[1].trustScore * b[1].accuracy);

    // Remove bottom 10%
    const toRemove = Math.floor(sorted.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      this.rules.delete(sorted[i][0]);
    }
  }

  // ── Statistics ────────────────────────────────────────────────────────────────

  getStats(): CollectiveLearningStats {
    const rules = Array.from(this.rules.values());
    const verified = rules.filter(r => r.verifiedCount >= VERIFICATION_THRESHOLD);

    const categoryCount = new Map<string, number>();
    for (const rule of rules) {
      categoryCount.set(rule.category, (categoryCount.get(rule.category) || 0) + 1);
    }

    const topCategories = Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, count]) => {
        const catRules = rules.filter(r => r.category === cat);
        const avgAcc = catRules.length > 0
          ? catRules.reduce((s, r) => s + r.accuracy, 0) / catRules.length
          : 0;
        return { category: cat, count, avgAccuracy: avgAcc };
      });

    const avgAccuracy = verified.length > 0
      ? verified.reduce((s, r) => s + r.accuracy, 0) / verified.length
      : 0;

    const recentRules = rules
      .filter(r => Date.now() - r.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000)
      .length;

    return {
      totalRules: rules.length,
      verifiedRules: verified.length,
      averageAccuracy: avgAccuracy,
      topCategories,
      recentAdoptions: recentRules,
      consensusRate: rules.length > 0
        ? rules.filter(r => r.verifiedCount > 0).length / rules.length
        : 0,
      networkSize: new Set(rules.flatMap(r => r.verifiedBy)).size,
      knowledgeBaseSizeMB: 0, // Approximate — would need actual file size
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private persistToDisk(): void {
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }

      const data = {
        rules: Array.from(this.rules.entries()).map(([id, r]) => [
          id,
          {
            ...r,
            createdAt: r.createdAt.toISOString(),
            lastVerifiedAt: r.lastVerifiedAt.toISOString(),
          },
        ]),
        projectRules: Array.from(this.projectRules.entries()).map(([pid, rids]) => [
          pid,
          Array.from(rids),
        ]),
        version: '5.0.0',
      };

      fs.writeFileSync(
        path.join(this.storeDir, 'collective-rules.json'),
        JSON.stringify(data)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      const file = path.join(this.storeDir, 'collective-rules.json');
      if (!fs.existsSync(file)) return;

      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

      if (data.rules) {
        for (const [id, r] of data.rules as [string, Record<string, unknown>][]) {
          const rule = { ...r } as unknown as CollectiveRule;
          rule.createdAt = new Date(r.createdAt as string);
          rule.lastVerifiedAt = new Date(r.lastVerifiedAt as string);
          this.rules.set(id, rule);
        }
      }

      if (data.projectRules) {
        for (const [pid, rids] of data.projectRules as [string, string[]][]) {
          this.projectRules.set(pid, new Set(rids));
        }
      }
    } catch {
      // Fresh start
    }
  }
}
