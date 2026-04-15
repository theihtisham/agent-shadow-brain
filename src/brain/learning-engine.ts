// src/brain/learning-engine.ts — Self-Improvement Learning Engine for Shadow Brain
// Learns from past analysis sessions and gets smarter over time.
// v4.0.0 — SelfEvolution genetic rule optimization integration

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { BrainInsight, FileChange, ProjectContext, LearnedLesson, CodePattern, ProjectKnowledge } from '../types.js';
import type { LLMClient } from './llm-client.js';
import { SelfEvolution } from './self-evolution.js';

// ── Internal Store ──────────────────────────────────────────────────────────

interface LearningStore {
  version: number;
  lessons: LearnedLesson[];
  falsePositiveRates: Record<string, { reported: number; dismissed: number }>;
  codePatterns: CodePattern[];
  agentPreferences: Record<string, string[]>;
  projectKnowledge: Record<string, ProjectKnowledge>;
  lastTraining: Date;
}

// ── Learning Engine ─────────────────────────────────────────────────────────

export class LearningEngine {
  private store: LearningStore;
  private storePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private projectDir: string;
  private llmClient: LLMClient | null;
  private selfEvolution: SelfEvolution;
  private evolveCounter = 0;

  constructor(projectDir: string, llmClient?: LLMClient) {
    this.projectDir = projectDir;
    this.llmClient = llmClient ?? null;
    this.storePath = path.join(os.homedir(), '.shadow-brain', 'learning.json');
    this.selfEvolution = new SelfEvolution();

    this.store = {
      version: 1,
      lessons: [],
      falsePositiveRates: {},
      codePatterns: [],
      agentPreferences: {},
      projectKnowledge: {},
      lastTraining: new Date(),
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });

      const raw = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Hydrate date strings back to Date objects
      if (parsed.lastTraining) parsed.lastTraining = new Date(parsed.lastTraining);
      if (parsed.lessons) {
        parsed.lessons = parsed.lessons.map((l: any) => ({
          ...l,
          lastSeen: new Date(l.lastSeen),
        }));
      }
      if (parsed.codePatterns) {
        parsed.codePatterns = parsed.codePatterns.map((p: any) => ({
          ...p,
          lastSeen: new Date(p.lastSeen),
        }));
      }
      if (parsed.projectKnowledge) {
        for (const key of Object.keys(parsed.projectKnowledge)) {
          parsed.projectKnowledge[key].lastUpdated = new Date(parsed.projectKnowledge[key].lastUpdated);
        }
      }

