// src/watchers/git-watcher.ts — Watches git activity (commits, branches, diffs)

import simpleGit, { SimpleGit, StatusResult, DiffResult } from 'simple-git';
import { EventEmitter } from 'events';

export interface GitState {
  branch: string;
  status: StatusResult;
  recentCommits: GitCommit[];
  stagedDiff: string;
  unstagedDiff: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export class GitWatcher extends EventEmitter {
  private git: SimpleGit;
  private projectDir: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCommitHash: string = '';
  private lastBranch: string = '';

  constructor(projectDir: string) {
    super();
    this.projectDir = projectDir;
    this.git = simpleGit(projectDir);
  }

  async start(intervalMs: number = 3000): Promise<void> {
    // Get initial state
    try {
      const log = await this.git.log({ maxCount: 1 });
      this.lastCommitHash = log.latest?.hash || '';
      const branch = await this.git.branch();
      this.lastBranch = branch.current;
    } catch { /* not a git repo */ }

    this.pollInterval = setInterval(() => this.poll(), intervalMs);
    this.emit('started');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.emit('stopped');
  }

  private async poll(): Promise<void> {
    try {
      // Check for new commits
      const log = await this.git.log({ maxCount: 1 });
      const currentHash = log.latest?.hash || '';
      if (currentHash && currentHash !== this.lastCommitHash) {
        this.lastCommitHash = currentHash;
        this.emit('new-commit', {
          hash: log.latest?.hash,
          message: log.latest?.message,
          author: log.latest?.author_name,
          date: log.latest?.date,
        });
      }

      // Check for branch change
      const branch = await this.git.branch();
      if (branch.current !== this.lastBranch) {
        const oldBranch = this.lastBranch;
        this.lastBranch = branch.current;
        this.emit('branch-change', { from: oldBranch, to: branch.current });
      }
    } catch { /* ignore git errors during polling */ }
  }

  async getFullState(): Promise<GitState> {
    const [status, log, stagedDiff, unstagedDiff, branch] = await Promise.all([
      this.git.status(),
      this.git.log({ maxCount: 10 }),
      this.git.diff(['--cached']),
      this.git.diff(),
      this.git.branch(),
    ]);

    const recentCommits: GitCommit[] = (log.all || []).slice(0, 10).map(c => ({
      hash: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
      files: [], // populated on demand
    }));

    return {
      branch: branch.current,
      status,
      recentCommits,
      stagedDiff,
      unstagedDiff,
    };
  }

  async getDiffForCommit(hash: string): Promise<string> {
    return this.git.diff([`${hash}~1`, hash]);
  }

  async getFileHistory(filePath: string, count: number = 5): Promise<GitCommit[]> {
    const log = await this.git.log({ file: filePath, maxCount: count });
    return (log.all || []).map(c => ({
      hash: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
      files: [filePath],
    }));
  }
}
