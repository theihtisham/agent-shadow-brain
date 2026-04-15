// src/brain/smart-fix.ts — Smart Fix Engine: generates before/after fix suggestions

import { BrainInsight, FileChange } from '../types.js';
import { LLMClient } from './llm-client.js';

export interface FixSuggestion {
  file: string;
  issue: string;
  before: string;
  after: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'quality' | 'architecture';
}

// Rule-based fixes for known patterns — zero LLM cost, instant
const RULE_FIXES: Array<{
  match: RegExp;
  category: FixSuggestion['category'];
  issue: string;
  transform: (code: string, match: RegExpMatchArray) => { before: string; after: string; explanation: string };
}> = [
  // Hardcoded secrets → env var
  {
    match: /(?:apiKey|api_key|API_KEY)\s*[:=]\s*['"`]([^'"`]{10,})['"`]/,
    category: 'security',
    issue: 'Hardcoded API key',
    transform: (code, m) => ({
      before: m[0],
      after: `apiKey: process.env.API_KEY`,
      explanation: 'Move hardcoded credentials to environment variables. Add to .env and reference via process.env',
    }),
  },
  // Hardcoded password
  {
    match: /(?:password|passwd|pwd)\s*[:=]\s*['"`]([^'"`]{4,})['"`]/i,
    category: 'security',
    issue: 'Hardcoded password',
    transform: (code, m) => ({
      before: m[0],
      after: m[0].replace(/['"`][^'"`]+['"`]/, 'process.env.DB_PASSWORD'),
      explanation: 'Never hardcode passwords. Use environment variables or a secrets manager.',
    }),
  },
  // eval() → JSON.parse
  {
    match: /\beval\s*\(\s*([^)]+)\s*\)/,
    category: 'security',
    issue: 'Dangerous eval() usage',
    transform: (code, m) => ({
      before: m[0],
      after: `JSON.parse(${m[1].trim()})`,
      explanation: 'eval() executes arbitrary code. Use JSON.parse() for data, or safer alternatives.',
    }),
  },
  // SQL injection with template literal
  {
    match: /query\s*\(\s*`[^`]*\$\{([^}]+)\}[^`]*`/,
    category: 'security',
    issue: 'SQL injection risk — string interpolation in query',
    transform: (code, m) => ({
      before: m[0],
      after: `query('SELECT * FROM table WHERE id = $1', [${m[1].trim()}])`,
      explanation: 'Use parameterized queries instead of string interpolation to prevent SQL injection.',
    }),
  },
  // readFileSync → readFile
  {
    match: /fs\.readFileSync\s*\(([^)]+)\)/,
    category: 'performance',
    issue: 'Synchronous file read blocks event loop',
    transform: (code, m) => ({
      before: m[0],
      after: `await fs.readFile(${m[1]})`,
      explanation: 'readFileSync blocks Node.js event loop. Use async readFile with await for better performance.',
    }),
  },
  // writeFileSync → writeFile
  {
    match: /fs\.writeFileSync\s*\(([^)]+)\)/,
    category: 'performance',
    issue: 'Synchronous file write blocks event loop',
    transform: (code, m) => ({
      before: m[0],
      after: `await fs.writeFile(${m[1]})`,
      explanation: 'writeFileSync blocks Node.js event loop. Use async writeFile with await.',
    }),
  },
  // .map with await (N+1) → Promise.all
  {
    match: /(\w+)\.map\s*\(async\s*(?:\([^)]*\)|\w+)\s*=>/,
    category: 'performance',
    issue: 'N+1 pattern: await inside .map()',
    transform: (code, m) => ({
      before: m[0],
      after: `// Wrap in Promise.all for parallel execution:\nawait Promise.all(${m[1]}.map(async `,
      explanation: '.map() with async runs promises sequentially. Wrap with Promise.all() for parallel execution.',
    }),
  },
  // console.log → logger
  {
    match: /console\.log\s*\(/g,
    category: 'quality',
    issue: 'console.log in production code',
    transform: (code, m) => ({
      before: 'console.log(',
      after: 'logger.debug(',
      explanation: 'Replace console.log with a proper logger (winston/pino) that supports log levels and structured output.',
    }),
  },
  // var → const/let
  {
    match: /\bvar\s+(\w+)\s*=/,
    category: 'quality',
    issue: 'var declaration (function-scoped, avoid)',
    transform: (code, m) => ({
      before: m[0],
      after: m[0].replace('var ', 'const '),
      explanation: 'Use const (preferred) or let instead of var. var has function scope which leads to subtle bugs.',
    }),
  },
  // == instead of ===
  {
    match: /(?<![=!<>])={2}(?!=)(?!\s*>)/,
    category: 'quality',
    issue: 'Loose equality (==) instead of strict (===)',
    transform: (code, m) => ({
      before: '==',
      after: '===',
      explanation: 'Use strict equality (===) to avoid type coercion bugs. == can lead to surprising falsy comparisons.',
    }),
  },
  // dangerouslySetInnerHTML → DOMPurify
  {
    match: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*([^}]+)\}\s*\}/,
    category: 'security',
    issue: 'XSS risk: unescaped HTML injection',
    transform: (code, m) => ({
      before: m[0],
      after: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(${m[1].trim()}) }}`,
      explanation: 'Sanitize HTML with DOMPurify before injection to prevent XSS attacks. Install: npm i dompurify',
    }),
  },
  // Missing error handling in async
  {
    match: /await\s+\w+[^;{]+;(?!\s*\}|\s*catch)/,
    category: 'quality',
    issue: 'Unhandled promise — await without try/catch',
    transform: (code, m) => ({
      before: m[0],
      after: `try {\n  ${m[0]}\n} catch (err) {\n  console.error('Operation failed:', err);\n  throw err;\n}`,
      explanation: 'Wrap await calls in try/catch to handle rejections gracefully.',
    }),
  },
];

export class SmartFixEngine {
  private llmClient: LLMClient | null;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient || null;
  }

  /**
   * Generate fix suggestions for the given changes and insights.
   * Pure rule-based — instant, no LLM required.
   */
  generateFixes(changes: FileChange[], insights: BrainInsight[]): FixSuggestion[] {
    const fixes: FixSuggestion[] = [];

    for (const change of changes) {
      const content = change.content || change.diff || '';
      if (!content) continue;

      for (const rule of RULE_FIXES) {
        const match = content.match(rule.match);
        if (match) {
          const result = rule.transform(content, match);
          // Don't duplicate same fix for same file+issue
          if (!fixes.some(f => f.file === change.path && f.issue === rule.issue)) {
            fixes.push({
              file: change.path,
              issue: rule.issue,
              before: result.before,
              after: result.after,
              explanation: result.explanation,
              confidence: 'high',
              category: rule.category,
            });
          }
        }
      }
    }

    // Also generate fixes from insights that match known patterns
    for (const insight of insights) {
      if (insight.priority === 'critical' || insight.priority === 'high') {
        const knownFix = this.insightToFix(insight);
        if (knownFix && !fixes.some(f => f.issue === knownFix.issue)) {
          fixes.push(knownFix);
        }
      }
    }

    // Deduplicate and sort: critical first
    const seen = new Set<string>();
    const deduped = fixes.filter(f => {
      const key = `${f.file}:${f.issue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped.sort((a, b) => {
      const order = { security: 0, performance: 1, quality: 2, architecture: 3 };
      return order[a.category] - order[b.category];
    });
  }

  private insightToFix(insight: BrainInsight): FixSuggestion | null {
    const file = insight.files?.[0] || 'unknown';

    if (insight.title.includes('SQL injection')) {
      return {
        file,
        issue: 'SQL injection vulnerability',
        before: 'query(`SELECT * FROM users WHERE id = ${userId}`)',
        after: 'query("SELECT * FROM users WHERE id = $1", [userId])',
        explanation: 'Use parameterized queries. The $1 placeholder escapes input automatically.',
        confidence: 'high',
        category: 'security',
      };
    }

    if (insight.title.includes('Lock file changed')) {
      return {
        file: insight.files?.[0] || 'package-lock.json',
        issue: 'Unexpected lock file change',
        before: '# Lock file changed without manifest update',
        after: '# Run: npm install --package-lock-only to regenerate\n# Or revert: git checkout package-lock.json',
        explanation: 'Lock file changes without dependency manifest updates may indicate accidental version drift.',
        confidence: 'medium',
        category: 'architecture',
      };
    }

    if (insight.title.includes('N+1')) {
      return {
        file,
        issue: 'N+1 database query pattern',
        before: 'const results = await Promise.all(ids.map(id => db.findById(id)));',
        after: 'const results = await db.findByIds(ids); // batch query',
        explanation: 'Use batch queries (findMany/whereIn) instead of per-item lookups to reduce DB round trips.',
        confidence: 'medium',
        category: 'performance',
      };
    }

    if (insight.title.includes('XSS')) {
      return {
        file,
        issue: 'XSS vulnerability via raw HTML',
        before: 'element.innerHTML = userContent;',
        after: 'element.textContent = userContent; // or use DOMPurify.sanitize()',
        explanation: 'Never set innerHTML with untrusted content. Use textContent for plain text or DOMPurify for HTML.',
        confidence: 'high',
        category: 'security',
      };
    }

    return null;
  }

  formatFixes(fixes: FixSuggestion[]): string {
    if (fixes.length === 0) return '  No auto-fixes available for current changes.\n';

    const categoryIcon: Record<FixSuggestion['category'], string> = {
      security: '🛡',
      performance: '⚡',
      quality: '✨',
      architecture: '🏗',
    };

    let out = `\n  🔧 Smart Fix Engine — ${fixes.length} fix suggestion(s)\n\n`;

    for (const fix of fixes) {
      const icon = categoryIcon[fix.category];
      out += `  ${icon} [${fix.category.toUpperCase()}] ${fix.issue}\n`;
      out += `  \x1b[2mFile: ${fix.file}\x1b[0m\n\n`;
      out += `  \x1b[31mBefore:\x1b[0m\n    ${fix.before.split('\n').join('\n    ')}\n\n`;
      out += `  \x1b[32mAfter:\x1b[0m\n    ${fix.after.split('\n').join('\n    ')}\n\n`;
      out += `  \x1b[2m💡 ${fix.explanation}\x1b[0m\n`;
      out += `  \x1b[2m─────────────────────────────────────\x1b[0m\n\n`;
    }

    return out;
  }

  toMarkdown(fixes: FixSuggestion[]): string {
    if (fixes.length === 0) return '> No auto-fixes generated.\n';

    let md = `## 🔧 Smart Fix Suggestions\n\n`;
    for (const fix of fixes) {
      md += `### ${fix.issue}\n\n`;
      md += `**File:** \`${fix.file}\`  **Category:** ${fix.category}  **Confidence:** ${fix.confidence}\n\n`;
      md += `**Before:**\n\`\`\`\n${fix.before}\n\`\`\`\n\n`;
      md += `**After:**\n\`\`\`\n${fix.after}\n\`\`\`\n\n`;
      md += `> 💡 ${fix.explanation}\n\n---\n\n`;
    }
    return md;
  }
}
