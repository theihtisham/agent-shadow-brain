// src/brain/custom-rules.ts — Custom rule engine: load, validate, apply user-defined rules

import { CustomRule, BrainInsight, FileChange } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const RULES_FILE_NAMES = [
  '.shadow-brain-rules.json',
  'shadow-brain-rules.json',
  '.shadowbrain.json',
];

export class CustomRulesEngine {
  private rules: CustomRule[] = [];
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async load(): Promise<void> {
    for (const name of RULES_FILE_NAMES) {
      const fp = path.join(this.projectDir, name);
      if (fs.existsSync(fp)) {
        try {
          const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          const rules = Array.isArray(raw) ? raw : raw.rules || [];
          this.rules = rules.map((r: any, i: number) => this.normalizeRule(r, i));
          return;
        } catch (err: any) {
          throw new Error(`Invalid rules file ${name}: ${err.message}`);
        }
      }
    }
    // Also check package.json for "shadowBrain.rules"
    const pkgPath = path.join(this.projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.shadowBrain?.rules) {
          this.rules = pkg.shadowBrain.rules.map((r: any, i: number) => this.normalizeRule(r, i));
        }
      } catch { /* ignore */ }
    }
  }

  getRules(): CustomRule[] {
    return this.rules.filter(r => r.enabled);
  }

  addRule(rule: Omit<CustomRule, 'id'>): CustomRule {
    const newRule: CustomRule = {
      ...rule,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    this.rules.push(newRule);
    return newRule;
  }

  removeRule(id: string): boolean {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx >= 0) { this.rules.splice(idx, 1); return true; }
    return false;
  }

  applyRules(changes: FileChange[]): BrainInsight[] {
    const insights: BrainInsight[] = [];
    const enabledRules = this.rules.filter(r => r.enabled);

    for (const change of changes) {
      const content = change.content || change.diff || '';
      if (!content) continue;

      for (const rule of enabledRules) {
        try {
          const flags = rule.flags || 'gi';
          const regex = new RegExp(rule.pattern, flags);
          if (regex.test(content)) {
            insights.push({
              type: 'warning',
              priority: rule.severity,
              title: `[Custom] ${rule.name}`,
              content: rule.description + (rule.suggestion ? `\n\nSuggestion: ${rule.suggestion}` : ''),
              files: [change.path],
              timestamp: new Date(),
            });
          }
        } catch {
          // Skip invalid regex patterns silently
        }
      }
    }

    return insights;
  }

  save(): void {
    const fp = path.join(this.projectDir, '.shadow-brain-rules.json');
    const data = { version: '1.0', rules: this.rules };
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  }

  private normalizeRule(r: any, index: number): CustomRule {
    return {
      id: r.id || `rule-${index}`,
      name: r.name || `Rule ${index + 1}`,
      description: r.description || '',
      pattern: r.pattern || '',
      flags: r.flags || 'gi',
      severity: r.severity || 'medium',
      category: r.category || 'quality',
      suggestion: r.suggestion,
      enabled: r.enabled !== false,
    };
  }
}
