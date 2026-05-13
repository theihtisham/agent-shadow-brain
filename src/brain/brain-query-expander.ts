// src/brain/brain-query-expander.ts — Query expansion + HyDE
// v6.0.2 — Hive Mind Edition
//
// Short user queries make noisy embeddings. Expanding "fix auth" →
// "fix authentication login session token bearer" produces a denser
// query vector with more lexical surface area for the reranker to bite on.
//
// HyDE (Hypothetical Document Embeddings) takes this further: ask a local
// LLM to draft a 1-paragraph "ideal answer" to the query and search by
// THAT document. Empirically this beats raw query embedding for
// underspecified questions. Falls through to a templated pseudo-answer
// when no Ollama model is reachable so the technique always returns
// something usable.
//
// Persists every expansion to ~/.shadow-brain/query-expansions.jsonl so
// downstream analysis can correlate (expansion technique → click vs ignore).
//
// Exposed: BrainQueryExpander, getBrainQueryExpander(),
//          resetBrainQueryExpanderForTests().
//   .expand(query, opts)
//   .combineAll(query, opts)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const BRAIN_DIR = path.join(os.homedir(), '.shadow-brain');
const EXPANSIONS_LOG = path.join(BRAIN_DIR, 'query-expansions.jsonl');
const DEFAULT_MAX_TERMS = 12;
const HYDE_TIMEOUT_MS = 12_000;
const HYDE_PROBE_TIMEOUT_MS = 1500;
const HYDE_CANDIDATES = ['qwen2.5-coder:1.5b', 'deepseek-coder:1.3b', 'llama3.2'];
const OLLAMA_URL = 'http://127.0.0.1:11434';

export type ExpansionTechnique = 'synonyms' | 'abbrev' | 'related' | 'hyde';

export interface ExpansionOptions {
  techniques?: ExpansionTechnique[];
  maxTerms?: number;
  hydeModel?: string;
}

export interface ExpansionResult {
  original: string;
  expanded: string;
  techniques_used: string[];
  terms_added: string[];
  hyde_doc?: string;
  durationMs: number;
}

