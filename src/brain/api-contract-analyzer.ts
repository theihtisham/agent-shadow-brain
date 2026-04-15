// src/brain/api-contract-analyzer.ts — API endpoint contract analysis
// v3.0.0 — Detects API endpoints, checks for validation, auth, rate limiting, docs, tests

import { BrainInsight, APIEndpoint } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

export class APIContractAnalyzer {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 200): Promise<BrainInsight[]> {
    const endpoints = this.discoverEndpoints(maxFiles);
    const insights: BrainInsight[] = [];

    for (const ep of endpoints) {
      const issues = this.auditEndpoint(ep);
      if (issues.length > 0) {
        insights.push(this.endpointToInsight(ep, issues));
      }
    }

    // Summary insight
    if (endpoints.length > 0) {
      const noAuth = endpoints.filter(e => !e.hasAuth).length;
      const noValidation = endpoints.filter(e => !e.hasValidation).length;
      const noDocs = endpoints.filter(e => !e.hasDocs).length;

      if (noAuth > 0 || noValidation > 0) {
        insights.push({
          type: 'api-contract',
          priority: noAuth > endpoints.length * 0.5 ? 'critical' : 'high',
          title: `[api-contract] API audit: ${endpoints.length} endpoints found (${noAuth} without auth, ${noValidation} without validation)`,
          content:
            `API Contract Audit Summary:\n` +
            `  Total endpoints: ${endpoints.length}\n` +
            `  Without authentication: ${noAuth}\n` +
            `  Without input validation: ${noValidation}\n` +
            `  Without documentation: ${noDocs}\n` +
            `  Ensure all endpoints have proper auth, validation, and documentation.`,
          files: endpoints.map(e => e.file).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10),
          timestamp: new Date(),
          confidence: 0.85,
          metadata: { totalEndpoints: endpoints.length, noAuth, noValidation, noDocs },
        });
      }
    }

    return insights;
  }

  private discoverEndpoints(maxFiles: number): APIEndpoint[] {
    const endpoints: APIEndpoint[] = [];
    const files = this.collectFiles(this.projectDir, maxFiles);

    for (const filePath of files) {
      let content: string;
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

      const relPath = path.relative(this.projectDir, filePath);
      endpoints.push(...this.extractEndpoints(content, relPath));
    }

    return endpoints;
  }

  private extractEndpoints(content: string, filePath: string): APIEndpoint[] {
    const endpoints: APIEndpoint[] = [];
    const lines = content.split('\n');

    // Express.js patterns
    const expressPattern = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match: RegExpExecArray | null;
    while ((match = expressPattern.exec(content)) !== null) {
      const method = match[1].toUpperCase() as APIEndpoint['method'];
      const routePath = match[2];
      const line = content.substring(0, match.index).split('\n').length;
      const block = this.getBlock(lines, line - 1);

      endpoints.push({
        path: routePath,
        method,
        file: filePath,
        line,
        hasValidation: this.checkValidation(block),
        hasAuth: this.checkAuth(block, content),
        hasRateLimit: this.checkRateLimit(content),
        hasDocs: this.checkDocs(content, line),
        hasTests: this.checkTests(filePath, routePath),
        statusCode: this.extractStatusCodes(block),
        issues: [],
      });
    }

    // Next.js API route pattern (files in pages/api or app/api)
    if (filePath.includes('/api/') || filePath.includes('\\api\\')) {
      // Infer route from file path
      const apiPath = filePath
        .replace(/^(.*?[/\\])api([/\\])/, '/api/')
        .replace(/\.(ts|tsx|js|jsx)$/, '')
        .replace(/\/index$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1');

      if (!endpoints.some(e => e.file === filePath)) {
        const content2 = content;
        endpoints.push({
          path: apiPath || '/api/unknown',
          method: 'GET', // default, could be POST etc.
          file: filePath,
          line: 1,
          hasValidation: this.checkValidation(content2),
          hasAuth: this.checkAuth(content2, content),
          hasRateLimit: this.checkRateLimit(content),
          hasDocs: this.checkDocs(content, 1),
          hasTests: this.checkTests(filePath, apiPath),
          statusCode: this.extractStatusCodes(content2),
          issues: [],
        });
      }
    }

    // Fastify pattern
    const fastifyPattern = /\.(get|post|put|patch|delete)\s*\(\s*\{\s*url\s*:\s*['"`]([^'"`]+)['"`]/gi;
    while ((match = fastifyPattern.exec(content)) !== null) {
      const method = match[1].toUpperCase() as APIEndpoint['method'];
      const routePath = match[2];
      const line = content.substring(0, match.index).split('\n').length;
      const block = this.getBlock(lines, line - 1);

      endpoints.push({
        path: routePath,
        method,
        file: filePath,
        line,
        hasValidation: this.checkValidation(block),
        hasAuth: this.checkAuth(block, content),
        hasRateLimit: this.checkRateLimit(content),
        hasDocs: this.checkDocs(content, line),
        hasTests: this.checkTests(filePath, routePath),
        statusCode: this.extractStatusCodes(block),
        issues: [],
      });
    }

    return endpoints;
  }

  private auditEndpoint(ep: APIEndpoint): string[] {
    const issues: string[] = [];

    if (!ep.hasAuth && !ep.path.includes('public') && !ep.path.includes('health')) {
      issues.push('No authentication detected');
    }
    if (!ep.hasValidation && ['POST', 'PUT', 'PATCH'].includes(ep.method)) {
      issues.push('No input validation for write endpoint');
    }
    if (!ep.hasDocs) {
      issues.push('No API documentation found');
    }
    if (ep.statusCode.length === 0) {
      issues.push('No explicit status codes returned');
    }

    return issues;
  }

  private checkValidation(block: string): boolean {
    return /\b(validate|schema|joi|zod|yup|ajv|validator|check|sanitize|parse)\b/i.test(block);
  }

  private checkAuth(block: string, fullContent: string): boolean {
    return /\b(auth|jwt|token|session|passport|bearer|apikey|api[_-]?key|middleware)\b/i.test(block) ||
      /\b(auth|authenticate|authorize|verifyToken|isAuthenticated)\b/i.test(fullContent.substring(0, fullContent.indexOf(block) + block.length));
  }

  private checkRateLimit(content: string): boolean {
    return /\b(rate[_-]?limit|rateLimit|throttle|slow[_-]?down|slowDown)\b/i.test(content);
  }

  private checkDocs(content: string, line: number): boolean {
    // Check for JSDoc, OpenAPI/Swagger, or comment above the route
    const lines = content.split('\n');
    for (let i = Math.max(0, line - 5); i < line - 1; i++) {
      if (/\/\*\*|@route|@api|swagger|openapi/i.test(lines[i])) return true;
    }
    return false;
  }

  private checkTests(filePath: string, routePath: string): boolean {
    // Heuristic: check if a test file exists for this route handler
    const testPatterns = [
      filePath.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1'),
      filePath.replace(/\.(ts|tsx|js|jsx)$/, '.spec.$1'),
      filePath.replace(/\/src\//, '/tests/').replace(/\.(ts|tsx|js|jsx)$/, '.test.ts'),
    ];
    for (const p of testPatterns) {
      try { fs.accessSync(p); return true; } catch { /* continue */ }
    }
    return false;
  }

  private extractStatusCodes(block: string): number[] {
    const codes: number[] = [];
    const statusPattern = /status\s*\(\s*(\d{3})\s*\)|statusCode\s*=\s*(\d{3})|\.send\s*\(\s*\{[^}]*status\s*:\s*(\d{3})/g;
    let m: RegExpExecArray | null;
    while ((m = statusPattern.exec(block)) !== null) {
      const code = parseInt(m[1] || m[2] || m[3]);
      if (code >= 100 && code < 600) codes.push(code);
    }
    return [...new Set(codes)];
  }

  private getBlock(lines: string[], startLine: number): string {
    // Get ~20 lines around the endpoint definition
    const start = Math.max(0, startLine - 2);
    const end = Math.min(lines.length, startLine + 20);
    return lines.slice(start, end).join('\n');
  }

  private endpointToInsight(ep: APIEndpoint, issues: string[]): BrainInsight {
    return {
      type: 'api-contract',
      priority: issues.some(i => i.includes('authentication')) ? 'critical' :
        issues.some(i => i.includes('validation')) ? 'high' : 'medium',
      title: `[api-contract] ${ep.method} ${ep.path} — ${issues.length} issues`,
      content:
        `API endpoint ${ep.method} ${ep.path} in ${ep.file}:${ep.line}\n` +
        `  Issues:\n${issues.map(i => `    - ${i}`).join('\n')}\n` +
        `  Auth: ${ep.hasAuth ? 'yes' : 'NO'} | Validation: ${ep.hasValidation ? 'yes' : 'NO'} | Docs: ${ep.hasDocs ? 'yes' : 'NO'} | Tests: ${ep.hasTests ? 'yes' : 'NO'}\n` +
        `  Status codes: ${ep.statusCode.length > 0 ? ep.statusCode.join(', ') : 'none detected'}`,
      files: [ep.file],
      timestamp: new Date(),
      confidence: 0.8,
      metadata: { method: ep.method, path: ep.path, issues },
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
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
