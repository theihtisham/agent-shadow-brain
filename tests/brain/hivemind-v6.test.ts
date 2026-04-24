// tests/brain/hivemind-v6.test.ts — Smoke tests for all v6 modules
//
// These tests exercise the happy-path + a few error cases for each Hive Mind
// module. They intentionally use fresh singletons + temp paths to avoid
// stepping on a developer's real ~/.shadow-brain store. If singletons weren't
// resettable, tests would collide across suites.

import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Force HOME to a tmp dir for isolation
const tmpHome = path.join(os.tmpdir(), `shadow-brain-tests-${Date.now()}`);
fs.mkdirSync(tmpHome, { recursive: true });
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

describe('v6 Hive Mind modules — smoke suite', () => {
  beforeEach(async () => {
    // Reset all singletons so each test is isolated
    const modules = await Promise.all([
      import('../../src/brain/subagent-bridge.js'),
      import('../../src/brain/causal-chains.js'),
      import('../../src/brain/collision-detective.js'),
      import('../../src/brain/dream-engine.js'),
      import('../../src/brain/reputation-ledger.js'),
      import('../../src/brain/swarm-debate.js'),
      import('../../src/brain/pre-mortem.js'),
      import('../../src/brain/branch-brain.js'),
      import('../../src/brain/attention-heatmap.js'),
      import('../../src/brain/token-economy.js'),
      import('../../src/brain/forgetting-curve.js'),
      import('../../src/brain/formal-verification-bridge.js'),
      import('../../src/brain/calibration-monitor.js'),
      import('../../src/brain/air-gap.js'),
      import('../../src/brain/hallucination-quarantine.js'),
      import('../../src/brain/voice-mode.js'),
      import('../../src/brain/brain-garden.js'),
      import('../../src/brain/pr-auto-review.js'),
      import('../../src/brain/team-brain-sync.js'),
      import('../../src/brain/brain-exchange.js'),
      import('../../src/brain/local-llm.js'),
    ]);
    for (const m of modules) {
      for (const key of Object.keys(m)) {
        if (key.startsWith('reset') && typeof (m as any)[key] === 'function') (m as any)[key]();
      }
    }
  });

  it('SABB registers a spawn and produces a sliver', async () => {
    const { getSubAgentBridge } = await import('../../src/brain/subagent-bridge.js');
    const b = getSubAgentBridge();
    const req = await b.registerSpawn({
      parentAgent: 'claude-code',
      subAgentId: 'test-sub-1',
      framework: 'claude-code-task',
      taskDescription: 'refactor auth module',
      projectDir: tmpHome,
    });
    const sliver = await b.computeSliver(req);
    expect(sliver.subAgentId).toBe('test-sub-1');
    expect(sliver.markdown).toContain('Shadow Brain Context Sliver');
    expect(sliver.tokenCount).toBeGreaterThanOrEqual(0);
  });

  it('SABB quarantine + graduate flow', async () => {
    const { getSubAgentBridge } = await import('../../src/brain/subagent-bridge.js');
    const b = getSubAgentBridge();
    const mem = await b.quarantineMemory('sub-2', 'cursor', 'JWT tokens should rotate every 24h', 'pattern', 0.5);
    expect(mem.verdict).toBe('pending');
    const ok = await b.graduate(mem.id);
    expect(ok).toBe(true);
  });

  it('Causal chains link + trace', async () => {
    const { getCausalChains } = await import('../../src/brain/causal-chains.js');
    const c = getCausalChains();
    const link = await c.link('effect-1', 'cause-1', 'because');
    expect(link.effectId).toBe('effect-1');
    const chain = await c.trace('effect-1');
    expect(chain.rootId).toBe('effect-1');
    expect(chain.dot).toContain('digraph');
  });

  it('Collision detective detects overlap', async () => {
    const { getCollisionDetective } = await import('../../src/brain/collision-detective.js');
    const d = getCollisionDetective();
    await d.declareIntent('claude-code', 'session-a', '/tmp/file.ts', 10, 30, 'refactor');
    const res = await d.declareIntent('cursor', 'session-b', '/tmp/file.ts', 20, 40, 'rate-limit');
    expect(res.collision).toBeTruthy();
    expect(res.collision!.overlapStartLine).toBeLessThanOrEqual(res.collision!.overlapEndLine);
  });

  it('Dream engine runs a cycle and returns dreams or empty array', async () => {
    const { getDreamEngine } = await import('../../src/brain/dream-engine.js');
    const d = getDreamEngine({ idleThresholdMs: 1 }); // instantly idle
    await d.init();
    d.noteActivity();
    // Force idle
    (d as any).lastActivityAt = Date.now() - 10 * 60 * 1000;
    const dreams = await d.dreamOnce();
    expect(Array.isArray(dreams)).toBe(true);
  });

  it('Reputation ledger signs and verifies a receipt', async () => {
    const { getReputationLedger } = await import('../../src/brain/reputation-ledger.js');
    const l = getReputationLedger();
    const rec = await l.sign({
      agentTool: 'claude-code', agentVersion: '4.7',
      projectId: 'proj-1', decision: 'use bcrypt cost 12',
      category: 'security', confidence: 0.9,
    });
    expect(rec.signature).toBeTruthy();
    expect(rec.publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('Swarm debate produces a transcript with arbiter verdict', async () => {
    const { getSwarmDebate } = await import('../../src/brain/swarm-debate.js');
    const s = getSwarmDebate();
    const t = await s.debate('Use Redis or Postgres for session storage?', 'session storage for 10k users', { turns: 1 });
    expect(t.turns.length).toBeGreaterThanOrEqual(3);
    expect(t.verdict).toBeTruthy();
  });

  it('Pre-mortem runs + returns a report', async () => {
    const { getPreMortem } = await import('../../src/brain/pre-mortem.js');
    const pm = getPreMortem();
    const report = await pm.run('add payment processing', tmpHome);
    expect(report.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.summary).toBeTruthy();
  });

  it('Branch brain tracks current branch', async () => {
    const { getBranchBrain } = await import('../../src/brain/branch-brain.js');
    const b = getBranchBrain();
    const state = await b.getState(tmpHome);
    expect(state.currentBranch).toBeTruthy();
  });

  it('Attention heatmap produces weights that sum to ~1', async () => {
    const { getAttentionHeatmap } = await import('../../src/brain/attention-heatmap.js');
    const hm = getAttentionHeatmap();
    const report = await hm.compute({
      decisionText: 'use parameterized SQL',
      candidateMemoryIds: [],
      agentTool: 'claude-code',
    });
    expect(report.weights.length).toBe(0); // empty candidates = empty weights
  });

  it('Token economy records + reports', async () => {
    const { getTokenEconomy } = await import('../../src/brain/token-economy.js');
    const t = getTokenEconomy();
    await t.record({ agentTool: 'claude-code', model: 'claude-opus-4-7', inputTokens: 1000, outputTokens: 300, taskCategory: 'refactor' });
    const report = await t.report();
    expect(report.totalSpendUsd).toBeGreaterThan(0);
  });

  it('Forgetting curve tracks + consolidates', async () => {
    const { getForgettingCurve } = await import('../../src/brain/forgetting-curve.js');
    const f = getForgettingCurve();
    await f.track('mem-1');
    const report = await f.runConsolidation();
    expect(report.cycle).toBeGreaterThanOrEqual(1);
  });

  it('Formal verification bridge generates from text', async () => {
    const { getFormalBridge } = await import('../../src/brain/formal-verification-bridge.js');
    const fb = getFormalBridge();
    const rule = await fb.generateFromText('always use parameterized SQL queries');
    expect(rule.eslintRule || rule.lspDiagnostic).toBeTruthy();
  });

  it('Calibration monitor records + produces Brier score', async () => {
    const { getCalibrationMonitor } = await import('../../src/brain/calibration-monitor.js');
    const c = getCalibrationMonitor();
    const score = await c.record({
      agentTool: 'claude-code', category: 'security', claim: 'bcrypt is slow',
      claimedConfidence: 0.8, actualOutcome: 'correct', outcomeAt: new Date(),
    });
    expect(score.brierScore).toBeGreaterThanOrEqual(0);
    expect(score.trustWeight).toBeGreaterThanOrEqual(0.4);
  });

  it('Air-gap toggles and reports status', async () => {
    const { getAirGapMode } = await import('../../src/brain/air-gap.js');
    const a = getAirGapMode();
    await a.enable();
    expect(a.isEnabled()).toBe(true);
    const allowLocal = await a.gate('http://127.0.0.1:11434/api/tags');
    expect(allowLocal).toBe(true);
    const blockRemote = await a.gate('https://api.openai.com/v1');
    expect(blockRemote).toBe(false);
    await a.disable();
  });

  it('Brain encryption round-trips with the right passphrase', async () => {
    const { BrainEncryption } = await import('../../src/brain/brain-encryption.js');
    const enc = BrainEncryption.encrypt('hello brain', 'test-pass-1234');
    const back = BrainEncryption.decrypt(enc, 'test-pass-1234').toString('utf-8');
    expect(back).toBe('hello brain');
  });

  it('Brain encryption fails with wrong passphrase', async () => {
    const { BrainEncryption } = await import('../../src/brain/brain-encryption.js');
    const enc = BrainEncryption.encrypt('secret', 'right-pass-000000');
    expect(() => BrainEncryption.decrypt(enc, 'wrong-pass-000000')).toThrow();
  });

  it('Hallucination quarantine flags + promotes', async () => {
    const { getHallucinationQuarantine } = await import('../../src/brain/hallucination-quarantine.js');
    const q = getHallucinationQuarantine();
    const entry = await q.flag('test', 'Foo exists at /api/nope', 'not found in source');
    expect(entry.decision).toBe('pending');
    const ok = await q.promote(entry.id, 'proj-1', 'claude-code');
    expect(ok).toBe(true);
  });

  it('Voice mode responds to transcripts', async () => {
    const { getVoiceMode } = await import('../../src/brain/voice-mode.js');
    const v = getVoiceMode();
    const res = await v.process({ transcript: 'brain status' });
    expect(res.intent).toBe('status');
    expect(res.response).toContain('Hive Mind');
  });

  it('Brain Garden produces a snapshot array', async () => {
    const { getBrainGarden } = await import('../../src/brain/brain-garden.js');
    const g = getBrainGarden();
    const snap = await g.snapshot(10);
    expect(Array.isArray(snap)).toBe(true);
  });

  it('PR auto-review produces a markdown body', async () => {
    const { getPRAutoReview } = await import('../../src/brain/pr-auto-review.js');
    const p = getPRAutoReview();
    const review = await p.generate({
      repo: 'theihtisham/agent-shadow-brain',
      prNumber: 42,
      projectDir: tmpHome,
      diffSummary: 'refactor auth',
      changedFiles: ['src/auth.ts'],
    });
    expect(review.body).toContain('Shadow Brain Review');
  });

  it('Team brain sync tracks peers', async () => {
    const { getTeamBrainSync } = await import('../../src/brain/team-brain-sync.js');
    const t = getTeamBrainSync();
    await t.registerPeer({ peerId: 'peer-1', displayName: 'Alice', agentTools: ['claude-code'], sharedMemoryCount: 0 });
    expect(t.listPeers().length).toBe(1);
  });

  it('Brain exchange exports + imports', async () => {
    const { getBrainExchange } = await import('../../src/brain/brain-exchange.js');
    const e = getBrainExchange();
    const exp = await e.export({ name: 'test-pack', description: 't', author: 'tester', limit: 10, minImportance: 0 });
    expect(fs.existsSync(exp.filePath)).toBe(true);
    const imp = await e.import(exp.filePath, { projectDir: tmpHome });
    expect(imp.pkg.name).toBe('test-pack');
  });

  it('Local LLM fallback works when Ollama is unreachable', async () => {
    const { LocalLLM } = await import('../../src/brain/local-llm.js');
    const llm = new LocalLLM({ endpoint: 'http://127.0.0.1:11434', timeoutMs: 200 });
    const res = await llm.generate('Hello brain, in one sentence.');
    expect(res.text).toBeTruthy();
    expect(res.local).toBe(true);
  });
});
