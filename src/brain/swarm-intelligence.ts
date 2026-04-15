// src/brain/swarm-intelligence.ts — Ant Colony Optimizer for Code Analysis
// Uses pheromone trails to prioritize files for deep analysis.
// Emergent behavior: ants self-organize around bugs and complexity hotspots.
// v4.0.0 — Hyper-Intelligence Edition

import * as crypto from 'crypto';
import { PheromoneTrail, SwarmTask, AntColonyState, SwarmConfig } from '../types.js';

const DEFAULT_CONFIG: SwarmConfig = {
  antCount: 20,
  evaporationRate: 0.1,
  reinforcementFactor: 2.0,
  maxIterations: 100,
  convergenceThreshold: 0.8,
};

/**
 * Swarm Intelligence — ant colony optimization for code analysis prioritization.
 *
 * Pheromone Trails:
 *   Each "ant" = lightweight analysis task for one file.
 *   Ants deposit pheromone when they find issues: strength += severity × confidence.
 *   Evaporation: strength *= (1 - evaporationRate) each cycle.
 *   High-pheromone files = high-priority for deep analysis.
 *
 * Task Partitioning:
 *   Large codebase → divide into territories by pheromone density.
 *   High-density → more ants (deeper analysis).
 *   Low-density → fewer ants (surface scan).
 *
 * Convergence: when top 10% of files account for 80% of total pheromone.
 */
export class SwarmIntelligence {
  private config: SwarmConfig;
  private state: AntColonyState;
  private trailMap: Map<string, number> = new Map(); // file → pheromone strength

