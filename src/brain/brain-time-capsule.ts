// src/brain/brain-time-capsule.ts — Brain Time Capsule (viral feature)
// v6.0.2 — freeze, label, and resurrect brain snapshots
//
// "Here's what we knew in January 2026" — gather all brain state into a
// per-file gzipped bundle on disk. Pure Node stdlib (fs + zlib + crypto).
// No native tar; the capsule is a directory `<id>.tcz/` containing a
// manifest.json plus one `.gz` per state file.
//
// Capsules live at: ~/.shadow-brain/time-capsules/<project>/<capsuleId>.tcz
// Each capsule includes: manifest.json (metadata) + content/*.gz (state files).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

export const CAPSULE_ROOT = path.join(os.homedir(), '.shadow-brain', 'time-capsules');
const BRAIN_ROOT = path.join(os.homedir(), '.shadow-brain');

/** Files / directories under ~/.shadow-brain that count as "brain state". */
const STATE_TARGETS = [
  'global.json',
  'debates.json',
  'embeddings',
  'consensus',
  'patterns',
  'learning',
  'neural-mesh',
  'context-recall',
  'collective',
  'turbo-memory',
  'knowledge-graph',
  'swarm',
  'evolution',
  'custom-rules',
  'hierarchical-memory',
  'replay-log',
  'constitution',
  'hive-voice',
];

export interface CapsuleManifest {
  schemaVersion: 1;
  capsuleId: string;
  project: string;
  label: string;
  description?: string;
  createdAt: string;
  signedBy?: string;
  signature?: string;
  files: Array<{ rel: string; sizeBytes: number; gzBytes: number; sha256: string }>;
  totalSizeBytes: number;
  totalGzBytes: number;
}

export interface CapsuleMeta {
  capsuleId: string;
  path: string;
  label: string;
  description?: string;
  createdAt: string;
  sizeBytes: number;
  signedBy?: string;
  signature?: string;
  fileCount: number;
}

export interface CapsuleDiffMinimal {
  onlyInA: string[];
  onlyInB: string[];
  changed: string[];
  unchanged: string[];
  stats: { addedCount: number; removedCount: number; changedCount: number };
}

