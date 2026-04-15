// src/brain/vuln-scanner.ts — Dependency vulnerability scanner (npm audit, pip audit)

import { VulnResult } from '../types.js';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class VulnScanner {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async scan(): Promise<VulnResult[]> {
    const results: VulnResult[] = [];

    // Detect package manager and run audits
    if (fs.existsSync(path.join(this.projectDir, 'package.json'))) {
      results.push(...await this.npmAudit());
    }

    if (fs.existsSync(path.join(this.projectDir, 'requirements.txt')) ||
        fs.existsSync(path.join(this.projectDir, 'Pipfile')) ||
        fs.existsSync(path.join(this.projectDir, 'pyproject.toml'))) {
      results.push(...await this.pipAudit());
    }

    if (fs.existsSync(path.join(this.projectDir, 'Cargo.toml'))) {
      results.push(...await this.cargoAudit());
    }

    // Static checks (no external tools needed)
    results.push(...this.staticSecretsScan());
    results.push(...this.staticDependencyCheck());

    return results.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.severity] - order[b.severity];
    });
  }

  private async npmAudit(): Promise<VulnResult[]> {
    return new Promise((resolve) => {
      const hasLock = fs.existsSync(path.join(this.projectDir, 'package-lock.json'));
      const cmd = hasLock ? 'npm audit --json' : 'npm audit --json --package-lock-only 2>/dev/null';

      exec(cmd, { cwd: this.projectDir, timeout: 30000 }, (err, stdout) => {
        try {
          const data = JSON.parse(stdout || '{}');
          const vulns: VulnResult[] = [];

          if (data.vulnerabilities) {
            for (const [name, info] of Object.entries(data.vulnerabilities as any)) {
              const v = info as any;
              vulns.push({
                package: name,
                severity: v.severity || 'medium',
                title: v.title || v.name || `Vulnerability in ${name}`,
                url: v.url,
                patchedIn: v.range || v.patchedIn,
              });
              // Also process via array
              if (v.via && Array.isArray(v.via)) {
                for (const detail of v.via) {
                  if (typeof detail === 'object' && detail.title) {
                    vulns.push({
                      package: detail.name || name,
                      severity: detail.severity || v.severity || 'medium',
                      title: detail.title,
                      url: detail.url,
                      patchedIn: detail.range,
                    });
                  }
                }
              }
            }
          }

          // Also check for metadata.auditReportVersion
          if (data.metadata?.vulnerabilities) {
            const meta = data.metadata.vulnerabilities;
            if (meta.total === 0) {
              // No vulnerabilities found by npm audit
            }
          }

          resolve(vulns);
        } catch {
          // Fallback: parse text output
          if (stdout && stdout.includes('vulnerability')) {
            resolve([{ package: 'npm', severity: 'medium', title: stdout.split('\n')[0] }]);
          } else {
            resolve([]);
          }
        }
      });
    });
  }

  private async pipAudit(): Promise<VulnResult[]> {
    return new Promise((resolve) => {
      exec('pip audit --format json 2>/dev/null || pip-audit --format json 2>/dev/null', {
        cwd: this.projectDir,
        timeout: 30000,
      }, (err, stdout) => {
        try {
          if (!stdout) { resolve([]); return; }
          const data = JSON.parse(stdout);
          const vulns: VulnResult[] = [];

          if (Array.isArray(data)) {
            for (const item of data) {
              vulns.push({
                package: item.package?.name || 'unknown',
                severity: item.severity || 'medium',
                title: item.advisory || item.description || 'Python package vulnerability',
                url: item.url,
                patchedIn: item.fix_versions?.join(', '),
              });
            }
          }

          resolve(vulns);
        } catch {
          resolve([]);
        }
      });
    });
  }

  private async cargoAudit(): Promise<VulnResult[]> {
    return new Promise((resolve) => {
      exec('cargo audit --json 2>/dev/null', { cwd: this.projectDir, timeout: 30000 }, (err, stdout) => {
        try {
          if (!stdout) { resolve([]); return; }
          const data = JSON.parse(stdout);
          const vulns: VulnResult[] = [];

          for (const v of data.vulnerabilities?.list || []) {
            vulns.push({
              package: v.package?.name || 'unknown',
              severity: v.advisory?.severity || 'medium',
              title: v.advisory?.title || 'Rust crate vulnerability',
              url: v.advisory?.url,
              patchedIn: v.versions?.patched?.join(', '),
            });
          }

          resolve(vulns);
        } catch {
          resolve([]);
        }
      });
    });
  }

  private staticSecretsScan(): VulnResult[] {
    const results: VulnResult[] = [];
    const secretPatterns: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"`]AKIA[0-9A-Z]{16}['"`]/, name: 'AWS Access Key' },
      { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, name: 'GitHub Token' },
      { pattern: /sk-[A-Za-z0-9]{20,}T[A-Za-z0-9]{20,}/, name: 'OpenAI API Key' },
      { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, name: 'Private Key' },
      { pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/, name: 'MongoDB Connection String with credentials' },
      { pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/, name: 'PostgreSQL Connection String with credentials' },
      { pattern: /mysql:\/\/[^:]+:[^@]+@/, name: 'MySQL Connection String with credentials' },
      { pattern: /redis:\/\/:[^@]+@/, name: 'Redis Connection String with credentials' },
    ];

    this.walkAndScan(this.projectDir, (filePath, content) => {
      // Skip .env.example, test files, lock files
      if (filePath.includes('.example') || filePath.includes('.test.') || filePath.includes('.spec.') ||
          filePath.includes('lock') || filePath.includes('.git/')) {
        return;
      }

      for (const { pattern, name } of secretPatterns) {
        if (pattern.test(content)) {
          results.push({
            package: path.relative(this.projectDir, filePath),
            severity: 'critical',
            title: `Exposed secret: ${name}`,
          });
        }
      }
    });

    return results;
  }

  private staticDependencyCheck(): VulnResult[] {
    const results: VulnResult[] = [];
    const pkgPath = path.join(this.projectDir, 'package.json');

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Known deprecated/problematic packages
        const problematic: Record<string, { reason: string; severity: VulnResult['severity'] }> = {
          'node-uuid': { reason: 'Deprecated — use uuid instead', severity: 'low' },
          'request': { reason: 'Deprecated — use node-fetch or axios', severity: 'medium' },
          'axios': { reason: 'Check for known CVEs — ensure latest version', severity: 'low' },
          'express': { reason: 'Ensure helmet.js is also installed for security headers', severity: 'low' },
          'colors': { reason: 'Package compromised (faker.js incident) — consider chalk', severity: 'high' },
          'faker': { reason: 'Package compromised — use @faker-js/faker instead', severity: 'high' },
          'lodash': { reason: 'Consider using lodash-es or native alternatives for smaller bundles', severity: 'low' },
          'moment': { reason: 'Deprecated — use dayjs or date-fns', severity: 'low' },
        };

        for (const [name, info] of Object.entries(problematic)) {
          if (deps[name]) {
            results.push({
              package: name,
              severity: info.severity,
              title: info.reason,
            });
          }
        }

        // Check for missing security packages in Express projects
        if (deps['express'] && !deps['helmet'] && !deps['helmet-csp']) {
          results.push({
            package: 'helmet',
            severity: 'medium',
            title: 'Express without helmet.js — missing critical security headers (CSP, HSTS, X-Frame-Options)',
          });
        }
      } catch { /* ignore */ }
    }

    return results;
  }

  private walkAndScan(dir: string, callback: (filePath: string, content: string) => void, depth = 0): void {
    if (depth > 5) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build', 'venv', '__pycache__'].includes(entry.name)) continue;
          this.walkAndScan(fullPath, callback, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.env', '.yaml', '.yml', '.json'].includes(ext)) continue;
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            callback(fullPath, content);
          } catch { /* binary or unreadable */ }
        }
      }
    } catch { /* permission */ }
  }

  formatConsole(vulns: VulnResult[]): string {
    if (vulns.length === 0) return '\n  No vulnerabilities found.\n';

    let out = `\n  Vulnerability Scan — ${vulns.length} issue(s) found\n`;
    out += `  ${'─'.repeat(55)}\n\n`;

    for (const v of vulns) {
      const icon = v.severity === 'critical' ? '🚨' : v.severity === 'high' ? '⚠️' : '📋';
      out += `  ${icon} [${v.severity.toUpperCase()}] ${v.package}\n`;
      out += `     ${v.title}\n`;
      if (v.url) out += `     ${v.url}\n`;
      if (v.patchedIn) out += `     Patched in: ${v.patchedIn}\n`;
      out += '\n';
    }

    const critical = vulns.filter(v => v.severity === 'critical').length;
    const high = vulns.filter(v => v.severity === 'high').length;

    if (critical > 0) out += `  ${'🚨'.repeat(Math.min(critical, 5))} ${critical} CRITICAL — fix immediately!\n`;
    if (high > 0) out += `  ⚠️  ${high} HIGH — address before merging\n`;

    return out;
  }

  formatJSON(vulns: VulnResult[]): string {
    return JSON.stringify(vulns, null, 2);
  }

  toMarkdown(vulns: VulnResult[]): string {
    if (vulns.length === 0) return '> No vulnerabilities detected.\n';

    let md = `## Vulnerability Report\n\n`;
    md += `| Severity | Package | Issue | Patched |\n|---|---|---|---|\n`;
    for (const v of vulns) {
      md += `| ${v.severity} | \`${v.package}\` | ${v.title} | ${v.patchedIn || 'N/A'} |\n`;
    }
    return md;
  }
}
