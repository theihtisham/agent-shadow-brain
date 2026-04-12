// src/brain/pr-generator.ts — Auto-generate PR descriptions & commit messages from diffs

import { LLMClient } from './llm-client.js';
import { FileChange, PRDescription, CommitMessage } from '../types.js';

export class PRGenerator {
  private llmClient: LLMClient | null;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || null;
  }

  async generatePRDescription(changes: FileChange[], branch?: string): Promise<PRDescription> {
    const summary = this.summarizeChanges(changes);

    if (this.llmClient) {
      try {
        const prompt = this.buildPRPrompt(summary, branch);
        const response = await this.llmClient.complete(prompt, 'You are a senior developer writing clear PR descriptions. Return valid JSON only.');
        return this.parsePRResponse(response);
      } catch { /* fall back to rule-based */ }
    }

    return this.ruleBasedPR(changes, summary);
  }

  async generateCommitMessage(changes: FileChange[]): Promise<CommitMessage> {
    const summary = this.summarizeChanges(changes);

    if (this.llmClient) {
      try {
        const prompt = this.buildCommitPrompt(summary);
        const response = await this.llmClient.complete(prompt, 'Return valid JSON only.');
        return this.parseCommitResponse(response);
      } catch { /* fall back */ }
    }

    return this.ruleBasedCommit(changes, summary);
  }

  private summarizeChanges(changes: FileChange[]): string {
    const added = changes.filter(c => c.type === 'add').map(c => c.path);
    const modified = changes.filter(c => c.type === 'modify').map(c => c.path);
    const deleted = changes.filter(c => c.type === 'delete').map(c => c.path);
    const renamed = changes.filter(c => c.type === 'rename').map(c => `${c.oldPath} → ${c.path}`);

    let out = '';
    if (added.length) out += `Added: ${added.join(', ')}\n`;
    if (modified.length) out += `Modified: ${modified.join(', ')}\n`;
    if (deleted.length) out += `Deleted: ${deleted.join(', ')}\n`;
    if (renamed.length) out += `Renamed: ${renamed.join(', ')}\n`;

    // Sample diff content
    const diffSamples = changes.slice(0, 5).map(c => {
      const content = c.content || c.diff || '';
      return `--- ${c.path} ---\n${content.slice(0, 500)}`;
    }).join('\n\n');

    return out + '\nDiff samples:\n' + diffSamples;
  }

  private buildPRPrompt(summary: string, branch?: string): string {
    return `Analyze these code changes and generate a PR description as JSON:
{
  "title": "short PR title (<72 chars)",
  "body": "markdown PR body with summary, changes list, test plan",
  "type": "feat|fix|refactor|docs|test|chore|perf",
  "scope": "optional scope like 'auth', 'api', etc",
  "breaking": false
}

Branch: ${branch || 'unknown'}
Changes:
${summary}`;
  }

  private buildCommitPrompt(summary: string): string {
    return `Generate a conventional commit message for these changes as JSON:
{
  "conventional": "type(scope): short message",
  "short": "short message without prefix",
  "detailed": "multi-line detailed message"
}

Changes:
${summary}`;
  }

  private parsePRResponse(response: string): PRDescription {
    try {
      const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        title: parsed.title || 'Update codebase',
        body: parsed.body || '',
        type: parsed.type || 'chore',
        scope: parsed.scope,
        breaking: parsed.breaking === true,
      };
    } catch {
      return { title: 'Update codebase', body: response, type: 'chore', breaking: false };
    }
  }

  private parseCommitResponse(response: string): CommitMessage {
    try {
      const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        conventional: parsed.conventional || 'chore: update code',
        short: parsed.short || 'update code',
        detailed: parsed.detailed || '',
      };
    } catch {
      return { conventional: 'chore: update code', short: 'update code', detailed: response };
    }
  }

  private ruleBasedPR(changes: FileChange[], summary: string): PRDescription {
    const types: Record<string, number> = {};
    for (const c of changes) types[c.type] = (types[c.type] || 0) + 1;

    const hasTests = changes.some(c => c.path.includes('.test.') || c.path.includes('.spec.'));
    const hasDocs = changes.some(c => c.path.includes('.md') || c.path.includes('docs/'));
    const hasDeps = changes.some(c => c.path.includes('package.json') || c.path.includes('requirements'));
    const hasConfig = changes.some(c => c.path.includes('.config') || c.path.includes('tsconfig'));

    let prType: PRDescription['type'] = 'feat';
    let scope: string | undefined;

    if (changes.every(c => c.path.includes('.test.') || c.path.includes('.spec.'))) prType = 'test';
    else if (changes.every(c => c.path.endsWith('.md'))) prType = 'docs';
    else if (hasDeps && changes.length <= 3) prType = 'chore';
    else if (hasConfig && !hasTests) prType = 'refactor';
    else if (types['delete'] && !types['add']) prType = 'refactor';

    // Detect scope from common patterns
    for (const c of changes) {
      if (c.path.includes('auth')) { scope = 'auth'; break; }
      if (c.path.includes('api')) { scope = 'api'; break; }
      if (c.path.includes('ui') || c.path.includes('component')) { scope = 'ui'; break; }
      if (c.path.includes('db') || c.path.includes('migration')) { scope = 'db'; break; }
    }

    const added = changes.filter(c => c.type === 'add');
    const modified = changes.filter(c => c.type === 'modify');
    const deleted = changes.filter(c => c.type === 'delete');

    let body = '## Summary\n\n';
    if (added.length) body += `- Added ${added.length} file(s)\n`;
    if (modified.length) body += `- Modified ${modified.length} file(s)\n`;
    if (deleted.length) body += `- Removed ${deleted.length} file(s)\n`;
    if (hasTests) body += '\n## Test Plan\n- Verify test suite passes\n';
    if (hasDeps) body += '\n> **Note:** Dependency changes detected — review for compatibility.\n';

    const title = `${prType}${scope ? `(${scope})` : ''}: ${this.inferTitle(changes)}`;

    return { title, body, type: prType, scope, breaking: false };
  }

  private ruleBasedCommit(changes: FileChange[], summary: string): CommitMessage {
    const pr = this.ruleBasedPR(changes, summary);
    return {
      conventional: pr.title,
      short: pr.title.split(': ').slice(-1)[0],
      detailed: pr.body.replace(/^## /gm, '').trim(),
    };
  }

  private inferTitle(changes: FileChange[]): string {
    if (changes.length === 1) {
      const p = changes[0].path;
      const name = p.split('/').pop() || p;
      return `update ${name}`;
    }
    const dirs = new Set(changes.map(c => c.path.split('/').slice(0, -1).join('/') || 'root'));
    if (dirs.size === 1) return `update ${[...dirs][0]}`;
    return `update ${changes.length} files`;
  }

  formatPR(pr: PRDescription): string {
    let out = `\n  Generated PR Description\n`;
    out += `  ${'─'.repeat(50)}\n\n`;
    out += `  Title: ${pr.title}\n\n`;
    out += `  Type: ${pr.type}${pr.scope ? ` (${pr.scope})` : ''}${pr.breaking ? ' [BREAKING]' : ''}\n\n`;
    out += `  Body:\n  ${pr.body.split('\n').join('\n  ')}\n`;
    return out;
  }

  formatCommit(msg: CommitMessage): string {
    let out = `\n  Generated Commit Message\n`;
    out += `  ${'─'.repeat(50)}\n\n`;
    out += `  Conventional: ${msg.conventional}\n`;
    out += `  Short:        ${msg.short}\n`;
    if (msg.detailed) out += `  Detailed:\n    ${msg.detailed.split('\n').join('\n    ')}\n`;
    return out;
  }
}
