// src/brain/intent-engine.ts — Developer intent prediction from code changes
// v6.0.0 — Behavioral analysis engine

import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeveloperIntent {
  action: IntentAction;
  confidence: number;
  evidence: string[];
  prediction: string;
  suggestions: string[];
  relatedFiles: string[];
  estimatedScope: 'small' | 'medium' | 'large' | 'refactor';
}

export type IntentAction =
  | 'adding-feature'
  | 'fixing-bug'
  | 'refactoring'
  | 'adding-tests'
  | 'updating-deps'
  | 'improving-perf'
  | 'adding-docs'
  | 'cleanup'
  | 'security-fix'
  | 'api-change'
  | 'ui-change'
  | 'config-change'
  | 'ci-cd'
  | 'database-migration'
  | 'unknown';

export interface IntentSignal {
  type: string;
  weight: number;
  source: string;
  timestamp: number;
}

export interface WorkSession {
  id: string;
  startedAt: number;
  lastActivity: number;
  filesModified: string[];
  intents: DeveloperIntent[];
  focusArea: string;
  velocity: number; // changes per minute
}

export interface IntentStats {
  totalPredictions: number;
  accuracy: number;
  topIntents: Array<{ action: IntentAction; count: number }>;
  currentSession: WorkSession | null;
  avgConfidence: number;
  patternCount: number;
}

// ── Intent Signals Map ─────────────────────────────────────────────────────

