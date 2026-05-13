// src/brain/multimodal-vision.ts — Image ingestion via Ollama llava
// v6.0.2 — Multimodal Edition
//
// Adds image understanding to the brain. Uses Ollama llava (or llava-llama3 /
// bakllava — probed in priority order). Falls through gracefully if no
// vision model is available: the image is registered but undescribed.
//
// Storage layout:
//   ~/.shadow-brain/vision/<project>/<hash>.json   — metadata (path + desc)
//   ~/.shadow-brain/vision/<project>/index.json    — flat index for search
//
// The actual image is NOT copied — it stays at sourcePath. The brain holds
// only the path, hash, description, and (optional) embedding.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getEmbeddings } from './embeddings.js';
import { getModelRegistry } from './model-registry.js';

const VISION_DIR = path.join(os.homedir(), '.shadow-brain', 'vision');

const PREFERRED_MODELS = ['llava', 'llava-llama3', 'bakllava'];
const DEFAULT_PROMPT =
  'Describe this image in detail. Focus on UI elements, text, code, ' +
  'diagrams. Use plain factual language.';

export interface VisionEntity {
  id: string;
  sourcePath: string;
  hash: string;
  capturedAt: string; // ISO timestamp
  description: string;
  ocr?: string;
  tags: string[];
  project: string;
  embedding?: number[];
}

interface IndexShape {
  schemaVersion: 1;
  entries: Array<{ id: string; hash: string; capturedAt: string; tags: string[] }>;
}

export class MultimodalVision {
  private ollamaModel: string | null = null;
  private ollamaBaseUrl = 'http://127.0.0.1:11434';
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(VISION_DIR, { recursive: true });

    try {
      const reg = getModelRegistry();
      await reg.init();
      const ollama = reg.getProvider('ollama');
      if (ollama?.enabled) {
        this.ollamaBaseUrl = ollama.baseUrl;
        const res = await fetch(this.ollamaBaseUrl + '/api/tags', {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const json = (await res.json()) as { models?: Array<{ name: string }> };
          for (const pref of PREFERRED_MODELS) {
            const match = json.models?.find(m => m.name.startsWith(pref));
            if (match) { this.ollamaModel = match.name; break; }
          }
        }
      }
    } catch { /* no ollama — graceful */ }

    this.initialized = true;
  }

