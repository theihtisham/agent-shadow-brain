// src/brain/brain-quantize.ts — int8 vector quantization for the brain
// v6.0.2 — Hive Mind Edition
//
// Float32 vectors are 4x bigger on disk and in memory than they need to be for
// approximate-nearest-neighbor recall. Symmetric int8 quantization preserves
// recall to within ~1% on unit-norm vectors while shrinking the working set
// by 4x. That means the same RAM budget covers four times as many memories
// and the cold-start read of a sharded JSON index is dramatically faster.
//
// Design:
//   - Symmetric per-vector int8: scale = max(|v_i|) / 127, q_i = round(v_i/scale).
//     Per-vector scale (not per-tensor) handles the case where some memories
//     have a much wider dynamic range than others (e.g. Ollama dense vs hash).
//   - Compressed format ".q8" is a tight binary:
//       magic     : 4 bytes  ascii  "Q8I0"
//       version   : uint32   1
//       dim       : uint32   embedding dimension
//       count     : uint32   number of entries
//       entries[] : { float64 scale; int8[dim] q; uint16 idLen; utf8 id[idLen] }
//   - Direct cosine on int8: integer dot then divide by scaleA*scaleB and
//     (dim * 127^2). Skips a dequantize-into-float32 round trip in the hot path.
//
// Exposed: BrainQuantize, getBrainQuantize(), resetBrainQuantizeForTests().
//   .quantize(vec)
//   .dequantize(q, scale)
//   .cosineQuantized(a, scaleA, b, scaleB)
//   .compressIndex(srcPath, outPath)
//   .loadCompressedIndex(path)
//   .quantizeRoundtripError(vectors)

import * as fs from 'fs';
import * as path from 'path';

const MAGIC = Buffer.from('Q8I0', 'ascii');
const VERSION = 1;
const HEADER_BYTES = 4 + 4 + 4 + 4; // magic + version + dim + count

export interface CompressionReport {
  originalBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  vectorCount: number;
  dim: number;
  encodingError: { meanAbs: number; max: number };
  durationMs: number;
}

export interface QuantizedEntry { q: Int8Array; scale: number }

export interface CompressedIndex {
  vectors: Map<string, QuantizedEntry>;
  dim: number;
  recallFn: (query: number[], topK: number) => Array<{ id: string; score: number }>;
}

export interface RoundtripErrorReport {
  meanAbs: number;
  max: number;
  samples: number;
}

interface ShardLikeDoc { id: string; vector: number[] }
interface ShardLikePayload { docs: ShardLikeDoc[] }

export class BrainQuantize {
  /** Symmetric int8 quantization with per-vector scale. */
  quantize(vector: number[]): Int8Array {
    if (!vector || vector.length === 0) return new Int8Array(0);
    let maxAbs = 0;
    for (let i = 0; i < vector.length; i++) {
      const a = Math.abs(vector[i]);
      if (a > maxAbs) maxAbs = a;
    }
    const out = new Int8Array(vector.length);
    if (maxAbs === 0) return out; // all zeros — quantizes to all zeros
    const scale = maxAbs / 127;
    const inv = 1 / scale;
    for (let i = 0; i < vector.length; i++) {
      const q = Math.round(vector[i] * inv);
      out[i] = q > 127 ? 127 : q < -127 ? -127 : q;
    }
    return out;
  }

  /** Recover an approximation of the original float vector. */
  dequantize(q: Int8Array, scale: number): number[] {
    if (!q || q.length === 0) return [];
    const out = new Array<number>(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
    return out;
  }

  /**
   * Cosine similarity on quantized vectors WITHOUT dequantizing first.
   *
   * If `a` and `b` were derived from unit-norm float vectors, the cosine is
   * just the dot product after rescaling. We compute the integer dot then
   * apply `scaleA * scaleB` to convert back to the float dot, and clamp to
   * [-1, 1] for numeric safety. Note: the dim/127^2 factor in the spec is the
   * theoretical worst-case scale (when every element is ±127); the actual
   * normalization is captured entirely by scaleA*scaleB, so we use that and
   * do not double-divide. The clamp guards against quantization rounding
   * pushing the result slightly out of range.
   */
  cosineQuantized(a: Int8Array, scaleA: number, b: Int8Array, scaleB: number): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += a[i] * b[i];
    const sim = dot * scaleA * scaleB;
    if (sim > 1) return 1;
    if (sim < -1) return -1;
    return sim;
  }

