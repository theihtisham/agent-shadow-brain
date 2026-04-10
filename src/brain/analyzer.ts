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
    const allContent = changes.map(c => c.content || c.diff || '').join('\n');

    // === SECURITY RULES ===

    // .env file changes
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

    // Hardcoded secrets detection
    const secretPatterns = [
      { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{10,}/i, name: 'API key' },
      { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}/i, name: 'password' },
      { pattern: /(?:secret|token)\s*[:=]\s*['"][^'"]{10,}/i, name: 'secret/token' },
      { pattern: /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/, name: 'AWS access key' },
      { pattern: /sk-[a-zA-Z0-9]{32,}/, name: 'OpenAI/Anthropic API key' },
      { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub PAT' },
      { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, name: 'private key' },
      { pattern: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/i, name: 'MongoDB connection string with credentials' },
      { pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/i, name: 'PostgreSQL connection string with credentials' },
      { pattern: /mysql:\/\/[^:]+:[^@]+@/i, name: 'MySQL connection string with credentials' },
    ];
    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(allContent)) {
        insights.push({
          type: 'warning',
          priority: 'critical',
          title: `Possible ${name} exposed in code`,
          content: `Detected what appears to be a hardcoded ${name}. Never commit secrets to version control. Use environment variables or a secrets manager instead.`,
          timestamp: now,
        });
        break; // one secret warning is enough
      }
    }

    // SQL injection risk
    const sqlInjectionPatterns = [
      /query\s*\(\s*[`'"]\s*SELECT.*\$\{/,
      /query\s*\(\s*[`'"]\s*INSERT.*\$\{/,
      /query\s*\(\s*[`'"]\s*UPDATE.*\$\{/,
      /query\s*\(\s*[`'"]\s*DELETE.*\$\{/,
      /\.raw\s*\(\s*[`'"].*\+|string concatenation in SQL/,
      /execute\s*\(\s*[`'"].*\$\{/,
    ];
    if (sqlInjectionPatterns.some(p => p.test(allContent))) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        title: 'Potential SQL injection vulnerability',
        content: 'String interpolation or concatenation detected in SQL queries. Use parameterized queries instead. Example: `query("SELECT * FROM users WHERE id = $1", [userId])` instead of template literals.',
        timestamp: now,
      });
    }

    // XSS risk — dangerouslySetInnerHTML or unescaped output
    if (allContent.includes('dangerouslySetInnerHTML') || allContent.includes('v-html')) {
      insights.push({
        type: 'warning',
        priority: 'high',
        title: 'XSS risk: raw HTML injection',
        content: 'Raw HTML injection detected (dangerouslySetInnerHTML/v-html). Ensure the content is sanitized before rendering to prevent cross-site scripting attacks. Use DOMPurify or similar.',
        timestamp: now,
      });
    }

    // eval/Function usage
    if (/\beval\s*\(|new\s+Function\s*\(/.test(allContent)) {
      insights.push({
        type: 'warning',
        priority: 'critical',
        title: 'Dangerous eval/Function usage',
        content: 'eval() or new Function() detected. These allow arbitrary code execution and are a major security risk. Use safer alternatives like JSON.parse() for data parsing.',
        timestamp: now,
      });
    }

    // === DEPENDENCY RULES ===

    const pkgChanges = changes.filter(c =>
      c.path.endsWith('package.json') || c.path.endsWith('requirements.txt') ||
      c.path.endsWith('Cargo.toml') || c.path.endsWith('go.mod') ||
      c.path.endsWith('pom.xml') || c.path.endsWith('build.gradle')
    );
    if (pkgChanges.length > 0) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Dependencies updated — consider audit',
        content: 'A dependency manifest was modified. Review for: version pinning, known vulnerabilities (run `npm audit` or equivalent), license compatibility, and unnecessary additions.',
        files: pkgChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // Lock file changes without manifest changes = potential version drift
    const lockChanges = changes.filter(c =>
      c.path.endsWith('package-lock.json') || c.path.endsWith('yarn.lock') ||
      c.path.endsWith('pnpm-lock.yaml') || c.path.endsWith('Poetry.lock')
    );
    if (lockChanges.length > 0 && pkgChanges.length === 0) {
      insights.push({
        type: 'review',
        priority: 'medium',
        title: 'Lock file changed without manifest update',
        content: 'A lock file was modified but no dependency manifest changed. This could indicate version drift or an indirect dependency update. Verify this is intentional.',
        files: lockChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // === CODE QUALITY RULES ===

    // Large batch of changes
    if (changes.length > 15) {
      insights.push({
        type: 'review',
        priority: 'high',
        title: 'Very large batch of changes detected',
        content: `${changes.length} files changed at once — high risk of introducing bugs. Consider splitting into smaller, focused PRs. Each PR should address one concern for easier review and rollback.`,
        files: changes.slice(0, 5).map(c => c.path),
        timestamp: now,
      });
    } else if (changes.length > 8) {
      insights.push({
        type: 'review',
        priority: 'medium',
        title: 'Large batch of changes',
        content: `${changes.length} files changed. Consider splitting into smaller, focused commits for easier review and rollback.`,
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
        content: `Files were deleted: ${deletedFiles.map(f => f.path).join(', ')}. Verify these deletions are intentional and no other code depends on them. Search for imports/references to these files.`,
        files: deletedFiles.map(c => c.path),
        timestamp: now,
      });
    }

    // New test files — positive reinforcement
    const testFiles = changes.filter(c =>
      c.type === 'add' && (c.path.includes('.test.') || c.path.includes('.spec.') || c.path.includes('_test.') || c.path.includes('.test_'))
    );
    if (testFiles.length > 0) {
      insights.push({
        type: 'context',
        priority: 'low',
        title: 'New test files added',
        content: `Test files created: ${testFiles.map(f => f.path).join(', ')}. Good practice — ensure tests cover edge cases, error paths, and boundary conditions.`,
        files: testFiles.map(c => c.path),
        timestamp: now,
      });
    }

    // Code changes without corresponding tests
    const srcFiles = changes.filter(c =>
      c.type === 'modify' && !c.path.includes('.test.') && !c.path.includes('.spec.') &&
      !c.path.includes('node_modules') && !c.path.includes('.d.ts') &&
      /\.(ts|tsx|js|jsx|py|go|rs|java)$/.test(c.path)
    );
    if (srcFiles.length >= 3 && testFiles.length === 0) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Code changes without test updates',
        content: `${srcFiles.length} source files modified but no test files were updated. Consider adding or updating tests to cover the changed behavior.`,
        files: srcFiles.slice(0, 3).map(c => c.path),
        timestamp: now,
      });
    }

    // === PERFORMANCE ANTI-PATTERNS ===

    // N+1 query pattern (ORM loops)
    if (/for\s*\(.*await.*find|\.map\s*\(.*await|forEach\s*\(.*await/.test(allContent)) {
      insights.push({
        type: 'suggestion',
        priority: 'high',
        title: 'Possible N+1 query pattern',
        content: 'Async/await inside a loop detected. This is a common source of N+1 queries and performance issues. Consider batching queries, using Promise.all() for parallel operations, or eager loading.',
        timestamp: now,
      });
    }

    // Synchronous file I/O
    if (/\breadFileSync\b|\bwriteFileSync\b|\breaddirSync\b|\bstatSync\b/.test(allContent)) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'Synchronous file I/O detected',
        content: 'Synchronous fs methods (readFileSync, writeFileSync) block the event loop. In production code, use async equivalents (readFile, writeFile) or streams for better performance.',
        timestamp: now,
      });
    }

    // Console.log left in production code
    const consoleLogCount = (allContent.match(/console\.log\s*\(/g) || []).length;
    if (consoleLogCount > 3) {
      insights.push({
        type: 'suggestion',
        priority: 'low',
        title: 'Excessive console.log statements',
        content: `${consoleLogCount} console.log() calls detected. Consider using a proper logging library (winston, pino) with log levels, or remove debug logs before production.`,
        timestamp: now,
      });
    }

    // === ARCHITECTURE RULES ===

    // Missing .gitignore
    if (!context.structure.some(f => f.includes('.gitignore'))) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'No .gitignore found',
        content: 'Project does not have a .gitignore file. Add one to prevent committing build artifacts, dependencies, and secrets.',
        files: [],
        timestamp: now,
      });
    }

    // Missing TypeScript config when .ts files exist
    if (changes.some(c => c.path.endsWith('.ts') || c.path.endsWith('.tsx'))) {
      if (!context.structure.some(f => f.includes('tsconfig.json'))) {
        insights.push({
          type: 'suggestion',
          priority: 'medium',
          title: 'TypeScript files without tsconfig.json',
          content: 'TypeScript files detected but no tsconfig.json found. Add one for proper compiler configuration and type checking.',
          timestamp: now,
        });
      }
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

    // Config file changes
    const configChanges = changes.filter(c =>
      /\.(json|yaml|yml|toml|ini|conf|config\.(ts|js))$/.test(c.path) &&
      !c.path.includes('node_modules') && !c.path.includes('package-lock')
    );
    if (configChanges.length > 2) {
      insights.push({
        type: 'review',
        priority: 'medium',
        title: 'Multiple config files changed',
        content: `${configChanges.length} configuration files modified. Double-check values, especially for production environments. Config mistakes are hard to debug.`,
        files: configChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // Database migration files
    const migrationFiles = changes.filter(c =>
      /migration|schema\.sql|\.sql$/.test(c.path) && c.path.includes('migrate')
    );
    if (migrationFiles.length > 0) {
      insights.push({
        type: 'warning',
        priority: 'high',
        title: 'Database migration changed',
        content: 'Database migration files modified. Ensure migrations are backwards-compatible. Test on a copy of production data before deploying. Consider if a rollback migration is needed.',
        files: migrationFiles.map(c => c.path),
        timestamp: now,
      });
    }

    // Docker/deployment changes
    const deployChanges = changes.filter(c =>
      /Dockerfile|docker-compose|\.kube|\.tf$|\.terraform|serverless\./.test(c.path)
    );
    if (deployChanges.length > 0) {
      insights.push({
        type: 'review',
        priority: 'high',
        title: 'Infrastructure/deployment files changed',
        content: 'Infrastructure configuration modified. Verify: exposed ports, environment variables, resource limits, health checks, and security groups are correct.',
        files: deployChanges.map(c => c.path),
        timestamp: now,
      });
    }

    // API endpoint changes
    const apiFiles = changes.filter(c =>
      /route|controller|api|endpoint|handler/.test(c.path.toLowerCase()) &&
      /\.(ts|js|py|go|rs|java)$/.test(c.path)
    );
    if (apiFiles.length > 0) {
      insights.push({
        type: 'suggestion',
        priority: 'medium',
        title: 'API endpoint files changed',
        content: 'API endpoint code was modified. Verify: input validation, authentication, rate limiting, proper error responses (no stack traces), and API documentation is updated.',
        files: apiFiles.map(c => c.path),
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