  /** Ingest an image file. Returns the persisted VisionEntity. */
  async ingestImage(
    filePath: string,
    opts?: { project?: string; tags?: string[]; prompt?: string }
  ): Promise<VisionEntity> {
    await this.init();

    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Image file not found: ${absPath}`);
    }
    const buf = fs.readFileSync(absPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const project = (opts?.project || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
    const projectDir = path.join(VISION_DIR, project);
    fs.mkdirSync(projectDir, { recursive: true });

    // De-dupe by hash within project
    const metaPath = path.join(projectDir, `${hash}.json`);
    if (fs.existsSync(metaPath)) {
      try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as VisionEntity;
      } catch { /* re-ingest */ }
    }

    const prompt = opts?.prompt || DEFAULT_PROMPT;
    const description = await this.describe(buf, prompt);
    const ocr = await ocrExtract(absPath);
    const tags = (opts?.tags || []).slice(0, 32);

    let embedding: number[] | undefined;
    try {
      const e = getEmbeddings();
      embedding = await e.embed(description + ' ' + (ocr || '') + ' ' + tags.join(' '));
    } catch { /* embedding optional */ }

    const entity: VisionEntity = {
      id: `vision_${hash}`,
      sourcePath: absPath,
      hash,
      capturedAt: new Date().toISOString(),
      description,
      ocr: ocr || undefined,
      tags,
      project,
      embedding,
    };

    try {
      fs.writeFileSync(metaPath, JSON.stringify(entity, null, 2));
      this.appendIndex(projectDir, entity);
    } catch { /* non-fatal */ }

    return entity;
  }

  /** Semantic search across stored image descriptions. */
  async search(query: string, topK = 10, project?: string): Promise<VisionEntity[]> {
    await this.init();
    const all = this.loadAll(project);
    if (all.length === 0) return [];

    try {
      const e = getEmbeddings();
      const qVec = await e.embed(query);
      const scored = all.map(ent => {
        const v = ent.embedding;
        const score = v ? cosine(qVec, v) : keywordScore(ent, query);
        return { ent, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(s => s.ent);
    } catch {
      // Fallback to keyword scoring on description + tags + ocr
      const scored = all.map(ent => ({ ent, score: keywordScore(ent, query) }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(s => s.ent);
    }
  }

  /** Recent ingests, newest first. */
  async recent(limit = 20, project?: string): Promise<VisionEntity[]> {
    await this.init();
    const all = this.loadAll(project);
    all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return all.slice(0, limit);
  }

  /** True if a vision model was detected. */
  hasVisionModel(): boolean { return this.ollamaModel !== null; }

  // ── Internals ────────────────────────────────────────────────────────

  private async describe(imageBuf: Buffer, prompt: string): Promise<string> {
    if (!this.ollamaModel) {
      return '[vision model not available — image registered but undescribed]';
    }
    try {
      const b64 = imageBuf.toString('base64');
      const res = await fetch(this.ollamaBaseUrl + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          images: [b64],
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        return '[vision model error — image registered but undescribed]';
      }
      const json = (await res.json()) as { response?: string };
      const text = (json.response || '').trim();
      return text || '[vision model returned empty description]';
    } catch {
      return '[vision model unreachable — image registered but undescribed]';
    }
  }

  private appendIndex(projectDir: string, entity: VisionEntity): void {
    const indexPath = path.join(projectDir, 'index.json');
    let idx: IndexShape = { schemaVersion: 1, entries: [] };
    if (fs.existsSync(indexPath)) {
      try {
        idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as IndexShape;
      } catch { /* reset */ }
    }
    if (!idx.entries.some(e => e.hash === entity.hash)) {
      idx.entries.push({
        id: entity.id,
        hash: entity.hash,
        capturedAt: entity.capturedAt,
        tags: entity.tags,
      });
    }
    const tmp = indexPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
    fs.renameSync(tmp, indexPath);
  }

  private loadAll(project?: string): VisionEntity[] {
    if (!fs.existsSync(VISION_DIR)) return [];
    const projects = project
      ? [project.replace(/[^a-zA-Z0-9._-]/g, '_')]
      : fs.readdirSync(VISION_DIR).filter(d => {
          try { return fs.statSync(path.join(VISION_DIR, d)).isDirectory(); }
          catch { return false; }
        });

    const out: VisionEntity[] = [];
    for (const p of projects) {
      const dir = path.join(VISION_DIR, p);
      if (!fs.existsSync(dir)) continue;
      let files: string[] = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.json') || f === 'index.json') continue;
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
          out.push(JSON.parse(raw) as VisionEntity);
        } catch { /* skip */ }
      }
    }
    return out;
  }
}

/** OCR stub. TODO: wire up tesseract.js or system tesseract for real OCR.
 *  Returns null today; vision model + description handles text most of the time. */
export async function ocrExtract(_filePath: string): Promise<string | null> {
  // TODO: integrate tesseract.js (pure JS) or shell out to `tesseract` CLI
  // when available. Kept as a stub to avoid pulling a heavy dependency.
  return null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

function keywordScore(ent: VisionEntity, query: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const hay = (ent.description + ' ' + (ent.ocr || '') + ' ' + ent.tags.join(' ')).toLowerCase();
  let score = 0;
  for (const t of q) if (hay.includes(t)) score += 1;
  return score / Math.max(q.length, 1);
}

let _instance: MultimodalVision | null = null;
export function getMultimodalVision(): MultimodalVision {
  if (!_instance) _instance = new MultimodalVision();
  return _instance;
}
export function resetMultimodalVisionForTests(): void { _instance = null; }
