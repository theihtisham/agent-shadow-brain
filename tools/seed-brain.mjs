// tools/seed-brain.mjs — populate the global brain with realistic memories
// so every dashboard tab displays real data instead of empty states.

import { getGlobalBrain } from '../dist/brain/global-brain.js';
import { getCausalChains } from '../dist/brain/causal-chains.js';
import { getReputationLedger } from '../dist/brain/reputation-ledger.js';
import { getTokenEconomy } from '../dist/brain/token-economy.js';
import { getSubAgentBridge } from '../dist/brain/subagent-bridge.js';
import { getCollisionDetective } from '../dist/brain/collision-detective.js';
import { getForgettingCurve } from '../dist/brain/forgetting-curve.js';
import { getFormalBridge } from '../dist/brain/formal-verification-bridge.js';

const brain = getGlobalBrain();
await brain.init();
const causal = getCausalChains(); await causal.init();
const rep = getReputationLedger(); await rep.init();
const tokens = getTokenEconomy(); await tokens.init();
const sabb = getSubAgentBridge(); await sabb.init();
const collision = getCollisionDetective(); await collision.init();
const forget = getForgettingCurve(); await forget.init();
const formal = getFormalBridge(); await formal.init();

const PROJECT_ID = 'shadow-brain-demo';
const PROJECT_NAME = 'shadow-brain';

const SEED_MEMORIES = [
  { agent: 'claude-code', category: 'decision',       content: 'Use bcrypt with cost factor 12 for all password hashing. Previous SHA-256 was found insecure.', imp: 0.92 },
  { agent: 'cursor',      category: 'pattern',        content: 'React Query is preferred over Redux for server state. Simpler, better DX, built-in cache invalidation.', imp: 0.88 },
  { agent: 'codex',       category: 'security',       content: 'All SQL queries must be parameterized — no string concatenation. Enforced via Semgrep rule.', imp: 0.95 },
  { agent: 'claude-code', category: 'architecture',   content: 'Singleton global brain at ~/.shadow-brain/global.json. Atomic write-rename for concurrency safety.', imp: 0.90 },
  { agent: 'cline',       category: 'warning',        content: 'Do NOT use fs.writeFileSync without a .tmp + rename pattern — partial writes corrupted settings.json before.', imp: 0.85 },
  { agent: 'claude-code', category: 'pitfall',        content: 'Ink TUI fails in non-TTY background processes. Set CI=true or use the dash command directly.', imp: 0.80 },
  { agent: 'cursor',      category: 'decision',       content: 'JWT tokens rotate every 24 hours with refresh tokens. Short-lived access + 30-day refresh.', imp: 0.87 },
  { agent: 'codex',       category: 'pattern',        content: 'Use zod for runtime schema validation at API boundaries. TypeScript alone is not enough.', imp: 0.82 },
  { agent: 'cline',       category: 'incident',       content: 'Production outage 2026-04-20: Postgres connection pool exhaustion. Fixed by adding pgbouncer + max 100 connections.', imp: 0.96 },
  { agent: 'claude-code', category: 'bug',            content: 'Shadow Brain session-hooks wrote wrong schema to Claude Code settings.json. Fixed with repairClaudeHookBlocks.', imp: 0.75 },
  { agent: 'cursor',      category: 'performance',    content: 'N+1 query in /api/users endpoint fixed by eager loading via .select(...).join(...) — latency dropped from 2.1s to 180ms.', imp: 0.89 },
  { agent: 'codex',       category: 'refactor',       content: 'Extracted shared auth middleware into single module. Reduced duplicate code by 400 lines across 6 routes.', imp: 0.70 },
  { agent: 'claude-code', category: 'convention',     content: 'File paths always use forward slashes even on Windows. node path.posix for display; path for filesystem.', imp: 0.68 },
  { agent: 'cursor',      category: 'failure',        content: 'React Suspense nested 3+ levels deep caused hydration mismatch. Flatten to 1 level max.', imp: 0.82 },
  { agent: 'claude-code', category: 'pattern',        content: 'Test file location: mirror source tree under tests/. Same filename with .test.ts suffix.', imp: 0.73 },
  { agent: 'cline',       category: 'security',       content: 'API keys never commit to repo. Store in .env, add to .gitignore, document in .env.example.', imp: 0.97 },
  { agent: 'codex',       category: 'decision',       content: 'Adopted Vitest over Jest for test runner. Faster, ESM-native, better TS support.', imp: 0.75 },
  { agent: 'cursor',      category: 'architecture',   content: 'Monorepo with pnpm workspaces. Shared packages under packages/, apps under apps/.', imp: 0.78 },
  { agent: 'claude-code', category: 'pattern',        content: 'Use AbortSignal.timeout(ms) on every fetch call to prevent hung requests in agent tools.', imp: 0.85 },
  { agent: 'codex',       category: 'pitfall',        content: 'Do not call .env file from src/ — always resolve relative to process.cwd() or project root.', imp: 0.70 },
  { agent: 'cursor',      category: 'performance',    content: 'Chart.js destroy + recreate on theme toggle. Otherwise colors bleed across renders.', imp: 0.65 },
  { agent: 'claude-code', category: 'learning',       content: 'Edge TTS via msedge-tts gives free Neural voices. Stream API preferred over toFile.', imp: 0.72 },
  { agent: 'cline',       category: 'warning',        content: 'Windows port release is slow after SIGKILL. Use PowerShell Get-NetTCPConnection to verify before restart.', imp: 0.68 },
  { agent: 'codex',       category: 'pattern',        content: 'Structured JSON output via Zod schema + retry. Fallback to parsed text on third failure.', imp: 0.83 },
  { agent: 'claude-code', category: 'rule',           content: 'Never use fs.readFileSync without try/catch in library code. Non-existent files crash the whole process.', imp: 0.80 },
  { agent: 'cursor',      category: 'pattern',        content: 'Playwright recordVideo context captures to WebM, then ffmpeg transcodes to H.264 MP4 with crf 20.', imp: 0.77 },
  { agent: 'claude-code', category: 'decision',       content: 'Default to local-first: Ollama is the primary provider. Remote LLM is an explicit opt-in.', imp: 0.93 },
  { agent: 'codex',       category: 'convention',     content: 'Commit messages: feat/fix/refactor/docs/chore/perf/security scope prefix, under 72 chars for subject line.', imp: 0.72 },
  { agent: 'cursor',      category: 'anti-pattern',   content: 'Do NOT use innerHTML with user-supplied strings. Always use textContent or DOMPurify.', imp: 0.94 },
  { agent: 'claude-code', category: 'observation',    content: 'TurboQuant achieves 6x vector compression (3 bits/dim) with <1% accuracy loss. Integrated into Hive Accelerator.', imp: 0.86 },
];

