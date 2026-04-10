// src/brain/analyzer.ts — Core analysis engine with LLM + rule-based fallback

import { z, ZodSchema } from 'zod';
import { LLMClient } from './llm-client.js';
import { BrainPersonality, BrainInsight, FileChange, ProjectContext, AgentActivity, AgentMemory } from '../types.js';

const BrainInsightSchema = z.object({
  type: z.enum(['review', 'suggestion', 'warning', 'context', 'pattern', 'instruction']),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string().max(100),
  content: z.string().max(2000),
  files: z.array(z.string()).optional(),
});
const BrainInsightsSchema = z.array(BrainInsightSchema).min(1).max(5);

type ReviewDepth = 'quick' | 'standard' | 'deep';

interface AnalysisParams {
  changes: FileChange[];
  context: ProjectContext;
  activity: AgentActivity[];
  agentMemory?: AgentMemory;
}

export class Analyzer {
  private llmClient: LLMClient;
  private personality: BrainPersonality;
  private reviewDepth: ReviewDepth;

  constructor(llmClient: LLMClient, personality: BrainPersonality, reviewDepth: ReviewDepth) {
    this.llmClient = llmClient;
    this.personality = personality;
    this.reviewDepth = reviewDepth;
  }

  async analyze(params: AnalysisParams): Promise<BrainInsight[]> {
    const systemPrompt = PromptBuilder.buildSystemPrompt(this.personality);
    const userPrompt = PromptBuilder.buildUserPrompt(params, this.reviewDepth);

    try {
      const raw = await this.llmClient.completeWithSchema(
        userPrompt,
        BrainInsightsSchema as ZodSchema<any>,
        systemPrompt,
      );

      return (raw as any[]).map(insight => ({
        ...insight,
        timestamp: new Date(),
      })) as BrainInsight[];
    } catch {
      // Fallback to rule-based analysis when LLM is unavailable
      return this.ruleBasedAnalysis(params.changes, params.context);
    }
  }

  private ruleBasedAnalysis(changes: FileChange[], context: ProjectContext): BrainInsight[] {
    const insights: BrainInsight[] = [];
    const now = new Date();

    // Security: .env file changes
    const envChanges = changes.filter(c => c.path.includes('.env') && !c.path.includes('.example'));
    if (envChanges.length > 0) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        title: 'Potential secrets in .env file',
        content: 'Environment file was modified. Ensure no secrets, API keys, or credentials are committed to version control. Verify .gitignore includes .env files.',
        files: envChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // Dependency changes
    const pkgChanges = changes.filter(c =>
      c.path.endsWith('package.json') || c.path.endsWith('requirements.txt') || c.path.endsWith('Cargo.toml')
    );
    if (pkgChanges.length > 0) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Dependencies updated — consider audit',
        content: 'A dependency manifest was modified. Review the changes for: version pinning, known vulnerabilities, license compatibility, and unnecessary additions.',
        files: pkgChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // Large batch of changes
    if (changes.length > 10) {
      insights.push({
        type: 'review',
        priority: 'high',
        title: 'Large batch of changes detected',
        content: `${changes.length} files changed at once. Consider splitting into smaller, focused commits for easier review and rollback. Large batches increase the risk of introducing bugs.`,
        files: changes.slice(0, 5).map(c => c.path),
        timestamp: now,
      });
    }

    // Deleted files
    const deletedFiles = changes.filter(c => c.type === 'delete');
    if (deletedFiles.length > 0) {
      insights.push({
        type: 'warning',
        priority: 'high',
        title: 'Files deleted',
        content: `Files were deleted: ${deletedFiles.map(f => f.path).join(', ')}. Verify these deletions are intentional and no other code depends on them.`,
        files: deletedFiles.map(c => c.path),
        timestamp: now,
      });
    }

    // New test files — positive note
    const testFiles = changes.filter(c =>
      c.type === 'add' && (c.path.includes('.test.') || c.path.includes('.spec.') || c.path.includes('_test.'))
    );
    if (testFiles.length > 0) {
      insights.push({
        type: 'context',
        priority: 'low',
        title: 'New test files added',
        content: `Test files created: ${testFiles.map(f => f.path).join(', ')}. Good practice — ensure tests cover edge cases and failure modes.`,
        files: testFiles.map(c => c.path),
        timestamp: now,
      });
    }

    // Missing .gitignore
    if (!context.structure.some(f => f.includes('.gitignore'))) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'No .gitignore found',
        content: 'Project does not have a .gitignore file. Consider adding one to prevent committing build artifacts, dependencies, and secrets.',
        files: [],
        timestamp: now,
      });
    }

    // Language/framework mismatch
    if (context.framework === 'Express' && changes.some(c => c.path.includes('pages/'))) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Possible framework mismatch',
        content: 'Pages directory detected in an Express project. If migrating to Next.js, ensure proper configuration. Otherwise, follow Express conventions.',
        files: changes.filter(c => c.path.includes('pages/')).map(c => c.path),
        timestamp: now,
      });
    }

    // Ensure at least one insight
    if (insights.length === 0) {
      insights.push({
        type: 'context',
        priority: 'low',
        title: 'Changes monitored',
        content: `${changes.length} file change(s) detected in ${context.name}. No immediate concerns found. Project uses ${context.language.join(', ')}${context.framework ? ` with ${context.framework}` : ''}.`,
        files: changes.map(c => c.path),
        timestamp: now,
      });
    }

    return insights;
  }
}