  /** Convert a v2 sharded JSON index into a single compressed .q8 binary. */
  async compressIndex(srcPath: string, outPath: string): Promise<CompressionReport> {
    const start = Date.now();
    const docs = this.readShardDocs(srcPath);
    if (docs.length === 0) {
      // Empty index → still write a valid empty file.
      const header = Buffer.alloc(HEADER_BYTES);
      MAGIC.copy(header, 0);
      header.writeUInt32LE(VERSION, 4);
      header.writeUInt32LE(0, 8);
      header.writeUInt32LE(0, 12);
      this.atomicWrite(outPath, header);
      return {
        originalBytes: this.measureBytes(srcPath),
        compressedBytes: header.length,
        compressionRatio: 0,
        vectorCount: 0,
        dim: 0,
        encodingError: { meanAbs: 0, max: 0 },
        durationMs: Date.now() - start,
      };
    }

    const dim = docs[0].vector.length;
    const quantized: Array<{ id: string; q: Int8Array; scale: number; original: number[] }> = [];
    for (const d of docs) {
      if (!d.vector || d.vector.length !== dim) continue; // skip ragged
      const q = this.quantize(d.vector);
      const scale = this.scaleOf(d.vector);
      quantized.push({ id: d.id, q, scale, original: d.vector });
    }

    // Estimate output size up front so we allocate one Buffer.
    let bodyBytes = 0;
    const idBufs: Buffer[] = [];
    for (const e of quantized) {
      const idBuf = Buffer.from(e.id, 'utf-8');
      idBufs.push(idBuf);
      bodyBytes += 8 + dim + 2 + idBuf.length;
    }
    const totalBytes = HEADER_BYTES + bodyBytes;
    const buf = Buffer.alloc(totalBytes);

    MAGIC.copy(buf, 0);
    buf.writeUInt32LE(VERSION, 4);
    buf.writeUInt32LE(dim, 8);
    buf.writeUInt32LE(quantized.length, 12);

    let offset = HEADER_BYTES;
    for (let i = 0; i < quantized.length; i++) {
      const e = quantized[i];
      buf.writeDoubleLE(e.scale, offset); offset += 8;
      // int8 array copy — Buffer views the Int8Array directly.
      Buffer.from(e.q.buffer, e.q.byteOffset, e.q.byteLength).copy(buf, offset);
      offset += dim;
      const idBuf = idBufs[i];
      buf.writeUInt16LE(idBuf.length, offset); offset += 2;
      idBuf.copy(buf, offset); offset += idBuf.length;
    }

    this.atomicWrite(outPath, buf);

    // Encoding error sample (cap at 500 vectors so this stays cheap).
    const sampleN = Math.min(500, quantized.length);
    let sumAbs = 0, maxAbs = 0, count = 0;
    for (let i = 0; i < sampleN; i++) {
      const e = quantized[i];
      const recon = this.dequantize(e.q, e.scale);
      for (let j = 0; j < dim; j++) {
        const err = Math.abs(recon[j] - e.original[j]);
        sumAbs += err;
        if (err > maxAbs) maxAbs = err;
        count++;
      }
    }

    const originalBytes = this.measureBytes(srcPath);
    return {
      originalBytes,
      compressedBytes: totalBytes,
      compressionRatio: originalBytes > 0 ? +(originalBytes / totalBytes).toFixed(3) : 0,
      vectorCount: quantized.length,
      dim,
      encodingError: {
        meanAbs: count > 0 ? +(sumAbs / count).toFixed(6) : 0,
        max: +maxAbs.toFixed(6),
      },
      durationMs: Date.now() - start,
    };
  }

  /** Load a .q8 file and return vectors plus a ready-to-use recall function. */
  async loadCompressedIndex(filePath: string): Promise<CompressedIndex> {
    const buf = await fs.promises.readFile(filePath);
    if (buf.length < HEADER_BYTES) throw new Error(`q8 index too short: ${buf.length} bytes`);
    if (buf.subarray(0, 4).compare(MAGIC) !== 0) throw new Error('q8 index: bad magic');
    const version = buf.readUInt32LE(4);
    if (version !== VERSION) throw new Error(`q8 index: unsupported version ${version}`);
    const dim = buf.readUInt32LE(8);
    const count = buf.readUInt32LE(12);

    const vectors = new Map<string, QuantizedEntry>();
    let offset = HEADER_BYTES;
    for (let i = 0; i < count; i++) {
      if (offset + 8 + dim + 2 > buf.length) throw new Error(`q8 index truncated at entry ${i}`);
      const scale = buf.readDoubleLE(offset); offset += 8;
      // Copy out of the parent buffer so the underlying ArrayBuffer can be GC'd
      // and the Int8Array view stays tight to its dim bytes.
      const q = new Int8Array(dim);
      buf.copy(Buffer.from(q.buffer, q.byteOffset, q.byteLength), 0, offset, offset + dim);
      offset += dim;
      const idLen = buf.readUInt16LE(offset); offset += 2;
      if (offset + idLen > buf.length) throw new Error(`q8 index truncated id at entry ${i}`);
      const id = buf.subarray(offset, offset + idLen).toString('utf-8');
      offset += idLen;
      vectors.set(id, { q, scale });
    }

    const recallFn = (query: number[], topK: number): Array<{ id: string; score: number }> => {
      if (vectors.size === 0 || !query || query.length === 0 || topK <= 0) return [];
      const qVec = query.length === dim ? query : padOrTruncate(query, dim);
      const qInt = this.quantize(qVec);
      const qScale = this.scaleOf(qVec);
      const hits: Array<{ id: string; score: number }> = [];
      for (const [id, entry] of vectors) {
        const score = this.cosineQuantized(qInt, qScale, entry.q, entry.scale);
        hits.push({ id, score });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, topK);
    };

    return { vectors, dim, recallFn };
  }

