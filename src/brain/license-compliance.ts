// src/brain/license-compliance.ts — License compliance checking
// v3.0.0 — Audits dependency licenses for restricted, unknown, and conflicting licenses

import { BrainInsight, LicenseIssue } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

// OSI-approved and common permissive licenses
const PERMISSIVE_LICENSES = new Set([
  'mit', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause', 'isc', '0bsd',
  'cc0-1.0', 'unlicense', 'wtfpl', 'zlib', 'psf-2.0', 'python-2.0',
  'postgresql', 'ncsa', 'artistic-2.0', 'afl-3.0', 'bsl-1.0',
  'cc-by-3.0', 'cc-by-4.0', 'ofl-1.1', 'unicode-dfs-2016',
]);

// Copyleft licenses that may require disclosure
const COPYLEFT_LICENSES = new Set([
  'gpl-2.0', 'gpl-3.0', 'agpl-3.0', 'lgpl-2.1', 'lgpl-3.0',
  'mpl-2.0', 'epl-1.0', 'epl-2.0', 'cddl-1.0', 'cddl-1.1',
  'ecl-2.0', 'osl-3.0', 'cpal-1.0', 'eupl-1.1', 'eupl-1.2',
]);

// Restricted / problematic licenses for commercial use
const RESTRICTED_LICENSES = new Set([
  'gpl-2.0', 'agpl-3.0', 'gpl-3.0',
  'cc-by-nc-3.0', 'cc-by-nc-4.0', 'cc-by-nc-sa-4.0',
  'sspl-1.0', 'bsl-1.1', 'commons-clause',
]);

// License field patterns that indicate unknown/unlicense
const UNKNOWN_PATTERNS = [
  'see license', 'unlicensed', 'proprietary', 'commercial', 'n/a', 'none',
];

export class LicenseCompliance {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(): Promise<BrainInsight[]> {
    const issues: LicenseIssue[] = [];
    const pkg = this.readPackageJson();
    if (!pkg) return [];

    const allDeps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
    const depEntries = Object.entries(allDeps);

    for (const [name, version] of depEntries) {
      const license = this.getPackageLicense(name);
      if (!license) {
        issues.push({
          package: name,
          version: version.replace(/^[\^~>=<]*/, ''),
          license: 'UNKNOWN',
          type: 'unknown',
          severity: 'medium',
          description: `Package ${name} has no detectable license.`,
          recommendation: `Manually verify the license of ${name} before using it in production.`,
        });
        continue;
      }

      const normalizedLicense = license.toLowerCase();

      // Check for restricted licenses
      if (RESTRICTED_LICENSES.has(normalizedLicense)) {
        issues.push({
          package: name,
          version: version.replace(/^[\^~>=<]*/, ''),
          license,
          type: 'restricted',
          severity: normalizedLicense === 'agpl-3.0' ? 'critical' : 'high',
          description: `Package ${name} uses ${license}, which has significant copyleft requirements.`,
          recommendation: this.getRestrictedRecommendation(normalizedLicense),
        });
      }

      // Check for copyleft
      if (COPYLEFT_LICENSES.has(normalizedLicense) && !RESTRICTED_LICENSES.has(normalizedLicense)) {
        issues.push({
          package: name,
          version: version.replace(/^[\^~>=<]*/, ''),
          license,
          type: 'copyleft',
          severity: 'medium',
          description: `Package ${name} uses ${license}, a copyleft license that may require source disclosure.`,
          recommendation: `Review ${license} requirements. Consider using an alternative with a permissive license if this is a commercial project.`,
        });
      }

      // Check for unknown/unusual license
      if (UNKNOWN_PATTERNS.some(p => normalizedLicense.includes(p))) {
        issues.push({
          package: name,
          version: version.replace(/^[\^~>=<]*/, ''),
          license,
          type: 'unknown',
          severity: 'medium',
          description: `Package ${name} has an unusual license: "${license}".`,
          recommendation: `Manually review the license terms of ${name} at its repository.`,
        });
      }
    }

    // Check for license conflicts
    issues.push(...this.detectConflicts(depEntries));

    return issues.map(issue => this.issueToInsight(issue));
  }