export class PromptBuilder {
  static buildSystemPrompt(personality: BrainPersonality): string {
    const base = `You are the Shadow Brain, an AI that watches agentic coding tools and provides real-time insights.
You review file changes, git activity, and agent behavior, then generate actionable insights.
You respond in JSON only — an array of 1-5 insight objects.
Each insight has: type (review|suggestion|warning|context|pattern|instruction), priority (critical|high|medium|low), title (max 100 chars), content (max 2000 chars), files (array of relevant file paths).`;

    const personalities: Record<BrainPersonality, string> = {
      mentor: `\nYour personality is MENTOR — you teach and guide.
- Explain WHY something might be a problem, not just that it is.
- Suggest better approaches with brief explanations.
- Acknowledge good patterns when you see them.
- Be encouraging but honest.
- Focus on: code quality, best practices, learning opportunities.`,

      critic: `\nYour personality is CRITIC — you give thorough, no-nonsense code reviews.
- Be direct and specific about issues.
- Cite specific lines/patterns that concern you.
- Rate the overall quality of changes.
- Focus on: bugs, logic errors, missing edge cases, poor naming.`,

      architect: `\nYour personality is ARCHITECT — you think about the big picture.
- Consider how changes affect the overall system design.
- Look for coupling, cohesion, and separation of concerns.
- Suggest structural improvements and patterns.
- Focus on: modularity, scalability, maintainability, design patterns.`,

      security: `\nYour personality is SECURITY — you are paranoid about vulnerabilities.
- Flag anything that could be a security risk.
- Check for: SQL injection, XSS, CSRF, insecure deserialization, hardcoded secrets, weak crypto, missing input validation, exposed endpoints.
- Be explicit about attack vectors and mitigations.`,

      performance: `\nYour personality is PERFORMANCE — you optimize everything.
- Look for: N+1 queries, unnecessary re-renders, memory leaks, blocking I/O, large bundle sizes, unoptimized loops, missing caching.
- Suggest specific optimizations with expected impact.`,

      balanced: `\nYour personality is BALANCED — you combine all perspectives.
- Mix mentorship, critique, architecture, security, and performance insights.
- Prioritize by severity: security > bugs > architecture > performance > style.
- Provide 2-3 insights per analysis covering different aspects.`,
    };

    return base + personalities[personality];
  }

  static buildUserPrompt(params: AnalysisParams, depth: ReviewDepth): string {
    const { changes, context, activity, agentMemory } = params;

    const sections: string[] = [];

    // Project context
    sections.push(`## Project Context
- Name: ${context.name}
- Languages: ${context.language.join(', ') || 'Unknown'}
- Framework: ${context.framework || 'Unknown'}
- Package Manager: ${context.packageManager || 'Unknown'}
- Branch: ${context.gitBranch || 'N/A'}
- Git Status: ${context.gitStatus || 'N/A'}`);

    // File changes
    if (changes.length > 0) {
      sections.push(`## File Changes (${changes.length} files)`);

      for (const change of changes) {
        let entry = `### ${change.type.toUpperCase()}: ${change.path}`;

        if (depth === 'standard' && change.diff) {
          const lines = change.diff.split('\n');
          entry += '\n' + lines.slice(0, 100).join('\n');
          if (lines.length > 100) entry += `\n... (${lines.length - 100} more lines)`;
        } else if (depth === 'deep' && change.diff) {
          entry += '\n' + change.diff;
        }

        sections.push(entry);
      }
    }

    // Agent activity
    if (activity.length > 0) {
      const activityLines = activity.slice(-20).map(a =>
        `- [${a.type}] ${a.detail}${a.file ? ` (${a.file})` : ''}`
      );
      sections.push(`## Agent Activity (${activity.length} events)\n${activityLines.join('\n')}`);
    }

    // Agent memory
    if (agentMemory && agentMemory.rules.length > 0) {
      const rulesText = agentMemory.rules.slice(0, 3).join('\n').slice(0, 2000);
      sections.push(`## Current Agent Rules\n${rulesText}`);
    }

    // Token budget guidance
    const tokenLimits: Record<ReviewDepth, number> = { quick: 4000, standard: 8000, deep: 16000 };
    const budgetNote = `\n---\nToken budget: ~${tokenLimits[depth]} tokens. Be concise but insightful.`;
    sections.push(budgetNote);

    // Truncate if too long
    let result = sections.join('\n\n');
    const maxChars = tokenLimits[depth] * 4; // rough token → char conversion
    if (result.length > maxChars) {
      result = result.slice(0, maxChars) + '\n\n[Content truncated to fit token budget]';
    }

    return result;
  }
}
