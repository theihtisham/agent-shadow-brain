// src/brain/self-evolution.ts — Genetic Algorithm Rule Optimizer
// Rules evolve themselves by measuring which produce accurate insights.
// Tournament selection, Gaussian mutation, Bayesian meta-learning.
// v4.0.0 — Hyper-Intelligence Edition

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { GeneticRule, EvolutionSnapshot, MetaLearningLog, SelfEvolutionConfig, BrainInsight } from '../types.js';

const EVOLUTION_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.shadow-brain', 'evolution');
const DEFAULT_CONFIG: SelfEvolutionConfig = {
  populationSize: 50,
  mutationRate: 0.1,
  crossoverRate: 0.7,
  elitePercent: 0.1,
  fitnessTarget: 0.95,
  maxGenerations: 1000,
  tournamentSize: 5,
};

/**
 * Self-Evolution Engine — rules that write themselves.
 *
 * Genetic Representation:
 *   Each rule = chromosome of floats encoding severity weight,
 *   confidence threshold, file pattern hash, category encoding, etc.
 *
 * Fitness: accuracy × coverage × (1 / falsePositiveRate)
 * Selection: Tournament (k=5)
 * Crossover: Single-point at random position
 * Mutation: Gaussian noise σ = 0.1 × mutationRate
 *
 * Meta-Learning: Tracks which (rule, project_type, language) combos work best.
 * Bayesian updating of weights per strategy.
 */
export class SelfEvolution {
  private config: SelfEvolutionConfig;
  private population: GeneticRule[] = [];
  private generation = 0;
  private metaLogs: MetaLearningLog[] = [];
  private eliteArchive: GeneticRule[] = [];
  private fitnessHistory: Array<{ gen: number; best: number; avg: number }> = [];

  constructor(config?: Partial<SelfEvolutionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromDisk();
  }

  // ── Evolution Cycle ─────────────────────────────────────────────────────────

  /** Run one evolution generation */
  async evolve(insights: BrainInsight[] = []): Promise<EvolutionSnapshot> {
    // Initialize population if empty
    if (this.population.length === 0) {
      this.initializePopulation();
    }

    // Evaluate fitness for all rules
    for (const rule of this.population) {
      rule.fitness = this.evaluateFitness(rule, insights);
    }

    // Sort by fitness (descending)
    this.population.sort((a, b) => b.fitness - a.fitness);

    // Track elite
    const eliteCount = Math.max(1, Math.floor(this.config.populationSize * this.config.elitePercent));
    const elites = this.population.slice(0, eliteCount);
    this.eliteArchive = [...this.eliteArchive, ...elites]
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, eliteCount * 3);

    // Create next generation
    const nextGen: GeneticRule[] = [...elites]; // Elitism: keep best

    while (nextGen.length < this.config.populationSize) {
      const parentA = this.tournamentSelect();
      const parentB = this.tournamentSelect();

      if (Math.random() < this.config.crossoverRate) {
        const [childA, childB] = this.crossover(parentA, parentB);
        nextGen.push(this.mutate(childA));
        if (nextGen.length < this.config.populationSize) {
          nextGen.push(this.mutate(childB));
        }
      } else {
        nextGen.push(this.mutate({ ...parentA, id: crypto.randomUUID() }));
      }
    }

    this.population = nextGen;
    this.generation++;

    // Record fitness history
    const bestFitness = elites[0]?.fitness ?? 0;
    const avgFitness = this.population.reduce((s, r) => s + r.fitness, 0) / this.population.length;
    this.fitnessHistory.push({ gen: this.generation, best: bestFitness, avg: avgFitness });

    const snapshot: EvolutionSnapshot = {
      generation: this.generation,
      bestFitness,
      avgFitness,
      worstFitness: this.population[this.population.length - 1]?.fitness ?? 0,
      population: [...this.population],
      eliteCount,
      timestamp: new Date(),
    };

