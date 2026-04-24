// src/brain/pr-auto-review.ts — PR review with brain context
// v6.0.0 — Hive Mind Edition
//
// Generates a Markdown review comment for a PR that cites brain memories.
// Does NOT post — returns a string you can post via gh CLI or github API.

import {
  PRReviewComment,
  GlobalEntry,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

export interface PRReviewInput {
  repo: string;
  prNumber: number;
  projectDir: string;
  diffSummary: string;
  changedFiles: string[];
}

export class PRAutoReview {
  private brain: GlobalBrain;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async generate(input: PRReviewInput): Promise<PRReviewComment> {
    await this.brain.init();

    const projectId = GlobalBrain.projectIdFor(input.projectDir);
    const terms = this.extractTerms(`${input.diffSummary} ${input.changedFiles.join(' ')}`);
    const relevant = this.brain.recall({ projectId, keywords: terms, limit: 30 });

    const matches: string[] = [];
    const contradictions: string[] = [];
    const suggestions: string[] = [];
    const citations: PRReviewComment['sections']['citations'] = [];

    for (const entry of relevant.slice(0, 12)) {
      const snippet = entry.content.slice(0, 160);
      citations.push({ memoryId: entry.id, snippet });
      const category = entry.category.toLowerCase();
      if (category.includes('warning') || category.includes('pitfall') || category.includes('failure')) {
        contradictions.push(`⚠️  Prior issue: ${snippet}`);
      } else if (category.includes('pattern') || category.includes('decision')) {
        matches.push(`✅ Matches pattern: ${snippet}`);
      } else {
        suggestions.push(`💡 Related memory: ${snippet}`);
      }
    }

    if (!matches.length && !contradictions.length && !suggestions.length) {
      suggestions.push('No directly related project memories found. Brain is still learning.');
    }

    const body = [
      `## Shadow Brain Review (${relevant.length} memories considered)`,
      ``,
      `**Changed files:** ${input.changedFiles.slice(0, 10).join(', ')}`,
      ``,
      matches.length ? `### Pattern matches\n${matches.join('\n')}` : '',
      contradictions.length ? `\n### Past issues to re-check\n${contradictions.join('\n')}` : '',
      suggestions.length ? `\n### Suggestions\n${suggestions.join('\n')}` : '',
      `\n---\n<sub>_Shadow Brain v6.0 · Hive Mind — https://github.com/theihtisham/agent-shadow-brain_</sub>`,
    ].filter(Boolean).join('\n');

    return {
      prNumber: input.prNumber,
      repo: input.repo,
      body,
      sections: { matches, contradictions, suggestions, citations },
      generatedAt: new Date(),
    };
  }

  private extractTerms(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_./]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['file', 'files', 'diff', 'added', 'removed', 'changed', 'modified'].includes(w))
      .slice(0, 15);
  }
}

let _instance: PRAutoReview | null = null;

export function getPRAutoReview(): PRAutoReview {
  if (!_instance) _instance = new PRAutoReview();
  return _instance;
}

export function resetPRAutoReviewForTests(): void {
  _instance = null;
}
