// src/brain/branch-brain.ts — Branch Brains (git-aware memory context)
// v6.0.0 — Hive Mind Edition
//
// When you switch git branches, the brain's active memory set switches too.
// Memories are tagged `branch:<name>` or `global` when created. Git-aware
// filtering keeps the mental model aligned with the branch you're on.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  BranchBrainState,
  BranchMemoryTag,
} from '../types.js';
import { getGlobalBrain, GlobalBrain } from './global-brain.js';

const TAGS_PATH = path.join(os.homedir(), '.shadow-brain', 'branch-tags.json');

interface PersistShape {
  schemaVersion: 1;
  tags: BranchMemoryTag[];
  lastBranchByProject: Record<string, string>;
}

export class BranchBrain {
  private brain: GlobalBrain;
  private tags: Map<string, BranchMemoryTag[]> = new Map(); // memoryId → tags
  private lastBranchByProject: Map<string, string> = new Map();
  private initialized = false;

  constructor() {
    this.brain = getGlobalBrain();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(TAGS_PATH), { recursive: true });
    await this.brain.init();

    if (fs.existsSync(TAGS_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf-8')) as PersistShape;
        for (const t of parsed.tags ?? []) {
          const rehy: BranchMemoryTag = { ...t, taggedAt: new Date(t.taggedAt) };
          const existing = this.tags.get(rehy.memoryId) ?? [];
          existing.push(rehy);
          this.tags.set(rehy.memoryId, existing);
        }
        for (const [proj, br] of Object.entries(parsed.lastBranchByProject ?? {})) {
          this.lastBranchByProject.set(proj, br);
        }
      } catch {
        /* skip */
      }
    }
    this.initialized = true;
  }

  /** Current branch from git for the given project dir. */
  async currentBranch(projectDir: string): Promise<string> {
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: projectDir, reject: false });
      return stdout.trim() || 'HEAD';
    } catch {
      return 'HEAD';
    }
  }

  /** Tag a memory as either global or branch-scoped. */
  async tag(memoryId: string, branch: string, scope: 'branch' | 'global' = 'branch'): Promise<BranchMemoryTag> {
    await this.init();
    const tag: BranchMemoryTag = {
      memoryId,
      branch,
      scope,
      taggedAt: new Date(),
    };
    const existing = this.tags.get(memoryId) ?? [];
    existing.push(tag);
    this.tags.set(memoryId, existing);
    await this.persist();
    return tag;
  }

  /** Return the set of memory IDs active for a branch (branch-scoped + global). */
  activeMemoryIds(branch: string): string[] {
    const ids = new Set<string>();
    for (const [memoryId, tagList] of this.tags) {
      for (const t of tagList) {
        if (t.scope === 'global' || t.branch === branch) {
          ids.add(memoryId);
          break;
        }
      }
    }
    return Array.from(ids);
  }

  /** Compute + return the current branch brain state. */
  async getState(projectDir: string): Promise<BranchBrainState> {
    await this.init();
    const branch = await this.currentBranch(projectDir);
    const projectId = GlobalBrain.projectIdFor(projectDir);
    const last = this.lastBranchByProject.get(projectId);

    let branchCount = 0;
    let globalCount = 0;
    const branchCategories = new Set<string>();
    const activeIds = this.activeMemoryIds(branch);
    const branchActiveOnly = new Set<string>();

    for (const [memoryId, tagList] of this.tags) {
      const hasGlobal = tagList.some(t => t.scope === 'global');
      const hasThisBranch = tagList.some(t => t.scope === 'branch' && t.branch === branch);
      if (hasGlobal) globalCount++;
      if (hasThisBranch) {
        branchCount++;
        branchActiveOnly.add(memoryId);
      }
    }

    // Enrich branch categories from the brain
    const branchEntries = this.brain.recallByIds(Array.from(branchActiveOnly));
    for (const e of branchEntries) branchCategories.add(e.category);

    if (last !== branch) {
      this.lastBranchByProject.set(projectId, branch);
      await this.persist();
    }

    return {
      currentBranch: branch,
      activeMemoryIds: activeIds,
      branchMemoryCount: branchCount,
      globalMemoryCount: globalCount,
      lastSwitchAt: new Date(),
      branchSpecificCategories: Array.from(branchCategories),
    };
  }

  /** Promote a branch-scoped memory to global (e.g., after merging). */
  async promoteToGlobal(memoryId: string): Promise<boolean> {
    await this.init();
    const list = this.tags.get(memoryId);
    if (!list) return false;
    list.push({ memoryId, branch: '*', scope: 'global', taggedAt: new Date() });
    await this.persist();
    return true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    try {
      const flat: BranchMemoryTag[] = [];
      for (const list of this.tags.values()) flat.push(...list);
      const payload: PersistShape = {
        schemaVersion: 1,
        tags: flat,
        lastBranchByProject: Object.fromEntries(this.lastBranchByProject.entries()),
      };
      const tmp = TAGS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, TAGS_PATH);
    } catch {
      /* non-fatal */
    }
  }
}

let _instance: BranchBrain | null = null;

export function getBranchBrain(): BranchBrain {
  if (!_instance) _instance = new BranchBrain();
  return _instance;
}

export function resetBranchBrainForTests(): void {
  _instance = null;
}