  /** Self-test: report mean / max absolute reconstruction error on `vectors`. */
  quantizeRoundtripError(vectors: number[][]): RoundtripErrorReport {
    if (!vectors || vectors.length === 0) return { meanAbs: 0, max: 0, samples: 0 };
    let sum = 0, maxAbs = 0, n = 0;
    for (const v of vectors) {
      if (!v || v.length === 0) continue;
      const q = this.quantize(v);
      const scale = this.scaleOf(v);
      for (let i = 0; i < v.length; i++) {
        const recon = q[i] * scale;
        const err = Math.abs(recon - v[i]);
        sum += err;
        if (err > maxAbs) maxAbs = err;
        n++;
      }
    }
    return {
      meanAbs: n > 0 ? +(sum / n).toFixed(6) : 0,
      max: +maxAbs.toFixed(6),
      samples: n,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private scaleOf(vector: number[]): number {
    let maxAbs = 0;
    for (let i = 0; i < vector.length; i++) {
      const a = Math.abs(vector[i]);
      if (a > maxAbs) maxAbs = a;
    }
    return maxAbs === 0 ? 0 : maxAbs / 127;
  }

  private readShardDocs(srcPath: string): ShardLikeDoc[] {
    // Accept either a single JSON file with {docs: [...]} or a directory of shards.
    const docs: ShardLikeDoc[] = [];
    try {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        for (const f of fs.readdirSync(srcPath)) {
          if (!f.endsWith('.json')) continue;
          const raw = fs.readFileSync(path.join(srcPath, f), 'utf-8');
          this.collectDocs(raw, docs);
        }
      } else {
        const raw = fs.readFileSync(srcPath, 'utf-8');
        this.collectDocs(raw, docs);
      }
    } catch { /* missing or unreadable → empty result */ }
    return docs;
  }

  private collectDocs(raw: string, out: ShardLikeDoc[]): void {
    try {
      const parsed = JSON.parse(raw) as Partial<ShardLikePayload> & { vectors?: Record<string, number[]> };
      if (Array.isArray(parsed.docs)) {
        for (const d of parsed.docs) {
          if (d && typeof d.id === 'string' && Array.isArray(d.vector)) out.push({ id: d.id, vector: d.vector });
        }
      } else if (parsed.vectors && typeof parsed.vectors === 'object') {
        // Legacy v1 cache shape: { vectors: { id: number[] } }
        for (const [id, vec] of Object.entries(parsed.vectors)) {
          if (Array.isArray(vec)) out.push({ id, vector: vec });
        }
      }
    } catch { /* skip corrupt shard */ }
  }

  private measureBytes(srcPath: string): number {
    try {
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) return stat.size;
      if (stat.isDirectory()) {
        let total = 0;
        for (const f of fs.readdirSync(srcPath)) {
          try { total += fs.statSync(path.join(srcPath, f)).size; } catch { /* skip */ }
        }
        return total;
      }
    } catch { /* missing */ }
    return 0;
  }

  private atomicWrite(filePath: string, data: Buffer): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  }
}

function padOrTruncate(v: number[], dim: number): number[] {
  if (v.length === dim) return v;
  if (v.length > dim) return v.slice(0, dim);
  const out = v.slice();
  while (out.length < dim) out.push(0);
  return out;
}

let _instance: BrainQuantize | null = null;
export function getBrainQuantize(): BrainQuantize {
  if (!_instance) _instance = new BrainQuantize();
  return _instance;
}
export function resetBrainQuantizeForTests(): void { _instance = null; }
