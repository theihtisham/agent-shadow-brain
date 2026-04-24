// src/brain/formal-verification-bridge.ts — Natural-language brain patterns → formal checks
// v6.0.0 — Hive Mind Edition
//
// Takes brain memories like "always use parameterized SQL queries" and generates:
//   - ESLint rule snippet (for JS/TS)
//   - Semgrep rule (for Python/Go/multi-language)
//   - LSP diagnostic (generic regex + message + code)
//
// Bridges informal team knowledge into enforced compile-time spec. Shadow Brain
// is the first tool that does this auto-generation step.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  FormalBridgeStats,
  FormalRule,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const RULES_PATH = path.join(os.homedir(), '.shadow-brain', 'formal-rules.json');

interface PersistShape {
  schemaVersion: 1;
  rules: FormalRule[];
}

export class FormalVerificationBridge {
  private brain: GlobalBrain;
  private rules: Map<string, FormalRule> = new Map();
  private initialized = false;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(RULES_PATH), { recursive: true });
    await this.brain.init();
    if (fs.existsSync(RULES_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8')) as PersistShape;
        for (const r of parsed.rules ?? []) {
          this.rules.set(r.id, { ...r, generatedAt: new Date(r.generatedAt) });
        }
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  /** Generate a formal rule from a memory by semantic pattern detection. */
  async generateFromMemory(memoryId: string): Promise<FormalRule | null> {
    await this.init();
    const entry = this.brain.recallByIds([memoryId])[0];
    if (!entry) return null;
    return this.generateFromText(entry.content, memoryId);
  }

  /** Generate a rule from raw natural-language text. */
  async generateFromText(text: string, sourceId?: string): Promise<FormalRule> {
    await this.init();
    const rule: FormalRule = {
      id: `fr-${crypto.randomBytes(6).toString('hex')}`,
      sourceMemoryId: sourceId ?? '',
      naturalLanguage: text.slice(0, 400),
      languageScope: [],
      generatedAt: new Date(),
      verified: false,
    };

    const lower = text.toLowerCase();

    // SQL patterns
    if (/(parameterized|prepared statement|no string concat).*sql|sql.*(parameterized|prepared)/.test(lower)
      || /never.*(concatenate|interpolate).*sql/.test(lower)) {
      rule.eslintRule = JSON.stringify(
        {
          'no-restricted-syntax': [
            'error',
            { selector: "TemplateLiteral[quasis.0.value.cooked=/SELECT|INSERT|UPDATE|DELETE/i]", message: 'Use parameterized SQL queries.' },
          ],
        },
        null,
        2,
      );
      rule.semgrepRule = this.semgrepBlock(
        'brain.no-sql-string-concat',
        ['javascript', 'typescript', 'python', 'go'],
        '$X + "SELECT " + $Y',
        'SQL string concatenation detected. Use parameterized queries.',
      );
      rule.lspDiagnostic = {
        code: 'SB-SQL-001',
        pattern: String.raw`\b(query|execute)\s*\(\s*\`[^\`]*(SELECT|INSERT|UPDATE|DELETE)[^\`]*\$\{`,
        message: 'Interpolated SQL detected. Use parameterized queries (sqlite3/pg/knex).',
      };
      rule.languageScope = ['javascript', 'typescript', 'python', 'go'];
      this.rules.set(rule.id, rule);
      await this.persist();
      return rule;
    }

    // Secret-in-code pattern
    if (/don('|)?t (hard\s?code|commit|store).*(api[_-]?key|secret|token|password)/.test(lower)) {
      rule.eslintRule = JSON.stringify(
        {
          'no-restricted-syntax': [
            'error',
            { selector: "Literal[raw=/(api[_-]?key|secret|token|password)\\s*[:=]/i]", message: 'Potential secret in source.' },
          ],
        },
        null,
        2,
      );
      rule.semgrepRule = this.semgrepBlock(
        'brain.no-hardcoded-secrets',
        ['javascript', 'typescript', 'python', 'go', 'java'],
        '$VAR = "..."',
        'Possible secret hardcoded in source. Use env vars.',
      );
      rule.lspDiagnostic = {
        code: 'SB-SEC-001',
        pattern: String.raw`(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["'][^"']{8,}["']`,
        message: 'Possible hardcoded secret. Move to environment variables.',
      };
      rule.languageScope = ['javascript', 'typescript', 'python', 'go', 'java'];
      this.rules.set(rule.id, rule);
      await this.persist();
      return rule;
    }

    // Bcrypt / password hashing
    if (/bcrypt.*cost.*1[012]|argon2|hash.*password/.test(lower) && !/md5|sha1/.test(lower)) {
      rule.lspDiagnostic = {
        code: 'SB-SEC-002',
        pattern: String.raw`\bbcrypt\.(hash|hashSync)\s*\([^,]+,\s*[0-9](?!\d)`,
        message: 'bcrypt cost factor is too low. Use >=12 (project convention).',
      };
      rule.languageScope = ['javascript', 'typescript'];
      this.rules.set(rule.id, rule);
      await this.persist();
      return rule;
    }

    // Generic "avoid X" pattern (catch-all)
    const avoidMatch = lower.match(/avoid\s+([a-z0-9_\-. /]+)/);
    if (avoidMatch) {
      const target = avoidMatch[1].trim();
      rule.lspDiagnostic = {
        code: 'SB-GEN-001',
        pattern: this.escapeRegex(target),
        message: `Project memory advises avoiding "${target}".`,
      };
      rule.languageScope = ['any'];
      this.rules.set(rule.id, rule);
      await this.persist();
      return rule;
    }

    // Fallback: no formal pattern matched
    rule.lspDiagnostic = undefined;
    rule.languageScope = [];
    this.rules.set(rule.id, rule);
    await this.persist();
    return rule;
  }

  /** Compile all formal rules into ESLint config snippet. */
  exportEslintConfig(): string {
    const rules: Record<string, unknown> = {};
    for (const r of this.rules.values()) {
      if (r.eslintRule) {
        try {
          const obj = JSON.parse(r.eslintRule);
          Object.assign(rules, obj);
        } catch { /* skip */ }
      }
    }
    return JSON.stringify({ rules }, null, 2);
  }

  /** Compile all formal rules into Semgrep YAML. */
  exportSemgrepYaml(): string {
    const lines = ['rules:'];
    for (const r of this.rules.values()) {
      if (r.semgrepRule) lines.push(r.semgrepRule);
    }
    return lines.join('\n');
  }

  /** Snapshot stats. */
  stats(): FormalBridgeStats {
    const byLang: Record<string, number> = {};
    let verified = 0;
    let lastGenerated: Date | null = null;
    for (const r of this.rules.values()) {
      for (const lang of r.languageScope) byLang[lang] = (byLang[lang] ?? 0) + 1;
      if (r.verified) verified++;
      if (!lastGenerated || r.generatedAt > lastGenerated) lastGenerated = r.generatedAt;
    }
    return {
      totalRules: this.rules.size,
      byLanguage: byLang,
      verifiedRules: verified,
      lastGenerated,
    };
  }

  listRules(limit = 50): FormalRule[] {
    return Array.from(this.rules.values())
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
      .slice(0, limit);
  }

  async removeRule(id: string): Promise<boolean> {
    await this.init();
    const ok = this.rules.delete(id);
    if (ok) await this.persist();
    return ok;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private semgrepBlock(id: string, languages: string[], pattern: string, message: string): string {
    return `  - id: ${id}\n    languages: [${languages.join(', ')}]\n    severity: WARNING\n    message: "${message}"\n    pattern: |\n      ${pattern.replace(/\n/g, '\n      ')}`;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async persist(): Promise<void> {
    try {
      const payload: PersistShape = {
        schemaVersion: 1,
        rules: Array.from(this.rules.values()),
      };
      const tmp = RULES_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, RULES_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: FormalVerificationBridge | null = null;

export function getFormalBridge(): FormalVerificationBridge {
  if (!_instance) _instance = new FormalVerificationBridge();
  return _instance;
}

export function resetFormalBridgeForTests(): void {
  _instance = null;
}
