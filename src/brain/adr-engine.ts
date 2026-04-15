// src/brain/adr-engine.ts — Architecture Decision Records engine

import * as fs from 'fs';
import * as path from 'path';
import { ADRDecision } from '../types.js';
import { LLMClient } from './llm-client.js';

const ADR_HEADER_RE = /^#\s+(.+)$/;
const ADR_SECTION_RE = /^##\s+(.+)$/;

export class ADREngine {
  private projectDir: string;
  private llmClient: any;
  private adrDir: string;

  constructor(projectDir: string, llmClient: any) {
    this.projectDir = projectDir;
    this.llmClient = llmClient;

    // Prefer docs/adr/, fall back to .shadow-brain/adrs/
    const docsAdr = path.join(projectDir, 'docs', 'adr');
    const shadowAdr = path.join(projectDir, '.shadow-brain', 'adrs');

    if (fs.existsSync(docsAdr)) {
      this.adrDir = docsAdr;
    } else if (fs.existsSync(shadowAdr)) {
      this.adrDir = shadowAdr;
    } else {
      // Default to docs/adr (will be created on first save)
      this.adrDir = docsAdr;
    }
  }

  /**
   * Load all ADR markdown files from the ADR directory.
   * Returns parsed ADRDecision objects sorted by ID.
   */
  async loadADRs(): Promise<ADRDecision[]> {
    if (!fs.existsSync(this.adrDir)) {
      return [];
    }

    const adrs: ADRDecision[] = [];

    const files = fs.readdirSync(this.adrDir)
      .filter(f => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      const fullPath = path.join(this.adrDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const adr = this.parseADR(content, file);
        if (adr) adrs.push(adr);
      } catch {
        // unreadable file — skip
      }
    }

    return adrs;
  }

  /**
   * Write an ADR to the docs/adr/ directory in standard markdown format.
   * Filename pattern: NNNN-kebab-case-title.md
   */
  async saveADR(adr: ADRDecision): Promise<void> {
    // Ensure the directory exists
    fs.mkdirSync(this.adrDir, { recursive: true });

    // Determine the next sequence number
    const nextNum = await this.getNextNumber();
    const slug = this.slugify(adr.title);
    const filename = `${String(nextNum).padStart(4, '0')}-${slug}.md`;
    const fullPath = path.join(this.adrDir, filename);

    const markdown = this.formatADRMd(adr);
    fs.writeFileSync(fullPath, markdown, 'utf-8');
  }