  constructor(config?: Partial<SwarmConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      trails: [],
      activeTasks: [],
      convergenceScore: 0,
      totalAnts: this.config.antCount,
      cycleCount: 0,
      highPriorityFiles: [],
    };
  }

  /** Initialize colony with files to analyze */
  initialize(files: string[]): AntColonyState {
    this.trailMap.clear();

    // Initialize pheromone trails for each file
    for (const file of files) {
      this.trailMap.set(file, 0.1); // Small initial pheromone (exploration bias)
    }

    this.state = {
      trails: Array.from(this.trailMap.entries()).map(([file, strength]) => ({
        path: [file],
        strength,
        evaporation: this.config.evaporationRate,
        lastReinforced: new Date(),
        totalDetections: 0,
      })),
      activeTasks: [],
      convergenceScore: 0,
      totalAnts: this.config.antCount,
      cycleCount: 0,
      highPriorityFiles: [],
    };

    return this.state;
  }

  /** Run one colony cycle — dispatch ants, collect results, update pheromones */
  async runCycle(
    analyzeFile: (file: string) => Promise<{ severity: number; confidence: number; issues: number }>
  ): Promise<AntColonyState> {
    this.state.cycleCount++;

    // Phase 1: Dispatch ants based on pheromone distribution
    const tasks = this.partitionTasks(this.config.antCount);

    // Phase 2: Execute analysis tasks
    for (const taskGroup of tasks) {
      const taskPromises = taskGroup.map(async (task) => {
        try {
          task.status = 'in-progress';
          const result = await analyzeFile(task.file ?? 'unknown');

          // Deposit pheromone based on findings
          const pheromoneDeposit = result.severity * result.confidence * this.config.reinforcementFactor;
          this.depositPheromone([task.file ?? ''], pheromoneDeposit);

          task.status = 'completed';
          task.result = result;
          return result;
        } catch {
          task.status = 'failed';
          return null;
        }
      });

      await Promise.all(taskPromises);
    }

    // Phase 3: Evaporate pheromones
    this.evaporate();

    // Phase 4: Update convergence score
    this.state.convergenceScore = this.calculateConvergence();

    // Phase 5: Update high-priority files
    this.state.highPriorityFiles = this.getHighPriorityFiles(10);

    return this.state;
  }

  /** Deposit pheromone on a trail (file path) */
  depositPheromone(trail: string[], strength: number): void {
    const file = trail[0];
    if (!file) return;

    const currentStrength = this.trailMap.get(file) ?? 0;
    const newStrength = currentStrength + strength;
    this.trailMap.set(file, newStrength);

    // Update trail in state
    const existingTrail = this.state.trails.find(t => t.path[0] === file);
    if (existingTrail) {
      existingTrail.strength = newStrength;
      existingTrail.lastReinforced = new Date();
      existingTrail.totalDetections++;
    } else {
      this.state.trails.push({
        path: trail,
        strength: newStrength,
        evaporation: this.config.evaporationRate,
        lastReinforced: new Date(),
        totalDetections: 1,
      });
    }
  }

  /** Evaporate all pheromone trails */
  evaporate(): void {
    for (const [file, strength] of this.trailMap) {
      const evaporated = strength * (1 - this.config.evaporationRate);
      this.trailMap.set(file, Math.max(0.01, evaporated)); // Minimum pheromone for exploration
    }

    // Update trail objects
    for (const trail of this.state.trails) {
      const file = trail.path[0];
      trail.strength = this.trailMap.get(file) ?? 0.01;
    }
  }

  /** Get files ranked by pheromone strength (highest first) */
  getHighPriorityFiles(topN: number = 10): string[] {
    return Array.from(this.trailMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([file]) => file);
  }

  /** Partition files into task groups based on pheromone density */
  partitionTasks(antCount: number): SwarmTask[][] {
    const rankedFiles = Array.from(this.trailMap.entries())
      .sort((a, b) => b[1] - a[1]);

    const totalPheromone = rankedFiles.reduce((sum, [_, s]) => sum + s, 0);
    if (totalPheromone === 0) {
      // Equal distribution
      const perAnt = Math.ceil(rankedFiles.length / antCount);
      const groups: SwarmTask[][] = [];
      for (let i = 0; i < rankedFiles.length; i += perAnt) {
        groups.push(rankedFiles.slice(i, i + perAnt).map(([file]) => this.createTask(file)));
      }
      return groups;
    }

    // Weighted distribution: more ants to high-pheromone files
    const groups: SwarmTask[][] = [];
    const antsPerGroup = Math.max(1, Math.floor(antCount / Math.min(rankedFiles.length, 5)));

    // Top files get multiple ants (deeper analysis)
    const topFiles = rankedFiles.slice(0, Math.ceil(rankedFiles.length * 0.2));
    const regularFiles = rankedFiles.slice(Math.ceil(rankedFiles.length * 0.2));

    // Deep analysis group (top pheromone files)
    const deepGroup: SwarmTask[] = topFiles.map(([file]) =>
      this.createTask(file, 'deep-scan', 'high')
    );
    groups.push(deepGroup);

    // Regular analysis groups
    const batchSize = Math.ceil(regularFiles.length / Math.max(1, antCount - antsPerGroup));
    for (let i = 0; i < regularFiles.length; i += batchSize) {
      const batch = regularFiles.slice(i, i + batchSize).map(([file]) =>
        this.createTask(file, 'analyze', 'medium')
      );
      groups.push(batch);
    }

    return groups;
  }

  /** Calculate convergence score (0-1, higher = more focused) */
  private calculateConvergence(): number {
    const rankedFiles = Array.from(this.trailMap.values()).sort((a, b) => b - a);
    if (rankedFiles.length === 0) return 0;

    const totalPheromone = rankedFiles.reduce((s, v) => s + v, 0);
    if (totalPheromone === 0) return 0;

    const topCount = Math.max(1, Math.ceil(rankedFiles.length * 0.1));
    const topPheromone = rankedFiles.slice(0, topCount).reduce((s, v) => s + v, 0);

    return topPheromone / totalPheromone;
  }

  /** Create a swarm task */
  private createTask(
    file: string,
    type: SwarmTask['type'] = 'analyze',
    priority: SwarmTask['priority'] = 'medium'
  ): SwarmTask {
    const task: SwarmTask = {
      id: crypto.randomUUID(),
      type,
      file,
      priority,
      status: 'pending',
      createdAt: new Date(),
    };
    this.state.activeTasks.push(task);
    return task;
  }

  /** Get colony state */
  getState(): AntColonyState {
    return { ...this.state };
  }

  /** Reset colony */
  reset(): void {
    this.trailMap.clear();
    this.state = {
      trails: [],
      activeTasks: [],
      convergenceScore: 0,
      totalAnts: this.config.antCount,
      cycleCount: 0,
      highPriorityFiles: [],
    };
  }
}