const INTENT_SIGNALS: Record<IntentAction, Array<{ pattern: RegExp | string; weight: number; source: string }>> = {
  'adding-feature': [
    { pattern: /^(?:feat|feature|add|new|implement|create)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: '.ts', weight: 0.3, source: 'new-file' },
    { pattern: /export\s+(?:class|function|const)\s+\w+/g, weight: 0.4, source: 'code-pattern' },
    { pattern: /import.*from/g, weight: 0.2, source: 'new-import' },
  ],
  'fixing-bug': [
    { pattern: /^(?:fix|bug|patch|hotfix|resolve|close)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /if\s*\(\s*!\s*\w+/g, weight: 0.3, source: 'null-check-added' },
    { pattern: /try\s*\{/g, weight: 0.3, source: 'error-handling-added' },
    { pattern: /catch\s*\(/g, weight: 0.3, source: 'catch-added' },
    { pattern: /\.test\.|\.spec\./i, weight: 0.2, source: 'test-file-modified' },
  ],
  'refactoring': [
    { pattern: /^(?:refactor|restructure|reorganize|simplify|extract|rename|move)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /import.*from\s+['"]\.\//g, weight: 0.3, source: 'import-change' },
    { pattern: 'delete', weight: 0.4, source: 'file-deleted' },
    { pattern: 'rename', weight: 0.5, source: 'file-renamed' },
  ],
  'adding-tests': [
    { pattern: /^(?:test|spec|coverage|e2e)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /\.test\.|\.spec\.|__tests__/i, weight: 0.8, source: 'test-file' },
    { pattern: /describe\s*\(|it\s*\(|expect\s*\(/g, weight: 0.7, source: 'test-code' },
    { pattern: /jest|vitest|mocha|cypress|playwright/i, weight: 0.4, source: 'test-framework' },
  ],
  'updating-deps': [
    { pattern: /^(?:deps|dependencies|upgrade|update|bump)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: 'package.json', weight: 0.7, source: 'package-json' },
    { pattern: 'package-lock.json', weight: 0.6, source: 'lockfile' },
    { pattern: 'requirements.txt', weight: 0.7, source: 'requirements' },
    { pattern: 'go.mod', weight: 0.7, source: 'gomod' },
  ],
  'improving-perf': [
    { pattern: /^(?:perf|performance|optimize|speed|cache|lazy|memo)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /useMemo|useCallback|React\.memo/g, weight: 0.5, source: 'react-memo' },
    { pattern: /cache|memoize|lazy|debounce|throttle/gi, weight: 0.4, source: 'perf-keyword' },
    { pattern: /index|INDEX|CREATE INDEX/gi, weight: 0.5, source: 'db-index' },
  ],
  'adding-docs': [
    { pattern: /^(?:docs|documentation|readme|jsdoc|comment)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /\.md$/i, weight: 0.7, source: 'markdown-file' },
    { pattern: /\/\*\*[\s\S]*?\*\//g, weight: 0.4, source: 'jsdoc' },
    { pattern: 'README', weight: 0.8, source: 'readme' },
  ],
  'cleanup': [
    { pattern: /^(?:cleanup|clean|remove|delete|prune|lint)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /console\.\w+/g, weight: 0.3, source: 'console-removed' },
    { pattern: /TODO|FIXME|HACK/g, weight: 0.3, source: 'todo-addressed' },
  ],
  'security-fix': [
    { pattern: /^(?:security|vuln|cve|auth|xss|csrf|injection|sanitize)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /sanitize|escape|validate|csrf|helmet|cors/gi, weight: 0.5, source: 'security-code' },
    { pattern: /bcrypt|argon2|jwt|oauth/gi, weight: 0.4, source: 'auth-code' },
  ],
  'api-change': [
    { pattern: /^(?:api|endpoint|route|controller|handler)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /router\.\w+|app\.\w+\s*\(/g, weight: 0.5, source: 'route-code' },
    { pattern: /openapi|swagger|graphql|rest/gi, weight: 0.4, source: 'api-spec' },
  ],
  'ui-change': [
    { pattern: /^(?:ui|ux|style|css|layout|component|page|view)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /\.css$|\.scss$|\.less$|\.styled\./i, weight: 0.7, source: 'style-file' },
    { pattern: /\.tsx$|\.jsx$|\.vue$|\.svelte$/i, weight: 0.5, source: 'component-file' },
    { pattern: /className|style=|styled\./g, weight: 0.3, source: 'style-code' },
  ],
  'config-change': [
    { pattern: /^(?:config|env|settings|setup)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /\.config\.|\.env|tsconfig|webpack|vite\.config/i, weight: 0.7, source: 'config-file' },
    { pattern: /docker|kubernetes|terraform|ansible/i, weight: 0.5, source: 'infra-config' },
  ],
  'ci-cd': [
    { pattern: /^(?:ci|cd|pipeline|deploy|build|workflow|action)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /\.github\/workflows|\.gitlab-ci|Jenkinsfile|\.circleci/i, weight: 0.8, source: 'ci-file' },
    { pattern: 'Dockerfile', weight: 0.5, source: 'docker' },
  ],
  'database-migration': [
    { pattern: /^(?:migration|schema|db|database|migrate|seed)/i, weight: 0.9, source: 'commit-msg' },
    { pattern: /migration|\.sql$/i, weight: 0.7, source: 'migration-file' },
    { pattern: /CREATE TABLE|ALTER TABLE|DROP TABLE|ADD COLUMN/gi, weight: 0.8, source: 'sql' },
    { pattern: /prisma|sequelize|typeorm|knex|drizzle/gi, weight: 0.5, source: 'orm' },
  ],
  'unknown': [],
};

// ── Intent Engine ──────────────────────────────────────────────────────────

export class IntentEngine {
  private predictions: DeveloperIntent[] = [];
  private signals: IntentSignal[] = [];
  private sessions: WorkSession[] = [];
  private currentSession: WorkSession | null = null;
  private intentHistory: Map<IntentAction, number> = new Map();
  private fileIntentMap: Map<string, IntentAction[]> = new Map(); // file -> past intents
  private accuracy = 0;
  private correctPredictions = 0;
  private totalPredictions = 0;

  constructor() {
    this.startNewSession();
  }

  // ── Prediction ──────────────────────────────────────────────────────

  predictIntent(changes: Array<{ file: string; type: 'add' | 'modify' | 'delete'; content?: string; diff?: string }>, commitMsg?: string): DeveloperIntent {
    const scores = new Map<IntentAction, { score: number; evidence: string[] }>();

    // Initialize all intents
    for (const action of Object.keys(INTENT_SIGNALS) as IntentAction[]) {
      scores.set(action, { score: 0, evidence: [] });
    }

    // Score from commit message
    if (commitMsg) {
      for (const [action, signalDefs] of Object.entries(INTENT_SIGNALS)) {
        for (const signal of signalDefs) {
          if (signal.source === 'commit-msg' && signal.pattern instanceof RegExp) {
            if (signal.pattern.test(commitMsg)) {
              const entry = scores.get(action as IntentAction)!;
              entry.score += signal.weight;
              entry.evidence.push(`Commit message matches ${action} pattern`);
            }
          }
        }
      }
    }

    // Score from file changes
    for (const change of changes) {
      const fileName = path.basename(change.file);
      const ext = path.extname(change.file);
      const relPath = change.file;

      for (const [action, signalDefs] of Object.entries(INTENT_SIGNALS)) {
        for (const signal of signalDefs) {
          if (signal.source === 'commit-msg') continue;

          let matched = false;
          if (signal.pattern instanceof RegExp) {
            const testContent = change.content || change.diff || '';
            matched = signal.pattern.test(testContent);
            // Reset regex lastIndex
            if (signal.pattern.global) signal.pattern.lastIndex = 0;
          } else if (typeof signal.pattern === 'string') {
            matched = fileName.includes(signal.pattern) || relPath.includes(signal.pattern) || ext === signal.pattern;
          }

          if (matched) {
            const entry = scores.get(action as IntentAction)!;
            entry.score += signal.weight;
            entry.evidence.push(`${signal.source}: ${fileName}`);
          }
        }
      }

      // File-type heuristics
      if (change.type === 'add') {
        scores.get('adding-feature')!.score += 0.3;
        scores.get('adding-feature')!.evidence.push(`New file: ${fileName}`);
      }
      if (change.type === 'delete') {
        scores.get('refactoring')!.score += 0.3;
        scores.get('cleanup')!.score += 0.2;
        scores.get('refactoring')!.evidence.push(`Deleted: ${fileName}`);
      }

      // Historical file intent correlation
      const pastIntents = this.fileIntentMap.get(relPath);
      if (pastIntents && pastIntents.length > 0) {
        const lastIntent = pastIntents[pastIntents.length - 1];
        const entry = scores.get(lastIntent);
        if (entry) {
          entry.score += 0.15;
          entry.evidence.push(`Historical pattern: ${relPath} → ${lastIntent}`);
        }
      }
    }

    // Find top intent
    let topAction: IntentAction = 'unknown';
    let topScore = 0;
    let topEvidence: string[] = [];

    for (const [action, data] of scores) {
      if (data.score > topScore) {
        topScore = data.score;
        topAction = action;
        topEvidence = data.evidence;
      }
    }

    // Normalize confidence
    const totalScores = Array.from(scores.values()).reduce((s, d) => s + d.score, 0);
    const confidence = totalScores > 0 ? Math.min(1, topScore / totalScores) : 0;

    // Generate suggestions based on intent
    const suggestions = this.generateSuggestions(topAction, changes);
    const relatedFiles = this.findRelatedFiles(topAction, changes);

    const intent: DeveloperIntent = {
      action: topAction,
      confidence,
      evidence: topEvidence.slice(0, 10),
      prediction: this.describePrediction(topAction, changes),
      suggestions,
      relatedFiles,
      estimatedScope: this.estimateScope(changes),
    };

    // Track
    this.predictions.push(intent);
    if (this.predictions.length > 1000) this.predictions = this.predictions.slice(-500);
    this.totalPredictions++;
    this.intentHistory.set(topAction, (this.intentHistory.get(topAction) || 0) + 1);

    // Update file-intent map
    for (const change of changes) {
      if (!this.fileIntentMap.has(change.file)) {
        this.fileIntentMap.set(change.file, []);
      }
      const history = this.fileIntentMap.get(change.file)!;
      history.push(topAction);
      if (history.length > 10) this.fileIntentMap.set(change.file, history.slice(-10));
    }

    // Update session
    if (this.currentSession) {
      this.currentSession.lastActivity = Date.now();
      this.currentSession.filesModified.push(...changes.map(c => c.file));
      this.currentSession.intents.push(intent);
      this.currentSession.focusArea = topAction;
      const sessionDuration = (Date.now() - this.currentSession.startedAt) / 60_000;
      this.currentSession.velocity = sessionDuration > 0 ? this.currentSession.filesModified.length / sessionDuration : 0;
    }

    return intent;
  }

  confirmPrediction(correct: boolean): void {
    if (correct) this.correctPredictions++;
    this.accuracy = this.totalPredictions > 0 ? this.correctPredictions / this.totalPredictions : 0;
  }

  // ── Suggestions ─────────────────────────────────────────────────────

  private generateSuggestions(action: IntentAction, changes: Array<{ file: string; type: string }>): string[] {
    const suggestions: string[] = [];
    const files = changes.map(c => c.file);

    switch (action) {
      case 'adding-feature':
        suggestions.push('Consider writing tests for the new feature');
        suggestions.push('Update README/docs if the feature is user-facing');
        if (!files.some(f => /index\.|barrel|export/i.test(f))) {
          suggestions.push('Don\'t forget to export from the barrel file / index');
        }
        break;
      case 'fixing-bug':
        suggestions.push('Add a regression test to prevent recurrence');
        suggestions.push('Check for similar patterns elsewhere in the codebase');
        suggestions.push('Update CHANGELOG with the fix');
        break;
      case 'refactoring':
        suggestions.push('Run the full test suite after refactoring');
        suggestions.push('Check for broken imports or references');
        suggestions.push('Consider creating an ADR for the refactoring decision');
        break;
      case 'adding-tests':
        suggestions.push('Ensure edge cases and error paths are covered');
        suggestions.push('Check test naming follows team conventions');
        break;
      case 'updating-deps':
        suggestions.push('Run security audit on updated packages');
        suggestions.push('Check for breaking changes in changelogs');
        suggestions.push('Run full test suite to catch compatibility issues');
        break;
      case 'improving-perf':
        suggestions.push('Benchmark before and after to measure improvement');
        suggestions.push('Consider caching strategies for hot paths');
        break;
      case 'security-fix':
        suggestions.push('Run security scanner to verify the fix');
        suggestions.push('Check for similar vulnerabilities elsewhere');
        suggestions.push('Consider adding security test cases');
        break;
      case 'api-change':
        suggestions.push('Update API documentation / OpenAPI spec');
        suggestions.push('Check for backward compatibility');
        suggestions.push('Notify API consumers of the change');
        break;
      case 'database-migration':
        suggestions.push('Ensure migration is reversible (add down migration)');
        suggestions.push('Test migration with production-like data volume');
        suggestions.push('Check for potential data loss');
        break;
      default:
        suggestions.push('Consider running lint and tests before committing');
    }

    return suggestions;
  }

  private findRelatedFiles(action: IntentAction, changes: Array<{ file: string; type: string }>): string[] {
    const related: Set<string> = new Set();

    for (const change of changes) {
      const dir = path.dirname(change.file);
      const name = path.basename(change.file, path.extname(change.file));

      // Suggest test file if modifying source
      if (action !== 'adding-tests' && !change.file.includes('.test.') && !change.file.includes('.spec.')) {
        related.add(path.join(dir, `${name}.test${path.extname(change.file)}`));
        related.add(path.join(dir, '__tests__', `${name}.test${path.extname(change.file)}`));
      }

      // Suggest barrel file
      related.add(path.join(dir, 'index.ts'));
      related.add(path.join(dir, 'index.js'));
    }

    return Array.from(related).slice(0, 10);
  }

  private describePrediction(action: IntentAction, changes: Array<{ file: string; type: string }>): string {
    const fileCount = changes.length;
    const descriptions: Record<IntentAction, string> = {
      'adding-feature': `Adding a new feature (${fileCount} file${fileCount !== 1 ? 's' : ''} modified)`,
      'fixing-bug': `Fixing a bug (${fileCount} file${fileCount !== 1 ? 's' : ''} patched)`,
      'refactoring': `Refactoring code (${fileCount} file${fileCount !== 1 ? 's' : ''} restructured)`,
      'adding-tests': `Adding tests (${fileCount} test file${fileCount !== 1 ? 's' : ''})`,
      'updating-deps': `Updating dependencies`,
      'improving-perf': `Improving performance (${fileCount} file${fileCount !== 1 ? 's' : ''} optimized)`,
      'adding-docs': `Updating documentation`,
      'cleanup': `Code cleanup (${fileCount} file${fileCount !== 1 ? 's' : ''} cleaned)`,
      'security-fix': `Security fix (${fileCount} file${fileCount !== 1 ? 's' : ''} hardened)`,
      'api-change': `API changes (${fileCount} endpoint${fileCount !== 1 ? 's' : ''} modified)`,
      'ui-change': `UI/UX changes (${fileCount} component${fileCount !== 1 ? 's' : ''} modified)`,
      'config-change': `Configuration changes`,
      'ci-cd': `CI/CD pipeline changes`,
      'database-migration': `Database schema migration`,
      'unknown': `Code changes (${fileCount} file${fileCount !== 1 ? 's' : ''})`,
    };
    return descriptions[action] || descriptions.unknown;
  }

  private estimateScope(changes: Array<{ file: string; type: string }>): 'small' | 'medium' | 'large' | 'refactor' {
    const fileCount = changes.length;
    const dirs = new Set(changes.map(c => path.dirname(c.file)));
    const hasDeletes = changes.some(c => c.type === 'delete');

    if (fileCount <= 2) return 'small';
    if (fileCount <= 5 && dirs.size <= 2) return 'medium';
    if (hasDeletes && fileCount > 5) return 'refactor';
    return 'large';
  }

  // ── Session Management ──────────────────────────────────────────────

  private startNewSession(): void {
    this.currentSession = {
      id: `session-${Date.now()}`,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      filesModified: [],
      intents: [],
      focusArea: 'unknown',
      velocity: 0,
    };
    this.sessions.push(this.currentSession);
    if (this.sessions.length > 50) this.sessions = this.sessions.slice(-25);
  }

  getCurrentSession(): WorkSession | null {
    return this.currentSession;
  }

  getRecentIntents(n: number = 10): DeveloperIntent[] {
    return this.predictions.slice(-n);
  }

  // ── Stats ────────────────────────────────────────────────────────────

  stats(): IntentStats {
    const topIntents = Array.from(this.intentHistory.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const avgConfidence = this.predictions.length > 0
      ? this.predictions.reduce((s, p) => s + p.confidence, 0) / this.predictions.length
      : 0;

    return {
      totalPredictions: this.totalPredictions,
      accuracy: this.accuracy,
      topIntents,
      currentSession: this.currentSession,
      avgConfidence,
      patternCount: this.fileIntentMap.size,
    };
  }
}