export class BrainTimeCapsule {
  /** Freeze the current brain state into a labeled capsule. */
  async freeze(
    project: string,
    label: string,
    opts: { description?: string; signedBy?: string } = {},
  ): Promise<{ capsuleId: string; path: string; sizeBytes: number }> {
    if (!project) throw new Error('freeze: project is required');
    if (!label) throw new Error('freeze: label is required');

    const projectSlug = slugify(project);
    const capsuleId = makeCapsuleId();
    const capsuleDir = path.join(CAPSULE_ROOT, projectSlug, `${capsuleId}.tcz`);
    const contentDir = path.join(capsuleDir, 'content');
    fs.mkdirSync(contentDir, { recursive: true });

    const collected = collectStateFiles();
    const fileRecords: CapsuleManifest['files'] = [];
    let totalRaw = 0;
    let totalGz = 0;

    for (const rel of collected) {
      const abs = path.join(BRAIN_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      try {
        const raw = fs.readFileSync(abs);
        const gz = zlib.gzipSync(raw, { level: 9 });
        const target = path.join(contentDir, rel + '.gz');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, gz);
        const sha = crypto.createHash('sha256').update(raw).digest('hex');
        fileRecords.push({ rel, sizeBytes: raw.byteLength, gzBytes: gz.byteLength, sha256: sha });
        totalRaw += raw.byteLength;
        totalGz += gz.byteLength;
      } catch { /* skip unreadable file */ }
    }

    const manifest: CapsuleManifest = {
      schemaVersion: 1,
      capsuleId,
      project: projectSlug,
      label,
      description: opts.description,
      createdAt: new Date().toISOString(),
      signedBy: opts.signedBy,
      files: fileRecords,
      totalSizeBytes: totalRaw,
      totalGzBytes: totalGz,
    };
    fs.writeFileSync(path.join(capsuleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { capsuleId, path: capsuleDir, sizeBytes: totalGz };
  }

  /** List all capsules for a project, newest first. */
  async list(project: string): Promise<CapsuleMeta[]> {
    const projectDir = path.join(CAPSULE_ROOT, slugify(project));
    if (!fs.existsSync(projectDir)) return [];
    const dirs = fs.readdirSync(projectDir).filter(d => d.endsWith('.tcz'));
    const out: CapsuleMeta[] = [];
    for (const d of dirs) {
      const manifestPath = path.join(projectDir, d, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CapsuleManifest;
        out.push({
          capsuleId: m.capsuleId,
          path: path.join(projectDir, d),
          label: m.label,
          description: m.description,
          createdAt: m.createdAt,
          sizeBytes: m.totalGzBytes,
          signedBy: m.signedBy,
          signature: m.signature,
          fileCount: m.files.length,
        });
      } catch { /* skip corrupted */ }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  /** Inspect a capsule without restoring. Returns manifest + a small sample. */
  async inspect(capsuleId: string): Promise<{ manifest: CapsuleManifest; sample: Record<string, string> }> {
    const capsuleDir = await this.resolveCapsule(capsuleId);
    const manifest = JSON.parse(fs.readFileSync(path.join(capsuleDir, 'manifest.json'), 'utf-8')) as CapsuleManifest;
    const sample: Record<string, string> = {};
    // Sample first 3 small text files for a peek.
    const samples = manifest.files
      .filter(f => f.sizeBytes < 64 * 1024)
      .slice(0, 3);
    for (const f of samples) {
      try {
        const gz = fs.readFileSync(path.join(capsuleDir, 'content', f.rel + '.gz'));
        const raw = zlib.gunzipSync(gz).toString('utf-8');
        sample[f.rel] = raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
      } catch { /* skip */ }
    }
    return { manifest, sample };
  }

  /**
   * Restore a capsule into the active brain. Backs up current state first into
   * an auto-named pre-restore capsule (so the operation is reversible).
   */
  async restore(capsuleId: string, opts: { into?: string } = {}): Promise<{ restoredAt: string; replacedFiles: string[] }> {
    const capsuleDir = await this.resolveCapsule(capsuleId);
    const manifest = JSON.parse(fs.readFileSync(path.join(capsuleDir, 'manifest.json'), 'utf-8')) as CapsuleManifest;
    const targetRoot = opts.into ?? BRAIN_ROOT;

    // Safety: snapshot the current brain before overwriting.
    try {
      await this.freeze(manifest.project, `pre-restore-${manifest.capsuleId}`, {
        description: `Auto-backup taken before restoring ${manifest.capsuleId}`,
      });
    } catch { /* non-fatal — still proceed */ }

    const replaced: string[] = [];
    for (const f of manifest.files) {
      try {
        const gz = fs.readFileSync(path.join(capsuleDir, 'content', f.rel + '.gz'));
        const raw = zlib.gunzipSync(gz);
        const target = path.join(targetRoot, f.rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const tmp = target + '.restoring';
        fs.writeFileSync(tmp, raw);
        try { fs.renameSync(tmp, target); }
        catch {
          // On Windows, rename can fail if target exists — fallback.
          try { fs.unlinkSync(target); } catch { /* ignore */ }
          fs.renameSync(tmp, target);
        }
        replaced.push(f.rel);
      } catch { /* skip failing file */ }
    }

    return { restoredAt: new Date().toISOString(), replacedFiles: replaced };
  }

  /**
   * High-level diff between two capsules. For semantic / entity-level diffing,
   * call BrainDiff.diff() directly — this is a fast file-level summary.
   */
  async diff(capsuleA: string, capsuleB: string): Promise<CapsuleDiffMinimal> {
    const a = await this.inspect(capsuleA);
    const b = await this.inspect(capsuleB);
    const fileMapA = new Map(a.manifest.files.map(f => [f.rel, f.sha256] as const));
    const fileMapB = new Map(b.manifest.files.map(f => [f.rel, f.sha256] as const));

    const onlyInA: string[] = [];
    const onlyInB: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const [rel, sha] of fileMapA) {
      const other = fileMapB.get(rel);
      if (other === undefined) onlyInA.push(rel);
      else if (other === sha) unchanged.push(rel);
      else changed.push(rel);
    }
    for (const [rel] of fileMapB) {
      if (!fileMapA.has(rel)) onlyInB.push(rel);
    }

    return {
      onlyInA, onlyInB, changed, unchanged,
      stats: { addedCount: onlyInB.length, removedCount: onlyInA.length, changedCount: changed.length },
    };
  }

  /** Append a signature line to the manifest. No crypto verification — stub. */
  async seal(capsuleId: string, signature: string): Promise<void> {
    const capsuleDir = await this.resolveCapsule(capsuleId);
    const manifestPath = path.join(capsuleDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CapsuleManifest;
    manifest.signature = signature;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async resolveCapsule(capsuleId: string): Promise<string> {
    // Allow either a bare ID (search across projects) or a full path.
    if (path.isAbsolute(capsuleId) && fs.existsSync(capsuleId)) return capsuleId;
    if (!fs.existsSync(CAPSULE_ROOT)) throw new Error(`Capsule not found: ${capsuleId}`);
    const projects = fs.readdirSync(CAPSULE_ROOT).filter(p => fs.statSync(path.join(CAPSULE_ROOT, p)).isDirectory());
    for (const p of projects) {
      const candidate = path.join(CAPSULE_ROOT, p, capsuleId.endsWith('.tcz') ? capsuleId : `${capsuleId}.tcz`);
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Capsule not found: ${capsuleId}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectStateFiles(): string[] {
  const out: string[] = [];
  for (const target of STATE_TARGETS) {
    const abs = path.join(BRAIN_ROOT, target);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      out.push(target);
    } else if (stat.isDirectory()) {
      walk(abs, target, out);
    }
  }
  return out;
}

function walk(dirAbs: string, dirRel: string, out: string[], depth = 0): void {
  if (depth > 6) return; // safety
  for (const entry of fs.readdirSync(dirAbs)) {
    if (entry.startsWith('.')) continue;
    const abs = path.join(dirAbs, entry);
    const rel = path.posix.join(dirRel.replace(/\\/g, '/'), entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isFile()) {
      // Skip very large files (>20MB) — capsules should stay portable.
      if (stat.size > 20 * 1024 * 1024) continue;
      out.push(rel);
    } else if (stat.isDirectory()) {
      walk(abs, rel, out, depth + 1);
    }
  }
}

function makeCapsuleId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `cap-${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

let _instance: BrainTimeCapsule | null = null;
export function getBrainTimeCapsule(): BrainTimeCapsule {
  if (!_instance) _instance = new BrainTimeCapsule();
  return _instance;
}
export function resetBrainTimeCapsuleForTests(): void { _instance = null; }
