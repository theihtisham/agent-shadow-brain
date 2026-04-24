// src/brain/agent-handoff.ts — Cross-agent continuation packets

import * as path from 'path';
import { AgentHandoffPacket, AgentTool, BrainTimelineEvent } from '../types.js';
import { GlobalBrain, getGlobalBrain } from './global-brain.js';
import { AgentFirewall } from './agent-firewall.js';

export class AgentHandoff {
  private brain: GlobalBrain;
  private firewall = new AgentFirewall();

  constructor(brain = getGlobalBrain()) {
    this.brain = brain;
  }

  async generate(opts: {
    fromAgent: AgentTool;
    toAgent: AgentTool;
    projectDir: string;
    task?: string;
    limit?: number;
  }): Promise<AgentHandoffPacket> {
    await this.brain.init();

    const projectDir = path.resolve(opts.projectDir);
    const projectId = GlobalBrain.projectIdFor(projectDir);
    const projectName = path.basename(projectDir);
    const recentMemories = this.brain.timeline({
      projectId,
      limit: opts.limit ?? 12,
    });

    const changedFiles = await this.getChangedFiles(projectDir);
    const gitSummary = await this.getGitSummary(projectDir);
    const safetyWarnings = this.getSafetyWarnings(recentMemories, changedFiles);
    const task = opts.task || 'Continue the current implementation with the project conventions and warnings below.';

    const packet: Omit<AgentHandoffPacket, 'markdown'> = {
      fromAgent: opts.fromAgent,
      toAgent: opts.toAgent,
      projectDir,
      projectName,
      task,
      createdAt: new Date(),
      recentMemories,
      changedFiles,
      gitSummary,
      safetyWarnings,
    };

    return {
      ...packet,
      markdown: this.toMarkdown(packet),
    };
  }

  private async getChangedFiles(projectDir: string): Promise<string[]> {
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('git', ['status', '--short'], { cwd: projectDir, reject: false });
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^..?\s+/, '').replace(/^"|"$/g, ''))
        .slice(0, 40);
    } catch {
      return [];
    }
  }

  private async getGitSummary(projectDir: string): Promise<string> {
    try {
      const { execa } = await import('execa');
      const [branch, diff] = await Promise.all([
        execa('git', ['branch', '--show-current'], { cwd: projectDir, reject: false }),
        execa('git', ['diff', '--stat'], { cwd: projectDir, reject: false }),
      ]);
      return [
        branch.stdout ? `Branch: ${branch.stdout}` : 'Branch: unknown',
        diff.stdout || 'No unstaged diff stat available',
      ].join('\n');
    } catch {
      return 'Git summary unavailable.';
    }
  }

  private getSafetyWarnings(memories: BrainTimelineEvent[], changedFiles: string[]): string[] {
    const warnings = new Set<string>();
    for (const file of changedFiles) {
      const decision = this.firewall.check({ filePath: file });
      for (const finding of decision.findings) warnings.add(finding.reason);
    }
    for (const event of memories) {
      const decision = this.firewall.check({ content: event.content });
      for (const finding of decision.findings) warnings.add(finding.reason);
    }
    return Array.from(warnings).slice(0, 8);
  }

  private toMarkdown(packet: Omit<AgentHandoffPacket, 'markdown'>): string {
    const lines: string[] = [
      `# Shadow Brain Agent Handoff`,
      ``,
      `**From:** ${packet.fromAgent}`,
      `**To:** ${packet.toAgent}`,
      `**Project:** ${packet.projectName}`,
      `**Created:** ${packet.createdAt.toISOString()}`,
      ``,
      `## Current Task`,
      packet.task,
      ``,
      `## Git State`,
      '```text',
      packet.gitSummary,
      '```',
      ``,
      `## Changed Files`,
      ...(packet.changedFiles.length ? packet.changedFiles.map(f => `- ${f}`) : ['- No changed files detected']),
      ``,
      `## Recent Shared Memory`,
    ];

    if (packet.recentMemories.length) {
      for (const memory of packet.recentMemories) {
        lines.push(`- [${memory.agentTool}/${memory.category}] ${memory.content.slice(0, 220)}`);
      }
    } else {
      lines.push('- No global memories yet. Start by recording decisions and warnings.');
    }

    lines.push('', '## Safety Warnings');
    if (packet.safetyWarnings.length) {
      for (const warning of packet.safetyWarnings) lines.push(`- ${warning}`);
    } else {
      lines.push('- No safety warnings detected in the handoff packet.');
    }

    lines.push(
      '',
      '## Instruction For Receiving Agent',
      'Continue from this packet. Prefer project-specific memory over generic assumptions. Do not access secrets or run destructive commands without explicit user approval.',
      '',
    );

    return lines.join('\n');
  }
}