      this.store = {
        version: parsed.version ?? 1,
        lessons: parsed.lessons ?? [],
        falsePositiveRates: parsed.falsePositiveRates ?? {},
        codePatterns: parsed.codePatterns ?? [],
        agentPreferences: parsed.agentPreferences ?? {},
        projectKnowledge: parsed.projectKnowledge ?? {},
        lastTraining: parsed.lastTraining ?? new Date(),
      };
    } catch {
      // File doesn't exist or is corrupt — start fresh
      this.store = {
        version: 1,
        lessons: [],
        falsePositiveRates: {},
        codePatterns: [],
        agentPreferences: {},
        projectKnowledge: {},
        lastTraining: new Date(),
      };
    }

    // v4.0.0: Apply evolved rules to adjust lesson confidence
    const bestRules = this.selfEvolution.getBestRules('all', 10);
    for (const lesson of this.store.lessons) {
      const matchingRule = bestRules.find(r =>
        r.category === lesson.category || r.category === 'all'
      );
      if (matchingRule) {
        if (matchingRule.fitness > 0.7) {
          lesson.confidence = Math.min(1.0, lesson.confidence + 0.1);
        } else if (matchingRule.fitness < 0.3) {
          lesson.confidence = Math.max(0, lesson.confidence - 0.05);
        }
      }
    }
  }

  async save(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });

      const data = JSON.stringify(this.store, null, 2);
      await fs.writeFile(this.storePath, data, 'utf-8');
    } catch (err: any) {
      console.error(`[LearningEngine] Failed to save store: ${err.message}`);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    // Debounce: wait 2 seconds before actually writing to disk
    this.saveTimer = setTimeout(() => {
      this.save().catch((err: any) => {
        console.error(`[LearningEngine] Debounced save failed: ${err.message}`);
      });
    }, 2000);
  }

  // ── Learning Methods ────────────────────────────────────────────────────

  learnFromInsights(insights: BrainInsight[], changes: FileChange[]): void {
    try {
      const now = new Date();

      for (const insight of insights) {
        // Track false positive rates per insight category
        const category = insight.type;
        if (!this.store.falsePositiveRates[category]) {
          this.store.falsePositiveRates[category] = { reported: 0, dismissed: 0 };
        }
        this.store.falsePositiveRates[category].reported++;

        // Create or update lessons based on patterns
        for (const change of changes) {
          const pattern = this.extractPattern(change);
          if (!pattern) continue;

          const existingLesson = this.store.lessons.find(
            (l) => l.pattern === pattern && l.category === category,
          );

          if (existingLesson) {
            existingLesson.occurrences++;
            existingLesson.lastSeen = now;
            // Slowly increase confidence when seen repeatedly
            existingLesson.confidence = Math.min(1.0, existingLesson.confidence + 0.02);
          } else {
            this.store.lessons.push({
              id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              category,
              pattern,
              lesson: insight.content.slice(0, 200),
              confidence: 0.3,
              occurrences: 1,
              lastSeen: now,
              source: 'rule',
            });
          }
        }

        // Track code patterns
        for (const change of changes) {
          if (!change.path) continue;
          const ext = path.extname(change.path).replace('.', '');
          if (!ext) continue;

          const contentPattern = this.extractCodePattern(change.content ?? '');
          if (!contentPattern) continue;

          const existingPattern = this.store.codePatterns.find(
            (p) => p.pattern === contentPattern && p.language === ext,
          );

          if (existingPattern) {
            existingPattern.frequency++;
            existingPattern.lastSeen = now;
            if (!existingPattern.associatedInsights.includes(insight.type)) {
              existingPattern.associatedInsights.push(insight.type);
            }
          } else {
            this.store.codePatterns.push({
              id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              language: ext,
              pattern: contentPattern,
              description: `Observed in ${path.basename(change.path)}`,
              frequency: 1,
              lastSeen: now,
              associatedInsights: [insight.type],
            });
          }
        }
      }

      this.store.lastTraining = now;
      this.scheduleSave();

      // v4.0.0: Trigger self-evolution every 10 calls
      this.evolveCounter++;
      if (this.evolveCounter % 10 === 0) {
        this.selfEvolution.evolve(insights).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[LearningEngine] learnFromInsights error: ${err.message}`);
    }
  }

  learnFromFeedback(insightId: string, accepted: boolean): void {
    try {
      if (!accepted) {
        // Find the lesson associated with this insight and reduce confidence
        const lesson = this.store.lessons.find(
          (l) => l.lesson.slice(0, 50) === insightId.slice(0, 50),
        );
        if (lesson) {
          lesson.confidence = Math.max(0, lesson.confidence - 0.15);
        }

        // Track in false positive rates
        if (!this.store.falsePositiveRates[insightId]) {
          this.store.falsePositiveRates[insightId] = { reported: 0, dismissed: 0 };
        }
        this.store.falsePositiveRates[insightId].dismissed++;
      }

      // v4.0.0: Feed self-evolution meta-learning
      const category = this.store.lessons.find(
        (l) => l.lesson.slice(0, 50) === insightId.slice(0, 50),
      )?.category || 'general';
      this.selfEvolution.updateMetaLearning(
        `feedback:${insightId.slice(0, 30)}`,
        accepted,
        category,
      );

      this.scheduleSave();
    } catch (err: any) {
      console.error(`[LearningEngine] learnFromFeedback error: ${err.message}`);
    }
  }

  async learnProjectPatterns(context: ProjectContext, files: string[]): Promise<void> {
    if (!this.llmClient) return;

    try {
      const fileSample = files.slice(0, 20).map((f) => path.basename(f)).join(', ');
      const langList = context.language.join(', ');

      const prompt = `Analyze this project and extract conventions, patterns, and architecture insights.

Project: ${context.name}
Languages: ${langList}
Framework: ${context.framework ?? 'unknown'}
Files sample: ${fileSample}
Directory structure: ${context.structure.slice(0, 30).join('\n')}

Return a JSON object with these fields:
{
  "conventions": ["list of coding conventions observed, e.g. 'uses arrow functions', 'snake_case file names'"],
  "architecture": "brief description of the architecture pattern used",
  "commonPatterns": ["common code patterns found in this project"],
  "avoidPatterns": ["patterns or practices this project avoids"],
  "dependencies": ["key dependencies this project relies on"]
}`;

      const systemPrompt = 'You are a codebase analysis expert. Extract patterns and conventions from project metadata. Return valid JSON only.';

      let result: ProjectKnowledge;
      try {
        result = await this.llmClient.completeWithSchema<ProjectKnowledge>(
          prompt,
          // Minimal inline schema since we can't use zod here without importing it
          // The LLMClient.completeWithSchema needs a ZodSchema, so we'll parse manually
          null as any,
          systemPrompt,
        );
      } catch {
        // Manual JSON parse fallback
        const raw = await this.llmClient.complete(prompt, systemPrompt);
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        result = JSON.parse(cleaned);
      }

      const knowledge: ProjectKnowledge = {
        name: context.name,
        conventions: result.conventions ?? [],
        architecture: result.architecture ?? '',
        commonPatterns: result.commonPatterns ?? [],
        avoidPatterns: result.avoidPatterns ?? [],
        dependencies: result.dependencies ?? [],
        lastUpdated: new Date(),
      };

      this.store.projectKnowledge[context.rootDir] = knowledge;
      this.scheduleSave();
    } catch (err: any) {
      console.error(`[LearningEngine] learnProjectPatterns error: ${err.message}`);
    }
  }

  // ── Retrieval Methods ───────────────────────────────────────────────────

  getRelevantLessons(changes: FileChange[]): LearnedLesson[] {
    const now = new Date();
    const relevant: LearnedLesson[] = [];

    // v4.0.0: Get best evolved rules for confidence adjustment
    const bestRules = this.selfEvolution.getBestRules('all', 10);

    for (const change of changes) {
      const pattern = this.extractPattern(change);
      if (!pattern) continue;

      for (const lesson of this.store.lessons) {
        // Match by pattern similarity or file extension
        if (
          lesson.pattern === pattern ||
          change.path.endsWith(`.${lesson.pattern.split(':')[0]}`) ||
          lesson.pattern.includes(path.extname(change.path).replace('.', ''))
        ) {
          // Boost confidence for recently seen lessons
          const daysSinceLastSeen = (now.getTime() - new Date(lesson.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
          const recencyBoost = Math.max(0, 1 - daysSinceLastSeen / 30) * 0.1;

          // v4.0.0: Apply evolved rule fitness as confidence modifier
          const matchingRule = bestRules.find(r =>
            r.category === lesson.category || r.category === 'all'
          );
          const fitnessBoost = matchingRule ? matchingRule.fitness * 0.2 : 0;

          relevant.push({
            ...lesson,
            confidence: Math.min(1.0, lesson.confidence + recencyBoost + fitnessBoost),
          });
        }
      }
    }

    // Sort by confidence descending, deduplicate
    const seen = new Set<string>();
    return relevant
      .sort((a, b) => b.confidence - a.confidence)
      .filter((l) => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      })
      .slice(0, 20);
  }

  getProjectKnowledge(projectDir: string): ProjectKnowledge | null {
    return this.store.projectKnowledge[projectDir] ?? null;
  }

  async getIntelligenceBoost(
    changes: FileChange[],
    context: ProjectContext,
  ): Promise<BrainInsight[]> {
    const insights: BrainInsight[] = [];

    try {
      // 1. Rule-based insights from learned lessons
      const relevantLessons = this.getRelevantLessons(changes);
      for (const lesson of relevantLessons) {
        if (lesson.confidence < 0.5) continue;

        insights.push({
          type: 'pattern',
          priority: lesson.confidence > 0.8 ? 'high' : lesson.confidence > 0.6 ? 'medium' : 'low',
          title: `Learned: ${lesson.category} pattern detected`,
          content: lesson.lesson,
          files: changes.map((c) => c.path),
          timestamp: new Date(),
        });
      }

      // 2. Knowledge-based insights from project conventions
      const knowledge = this.getProjectKnowledge(context.rootDir);
      if (knowledge) {
        for (const change of changes) {
          if (!change.content) continue;

          // Check if changes violate known avoid patterns
          for (const avoid of knowledge.avoidPatterns) {
            const patternLower = avoid.toLowerCase();
            const contentLower = change.content.toLowerCase();
            if (contentLower.includes(patternLower)) {
              insights.push({
                type: 'warning',
                priority: 'medium',
                title: `Project convention violation: ${avoid}`,
                content: `This project avoids "${avoid}". Consider refactoring in ${path.basename(change.path)}.`,
                files: [change.path],
                timestamp: new Date(),
              });
            }
          }
        }

        // Check for missing conventions
        for (const convention of knowledge.conventions) {
          const filesWithoutConvention = changes.filter((c) => {
            if (!c.content) return false;
            return !this.contentFollowsConvention(c.content, convention);
          });

          if (filesWithoutConvention.length > 0) {
            insights.push({
              type: 'suggestion',
              priority: 'low',
              title: `Convention check: ${convention}`,
              content: `Some files may not follow project convention "${convention}": ${filesWithoutConvention.map((f) => path.basename(f.path)).join(', ')}`,
              files: filesWithoutConvention.map((f) => f.path),
              timestamp: new Date(),
            });
          }
        }
      }

      // 3. LLM-powered super insights (if client available)
      if (this.llmClient && changes.length > 0) {
        const llmInsights = await this.generateLLMInsights(changes, context, knowledge);
        insights.push(...llmInsights);
      }
    } catch (err: any) {
      console.error(`[LearningEngine] getIntelligenceBoost error: ${err.message}`);
    }

    return insights;
  }

  getStats(): { totalLessons: number; totalPatterns: number; avgConfidence: number; projectCount: number } {
    const lessons = this.store.lessons;
    const totalConfidence = lessons.reduce((sum, l) => sum + l.confidence, 0);
    const avgConfidence = lessons.length > 0 ? totalConfidence / lessons.length : 0;

    return {
      totalLessons: lessons.length,
      totalPatterns: this.store.codePatterns.length,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      projectCount: Object.keys(this.store.projectKnowledge).length,
    };
  }

  // ── Orchestrator-Facing Methods ────────────────────────────────────────────

  /**
   * learnFromProject — Scan the project for patterns and extract lessons.
   * Called by the orchestrator during a learning cycle.
   */
  async learnFromProject(): Promise<void> {
    try {
      const srcDir = path.join(this.projectDir, 'src');
      const scanDir = await this.dirExists(srcDir) ? srcDir : this.projectDir;

      const sourceFiles = await this.collectSourceFiles(scanDir, 100);
      if (sourceFiles.length === 0) return;

      const now = new Date();

      for (const filePath of sourceFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const ext = path.extname(filePath).replace('.', '');

          // Extract code patterns from each file
          const patternKey = this.extractCodePattern(content);
          if (!patternKey) continue;

          // Record or update each individual pattern
          const individualPatterns = patternKey.split('+');
          for (const pat of individualPatterns) {
            const existing = this.store.codePatterns.find(
              (p) => p.pattern === pat && p.language === ext,
            );

            if (existing) {
              existing.frequency++;
              existing.lastSeen = now;
            } else {
              this.store.codePatterns.push({
                id: `pattern-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
                language: ext,
                pattern: pat,
                description: `Observed in ${path.relative(this.projectDir, filePath)}`,
                frequency: 1,
                lastSeen: now,
                associatedInsights: [],
              });
            }
          }

          // Create lessons for notable patterns
          this.createLessonFromContent(content, filePath, ext, now);
        } catch {
          // Skip unreadable files
        }
      }

      // If LLM is available, enrich lessons with AI analysis
      if (this.llmClient && this.store.codePatterns.length > 0) {
        try {
          await this.enrichLessonsWithLLM();
        } catch (err: any) {
          console.error(`[LearningEngine] LLM enrichment failed: ${err.message}`);
        }
      }

      this.store.lastTraining = now;
      this.scheduleSave();
    } catch (err: any) {
      console.error(`[LearningEngine] learnFromProject error: ${err.message}`);
    }
  }

  /**
   * getLessons — Return all learned lessons in the format the orchestrator expects.
   */
  async getLessons(): Promise<Array<{ category: string; pattern: string; lesson: string; confidence: number }>> {
    return this.store.lessons
      .sort((a, b) => b.confidence - a.confidence)
      .map((l) => ({
        category: l.category,
        pattern: l.pattern,
        lesson: l.lesson,
        confidence: l.confidence,
      }));
  }

  /**
   * recordInsight — Record a BrainInsight as a learned lesson.
   * Called by the orchestrator when critical/high-priority insights are generated.
   */
  async recordInsight(insight: BrainInsight): Promise<void> {
    try {
      const now = new Date();

      // Create a lesson from the insight
      const pattern = insight.files && insight.files.length > 0
        ? `${path.extname(insight.files[0]).replace('.', '') || 'general'}:${insight.type}`
        : `general:${insight.type}`;

      const existing = this.store.lessons.find(
        (l) => l.pattern === pattern && l.lesson === insight.content.slice(0, 300),
      );

      if (existing) {
        existing.occurrences++;
        existing.lastSeen = now;
        // Boost confidence slightly for repeated observations
        existing.confidence = Math.min(1.0, existing.confidence + 0.05);
      } else {
        this.store.lessons.push({
          id: `lesson-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          category: insight.type,
          pattern,
          lesson: insight.content.slice(0, 300),
          confidence: insight.priority === 'critical' ? 0.7 : insight.priority === 'high' ? 0.5 : 0.3,
          occurrences: 1,
          lastSeen: now,
          source: 'rule',
        });
      }

      // Update false positive tracking
      if (!this.store.falsePositiveRates[insight.type]) {
        this.store.falsePositiveRates[insight.type] = { reported: 0, dismissed: 0 };
      }
      this.store.falsePositiveRates[insight.type].reported++;

      this.store.lastTraining = now;
      this.scheduleSave();
    } catch (err: any) {
      console.error(`[LearningEngine] recordInsight error: ${err.message}`);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  cleanup(): void {
    try {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Remove low-confidence lessons
      this.store.lessons = this.store.lessons.filter((l) => l.confidence >= 0.1);

      // Remove stale code patterns (older than 60 days)
      this.store.codePatterns = this.store.codePatterns.filter(
        (p) => new Date(p.lastSeen) > sixtyDaysAgo,
      );

      this.scheduleSave();
    } catch (err: any) {
      console.error(`[LearningEngine] cleanup error: ${err.message}`);
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async collectSourceFiles(dir: string, limit: number): Promise<string[]> {
    const results: string[] = [];
    const skipDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '.next', '.nuxt', '.cache', '.turbo', '__pycache__',
      'target', 'vendor', '.shadow-brain',
    ]);
    const sourceExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.go', '.rs', '.java', '.rb',
    ]);

    const queue: string[] = [dir];

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      let entries: { name: string; fullPath: string; isDir: boolean }[];
      try {
        const dirents = await fs.readdir(current, { withFileTypes: true });
        entries = dirents.map((e) => ({
          name: e.name,
          fullPath: path.join(current, e.name),
          isDir: e.isDirectory(),
        }));
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (results.length >= limit) break;

        if (entry.isDir) {
          if (!entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
            queue.push(entry.fullPath);
          }
        } else {
          const ext = path.extname(entry.name);
          if (sourceExtensions.has(ext)) {
            results.push(entry.fullPath);
          }
        }
      }
    }

    return results;
  }

  private createLessonFromContent(
    content: string,
    filePath: string,
    ext: string,
    now: Date,
  ): void {
    const relPath = path.relative(this.projectDir, filePath);
    const lessons: Array<{ category: string; lesson: string; pattern: string }> = [];

    // Security anti-patterns
    if (/\beval\s*\(/.test(content)) {
      lessons.push({
        category: 'security',
        lesson: `Avoid eval() in ${relPath} — it introduces code injection risks`,
        pattern: `eval:${ext}`,
      });
    }
    if (/innerHTML\s*=/.test(content) && !/sanitize|escape|DOMPurify/.test(content)) {
      lessons.push({
        category: 'security',
        lesson: `Direct innerHTML assignment in ${relPath} without sanitization — XSS risk`,
        pattern: `innerHTML:${ext}`,
      });
    }

    // TypeScript quality
    if (ext === 'ts' || ext === 'tsx') {
      const anyMatches = content.match(/:\s*any\b/g);
      if (anyMatches && anyMatches.length > 3) {
        lessons.push({
          category: 'quality',
          lesson: `${relPath} uses 'any' type ${anyMatches.length} times — prefer specific types`,
          pattern: `excessive-any:${ext}`,
        });
      }
      if (/\bas\s+any/.test(content)) {
        lessons.push({
          category: 'quality',
          lesson: `Type assertion 'as any' found in ${relPath} — defeats type safety`,
          pattern: `as-any:${ext}`,
        });
      }
    }

    // Error handling
    if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(content)) {
      lessons.push({
        category: 'quality',
        lesson: `Empty catch block in ${relPath} — silently swallowing errors`,
        pattern: `empty-catch:${ext}`,
      });
    }

    // Performance
    if (/\.forEach\s*\(/.test(content) && /await/.test(content)) {
      lessons.push({
        category: 'performance',
        lesson: `Async operations inside forEach in ${relPath} — use for...of or Promise.all instead`,
        pattern: `async-foreach:${ext}`,
      });
    }

    // Maintainability
    const lines = content.split('\n').length;
    if (lines > 500) {
      lessons.push({
        category: 'maintainability',
        lesson: `${relPath} is ${lines} lines long — consider splitting into smaller modules`,
        pattern: `large-file:${ext}`,
      });
    }

    // Add lessons to the store
    for (const { category, lesson, pattern } of lessons) {
      const existing = this.store.lessons.find(
        (l) => l.pattern === pattern && l.category === category,
      );

      if (existing) {
        existing.occurrences++;
        existing.lastSeen = now;
        existing.confidence = Math.min(1.0, existing.confidence + 0.03);
      } else {
        this.store.lessons.push({
          id: `lesson-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          category,
          pattern,
          lesson,
          confidence: 0.4,
          occurrences: 1,
          lastSeen: now,
          source: 'rule',
        });
      }
    }
  }

  private async enrichLessonsWithLLM(): Promise<void> {
    if (!this.llmClient) return;

    // Pick the top patterns to analyze
    const topPatterns = this.store.codePatterns
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    const patternSummary = topPatterns
      .map((p) => `- [${p.language}] ${p.pattern} (frequency: ${p.frequency})`)
      .join('\n');

    const lessonSummary = this.store.lessons
      .slice(0, 10)
      .map((l) => `- [${l.category}] ${l.lesson}`)
      .join('\n');

    const prompt = `Given these code patterns and existing lessons from a project, suggest additional lessons that a senior developer would know.

Observed patterns:
${patternSummary}

Existing lessons:
${lessonSummary || 'None yet.'}

Return a JSON array of lesson objects:
[{
  "category": "security" | "performance" | "quality" | "architecture" | "maintainability",
  "pattern": "short pattern key",
  "lesson": "actionable lesson text",
  "confidence": 0.5
}]

Provide 3-5 non-obvious lessons. Do NOT repeat existing ones.`;

    const systemPrompt = 'You are an expert code reviewer. Suggest non-obvious lessons from code patterns. Return valid JSON array only.';

    try {
      const response = await this.llmClient.complete(prompt, systemPrompt);
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: any[];
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          return;
        }
      }

      if (!Array.isArray(parsed)) return;

      const now = new Date();
      for (const item of parsed) {
        if (!item.category || !item.pattern || !item.lesson) continue;

        const existing = this.store.lessons.find(
          (l) => l.pattern === item.pattern && l.category === item.category,
        );

        if (existing) continue; // Don't overwrite

        this.store.lessons.push({
          id: `lesson-llm-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          category: item.category,
          pattern: item.pattern,
          lesson: item.lesson,
          confidence: item.confidence ?? 0.5,
          occurrences: 1,
          lastSeen: now,
          source: 'llm',
        });
      }
    } catch {
      // LLM enrichment is best-effort
    }
  }

  private extractPattern(change: FileChange): string | null {
    if (!change.path) return null;
    const ext = path.extname(change.path).replace('.', '');
    const type = change.type;

    // Create a pattern key from file extension + change type
    if (ext) {
      return `${ext}:${type}`;
    }

    // Fallback: use directory-based pattern
    const dir = path.dirname(change.path).split(path.sep).slice(-2).join('/');
    return `dir:${dir}:${type}`;
  }

  private extractCodePattern(content: string): string | null {
    if (!content || content.length < 10) return null;

    // Detect common patterns in code content
    const patterns: string[] = [];

    // Arrow functions
    if (/=>\s*\{/.test(content)) patterns.push('arrow-fn');
    // async/await
    if (/async\s+/.test(content) && /await\s+/.test(content)) patterns.push('async-await');
    // try/catch
    if (/try\s*\{/.test(content) && /catch\s*\(/.test(content)) patterns.push('try-catch');
    // console.log
    if (/console\.log/.test(content)) patterns.push('console-log');
    // TODO/FIXME
    if (/TODO|FIXME|HACK|XXX/.test(content)) patterns.push('todo-comment');
    // class-based
    if (/class\s+\w+/.test(content)) patterns.push('class-based');
    // export default
    if (/export\s+default/.test(content)) patterns.push('export-default');
    // named exports
    if (/export\s+(const|function|class|interface|type)\s/.test(content)) patterns.push('named-export');
    // type assertions
    if (/as\s+\w+/.test(content)) patterns.push('type-assertion');
    // null checks
    if (/[!=]==?\s*null|[!=]==?\s*undefined|\?\.|!\./.test(content)) patterns.push('null-check');
    // Promises
    if (/new\s+Promise|\.then\(|\.catch\(/.test(content)) patterns.push('promise');
    // Error throwing
    if (/throw\s+new\s+/.test(content)) patterns.push('throw-error');

    return patterns.length > 0 ? patterns.join('+') : null;
  }

  private contentFollowsConvention(content: string, convention: string): boolean {
    const lower = convention.toLowerCase();

    if (lower.includes('arrow function') && !/=>/.test(content)) return false;
    if (lower.includes('camelcase') && /_\w/.test(content) && !/^[A-Z]/.test(content)) return true;
    if (lower.includes('snake_case') && /[a-z][A-Z]/.test(content)) return false;
    if (lower.includes('semicolon') && /[^;{}]\s*$/m.test(content)) return false;

    // Default: assume it follows
    return true;
  }

  private async generateLLMInsights(
    changes: FileChange[],
    context: ProjectContext,
    knowledge: ProjectKnowledge | null,
  ): Promise<BrainInsight[]> {
    if (!this.llmClient) return [];

    try {
      const changeSummaries = changes
        .slice(0, 10)
        .map((c) => `- ${c.type} ${c.path}${c.content ? ` (${c.content.split('\n').length} lines)` : ''}`)
        .join('\n');

      const knowledgeContext = knowledge
        ? `Known conventions: ${knowledge.conventions.join(', ')}
Architecture: ${knowledge.architecture}
Avoid: ${knowledge.avoidPatterns.join(', ')}`
        : 'No prior knowledge about this project.';

      const lessonsContext = this.store.lessons
        .filter((l) => l.confidence >= 0.6)
        .slice(0, 10)
        .map((l) => `- [${l.category}] ${l.lesson} (confidence: ${l.confidence.toFixed(2)})`)
        .join('\n');

      const prompt = `You are a senior code reviewer AI that has been learning from past code reviews.

Analyze these file changes and provide insights that a standard rule-based linter would MISS:

Project: ${context.name}
Languages: ${context.language.join(', ')}
Framework: ${context.framework ?? 'unknown'}

Changes:
${changeSummaries}

${knowledgeContext}

Previously learned lessons:
${lessonsContext || 'No lessons learned yet.'}

Return a JSON array of insights. Each insight has:
{
  "type": "review" | "suggestion" | "warning",
  "priority": "critical" | "high" | "medium" | "low",
  "title": "short title",
  "content": "detailed explanation of the insight with actionable advice",
  "files": ["affected file paths"]
}

Focus on: architectural concerns, maintainability, hidden bugs, performance pitfalls, security gotchas that require human-like understanding.
Do NOT report obvious linting issues — only things that require deep understanding.`;

      const systemPrompt = 'You are an expert code reviewer AI. Provide deep, non-obvious insights about code changes. Return a valid JSON array. No markdown fences.';

      const response = await this.llmClient.complete(prompt, systemPrompt);
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: any[];
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Try to extract JSON array from response
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          return [];
        }
      }

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: any) => item.title && item.content)
        .map((item: any): BrainInsight => ({
          type: item.type ?? 'suggestion',
          priority: item.priority ?? 'medium',
          title: item.title,
          content: item.content,
          files: Array.isArray(item.files) ? item.files : [],
          timestamp: new Date(),
        }))
        .slice(0, 10);
    } catch (err: any) {
      console.error(`[LearningEngine] LLM insight generation failed: ${err.message}`);
      return [];
    }
  }

  /** v4.0.0: Get the self-evolution engine reference */
  getSelfEvolution(): SelfEvolution {
    return this.selfEvolution;
  }

  /** v4.0.0: Get evolution stats */
  getEvolutionStats(): { generation: number; populationSize: number; bestFitness: number } {
    const bestRules = this.selfEvolution.getBestRules('all', 1);
    return {
      generation: this.selfEvolution.getGeneration(),
      populationSize: this.selfEvolution.getPopulationSize(),
      bestFitness: bestRules.length > 0 ? bestRules[0].fitness : 0,
    };
  }
}
