// src/brain/otel-lite.ts — Zero-dep OpenTelemetry-compatible JSONL tracer
// v6.0.2 — Multimodal Edition
//
// Stand-in for real OpenTelemetry. Emits JSONL spans that match OTel's
// "Compatible JSONL exporter" shape so users can pipe the file into a real
// OTel collector later. Zero dependencies.
//
// Storage:
//   ~/.shadow-brain/traces/<YYYY-MM-DD>.jsonl
//   Daily rotation, retains last 14 days, drops older silently.
//
// Usage:
//   const tracer = trace('shadow-brain');
//   const span = tracer.startSpan('brain.recall', { attributes: { project } });
//   span.setAttribute('query', q); span.addEvent('cache.miss');
//   try { ... } catch (e) { span.recordException(e); throw e; }
//   span.end();
//
//   await tracer.withSpan('embed', async () => { ... }); // auto begin/end

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const TRACE_DIR = path.join(os.homedir(), '.shadow-brain', 'traces');
const RETENTION_DAYS = 14;

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export interface SpanEvent {
  name: string;
  time_ns: number;
  attributes?: Record<string, unknown>;
}

export interface TraceLine {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  tracer_name: string;
  start_ns: number;
  end_ns: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: { code: SpanStatusCode; message?: string };
}

export interface SpanOptions {
  attributes?: Record<string, unknown>;
  parent?: Span;
}

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly tracerName: string;
  readonly startNs: number;
  private endNs: number = 0;
  private ended = false;
  private attrs: Record<string, unknown> = {};
  private events: SpanEvent[] = [];
  private status: { code: SpanStatusCode; message?: string } = { code: 'UNSET' };
  private tracer: Tracer;

  constructor(tracer: Tracer, name: string, opts?: SpanOptions) {
    this.tracer = tracer;
    this.name = name;
    this.tracerName = tracer.name;
    this.traceId = opts?.parent?.traceId || randomHex(32);
    this.spanId = randomHex(16);
    this.parentSpanId = opts?.parent?.spanId;
    this.startNs = nowNs();
    if (opts?.attributes) for (const [k, v] of Object.entries(opts.attributes)) this.attrs[k] = v;
  }

  setAttribute(key: string, value: unknown): this {
    if (!this.ended) this.attrs[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    if (!this.ended) this.events.push({ name, time_ns: nowNs(), attributes });
    return this;
  }

  recordException(err: unknown): this {
    if (this.ended) return this;
    const e = err instanceof Error ? err : new Error(String(err));
    this.events.push({
      name: 'exception',
      time_ns: nowNs(),
      attributes: {
        'exception.type': e.name,
        'exception.message': e.message,
        'exception.stacktrace': e.stack || '',
      },
    });
    this.status = { code: 'ERROR', message: e.message };
    return this;
  }

  setStatus(code: SpanStatusCode, message?: string): this {
    if (!this.ended) this.status = { code, message };
    return this;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.endNs = nowNs();
    try { this.tracer.emitSpan(this.toLine()); } catch { /* never throw */ }
  }

  private toLine(): TraceLine {
    return {
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_span_id: this.parentSpanId,
      name: this.name,
      tracer_name: this.tracerName,
      start_ns: this.startNs,
      end_ns: this.endNs,
      attributes: this.attrs,
      events: this.events,
      status: this.status,
    };
  }
}

export class Tracer {
  readonly name: string;
  private sampleRate = 1.0;
  private lastRotation = '';

  constructor(name: string) { this.name = name; }

  startSpan(name: string, opts?: SpanOptions): Span {
    return new Span(this, name, opts);
  }

  /** Auto begin/end around an async function. */
  async withSpan<T>(name: string, fn: (span: Span) => Promise<T> | T, opts?: SpanOptions): Promise<T> {
    const span = this.startSpan(name, opts);
    try {
      const result = await fn(span);
      if (span['status'].code === 'UNSET') span.setStatus('OK');
      return result;
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  /** Set sample rate 0-1. 1 = emit all spans, 0 = drop all. */
  sample(rate: number): void {
    if (!Number.isFinite(rate)) return;
    this.sampleRate = Math.max(0, Math.min(1, rate));
  }

  /** Internal: write a line. Sampling + rotation handled here. */
  emitSpan(line: TraceLine): void {
    if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) return;
    try {
      fs.mkdirSync(TRACE_DIR, { recursive: true });
      const today = todayStamp();
      if (today !== this.lastRotation) {
        this.cleanupOldFiles();
        this.lastRotation = today;
      }
      const file = path.join(TRACE_DIR, `${today}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(line) + '\n');
    } catch { /* never throw from tracing */ }
  }

  private cleanupOldFiles(): void {
    try {
      if (!fs.existsSync(TRACE_DIR)) return;
      const files = fs.readdirSync(TRACE_DIR).filter(f => f.endsWith('.jsonl'));
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
      for (const f of files) {
        const stamp = f.replace('.jsonl', '');
        const t = Date.parse(stamp + 'T00:00:00Z');
        if (Number.isFinite(t) && t < cutoff) {
          try { fs.unlinkSync(path.join(TRACE_DIR, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

const _tracers = new Map<string, Tracer>();

export function trace(name: string): Tracer {
  let t = _tracers.get(name);
  if (!t) { t = new Tracer(name); _tracers.set(name, t); }
  return t;
}

export const OtelLite = {
  trace,

  /** Read the tail of today's trace file. Returns parsed TraceLines, newest last. */
  async tail(lines = 100): Promise<TraceLine[]> {
    try {
      const file = path.join(TRACE_DIR, `${todayStamp()}.jsonl`);
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, 'utf-8');
      const split = raw.split('\n').filter(l => l.length > 0);
      const slice = split.slice(Math.max(0, split.length - lines));
      const out: TraceLine[] = [];
      for (const line of slice) {
        try { out.push(JSON.parse(line) as TraceLine); } catch { /* skip bad line */ }
      }
      return out;
    } catch {
      return [];
    }
  },

  /** Path of today's trace file (whether or not it exists yet). */
  todayFilePath(): string {
    return path.join(TRACE_DIR, `${todayStamp()}.jsonl`);
  },

  /** Manually trigger retention cleanup. */
  cleanup(): void {
    const t = trace('_internal_');
    // emitSpan triggers cleanup; do a noop pass with sampling 0 so no line is written
    const prev = t['sampleRate'];
    t.sample(0);
    t['cleanupOldFiles']();
    t.sample(prev);
  },
};

// ── helpers ──────────────────────────────────────────────────────────────

function nowNs(): number {
  // Node high-res; convert ms → ns. process.hrtime.bigint is exact ns but
  // not wall-clock. Use Date.now * 1e6 so timestamps align with logs.
  return Date.now() * 1_000_000;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function randomHex(chars: number): string {
  return crypto.randomBytes(Math.ceil(chars / 2)).toString('hex').slice(0, chars);
}