// 80+ programmer-domain synonym mappings. Each key maps to a list of related
// terms; the expander pulls all of them when the key appears in the query.
const SYNONYMS: Record<string, string[]> = {
  auth: ['authentication', 'login', 'session', 'credentials', 'token', 'bearer', 'signin'],
  authentication: ['auth', 'login', 'session', 'credentials', 'oauth'],
  login: ['signin', 'auth', 'authentication', 'session'],
  logout: ['signout', 'session', 'invalidate'],
  signin: ['login', 'auth', 'authenticate'],
  signup: ['register', 'registration', 'onboarding', 'create account'],
  register: ['signup', 'enrollment', 'create user'],
  password: ['credential', 'secret', 'passphrase', 'hash'],
  token: ['jwt', 'bearer', 'session', 'access token', 'refresh'],
  jwt: ['token', 'bearer', 'json web token', 'claim'],
  session: ['cookie', 'token', 'auth', 'login state'],
  oauth: ['authentication', 'token', 'provider', 'scope'],
  permission: ['authorization', 'access', 'role', 'rbac', 'grant'],
  authorization: ['permission', 'access control', 'rbac', 'authz'],
  role: ['permission', 'authorization', 'group', 'rbac'],

  bug: ['issue', 'defect', 'error', 'fault', 'problem', 'glitch'],
  issue: ['bug', 'defect', 'problem', 'ticket'],
  error: ['exception', 'failure', 'bug', 'fault', 'crash'],
  exception: ['error', 'throw', 'panic', 'failure'],
  crash: ['failure', 'error', 'segfault', 'panic', 'fatal'],
  fail: ['error', 'failure', 'broken', 'crash'],
  failure: ['fail', 'error', 'crash', 'outage'],
  fix: ['patch', 'repair', 'resolve', 'correct', 'mend'],
  patch: ['fix', 'hotfix', 'update', 'change'],
  resolve: ['fix', 'solve', 'address', 'handle'],
  debug: ['investigate', 'trace', 'inspect', 'troubleshoot'],
  trace: ['log', 'debug', 'stack trace', 'instrument'],

  refactor: ['cleanup', 'redesign', 'restructure', 'rewrite', 'tidy'],
  cleanup: ['refactor', 'tidy', 'normalize', 'sanitize'],
  redesign: ['refactor', 'rewrite', 'architecture', 'restructure'],
  rewrite: ['refactor', 'redo', 'reimplement'],
  optimize: ['improve', 'speedup', 'performance', 'tune'],
  performance: ['speed', 'perf', 'latency', 'throughput', 'optimize'],
  speed: ['performance', 'fast', 'latency', 'throughput'],
  latency: ['delay', 'response time', 'performance', 'slow'],
  cache: ['caching', 'memoize', 'store', 'buffer'],
  memoize: ['cache', 'memoization', 'store'],

  api: ['application programming interface', 'endpoint', 'service', 'rest', 'rpc'],
  endpoint: ['api', 'route', 'url', 'handler'],
  route: ['endpoint', 'path', 'url', 'handler'],
  rest: ['restful', 'http api', 'endpoint'],
  graphql: ['gql', 'query language', 'api'],
  rpc: ['grpc', 'remote procedure', 'api'],
  service: ['microservice', 'api', 'daemon', 'server'],
  microservice: ['service', 'api', 'container'],

  database: ['db', 'datastore', 'storage', 'sql', 'persistence'],
  db: ['database', 'datastore', 'storage'],
  sql: ['database', 'query', 'relational'],
  query: ['sql', 'search', 'lookup', 'select'],
  schema: ['model', 'structure', 'migration', 'definition'],
  migration: ['schema change', 'alembic', 'flyway', 'db update'],
  table: ['relation', 'schema', 'collection'],
  index: ['indexing', 'btree', 'hash', 'lookup'],
  transaction: ['tx', 'commit', 'rollback', 'atomic'],

  test: ['testing', 'spec', 'unit test', 'check', 'assert'],
  testing: ['test', 'qa', 'verification', 'validate'],
  unit: ['unittest', 'jest', 'pytest', 'spec'],
  integration: ['e2e', 'end to end', 'smoke', 'cross module'],
  mock: ['stub', 'fake', 'spy', 'fixture'],
  fixture: ['mock', 'sample', 'seed data'],

  deploy: ['deployment', 'release', 'ship', 'rollout', 'publish'],
  deployment: ['deploy', 'release', 'rollout', 'cicd'],
  release: ['deploy', 'version', 'publish', 'ship'],
  cicd: ['continuous integration', 'pipeline', 'jenkins', 'github actions'],
  pipeline: ['cicd', 'workflow', 'build chain'],
  build: ['compile', 'bundle', 'package'],
  compile: ['build', 'transpile', 'tsc'],

  ml: ['machine learning', 'model', 'training', 'ai'],
  ai: ['artificial intelligence', 'ml', 'model', 'llm'],
  llm: ['language model', 'ai', 'gpt', 'transformer'],
  embedding: ['vector', 'representation', 'encoding'],
  vector: ['embedding', 'array', 'tensor'],
  rag: ['retrieval augmented generation', 'vector search', 'context injection'],

  security: ['secure', 'vuln', 'vulnerability', 'hardening', 'protection'],
  vuln: ['vulnerability', 'cve', 'security', 'exploit'],
  vulnerability: ['vuln', 'cve', 'exploit', 'weakness'],
  encrypt: ['encryption', 'cipher', 'crypto', 'tls'],
  crypto: ['encryption', 'cipher', 'hash', 'signature'],
  hash: ['digest', 'checksum', 'crypto', 'bcrypt'],

  ui: ['interface', 'frontend', 'view', 'screen'],
  frontend: ['ui', 'client', 'browser', 'react'],
  backend: ['server', 'api', 'service'],
  fullstack: ['full stack', 'frontend backend', 'end to end'],
  component: ['widget', 'element', 'module', 'block'],
  state: ['store', 'context', 'redux', 'data'],
  redux: ['state', 'store', 'flux'],

  log: ['logging', 'trace', 'record', 'audit'],
  logging: ['log', 'trace', 'observability'],
  monitor: ['observability', 'metrics', 'alerting', 'health'],
  metric: ['measurement', 'gauge', 'counter', 'telemetry'],
  alert: ['notification', 'warning', 'page', 'incident'],

  config: ['configuration', 'settings', 'env', 'options'],
  configuration: ['config', 'settings', 'env'],
  env: ['environment', 'variable', 'config'],
  setting: ['config', 'preference', 'option'],

  docker: ['container', 'image', 'compose'],
  container: ['docker', 'pod', 'image'],
  kubernetes: ['k8s', 'pod', 'cluster', 'helm'],
  k8s: ['kubernetes', 'pod', 'cluster'],

  git: ['version control', 'commit', 'branch', 'merge'],
  commit: ['git', 'change', 'snapshot'],
  branch: ['git', 'feature', 'merge'],
  merge: ['git', 'pull request', 'integrate'],
  pr: ['pull request', 'merge request', 'review'],
};