  /**
   * Analyse file changes to detect architectural decisions.
   * Uses heuristic rules, and optionally an LLM client for deeper analysis.
   */
  async detectDecisions(
    changes: Array<{ path: string; diff?: string }>,
  ): Promise<ADRDecision[]> {
    const decisions: ADRDecision[] = [];
    const now = new Date();

    // Gather all diffs for LLM analysis if available
    const allDiffs: string[] = [];

    for (const change of changes) {
      const diff = change.diff || '';

      // ── Heuristic: Framework change ───────────────────────────────────────
      if (this.looksLikeFrameworkChange(change.path, diff)) {
        decisions.push({
          id: `adr-auto-${Date.now()}-framework`,
          title: `Framework or library adoption in ${path.basename(change.path)}`,
          status: 'proposed',
          date: now,
          context: `A significant framework or core library change was detected in ${change.path}.`,
          decision: 'Pending review — framework or library change detected automatically.',
          consequences: 'May affect the overall architecture, build pipeline, and dependency tree.',
          alternatives: ['Evaluate alternatives before committing', 'Create a spike/prototype first'],
          files: [change.path],
        });
        continue;
      }

      // ── Heuristic: New architectural pattern ──────────────────────────────
      if (this.looksLikeNewPattern(change.path, diff)) {
        decisions.push({
          id: `adr-auto-${Date.now()}-pattern`,
          title: `New architectural pattern introduced in ${path.basename(change.path)}`,
          status: 'proposed',
          date: now,
          context: `A new structural or architectural pattern was introduced in ${change.path}.`,
          decision: 'Pending review — new pattern detected automatically.',
          consequences: 'May establish a precedent for how similar features are structured.',
          alternatives: ['Document the pattern explicitly', 'Refactor to match existing patterns'],
          files: [change.path],
        });
        continue;
      }

      // ── Heuristic: Significant refactor ───────────────────────────────────
      if (this.looksLikeSignificantRefactor(diff)) {
        decisions.push({
          id: `adr-auto-${Date.now()}-refactor`,
          title: `Significant refactor in ${path.basename(change.path)}`,
          status: 'proposed',
          date: now,
          context: `A large-scale refactoring was detected in ${change.path}. This could indicate an architectural shift.`,
          decision: 'Pending review — significant code restructure detected.',
          consequences: 'Could affect multiple modules, API contracts, or data flows.',
          alternatives: ['Incremental refactor with feature flags', 'Phased rollout'],
          files: [change.path],
        });
        continue;
      }

      if (diff) {
        allDiffs.push(`--- ${change.path} ---\n${diff}`);
      }
    }

    // ── LLM-assisted detection ─────────────────────────────────────────────
    if (this.llmClient && allDiffs.length > 0) {
      try {
        const llmDecisions = await this.detectWithLLM(allDiffs);
        decisions.push(...llmDecisions);
      } catch {
        // LLM detection is best-effort — heuristics are the primary path
      }
    }

    return decisions;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Format an ADRDecision as a standard ADR markdown document.
   */
  private formatADRMd(adr: ADRDecision): string {
    let md = `# ${adr.title}\n\n`;
    md += `## Status\n\n${adr.status}\n\n`;
    md += `## Context\n\n${adr.context}\n\n`;
    md += `## Decision\n\n${adr.decision}\n\n`;
    md += `## Consequences\n\n${adr.consequences}\n\n`;

    if (adr.alternatives && adr.alternatives.length > 0) {
      md += `## Alternatives Considered\n\n`;
      for (const alt of adr.alternatives) {
        md += `- ${alt}\n`;
      }
      md += `\n`;
    }

    if (adr.files && adr.files.length > 0) {
      md += `## Files Affected\n\n`;
      for (const file of adr.files) {
        md += `- ${file}\n`;
      }
      md += `\n`;
    }

    md += `## Date\n\n${adr.date.toISOString().split('T')[0]}\n`;

    return md;
  }

  /**
   * Parse a markdown ADR file into an ADRDecision object.
   */
  private parseADR(content: string, filename: string): ADRDecision | null {
    const lines = content.split('\n');

    // Extract ID from filename (e.g. "0003-use-postgres.md" -> "0003")
    const idMatch = filename.match(/^(\d+)/);
    const id = idMatch ? idMatch[1] : filename.replace('.md', '');

    // Parse title from first H1
    let title = filename.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
    for (const line of lines) {
      const m = line.match(ADR_HEADER_RE);
      if (m) {
        title = m[1].trim();
        break;
      }
    }

    // Parse sections
    let status: ADRDecision['status'] = 'proposed';
    let context = '';
    let decision = '';
    let consequences = '';
    let alternatives: string[] = [];
    let currentSection = '';

    for (const line of lines) {
      const sectionMatch = line.match(ADR_SECTION_RE);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim().toLowerCase();
        continue;
      }

      switch (currentSection) {
        case 'status':
          const statusVal = line.trim().toLowerCase();
          if (['proposed', 'accepted', 'deprecated', 'superseded'].includes(statusVal)) {
            status = statusVal as ADRDecision['status'];
          }
          break;
        case 'context':
          context += line + '\n';
          break;
        case 'decision':
          decision += line + '\n';
          break;
        case 'consequences':
          consequences += line + '\n';
          break;
        case 'alternatives considered':
        case 'alternatives':
          const trimmed = line.trim();
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            alternatives.push(trimmed.slice(2).trim());
          } else if (trimmed && !trimmed.startsWith('#')) {
            alternatives.push(trimmed);
          }
          break;
      }
    }