console.log('Seeding global brain with ' + SEED_MEMORIES.length + ' memories...');
const memoryIds = [];
for (const m of SEED_MEMORIES) {
  const id = brain.writeSync({
    projectId: PROJECT_ID, projectName: PROJECT_NAME,
    agentTool: m.agent, category: m.category, content: m.content, importance: m.imp,
    metadata: { seeded: true },
  });
  memoryIds.push(id);
}
brain.registerProject(process.cwd(), PROJECT_NAME);
console.log('✓ Memories written');

// Causal chains — link subsequent decisions to prior ones
for (let i = 1; i < Math.min(memoryIds.length, 12); i++) {
  if (i % 2 === 0) await causal.link(memoryIds[i], memoryIds[i - 1], 'built on prior decision');
}
console.log('✓ Causal links seeded');

// Reputation receipts
for (let i = 0; i < 8; i++) {
  const agents = ['claude-code', 'cursor', 'codex', 'cline'];
  const cats = ['security', 'architecture', 'pattern', 'performance'];
  await rep.sign({
    agentTool: agents[i % agents.length],
    agentVersion: '4.7',
    projectId: PROJECT_ID,
    decision: SEED_MEMORIES[i].content.slice(0, 120),
    category: cats[i % cats.length],
    confidence: 0.85 + (i % 3) * 0.04,
  });
  // Alternate outcomes
  const last = rep.exportPortable().agents[0];
  // note: recordOutcome expects receipt ID, we'd need to grab it from the sign() return
}
console.log('✓ Reputation receipts signed');

// Token spend history — last 7 days worth
const now = Date.now();
for (let d = 0; d < 7; d++) {
  for (let c = 0; c < 4; c++) {
    await tokens.record({
      agentTool: ['claude-code', 'cursor', 'codex', 'cline'][c % 4],
      model: ['claude-opus-4-7', 'claude-sonnet-4-6', 'gpt-5.4', 'claude-haiku-4-5'][(d + c) % 4],
      inputTokens: 800 + Math.floor(Math.random() * 2500),
      outputTokens: 300 + Math.floor(Math.random() * 800),
      taskCategory: ['refactor','feature','bugfix','docs','security'][(d * c) % 5],
    });
  }
}
console.log('✓ Token economy populated');

// Sub-agent spawn log entries
for (let i = 0; i < 5; i++) {
  await sabb.registerSpawn({
    parentAgent: ['claude-code', 'cursor', 'codex'][i % 3],
    subAgentId: 'seeded-sub-' + i + '-' + Date.now(),
    framework: ['claude-code-task', 'cursor-composer', 'crewai'][i % 3],
    taskDescription: [
      'refactor auth middleware to use passkeys',
      'fix typo in README intro paragraph',
      'add zod schema to /api/users POST endpoint',
      'benchmark postgres vs redis for session storage',
      'write vitest for the reputation ledger module',
    ][i],
    projectDir: process.cwd(),
    tokenBudget: [400, 150, 300, 500, 350][i],
  });
}
console.log('✓ Sub-agent spawns logged');

// Forgetting curve entries
for (const id of memoryIds.slice(0, 15)) await forget.track(id);
console.log('✓ Forgetting curve initialized');

// Formal rules — generate from two seed memories
await formal.generateFromText('always use parameterized SQL queries — never concatenate user input into SQL strings');
await formal.generateFromText('avoid innerHTML with user content — use textContent or DOMPurify.sanitize');
console.log('✓ Formal rules generated');

// Collision — declare a couple of conflicting intents
await collision.declareIntent('claude-code', 'seed-s1', 'src/auth.ts', 42, 67, 'JWT refactor');
await collision.declareIntent('cursor', 'seed-s2', 'src/auth.ts', 55, 89, 'rate limit');
console.log('✓ Collision intents seeded');

await brain.sync();
console.log('\n=== BRAIN SEEDED ===');
console.log('Memories: ' + SEED_MEMORIES.length);
console.log('Causal links, reputation, tokens, sub-agents, forgetting, formal rules, collisions — all populated.');
console.log('Refresh the dashboard.');
process.exit(0);