// 50+ programmer abbreviations. Single-token in → expanded phrase out.
const ABBREVIATIONS: Record<string, string> = {
  api: 'application programming interface',
  db: 'database',
  sql: 'structured query language',
  cli: 'command line interface',
  gui: 'graphical user interface',
  ui: 'user interface',
  ux: 'user experience',
  auth: 'authentication',
  authz: 'authorization',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  llm: 'large language model',
  nlp: 'natural language processing',
  ocr: 'optical character recognition',
  cv: 'computer vision',
  os: 'operating system',
  fs: 'file system',
  io: 'input output',
  ipc: 'inter process communication',
  rpc: 'remote procedure call',
  rest: 'representational state transfer',
  http: 'hypertext transfer protocol',
  https: 'http secure',
  url: 'uniform resource locator',
  uri: 'uniform resource identifier',
  dns: 'domain name system',
  cdn: 'content delivery network',
  tls: 'transport layer security',
  ssl: 'secure sockets layer',
  jwt: 'json web token',
  oauth: 'open authorization',
  rbac: 'role based access control',
  cors: 'cross origin resource sharing',
  csrf: 'cross site request forgery',
  xss: 'cross site scripting',
  cve: 'common vulnerabilities exposures',
  ci: 'continuous integration',
  cd: 'continuous deployment',
  cicd: 'continuous integration continuous deployment',
  vcs: 'version control system',
  pr: 'pull request',
  mr: 'merge request',
  ide: 'integrated development environment',
  sdk: 'software development kit',
  npm: 'node package manager',
  pip: 'python package installer',
  k8s: 'kubernetes',
  vm: 'virtual machine',
  iam: 'identity access management',
  sso: 'single sign on',
  mfa: 'multi factor authentication',
  rag: 'retrieval augmented generation',
  ann: 'approximate nearest neighbors',
  hnsw: 'hierarchical navigable small world',
  bm25: 'best matching 25',
  tdd: 'test driven development',
  bdd: 'behavior driven development',
  dx: 'developer experience',
};

export class BrainQueryExpander {
  /** Expand a query using selected techniques; returns the densified search text. */
  async expand(query: string, opts?: ExpansionOptions): Promise<ExpansionResult> {
    const start = Date.now();
    const original = (query ?? '').trim();
    if (!original) {
      return { original, expanded: original, techniques_used: [], terms_added: [], durationMs: 0 };
    }

    const techniques = opts?.techniques ?? ['synonyms', 'abbrev', 'related'];
    const maxTerms = opts?.maxTerms ?? DEFAULT_MAX_TERMS;
    const used: string[] = [];
    const added: string[] = [];
    let hydeDoc: string | undefined;

    const queryTokens = tokenize(original);
    const baseSet = new Set(queryTokens);

    if (techniques.includes('synonyms')) {
      const before = added.length;
      for (const tok of queryTokens) {
        const syns = SYNONYMS[tok];
        if (!syns) continue;
        for (const s of syns) {
          if (added.length >= maxTerms) break;
          if (baseSet.has(s)) continue;
          added.push(s);
          baseSet.add(s);
        }
      }
      if (added.length > before) used.push('synonyms');
    }

    if (techniques.includes('abbrev')) {
      const before = added.length;
      for (const tok of queryTokens) {
        const exp = ABBREVIATIONS[tok];
        if (!exp) continue;
        for (const w of exp.split(/\s+/)) {
          if (added.length >= maxTerms) break;
          if (baseSet.has(w)) continue;
          added.push(w);
          baseSet.add(w);
        }
      }
      if (added.length > before) used.push('abbrev');
    }

    if (techniques.includes('related')) {
      const before = added.length;
      const related = await this.lookupRelatedEntities(queryTokens, maxTerms - added.length);
      for (const r of related) {
        if (baseSet.has(r)) continue;
        added.push(r);
        baseSet.add(r);
      }
      if (added.length > before) used.push('related');
    }

    let expanded = added.length > 0 ? `${original} ${added.join(' ')}` : original;

    if (techniques.includes('hyde')) {
      const doc = await this.generateHyde(original, opts?.hydeModel);
      if (doc) {
        hydeDoc = doc;
        // HyDE replaces — the hypothetical answer IS the new search text.
        expanded = doc;
        used.push('hyde');
      }
    }

    const result: ExpansionResult = {
      original,
      expanded,
      techniques_used: used,
      terms_added: added,
      hyde_doc: hydeDoc,
      durationMs: Date.now() - start,
    };

    this.persist(result).catch(() => { /* non-fatal */ });
    return result;
  }

