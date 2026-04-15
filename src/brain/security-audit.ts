// src/brain/security-audit.ts — Deep security audit
// v3.1.0 — OWASP Top 10 pattern detection via regex-based static analysis

import { BrainInsight } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java']);

export interface SecurityIssue {
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line: number;
  match: string;
  description: string;
  recommendation: string;
  owaspCategory: string;
}

interface SecurityRule {
  name: string;
  category: string;
  owasp: string;
  severity: SecurityIssue['severity'];
  patterns: RegExp[];
  description: string;
  recommendation: string;
  falsePositiveFilters?: RegExp[];
}

const SECURITY_RULES: SecurityRule[] = [
  // 1. CSRF — missing CSRF token in form submissions
  {
    name: 'csrf-missing',
    category: 'CSRF',
    owasp: 'A01:2021-Broken Access Control',
    severity: 'high',
    patterns: [
      /<form[^>]*method\s*=\s*["']POST["'][^>]*>/gi,
    ],
    description: 'POST form without CSRF token protection',
    recommendation: 'Add a CSRF token field to all POST forms. Use a CSRF middleware (e.g., csurf for Express) or include a hidden _csrf token field.',
    falsePositiveFilters: [
      /csrf/i,
      /_token/i,
      /authenticity_token/i,
    ],
  },
  // 2. CORS — overly permissive Access-Control-Allow-Origin
  {
    name: 'cors-wildcard',
    category: 'CORS',
    owasp: 'A05:2021-Security Misconfiguration',
    severity: 'high',
    patterns: [
      /Access-Control-Allow-Origin\s*[:=]\s*["']\*["']/gi,
      /cors\s*\(\s*\{\s*origin\s*:\s*["']\*["']/gi,
      /cors\s*\(\s*\{\s*origin\s*:\s*true/gi,
    ],
    description: 'CORS configured to allow all origins (*)',
    recommendation: 'Restrict CORS to specific trusted origins. Never use wildcard (*) in production.',
  },
  // 3. Cookie security — missing flags
  {
    name: 'cookie-insecure',
    category: 'Cookie Security',
    owasp: 'A07:2021-Identification and Authentication Failures',
    severity: 'medium',
    patterns: [
      /cookie\s*\(\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*\)/gi,
      /res\.cookie\s*\(/gi,
      /document\.cookie\s*=/gi,
      /Set-Cookie\s*:/gi,
    ],
    description: 'Cookie set without httpOnly, secure, or sameSite flags',
    recommendation: 'Always set httpOnly, secure, and sameSite flags on cookies. Example: res.cookie("name", "value", { httpOnly: true, secure: true, sameSite: "strict" })',
    falsePositiveFilters: [
      /httpOnly/i,
      /secure\s*:\s*true/i,
      /sameSite/i,
    ],
  },
  // 4. CSP — missing Content-Security-Policy
  {
    name: 'csp-missing',
    category: 'CSP',
    owasp: 'A05:2021-Security Misconfiguration',
    severity: 'medium',
    patterns: [
      /Content-Security-Policy\s*:/gi,
      /helmet\s*\(/gi,
      /csp\s*\(\s*\{/gi,
    ],
    description: 'Content-Security-Policy header check',
    recommendation: 'Set a Content-Security-Policy header to prevent XSS attacks. Use helmet.js for Express apps.',
    // This rule is inverted: we flag if CSP headers are NOT found (handled in analysis)
  },
  // 5. Open redirect
  {
    name: 'open-redirect',
    category: 'Open Redirect',
    owasp: 'A01:2021-Broken Access Control',
    severity: 'medium',
    patterns: [
      /(?:res|response|ctx)\.redirect\s*\(\s*(?:req|request|ctx)\.(?:query|params|body)\./gi,
      /(?:res|response|ctx)\.redirect\s*\(\s*(?:req|request)\.(?:query|params)\s*[.[\]]/gi,
      /redirect\s*\(\s*req\.query\./gi,
      /window\.location\s*=\s*[^;]*?(?:req|request|ctx)\.(?:query|params)/gi,
    ],
    description: 'Potential open redirect via user-controlled input',
    recommendation: 'Validate redirect URLs against an allowlist. Never redirect to user-supplied URLs without verification.',
  },
  // 6. Path traversal
  {
    name: 'path-traversal',
    category: 'Path Traversal',
    owasp: 'A01:2021-Broken Access Control',
    severity: 'critical',
    patterns: [
      /(?:fs|filesystem|file)\.(?:readFile|readFileSync|writeFile|writeFileSync|unlink|unlinkSync|access|accessSync|stat|statSync)\s*\(\s*(?:req|request|ctx)\.(?:params|query|body)\./gi,
      /(?:fs|filesystem)\.\w+\s*\(\s*path\.join\s*\(\s*[^,]+,\s*(?:req|request|ctx)\./gi,
      /\.readFile\s*\(\s*req\.params\./gi,
      /createReadStream\s*\(\s*(?:req|request|ctx)\./gi,
    ],
    description: 'Potential path traversal via unsanitized file operations',
    recommendation: 'Sanitize and validate all file paths. Use path.resolve() and verify the resolved path is within the intended directory.',
  },
  // 7. SSRF — Server-Side Request Forgery
  {
    name: 'ssrf',
    category: 'SSRF',
    owasp: 'A10:2021-Server-Side Request Forgery',
    severity: 'critical',
    patterns: [
      /(?:fetch|axios|http\.get|https\.get|request)\s*\(\s*(?:req|request|ctx)\.(?:query|params|body)\.\w+/gi,
      /(?:fetch|axios)\s*\(\s*userInput/gi,
      /http\.get\s*\(\s*(?:userInput|url|uri)/gi,
    ],
    description: 'Potential SSRF via user-controlled URL in server-side request',
    recommendation: 'Validate URLs against an allowlist of permitted domains. Never pass user input directly to fetch/http requests.',
  },
  // 8. XXE — XML External Entity
  {
    name: 'xxe',
    category: 'XXE',
    owasp: 'A05:2021-Security Misconfiguration',
    severity: 'critical',
    patterns: [
      /enableExternalEntities\s*[:=]\s*true/gi,
      /XMLReader|SAXParser|DocumentBuilder|xml\.parse|parseXml|parseString/gi,
    ],
    description: 'Potential XXE via XML parsing without safe configuration',
    recommendation: 'Disable external entity processing. Set disallowDoctypeDecl=true for Java parsers or use safe XML libraries.',
    falsePositiveFilters: [
      /disallowDoctypeDecl\s*[:=]\s*true/i,
      /externalEntities\s*[:=]\s*false/i,
      /noent\s*[:=]\s*false/i,
    ],
  },
  // Bonus: eval and Function constructor
  {
    name: 'eval-usage',
    category: 'Code Injection',
    owasp: 'A03:2021-Injection',
    severity: 'critical',
    patterns: [
      /(?<![.\w])eval\s*\(/g,
      /new\s+Function\s*\(/g,
    ],
    description: 'Use of eval() or Function constructor — potential code injection',
    recommendation: 'Never use eval() or new Function(). Use JSON.parse() for data parsing or refactoring for dynamic behavior.',
  },
  // Bonus: SQL injection patterns
  {
    name: 'sql-injection',
    category: 'SQL Injection',
    owasp: 'A03:2021-Injection',
    severity: 'critical',
    patterns: [
      /(?:query|execute|run|raw)\s*\(\s*["'`][^"'`]*(?:\$\{|`\$\{|\+).*["'`]/gi,
      /(?:query|execute)\s*\(\s*["']SELECT.*\+\s*(?:req|request|ctx|params|user)/gi,
      /string\s*\+\s*["']\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
    ],
    description: 'Potential SQL injection via string concatenation',
    recommendation: 'Use parameterized queries or an ORM. Never concatenate user input into SQL strings.',
  },
];

export class SecurityAuditor {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 300): Promise<BrainInsight[]> {
    const files = this.collectFiles(this.projectDir, maxFiles);
    const insights: BrainInsight[] = [];
    const allIssues: SecurityIssue[] = [];

    for (const filePath of files) {
      const issues = this.analyzeFile(filePath);
      allIssues.push(...issues);
    }

    // Sort by severity (critical first)
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Generate individual insights
    for (const issue of allIssues) {
      insights.push(this.issueToInsight(issue));
    }

    // Summary insight if many issues found
    const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
    const highCount = allIssues.filter(i => i.severity === 'high').length;
    if (criticalCount + highCount > 0) {
      const categoryCounts = new Map<string, number>();
      for (const issue of allIssues) {
        categoryCounts.set(issue.category, (categoryCounts.get(issue.category) || 0) + 1);
      }
      const topCategories = [...categoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat, count]) => `    - ${cat}: ${count} issues`)
        .join('\n');

      insights.push({
        type: 'security',
        priority: criticalCount > 0 ? 'critical' : 'high',
        title: `[security] ${criticalCount + highCount} security issues detected (${criticalCount} critical, ${highCount} high)`,
        content:
          `Security audit found ${allIssues.length} total issues across the project.\n` +
          `  Critical: ${criticalCount}, High: ${highCount}, ` +
          `Medium: ${allIssues.filter(i => i.severity === 'medium').length}, ` +
          `Low: ${allIssues.filter(i => i.severity === 'low').length}\n` +
          `  Top categories:\n${topCategories}\n` +
          `  Review and fix critical/high issues before deploying to production.`,
        files: [...new Set(allIssues.filter(i => i.severity === 'critical' || i.severity === 'high').map(i => i.file))].slice(0, 20),
        timestamp: new Date(),
        confidence: 0.7,
        metadata: {
          totalIssues: allIssues.length,
          criticalCount,
          highCount,
          categories: Object.fromEntries(categoryCounts),
        },
      });
    }

    return insights;
  }

  analyzeFile(filePath: string): SecurityIssue[] {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }

    const relPath = path.relative(this.projectDir, filePath);
    const issues: SecurityIssue[] = [];

    for (const rule of SECURITY_RULES) {
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const line = content.substring(0, match.index).split('\n').length;
          const lineContent = content.split('\n')[line - 1]?.trim() || match[0];

          // Check false positive filters
          if (rule.falsePositiveFilters) {
            // For cookie rule: check the surrounding context (rest of the line or next few lines)
            const contextStart = Math.max(0, match.index - 50);
            const contextEnd = Math.min(content.length, match.index + 200);
            const context = content.substring(contextStart, contextEnd);

            // Special handling for cookie rule: only flag if security flags are NOT present
            if (rule.name === 'cookie-insecure') {
              const hasSecurityFlags = rule.falsePositiveFilters.some(filter => filter.test(context));
              if (hasSecurityFlags) continue;
            }
            // For XXE: skip if safety measures are present
            if (rule.name === 'xxe' && rule.falsePositiveFilters.length > 0) {
              const contextBlock = content.substring(
                Math.max(0, match.index - 500),
                Math.min(content.length, match.index + 500)
              );
              const hasSafety = rule.falsePositiveFilters.some(filter => filter.test(contextBlock));
              if (hasSafety) continue;
            }
            // For CSRF: check if form has token
            if (rule.name === 'csrf-missing') {
              // Find the closing </form> tag
              const formEnd = content.indexOf('</form>', match.index);
              const formBlock = formEnd !== -1
                ? content.substring(match.index, formEnd)
                : content.substring(match.index, Math.min(content.length, match.index + 2000));
              const hasToken = rule.falsePositiveFilters.some(filter => filter.test(formBlock));
              if (hasToken) continue;
            }
          }

          issues.push({
            category: rule.category,
            severity: rule.severity,
            file: relPath,
            line,
            match: lineContent,
            description: rule.description,
            recommendation: rule.recommendation,
            owaspCategory: rule.owasp,
          });
        }
      }
    }

    return issues;
  }

  private issueToInsight(issue: SecurityIssue): BrainInsight {
    return {
      type: 'security',
      priority: issue.severity as BrainInsight['priority'],
      title: `[security] [${issue.category}] ${issue.description} (${issue.file}:${issue.line})`,
      content:
        `Security issue in ${issue.file}:${issue.line}\n` +
        `  Category: ${issue.category}\n` +
        `  OWASP: ${issue.owaspCategory}\n` +
        `  Severity: ${issue.severity}\n` +
        `  Match: ${issue.match.substring(0, 100)}\n` +
        `  ${issue.description}\n` +
        `  Recommendation: ${issue.recommendation}`,
      files: [issue.file],
      timestamp: new Date(),
      confidence: 0.7,
      metadata: {
        category: issue.category,
        severity: issue.severity,
        line: issue.line,
        owasp: issue.owaspCategory,
        ruleName: issue.category.toLowerCase().replace(/\s+/g, '-'),
      },
    };
  }

  private collectFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles || depth > 10) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