    return {
      id,
      title,
      status,
      date: new Date(), // Files don't carry creation date in content; use mtime if needed
      context: context.trim(),
      decision: decision.trim(),
      consequences: consequences.trim(),
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  /**
   * Get the next sequence number for ADR filenames.
   */
  private async getNextNumber(): Promise<number> {
    if (!fs.existsSync(this.adrDir)) return 1;

    const files = fs.readdirSync(this.adrDir).filter(f => f.endsWith('.md'));
    let maxNum = 0;

    for (const file of files) {
      const match = file.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    return maxNum + 1;
  }

  /**
   * Heuristic: detect framework or core library changes.
   */
  private looksLikeFrameworkChange(filePath: string, diff: string): boolean {
    const frameworkIndicators = [
      /package\.json/,
      /next\.config/,
      /tsconfig\.json/,
      /webpack\.config/,
      /vite\.config/,
      /angular\.json/,
      /vue\.config/,
      /nuxt\.config/,
      /tailwind\.config/,
      /docker-compose/,
      /Dockerfile/,
      /\.env\.example/,
      /prisma\/schema/,
      /drizzle\.config/,
    ];

    const isConfigFile = frameworkIndicators.some(re => re.test(path.basename(filePath)));
    if (isConfigFile && diff.length > 100) return true;

    // Check diff for import changes of major frameworks
    const frameworkImports = [
      /from\s+['"]react['"]/,
      /from\s+['"]vue['"]/,
      /from\s+['"]@angular/,
      /from\s+['"]next['"]/,
      /from\s+['"]express['"]/,
      /from\s+['"]fastify['"]/,
      /from\s+['"]nestjs['"]/,
      /from\s+['"]@prisma/,
      /from\s+['"]drizzle-orm/,
    ];

    const hasFrameworkImport = frameworkImports.some(re => re.test(diff));
    return hasFrameworkImport && diff.length > 200;
  }

  /**
   * Heuristic: detect introduction of new architectural patterns.
   */
  private looksLikeNewPattern(filePath: string, diff: string): boolean {
    if (!diff) return false;

    const patternIndicators = [
      // Design patterns
      /\bclass\s+\w+Singleton\b/,
      /\bclass\s+\w+Factory\b/,
      /\bclass\s+\w+Strategy\b/,
      /\bclass\s+\w+Observer\b/,
      /\bclass\s+\w+Adapter\b/,
      /\bimplements\s+\w+Strategy/,
      /\bimplements\s+\w+Repository/,
      /\bimplements\s+\w+Service/,
      // Architectural patterns
      /\buseCase\b|\bUseCase\b/,
      /\brepository\b|\bRepository\b/,
      /\bservice\s+layer\b|\bServiceLayer\b/i,
      /\bclean\s+architecture\b/i,
      /\bhexagonal\b/i,
      /\bmiddleware\b/i,
      /\bplugin\b/i,
    ];

    return patternIndicators.some(re => re.test(diff));
  }

  /**
   * Heuristic: detect significant refactoring (large diffs with structural changes).
   */
  private looksLikeSignificantRefactor(diff: string): boolean {
    if (!diff || diff.length < 500) return false;

    // Count structural change indicators
    const addedLines = (diff.match(/^\+/gm) || []).length;
    const removedLines = (diff.match(/^-/gm) || []).length;

    // Significant if lots of additions and removals
    const totalChanges = addedLines + removedLines;
    if (totalChanges < 30) return false;

    // Check for structural keywords in the diff
    const structuralKeywords = [
      /\bclass\b.*\bextends\b/,
      /\binterface\b/,
      /\bexport\s+default\b/,
      /\bmodule\.exports\b/,
      /\bimport\s+.*\bfrom\b/,
      /\btype\s+\w+\s*=/,
      /\basync\s+/,
      /\bawait\s+/,
    ];

    let keywordHits = 0;
    for (const kw of structuralKeywords) {
      if (kw.test(diff)) keywordHits++;
    }

    return keywordHits >= 2;
  }

  /**
   * Use the LLM client to analyse diffs and detect architectural decisions.
   */
  private async detectWithLLM(diffs: string[]): Promise<ADRDecision[]> {
    if (!this.llmClient) return [];

    const combined = diffs.join('\n\n').slice(0, 8000); // truncate to reasonable size

    const prompt = `Analyse the following code diffs and identify any architectural decisions that should be documented as ADRs (Architecture Decision Records).
For each decision, provide:
- title: short descriptive title
- context: what is the situation that necessitates this decision
- decision: what was decided
- consequences: what are the resulting consequences

Respond with a JSON array of objects with keys: title, context, decision, consequences.
If no architectural decisions are detected, respond with an empty array: []

Diffs:
${combined}`;

    const response = await this.llmClient.complete(prompt,
      'You are a senior software architect. Analyse code changes and identify architectural decisions. Respond with valid JSON only.'
    );

    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any, idx: number) => ({
        id: `adr-llm-${Date.now()}-${idx}`,
        title: item.title || 'Untitled LLM-detected decision',
        status: 'proposed' as const,
        date: new Date(),
        context: item.context || '',
        decision: item.decision || '',
        consequences: item.consequences || '',
        alternatives: item.alternatives || undefined,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Convert a title string to a kebab-case slug for filenames.
   */
  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }
}