  /**
   * Run all techniques and return the densest expansion. Best for direct use
   * by retrievers that don't want to think about technique selection.
   */
  async combineAll(query: string, opts?: ExpansionOptions): Promise<ExpansionResult> {
    return this.expand(query, {
      ...opts,
      techniques: opts?.techniques ?? ['synonyms', 'abbrev', 'related', 'hyde'],
    });
  }

  // ── Related entities (brain entity co-occurrence) ─────────────────────

  private async lookupRelatedEntities(queryTokens: string[], budget: number): Promise<string[]> {
    if (budget <= 0) return [];
    try {
      const entityDir = path.join(BRAIN_DIR, 'entities');
      if (!fs.existsSync(entityDir)) return [];

      const cooc = new Map<string, number>();
      const files = fs.readdirSync(entityDir).filter(f => f.endsWith('.json'));
      // Scan up to ~500 entities, fine for desktop use.
      for (const file of files.slice(0, 500)) {
        try {
          const raw = fs.readFileSync(path.join(entityDir, file), 'utf-8');
          const obj = JSON.parse(raw) as { name?: string; observations?: string[]; tags?: string[] };
          const surface = `${obj.name ?? ''} ${(obj.observations ?? []).join(' ')} ${(obj.tags ?? []).join(' ')}`;
          const toks = tokenize(surface);
          const hit = queryTokens.some(qt => toks.includes(qt));
          if (!hit) continue;
          for (const t of toks) {
            if (queryTokens.includes(t)) continue;
            cooc.set(t, (cooc.get(t) ?? 0) + 1);
          }
        } catch { /* skip corrupt entity */ }
      }

      const ranked = [...cooc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3 + budget);
      return ranked.map(([term]) => term).slice(0, budget);
    } catch {
      return [];
    }
  }

  // ── HyDE ──────────────────────────────────────────────────────────────

  private async generateHyde(query: string, preferredModel?: string): Promise<string | null> {
    const model = await this.probeHydeModel(preferredModel);
    if (!model) return this.templateHyde(query);

    try {
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `Write ONE concise paragraph (2-4 sentences) answering the following question as if it were a documentation excerpt. Use specific technical vocabulary. Do not say "I" or address the reader.\n\nQuestion: ${query}\n\nAnswer:`,
          stream: false,
          options: { temperature: 0.3, num_predict: 220 },
        }),
        signal: AbortSignal.timeout(HYDE_TIMEOUT_MS),
      });
      if (!res.ok) return this.templateHyde(query);
      const json = (await res.json()) as { response?: string };
      const doc = (json.response ?? '').trim();
      return doc || this.templateHyde(query);
    } catch {
      return this.templateHyde(query);
    }
  }

  private async probeHydeModel(preferred?: string): Promise<string | null> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(HYDE_PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      const installed = (json.models ?? []).map(m => m.name);
      if (installed.length === 0) return null;

      const candidates = preferred ? [preferred, ...HYDE_CANDIDATES] : HYDE_CANDIDATES;
      for (const c of candidates) {
        const match = installed.find(name => name === c || name.startsWith(c));
        if (match) return match;
      }
      // Fallback to first installed model so HyDE isn't dead weight.
      return installed[0];
    } catch {
      return null;
    }
  }

  private templateHyde(query: string): string {
    const tokens = tokenize(query);
    const subject = tokens.slice(0, 3).join(' ') || query;
    const enriched = tokens
      .flatMap(t => SYNONYMS[t] ?? [])
      .filter(t => !tokens.includes(t))
      .slice(0, 4);
    const tail = enriched.length ? `, which usually involves ${enriched.join(', ')}` : '';
    return `This is likely about ${subject}${tail}. A typical solution involves identifying the relevant component, verifying its current behavior, and applying a targeted change covered by tests.`;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private async persist(result: ExpansionResult): Promise<void> {
    try {
      fs.mkdirSync(BRAIN_DIR, { recursive: true });
      const entry = JSON.stringify({ ts: new Date().toISOString(), ...result }) + '\n';
      fs.appendFileSync(EXPANSIONS_LOG, entry);
    } catch { /* non-fatal */ }
  }
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const stop = new Set(['the','a','an','and','or','of','to','for','in','on','is','it','this','that','as','by','be','do']);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !stop.has(t));
}

let _instance: BrainQueryExpander | null = null;
export function getBrainQueryExpander(): BrainQueryExpander {
  if (!_instance) _instance = new BrainQueryExpander();
  return _instance;
}
export function resetBrainQueryExpanderForTests(): void { _instance = null; }
