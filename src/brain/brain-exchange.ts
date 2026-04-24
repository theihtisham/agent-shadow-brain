// src/brain/brain-exchange.ts — Curated shareable brain slices
// v6.0.0 — Hive Mind Edition
//
// Export a curated subset of your brain as a shareable JSON package. Import
// someone else's package to instantly get expert knowledge for a domain.
// Zero-server design: packages are plain JSON files on disk (or shared via
// gist/HTTP/IPFS — transport is up to the user).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BrainSlicePackage } from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const EXCHANGE_DIR = path.join(os.homedir(), '.shadow-brain', 'exchange');

export class BrainExchange {
  private brain: GlobalBrain;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async export(opts: {
    name: string;
    description: string;
    author: string;
    categories?: string[];
    tags?: string[];
    minImportance?: number;
    limit?: number;
    license?: string;
  }): Promise<{ filePath: string; package: BrainSlicePackage }> {
    await this.brain.init();
    fs.mkdirSync(EXCHANGE_DIR, { recursive: true });

    const categories = opts.categories ?? [];
    const keywords = opts.tags ?? [];
    const limit = opts.limit ?? 500;
    const minImportance = opts.minImportance ?? 0.5;

    let entries = this.brain.recall({ keywords: keywords.length ? keywords : undefined, minImportance, limit });
    if (categories.length) {
      const allowed = new Set(categories.map(c => c.toLowerCase()));
      entries = entries.filter(e => allowed.has(e.category.toLowerCase()));
    }

    const pkg: BrainSlicePackage = {
      id: `pkg-${crypto.randomBytes(6).toString('hex')}`,
      name: opts.name,
      description: opts.description,
      author: opts.author,
      version: '1.0.0',
      tags: opts.tags ?? [],
      categories: Array.from(new Set(entries.map(e => e.category))),
      memoryCount: entries.length,
      memories: entries.map(e => ({
        content: this.redact(e.content),
        category: e.category,
        importance: e.importance,
      })),
      createdAt: new Date(),
      license: opts.license ?? 'MIT',
    };

    const safeName = opts.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const filePath = path.join(EXCHANGE_DIR, `${safeName}-${pkg.id.slice(-6)}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2));
    return { filePath, package: pkg };
  }

  async import(filePath: string, opts: { projectDir: string; agentTool?: string } = { projectDir: process.cwd() }): Promise<{ imported: number; pkg: BrainSlicePackage }> {
    await this.brain.init();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const pkg = JSON.parse(raw) as BrainSlicePackage;
    const projectId = GlobalBrain.projectIdFor(opts.projectDir);
    const projectName = path.basename(opts.projectDir);
    let imported = 0;
    for (const m of pkg.memories) {
      this.brain.writeSync({
        projectId,
        projectName,
        agentTool: (opts.agentTool as any) ?? 'claude-code',
        category: m.category,
        content: m.content,
        importance: m.importance,
        metadata: { origin: 'brain-exchange', packageId: pkg.id, packageName: pkg.name, author: pkg.author },
      });
      imported++;
    }
    return { imported, pkg };
  }

  listLocal(): BrainSlicePackage[] {
    fs.mkdirSync(EXCHANGE_DIR, { recursive: true });
    const files = fs.readdirSync(EXCHANGE_DIR).filter(f => f.endsWith('.json'));
    const out: BrainSlicePackage[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(EXCHANGE_DIR, f), 'utf-8');
        const pkg = JSON.parse(raw) as BrainSlicePackage;
        out.push({ ...pkg, createdAt: new Date(pkg.createdAt) });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private redact(content: string): string {
    return content
      .replace(/(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi, '$1: [REDACTED]')
      .replace(/[A-Za-z0-9+/=]{40,}/g, '[REDACTED_BLOB]')
      .replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, '[REDACTED_EMAIL]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]');
  }
}

let _instance: BrainExchange | null = null;

export function getBrainExchange(): BrainExchange {
  if (!_instance) _instance = new BrainExchange();
  return _instance;
}

export function resetBrainExchangeForTests(): void {
  _instance = null;
}