  private readPackageJson(): { dependencies: Record<string, string>; devDependencies: Record<string, string> } | null {
    try {
      const content = fs.readFileSync(path.join(this.projectDir, 'package.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private getPackageLicense(pkgName: string): string | null {
    // Strategy 1: Check package.json in node_modules
    const pkgJsonPath = path.join(this.projectDir, 'node_modules', pkgName, 'package.json');
    try {
      const content = fs.readFileSync(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.license) {
        return typeof pkg.license === 'string' ? pkg.license : (pkg.license as { type: string }).type;
      }
    } catch { /* continue */ }

    // Strategy 2: Check LICENSE file
    const licensePath = path.join(this.projectDir, 'node_modules', pkgName, 'LICENSE');
    try {
      const content = fs.readFileSync(licensePath, 'utf-8').toLowerCase();
      if (content.includes('mit license')) return 'MIT';
      if (content.includes('apache license') && content.includes('version 2.0')) return 'Apache-2.0';
      if (content.includes('bsd 3-clause')) return 'BSD-3-Clause';
      if (content.includes('bsd 2-clause')) return 'BSD-2-Clause';
      if (content.includes('isc license')) return 'ISC';
    } catch { /* continue */ }

    return null;
  }

  private detectConflicts(depEntries: [string, string][]): LicenseIssue[] {
    const issues: LicenseIssue[] = [];

    // Detect if project has GPL dependencies while also having proprietary code
    const pkg = this.readPackageJson();
    if (!pkg) return issues;

    const projectLicense = this.getProjectLicense();

    // If project is MIT/Apache but has AGPL deps
    if (projectLicense && ['mit', 'apache-2.0'].includes(projectLicense.toLowerCase())) {
      for (const [name, version] of depEntries) {
        const license = this.getPackageLicense(name);
        if (license && license.toLowerCase() === 'agpl-3.0') {
          issues.push({
            package: name,
            version: version.replace(/^[\^~>=<]*/, ''),
            license,
            type: 'conflict',
            severity: 'critical',
            description: `Project is ${projectLicense} but depends on ${name} (${license}). AGPL requires publishing source code of the entire network service.`,
            recommendation: `Either relicense the project, replace ${name} with a permissive alternative, or comply with AGPL requirements.`,
          });
        }
      }
    }

    return issues;
  }

  private getProjectLicense(): string | null {
    // Check package.json license field
    try {
      const content = fs.readFileSync(path.join(this.projectDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.license) return typeof pkg.license === 'string' ? pkg.license : null;
    } catch { /* continue */ }

    // Check LICENSE file
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENCE']) {
      try {
        const content = fs.readFileSync(path.join(this.projectDir, name), 'utf-8').toLowerCase();
        if (content.includes('mit license')) return 'MIT';
        if (content.includes('apache license')) return 'Apache-2.0';
      } catch { /* continue */ }
    }

    return null;
  }

  private getRestrictedRecommendation(license: string): string {
    switch (license) {
      case 'agpl-3.0':
        return 'AGPL-3.0 requires providing source code to any network user. Replace with a permissive alternative or ensure full AGPL compliance.';
      case 'gpl-3.0':
        return 'GPL-3.0 requires distributing source code with any derivative work. Replace with an MIT/Apache-2.0 alternative or ensure full GPL compliance.';
      case 'gpl-2.0':
        return 'GPL-2.0 has strong copyleft requirements. Consider replacing with a permissive-licensed alternative.';
      case 'sspl-1.0':
        return 'SSPL is not OSI-approved and has restrictive terms for cloud providers. Review carefully before use.';
      default:
        return `Review ${license} terms carefully and ensure compliance before using in production.`;
    }
  }

  private issueToInsight(issue: LicenseIssue): BrainInsight {
    return {
      type: 'license',
      priority: issue.severity === 'critical' ? 'critical' : issue.severity === 'high' ? 'high' : issue.severity === 'medium' ? 'medium' : 'low',
      title: `[license] ${issue.type}: ${issue.package} (${issue.license})`,
      content:
        `License issue with ${issue.package}@${issue.version}\n` +
        `  License: ${issue.license}\n` +
        `  Type: ${issue.type}\n` +
        `  Severity: ${issue.severity}\n` +
        `  Description: ${issue.description}\n` +
        `  Recommendation: ${issue.recommendation}`,
      files: ['package.json'],
      timestamp: new Date(),
      confidence: issue.type === 'restricted' ? 0.95 : 0.8,
      metadata: { package: issue.package, license: issue.license, issueType: issue.type },
    };
  }
}
