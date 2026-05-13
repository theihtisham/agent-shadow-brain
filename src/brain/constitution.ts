// src/brain/constitution.ts — Project invariants ("constitution") layer
// v6.0.2 — Hive Mind Edition
//
// Reads <project_root>/.shadow-brain/constitution.md, parses Markdown rules
// under `## Rule N` headings, and exposes them to other parts of the brain
// for prompt injection and post-hoc validation.
//
// Each rule is one of:
//   - must    : hard requirement, violations always flagged
//   - should  : strong preference, flagged with lower confidence
//   - never   : prohibition, treated like must but inverted
//
// Rule format inside constitution.md:
//
//   ## Rule 1: short title
//   severity: must|should|never
//   scope: all|code|commits|tests
//   No secrets in commits. Use env vars only.
//
// Why no LLM call in proposeRule? The point is to draft a rule the user can
// review and edit; an LLM round-trip would slow that loop. The template-based
// proposer is "good enough" — humans confirm before persisting.
//
// Exposed: Constitution, getConstitution(), resetConstitutionForTests().
//   .injectInto(prompt, opts)
//   .validate(text)
//   .proposeRule(observation)
//   .approve(rule), .listRules()

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getEmbeddings } from './embeddings.js';

export type RuleSeverity = 'must' | 'should' | 'never';
export type RuleScope = 'all' | 'code' | 'commits' | 'tests';

export interface ConstitutionRule {
  id: string;
  severity: RuleSeverity;
  scope: RuleScope;
  title: string;
  text: string;
  keywords: string[];
  source: 'file' | 'proposed' | 'approved';
}

export interface Violation {
  rule: ConstitutionRule;
  confidence: number;
  evidence: string;
}

export interface ValidateResult {
  violations: Violation[];
  passed: ConstitutionRule[];
}

interface InjectOpts {
  scope?: RuleScope;
  maxRules?: number;
}

const HOME_DIR = path.join(os.homedir(), '.shadow-brain');
const VIOLATIONS_LOG = path.join(HOME_DIR, 'constitution-violations.jsonl');
const PROJECT_REL_PATH = path.join('.shadow-brain', 'constitution.md');
const APPROVED_REL_PATH = path.join('.shadow-brain', 'constitution-approved.json');
const DEFAULT_MAX_RULES = 6;

export class Constitution {
  private rules: ConstitutionRule[] = [];
  private approved: ConstitutionRule[] = [];
  private projectRoot: string;
  private watcher: fs.FSWatcher | null = null;
  private initialized = false;
  private embeddings = getEmbeddings();
  private vectorCache: Map<string, number[]> = new Map();

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(HOME_DIR, { recursive: true });
    this.loadFromDisk();
    this.startWatcher();
    this.initialized = true;
  }

  /** Prepend the most relevant constitution rules to a prompt as a preamble. */
  injectInto(prompt: string, opts: InjectOpts = {}): string {
    const scope = opts.scope ?? 'all';
    const max = opts.maxRules ?? DEFAULT_MAX_RULES;
    const relevant = this.allRules()
      .filter(r => r.scope === 'all' || r.scope === scope)
      .slice(0, max);
    if (!relevant.length) return prompt;
    const preamble = [
      '## Project Constitution (binding rules)',
      ...relevant.map((r, i) => `${i + 1}. [${r.severity.toUpperCase()}] ${r.title} — ${r.text}`),
      '',
      '## Task',
    ].join('\n');
    return `${preamble}\n${prompt}`;
  }

  /**
   * Score `text` against every rule. Uses both keyword matching (fast, precise)
   * and semantic similarity (slower, fuzzy). Reports a confidence in [0,1].
   */
  async validate(text: string): Promise<ValidateResult> {
    await this.init();
    const violations: Violation[] = [];
    const passed: ConstitutionRule[] = [];
    const haystack = text.toLowerCase();

    for (const rule of this.allRules()) {
      const keywordHit = rule.keywords.some(k => haystack.includes(k));
      let semanticScore = 0;
      try {
        const q = await this.embeddings.embed(text.slice(0, 4000));
        const r = await this.cachedEmbed(rule.text);
        semanticScore = cosine(q, r);
      } catch { /* embeddings optional */ }

      const triggers = rule.severity === 'never'
        ? keywordHit || semanticScore > 0.55
        : keywordHit && semanticScore > 0.35;

      if (triggers) {
        const confidence = clamp(0.4 * (keywordHit ? 1 : 0) + 0.6 * semanticScore, 0, 1);
        const evidence = this.extractEvidence(text, rule.keywords);
        violations.push({ rule, confidence: +confidence.toFixed(3), evidence });
        this.logViolation(rule, confidence, evidence);
      } else {
        passed.push(rule);
      }
    }

    return { violations, passed };
  }

  /** Build a candidate rule from an observed pattern. Template-only, no LLM. */
  proposeRule(observation: string): ConstitutionRule {
    const trimmed = observation.trim().slice(0, 600);
    const severity = guessSeverity(trimmed);
    const scope = guessScope(trimmed);
    const title = trimmed.split(/[.\n]/)[0].slice(0, 80) || 'Untitled rule';
    return {
      id: `proposed-${Date.now().toString(36)}`,
      severity,
      scope,
      title,
      text: trimmed,
      keywords: extractKeywords(trimmed),
      source: 'proposed',
    };
  }

  /** Persist a user-approved rule to constitution-approved.json. */
  async approve(rule: ConstitutionRule): Promise<ConstitutionRule> {
    const approved: ConstitutionRule = { ...rule, source: 'approved' };
    this.approved.push(approved);
    const dir = path.join(this.projectRoot, '.shadow-brain');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(this.projectRoot, APPROVED_REL_PATH);
    fs.writeFileSync(file, JSON.stringify(this.approved, null, 2));
    return approved;
  }

  listRules(): ConstitutionRule[] { return this.allRules(); }

  dispose(): void {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
  }

  // -- Internals -----------------------------------------------------------

  private allRules(): ConstitutionRule[] { return [...this.rules, ...this.approved]; }

  private loadFromDisk(): void {
    const file = path.join(this.projectRoot, PROJECT_REL_PATH);
    if (fs.existsSync(file)) {
      try { this.rules = parseConstitutionMarkdown(fs.readFileSync(file, 'utf-8')); }
      catch { this.rules = []; }
    } else {
      this.rules = [];
    }
    const approvedFile = path.join(this.projectRoot, APPROVED_REL_PATH);
    if (fs.existsSync(approvedFile)) {
      try { this.approved = JSON.parse(fs.readFileSync(approvedFile, 'utf-8')) as ConstitutionRule[]; }
      catch { this.approved = []; }
    } else {
      this.approved = [];
    }
    this.vectorCache.clear();
  }

  private startWatcher(): void {
    const dir = path.join(this.projectRoot, '.shadow-brain');
    if (!fs.existsSync(dir)) return;
    try {
      this.watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename) return;
        if (filename.toString().endsWith('constitution.md') ||
            filename.toString().endsWith('constitution-approved.json')) {
          this.loadFromDisk();
        }
      });
    } catch { /* watcher not critical */ }
  }

  private async cachedEmbed(text: string): Promise<number[]> {
    const cached = this.vectorCache.get(text);
    if (cached) return cached;
    const v = await this.embeddings.embed(text);
    this.vectorCache.set(text, v);
    return v;
  }

  private extractEvidence(text: string, keywords: string[]): string {
    const lower = text.toLowerCase();
    for (const k of keywords) {
      const idx = lower.indexOf(k);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + k.length + 40);
        return text.slice(start, end).replace(/\s+/g, ' ');
      }
    }
    return text.slice(0, 120).replace(/\s+/g, ' ');
  }

  private logViolation(rule: ConstitutionRule, confidence: number, evidence: string): void {
    try {
      const entry = {
        ts: new Date().toISOString(),
        projectRoot: this.projectRoot,
        ruleId: rule.id,
        severity: rule.severity,
        confidence,
        evidence,
      };
      fs.appendFileSync(VIOLATIONS_LOG, JSON.stringify(entry) + '\n');
    } catch { /* non-fatal */ }
  }
}