    await this.saveToDisk();
    return snapshot;
  }

  // ── Fitness Evaluation ──────────────────────────────────────────────────────

  /** Evaluate rule fitness based on insight history */
  evaluateFitness(rule: GeneticRule, insights: BrainInsight[]): number {
    if (insights.length === 0) {
      // No insights to evaluate against — use chromosome values
      const chrom = rule.chromosome;
      const severityWeight = chrom[0] ?? 0.5;
      const confidenceThreshold = chrom[1] ?? 0.5;
      const coverageScore = chrom[2] ?? 0.5;
      const specificity = chrom[3] ?? 0.5;

      return (severityWeight * 0.3 + confidenceThreshold * 0.3 + coverageScore * 0.2 + specificity * 0.2);
    }

    // Match insights to rule category and measure accuracy
    const matchingInsights = insights.filter(i => {
      const categoryScore = rule.chromosome[3] ?? 0.5;
      return i.confidence !== undefined && i.confidence >= categoryScore * 0.5;
    });

    if (matchingInsights.length === 0) return 0.1; // Minimum fitness

    // Count true positives (high confidence insights that match)
    const truePositives = matchingInsights.filter(i =>
      i.priority === 'critical' || i.priority === 'high'
    ).length;

    // Count false positives (low confidence insights that fired)
    const falsePositives = matchingInsights.filter(i =>
      i.priority === 'low' && (i.confidence ?? 0) < 0.5
    ).length;

    const accuracy = truePositives / Math.max(matchingInsights.length, 1);
    const coverage = matchingInsights.length / Math.max(insights.length, 1);
    const falsePositiveRate = falsePositives / Math.max(matchingInsights.length, 1);

    return accuracy * 0.4 + coverage * 0.3 + (1 - falsePositiveRate) * 0.3;
  }

  // ── Genetic Operators ───────────────────────────────────────────────────────

  /** Tournament selection (k=5) */
  private tournamentSelect(): GeneticRule {
    let best: GeneticRule | null = null;
    for (let i = 0; i < this.config.tournamentSize; i++) {
      const candidate = this.population[Math.floor(Math.random() * this.population.length)];
      if (!best || candidate.fitness > best.fitness) {
        best = candidate;
      }
    }
    return { ...best!, id: crypto.randomUUID() };
  }

  /** Single-point crossover */
  crossover(a: GeneticRule, b: GeneticRule): [GeneticRule, GeneticRule] {
    const point = Math.floor(Math.random() * Math.min(a.chromosome.length, b.chromosome.length));

    const childAChrom = [...a.chromosome.slice(0, point), ...b.chromosome.slice(point)];
    const childBChrom = [...b.chromosome.slice(0, point), ...a.chromosome.slice(point)];

    return [
      { id: crypto.randomUUID(), chromosome: childAChrom, fitness: 0, generation: this.generation, mutations: 0, category: a.category, createdAt: new Date() },
      { id: crypto.randomUUID(), chromosome: childBChrom, fitness: 0, generation: this.generation, mutations: 0, category: b.category, createdAt: new Date() },
    ];
  }

  /** Gaussian mutation */
  mutate(rule: GeneticRule): GeneticRule {
    const sigma = 0.1 * this.config.mutationRate;
    const mutated = rule.chromosome.map(gene => {
      if (Math.random() < this.config.mutationRate) {
        // Box-Muller transform for Gaussian noise
        const u1 = Math.random();
        const u2 = Math.random();
        const noise = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2) * sigma;
        return Math.max(0, Math.min(1, gene + noise));
      }
      return gene;
    });

    return {
      ...rule,
      chromosome: mutated,
      mutations: rule.mutations + 1,
    };
  }

  // ── Population Initialization ───────────────────────────────────────────────

  private initializePopulation(): void {
    const categories = ['security', 'performance', 'quality', 'architecture', 'style'];

    for (let i = 0; i < this.config.populationSize; i++) {
      this.population.push({
        id: crypto.randomUUID(),
        chromosome: Array.from({ length: 10 }, () => Math.random()),
        fitness: 0,
        generation: 0,
        mutations: 0,
        category: categories[i % categories.length],
        createdAt: new Date(),
      });
    }
  }

  // ── Meta-Learning ───────────────────────────────────────────────────────────

  /** Update meta-learning log with strategy outcome */
  updateMetaLearning(strategy: string, outcome: boolean, category: string = 'general'): void {
    const existing = this.metaLogs.find(l => l.strategy === strategy && l.category === category);
    if (existing) {
      const totalSamples = existing.sampleCount + 1;
      const successCount = existing.sampleCount * existing.successRate + (outcome ? 1 : 0);
      existing.successRate = successCount / totalSamples;
      existing.avgImprovement = existing.avgImprovement * 0.9 + (outcome ? 0.1 : -0.05);
      existing.sampleCount = totalSamples;
      existing.lastUpdated = new Date();
    } else {
      this.metaLogs.push({
        strategy,
        successRate: outcome ? 1 : 0,
        avgImprovement: outcome ? 0.1 : 0,
        sampleCount: 1,
        lastUpdated: new Date(),
        category,
      });
    }
  }

  /** Get best evolved rules for a category */
  getBestRules(category: string, topN: number = 10): GeneticRule[] {
    const allRules = [...this.eliteArchive, ...this.population]
      .filter(r => category === 'all' || r.category === category)
      .sort((a, b) => b.fitness - a.fitness);

    // Deduplicate by chromosome similarity
    const seen: GeneticRule[] = [];
    for (const rule of allRules) {
      if (seen.length >= topN) break;
      const isDuplicate = seen.some(s =>
        s.chromosome.every((gene, i) => Math.abs(gene - rule.chromosome[i]) < 0.05)
      );
      if (!isDuplicate) seen.push(rule);
    }

    return seen;
  }

  /** Get current generation info */
  getGeneration(): number { return this.generation; }
  getPopulationSize(): number { return this.population.length; }
  getFitnessHistory(): Array<{ gen: number; best: number; avg: number }> { return this.fitnessHistory; }

  /** Get a snapshot of the current evolution state */
  getSnapshot(): EvolutionSnapshot {
    const fitnesses = this.population.map(r => r.fitness);
    return {
      generation: this.generation,
      bestFitness: fitnesses.length > 0 ? Math.max(...fitnesses) : 0,
      avgFitness: fitnesses.length > 0 ? fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length : 0,
      worstFitness: fitnesses.length > 0 ? Math.min(...fitnesses) : 0,
      population: this.population,
      eliteCount: this.eliteArchive.length,
      timestamp: new Date(),
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async saveToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(EVOLUTION_DIR)) {
        fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
      }

      const state = {
        generation: this.generation,
        population: this.population,
        eliteArchive: this.eliteArchive,
        metaLogs: this.metaLogs,
        fitnessHistory: this.fitnessHistory,
        config: this.config,
      };

      fs.writeFileSync(
        path.join(EVOLUTION_DIR, `gen-${this.generation}.json`),
        JSON.stringify(state)
      );
    } catch {
      // Non-blocking
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(EVOLUTION_DIR)) return;

      const files = fs.readdirSync(EVOLUTION_DIR)
        .filter(f => f.startsWith('gen-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) return;

      const latest = JSON.parse(fs.readFileSync(path.join(EVOLUTION_DIR, files[0]), 'utf-8'));
      this.generation = latest.generation ?? 0;
      this.population = latest.population ?? [];
      this.eliteArchive = latest.eliteArchive ?? [];
      this.metaLogs = latest.metaLogs ?? [];
      this.fitnessHistory = latest.fitnessHistory ?? [];
    } catch {
      // Fresh start
    }
  }
}