// -- Markdown parser ------------------------------------------------------

export function parseConstitutionMarkdown(md: string): ConstitutionRule[] {
  const out: ConstitutionRule[] = [];
  // Split on H2 headings that start with "Rule".
  const blocks = md.split(/^##\s+Rule\s+/im).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const headLine = lines.shift() ?? '';
    const m = headLine.match(/^(\S+)\s*[:\-—]?\s*(.*)$/);
    const id = `rule-${(m?.[1] ?? out.length + 1).toString().replace(/[^\w-]/g, '')}`;
    const title = (m?.[2] ?? '').trim() || `Rule ${out.length + 1}`;

    let severity: RuleSeverity = 'must';
    let scope: RuleScope = 'all';
    const bodyLines: string[] = [];
    for (const line of lines) {
      const sev = line.match(/^severity\s*:\s*(must|should|never)/i);
      const sco = line.match(/^scope\s*:\s*(all|code|commits|tests)/i);
      if (sev) { severity = sev[1].toLowerCase() as RuleSeverity; continue; }
      if (sco) { scope = sco[1].toLowerCase() as RuleScope; continue; }
      bodyLines.push(line);
    }
    const text = bodyLines.join('\n').trim();
    if (!text) continue;
    out.push({
      id,
      severity,
      scope,
      title,
      text,
      keywords: extractKeywords(`${title} ${text}`),
      source: 'file',
    });
  }
  return out;
}

function extractKeywords(text: string): string[] {
  const stop = new Set(['the','a','an','and','or','of','to','for','in','on','is','it','this','that','as','by','be','do','not','no','use','with','must','should','never','only']);
  const seen = new Set<string>();
  const out: string[] = [];
  const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  for (const tok of norm.split(/\s+/)) {
    if (tok.length < 4 || stop.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= 8) break;
  }
  return out;
}

function guessSeverity(text: string): RuleSeverity {
  const lower = text.toLowerCase();
  if (/\b(never|don'?t|prohibit|forbid|disallow|do not)\b/.test(lower)) return 'never';
  if (/\b(should|prefer|avoid|try to)\b/.test(lower)) return 'should';
  return 'must';
}

function guessScope(text: string): RuleScope {
  const lower = text.toLowerCase();
  if (/\b(commit|git|push|branch|merge)\b/.test(lower)) return 'commits';
  if (/\b(test|spec|coverage|assert)\b/.test(lower)) return 'tests';
  if (/\b(code|function|class|import|api)\b/.test(lower)) return 'code';
  return 'all';
}

function cosine(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

let _instance: Constitution | null = null;
export function getConstitution(projectRoot?: string): Constitution {
  if (!_instance) _instance = new Constitution(projectRoot);
  return _instance;
}
export function resetConstitutionForTests(): void {
  if (_instance) _instance.dispose();
  _instance = null;
}
