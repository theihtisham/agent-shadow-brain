// src/brain/mcp-server.ts — JSON-RPC 2.0 MCP server over HTTP
// Exposes analysis tools via Model Context Protocol
// v6.0.0 — Hive Mind Edition (Cursor + Claude Code + Codex + Copilot + sub-agent frameworks)

import * as http from 'http';
import { MCPRequest, MCPResponse, MCPTool, MCPServerOptions, SymbolInfo } from '../types.js';

interface SSEClient {
  res: http.ServerResponse;
  id: string;
}

export class MCPServer {
  private orchestrator: any;
  private options: Required<MCPServerOptions>;
  private server: http.Server | null = null;
  private sseClients: Map<string, SSEClient> = new Map();
  private lastHealthScore: number | null = null;
  private toolHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;

  constructor(orchestrator: any, options?: MCPServerOptions) {
    this.orchestrator = orchestrator;
    this.options = {
      port: options?.port ?? 7342,
      host: options?.host ?? 'localhost',
      authToken: options?.authToken ?? process.env.SHADOW_BRAIN_MCP_TOKEN ?? '',
      corsOrigin: options?.corsOrigin ?? `http://${options?.host ?? 'localhost'}:${options?.port ?? 7342}`,
    };

    this.toolHandlers = {
      analyze: this.handleAnalyze.bind(this),
      health: this.handleHealth.bind(this),
      fixes: this.handleFixes.bind(this),
      metrics: this.handleMetrics.bind(this),
      semantic: this.handleSemantic.bind(this),
      deps: this.handleDeps.bind(this),
      learn: this.handleLearn.bind(this),
      memory: this.handleMemory.bind(this),
      recall: this.handleRecall.bind(this),
      consensus: this.handleConsensus.bind(this),
      turbo: this.handleTurbo.bind(this),
      swarm: this.handleSwarm.bind(this),
      evolution: this.handleEvolution.bind(this),
      knowledge_graph: this.handleKnowledgeGraph.bind(this),
      predict: this.handlePredict.bind(this),
      ask: this.handleAsk.bind(this),
      status: this.handleStatus.bind(this),
      modules: this.handleModules.bind(this),
      auto_config: this.handleAutoConfig.bind(this),
      // v5.2.0 — Subconscious Singularity
      subconscious_inject: this.handleSubconsciousInject.bind(this),
      global_recall: this.handleGlobalRecall.bind(this),
      global_stats: this.handleGlobalStats.bind(this),
      attach_status: this.handleAttachStatus.bind(this),
      global_timeline: this.handleGlobalTimeline.bind(this),
      firewall_check: this.handleFirewallCheck.bind(this),
      agent_handoff: this.handleAgentHandoff.bind(this),
      // v6.0.0 — Hive Mind tools
      subagent_sliver: this.handleSubagentSliver.bind(this),
      subagent_quarantine_list: this.handleSubagentQuarantineList.bind(this),
      subagent_graduate: this.handleSubagentGraduate.bind(this),
      subagent_reject: this.handleSubagentReject.bind(this),
      causal_link: this.handleCausalLink.bind(this),
      causal_trace: this.handleCausalTrace.bind(this),
      causal_influence: this.handleCausalInfluence.bind(this),
      collision_declare: this.handleCollisionDeclare.bind(this),
      collision_list: this.handleCollisionList.bind(this),
      dream_run: this.handleDreamRun.bind(this),
      dream_list: this.handleDreamList.bind(this),
      reputation_sign: this.handleReputationSign.bind(this),
      reputation_score: this.handleReputationScore.bind(this),
      reputation_badge: this.handleReputationBadge.bind(this),
      debate_run: this.handleDebateRun.bind(this),
      premortem_run: this.handlePremortemRun.bind(this),
      branch_state: this.handleBranchState.bind(this),
      attention_heatmap: this.handleAttentionHeatmap.bind(this),
      tokens_record: this.handleTokensRecord.bind(this),
      tokens_report: this.handleTokensReport.bind(this),
      forget_consolidate: this.handleForgetConsolidate.bind(this),
      formal_generate: this.handleFormalGenerate.bind(this),
      calibration_record: this.handleCalibrationRecord.bind(this),
      calibration_scores: this.handleCalibrationScores.bind(this),
      airgap_status: this.handleAirGapStatus.bind(this),
      airgap_enable: this.handleAirGapEnable.bind(this),
      airgap_disable: this.handleAirGapDisable.bind(this),
      quarantine_list: this.handleQuarantineList.bind(this),
      quarantine_promote: this.handleQuarantinePromote.bind(this),
      voice_process: this.handleVoiceProcess.bind(this),
      garden_snapshot: this.handleGardenSnapshot.bind(this),
      pr_review_generate: this.handlePRReviewGenerate.bind(this),
      exchange_export: this.handleExchangeExport.bind(this),
      exchange_import: this.handleExchangeImport.bind(this),
      exchange_list: this.handleExchangeList.bind(this),
      hive_status: this.handleHiveStatus.bind(this),
    };
  }

  // ── v6.0 Hive Mind handlers ────────────────────────────────────────────────

  private async handleSubagentSliver(params: Record<string, unknown>): Promise<unknown> {
    const { getSubAgentBridge } = await import('./subagent-bridge.js');
    const b = getSubAgentBridge();
    const req = await b.registerSpawn({
      parentAgent: (params.parentAgent as any) ?? 'claude-code',
      subAgentId: (params.subAgentId as string) ?? `sub-${Date.now()}`,
      framework: (params.framework as any) ?? 'claude-code-task',
      taskDescription: (params.taskDescription as string) ?? '',
      projectDir: (params.projectDir as string) ?? process.cwd(),
      tokenBudget: params.tokenBudget as number | undefined,
    });
    return b.computeSliver(req);
  }
  private async handleSubagentQuarantineList(_params: Record<string, unknown>): Promise<unknown> {
    const { getSubAgentBridge } = await import('./subagent-bridge.js');
    const b = getSubAgentBridge(); await b.init();
    return b.listQuarantine();
  }
  private async handleSubagentGraduate(params: Record<string, unknown>): Promise<unknown> {
    const { getSubAgentBridge } = await import('./subagent-bridge.js');
    return { ok: await getSubAgentBridge().graduate(params.memoryId as string) };
  }
  private async handleSubagentReject(params: Record<string, unknown>): Promise<unknown> {
    const { getSubAgentBridge } = await import('./subagent-bridge.js');
    return { ok: await getSubAgentBridge().reject(params.memoryId as string, params.reason as string | undefined) };
  }
  private async handleCausalLink(params: Record<string, unknown>): Promise<unknown> {
    const { getCausalChains } = await import('./causal-chains.js');
    return getCausalChains().link(params.effectId as string, params.causeId as string, params.rationale as string | undefined, (params.strength as number) ?? 1.0);
  }
  private async handleCausalTrace(params: Record<string, unknown>): Promise<unknown> {
    const { getCausalChains } = await import('./causal-chains.js');
    return getCausalChains().trace(params.memoryId as string, { maxDepth: (params.maxDepth as number) ?? 8 });
  }
  private async handleCausalInfluence(params: Record<string, unknown>): Promise<unknown> {
    const { getCausalChains } = await import('./causal-chains.js');
    return getCausalChains().influence(params.memoryId as string, { maxDepth: (params.maxDepth as number) ?? 6 });
  }
  private async handleCollisionDeclare(params: Record<string, unknown>): Promise<unknown> {
    const { getCollisionDetective } = await import('./collision-detective.js');
    return getCollisionDetective().declareIntent(
      params.agentTool as any,
      params.sessionId as string,
      params.filePath as string,
      params.startLine as number,
      params.endLine as number,
      params.intent as string,
      params.ttlMs as number | undefined,
    );
  }
  private async handleCollisionList(_params: Record<string, unknown>): Promise<unknown> {
    const { getCollisionDetective } = await import('./collision-detective.js');
    const d = getCollisionDetective(); await d.init();
    return { intents: d.activeIntents(), alerts: d.activeAlerts(), stats: d.getStats() };
  }
  private async handleDreamRun(_params: Record<string, unknown>): Promise<unknown> {
    const { getDreamEngine } = await import('./dream-engine.js');
    return getDreamEngine().dreamOnce();
  }
  private async handleDreamList(params: Record<string, unknown>): Promise<unknown> {
    const { getDreamEngine } = await import('./dream-engine.js');
    const d = getDreamEngine(); await d.init();
    return d.listDreams({ unacknowledgedOnly: params.unacknowledgedOnly as boolean | undefined, limit: params.limit as number | undefined });
  }
  private async handleReputationSign(params: Record<string, unknown>): Promise<unknown> {
    const { getReputationLedger } = await import('./reputation-ledger.js');
    return getReputationLedger().sign({
      agentTool: params.agentTool as any,
      agentVersion: params.agentVersion as string,
      projectId: params.projectId as string,
      decision: params.decision as string,
      category: params.category as string,
      confidence: (params.confidence as number) ?? 0.8,
    });
  }
  private async handleReputationScore(params: Record<string, unknown>): Promise<unknown> {
    const { getReputationLedger } = await import('./reputation-ledger.js');
    const l = getReputationLedger(); await l.init();
    return l.getScore(params.agentTool as any, params.agentVersion as string | undefined);
  }
  private async handleReputationBadge(params: Record<string, unknown>): Promise<unknown> {
    const { getReputationLedger } = await import('./reputation-ledger.js');
    const l = getReputationLedger(); await l.init();
    return { badge: l.badge(params.agentTool as any, params.agentVersion as string | undefined) };
  }
  private async handleDebateRun(params: Record<string, unknown>): Promise<unknown> {
    const { getSwarmDebate } = await import('./swarm-debate.js');
    return getSwarmDebate().debate(params.question as string, (params.context as string) ?? '', { turns: (params.turns as number) ?? 2 });
  }
  private async handlePremortemRun(params: Record<string, unknown>): Promise<unknown> {
    const { getPreMortem } = await import('./pre-mortem.js');
    return getPreMortem().run(params.taskDescription as string, (params.projectDir as string) ?? process.cwd());
  }
  private async handleBranchState(params: Record<string, unknown>): Promise<unknown> {
    const { getBranchBrain } = await import('./branch-brain.js');
    return getBranchBrain().getState((params.projectDir as string) ?? process.cwd());
  }
  private async handleAttentionHeatmap(params: Record<string, unknown>): Promise<unknown> {
    const { getAttentionHeatmap } = await import('./attention-heatmap.js');
    return getAttentionHeatmap().compute({
      decisionText: params.decisionText as string,
      candidateMemoryIds: (params.candidateMemoryIds as string[]) ?? [],
      agentTool: (params.agentTool as any) ?? 'claude-code',
    });
  }
  private async handleTokensRecord(params: Record<string, unknown>): Promise<unknown> {
    const { getTokenEconomy } = await import('./token-economy.js');
    return getTokenEconomy().record({
      agentTool: params.agentTool as any,
      model: params.model as string,
      inputTokens: params.inputTokens as number,
      outputTokens: params.outputTokens as number,
      taskCategory: params.taskCategory as string | undefined,
    });
  }
  private async handleTokensReport(_params: Record<string, unknown>): Promise<unknown> {
    const { getTokenEconomy } = await import('./token-economy.js');
    return getTokenEconomy().report();
  }
  private async handleForgetConsolidate(_params: Record<string, unknown>): Promise<unknown> {
    const { getForgettingCurve } = await import('./forgetting-curve.js');
    return getForgettingCurve().runConsolidation();
  }
  private async handleFormalGenerate(params: Record<string, unknown>): Promise<unknown> {
    const { getFormalBridge } = await import('./formal-verification-bridge.js');
    return getFormalBridge().generateFromText(params.text as string, params.sourceId as string | undefined);
  }
  private async handleCalibrationRecord(params: Record<string, unknown>): Promise<unknown> {
    const { getCalibrationMonitor } = await import('./calibration-monitor.js');
    return getCalibrationMonitor().record({
      agentTool: params.agentTool as any,
      category: params.category as string,
      claim: params.claim as string,
      claimedConfidence: params.claimedConfidence as number,
      actualOutcome: params.actualOutcome as any,
      outcomeAt: new Date(),
    });
  }
  private async handleCalibrationScores(_params: Record<string, unknown>): Promise<unknown> {
    const { getCalibrationMonitor } = await import('./calibration-monitor.js');
    const m = getCalibrationMonitor(); await m.init();
    return m.listScores();
  }
  private async handleAirGapStatus(_params: Record<string, unknown>): Promise<unknown> {
    const { getAirGapMode } = await import('./air-gap.js');
    const a = getAirGapMode(); await a.init();
    return a.status();
  }
  private async handleAirGapEnable(params: Record<string, unknown>): Promise<unknown> {
    const { getAirGapMode } = await import('./air-gap.js');
    await getAirGapMode().enable((params.policy as any) ?? 'strict');
    return { ok: true };
  }
  private async handleAirGapDisable(_params: Record<string, unknown>): Promise<unknown> {
    const { getAirGapMode } = await import('./air-gap.js');
    await getAirGapMode().disable();
    return { ok: true };
  }
  private async handleQuarantineList(params: Record<string, unknown>): Promise<unknown> {
    const { getHallucinationQuarantine } = await import('./hallucination-quarantine.js');
    const q = getHallucinationQuarantine(); await q.init();
    return q.list({ pendingOnly: params.pendingOnly as boolean | undefined });
  }
  private async handleQuarantinePromote(params: Record<string, unknown>): Promise<unknown> {
    const { getHallucinationQuarantine } = await import('./hallucination-quarantine.js');
    return { ok: await getHallucinationQuarantine().promote(params.id as string, params.projectId as string, (params.agentTool as string) ?? 'claude-code') };
  }
  private async handleVoiceProcess(params: Record<string, unknown>): Promise<unknown> {
    const { getVoiceMode } = await import('./voice-mode.js');
    return getVoiceMode().process({ transcript: params.transcript as string, confidence: params.confidence as number | undefined, projectDir: params.projectDir as string | undefined });
  }
  private async handleGardenSnapshot(params: Record<string, unknown>): Promise<unknown> {
    const { getBrainGarden } = await import('./brain-garden.js');
    return getBrainGarden().snapshot((params.limit as number) ?? 100);
  }
  private async handlePRReviewGenerate(params: Record<string, unknown>): Promise<unknown> {
    const { getPRAutoReview } = await import('./pr-auto-review.js');
    return getPRAutoReview().generate({
      repo: params.repo as string,
      prNumber: params.prNumber as number,
      projectDir: (params.projectDir as string) ?? process.cwd(),
      diffSummary: params.diffSummary as string,
      changedFiles: (params.changedFiles as string[]) ?? [],
    });
  }
  private async handleExchangeExport(params: Record<string, unknown>): Promise<unknown> {
    const { getBrainExchange } = await import('./brain-exchange.js');
    return getBrainExchange().export({
      name: params.name as string,
      description: (params.description as string) ?? '',
      author: (params.author as string) ?? 'anonymous',
      categories: params.categories as string[] | undefined,
      tags: params.tags as string[] | undefined,
      limit: params.limit as number | undefined,
      minImportance: params.minImportance as number | undefined,
    });
  }
  private async handleExchangeImport(params: Record<string, unknown>): Promise<unknown> {
    const { getBrainExchange } = await import('./brain-exchange.js');
    return getBrainExchange().import(params.filePath as string, { projectDir: (params.projectDir as string) ?? process.cwd(), agentTool: params.agentTool as string | undefined });
  }
  private async handleExchangeList(_params: Record<string, unknown>): Promise<unknown> {
    const { getBrainExchange } = await import('./brain-exchange.js');
    return getBrainExchange().listLocal();
  }
  private async handleHiveStatus(_params: Record<string, unknown>): Promise<unknown> {
    const [
      { getSubAgentBridge },
      { getCausalChains },
      { getCollisionDetective },
      { getDreamEngine },
      { getReputationLedger },
      { getTokenEconomy },
      { getFormalBridge },
      { getAirGapMode },
      { getGlobalBrain },
    ] = await Promise.all([
      import('./subagent-bridge.js'),
      import('./causal-chains.js'),
      import('./collision-detective.js'),
      import('./dream-engine.js'),
      import('./reputation-ledger.js'),
      import('./token-economy.js'),
      import('./formal-verification-bridge.js'),
      import('./air-gap.js'),
      import('./global-brain.js'),
    ]);
    const sabb = getSubAgentBridge();
    const causal = getCausalChains();
    const collisions = getCollisionDetective();
    const dream = getDreamEngine();
    const rep = getReputationLedger();
    const tokens = getTokenEconomy();
    const formal = getFormalBridge();
    const airgap = getAirGapMode();
    const brain = getGlobalBrain();
    await Promise.all([sabb.init(), causal.init(), collisions.init(), dream.init(), rep.init(), tokens.init(), formal.init(), airgap.init(), brain.init()]);
    return {
      version: '6.0.0',
      modules: {
        sabb: sabb.getStats(),
        causal: causal.stats(),
        collision: collisions.getStats(),
        dream: dream.getStats(),
        reputation: rep.stats(),
        tokenEconomy: await tokens.report(),
        formalBridge: formal.stats(),
        airGap: airgap.status(),
      },
      localFirst: true,
      totalAgentsConnected: brain.getStats().totalAgents,
      totalMemoriesStored: brain.getStats().totalEntries,
      generatedAt: new Date(),
    };
  }

  // v5.2.0 handlers
  private async handleSubconsciousInject(params: Record<string, unknown>): Promise<unknown> {
    const { getSubconscious } = await import('./subconscious.js');
    const { GlobalBrain } = await import('./global-brain.js');
    const projectDir = (params.projectDir as string) || process.cwd();
    const agentTool = (params.agentTool as any) || 'claude-code';
    const briefing = await getSubconscious().generateBriefing({
      agentTool,
      projectDir,
      projectId: GlobalBrain.projectIdFor(projectDir),
      currentTask: params.currentTask as string | undefined,
    });
    return briefing;
  }

  private async handleGlobalRecall(params: Record<string, unknown>): Promise<unknown> {
    const { getGlobalBrain } = await import('./global-brain.js');
    const brain = getGlobalBrain();
    await brain.init();
    return brain.recall({
      projectId: params.projectId as string | undefined,
      agentTool: params.agentTool as any,
      category: params.category as string | undefined,
      keywords: params.keywords as string[] | undefined,
      limit: (params.limit as number) ?? 20,
      minImportance: params.minImportance as number | undefined,
    });
  }

  private async handleGlobalStats(_params: Record<string, unknown>): Promise<unknown> {
    const { getGlobalBrain } = await import('./global-brain.js');
    const { getAllCacheStats } = await import('./l0-cache.js');
    const brain = getGlobalBrain();
    await brain.init();
    return {
      brain: brain.getStats(),
      caches: getAllCacheStats(),
    };
  }

  private async handleAttachStatus(params: Record<string, unknown>): Promise<unknown> {
    const { getHookInstaller } = await import('./session-hooks.js');
    const projectDir = (params.projectDir as string) || process.cwd();
    const detected = await getHookInstaller().detectInstalled(projectDir);
    return { detected, projectDir };
  }

  private async handleGlobalTimeline(params: Record<string, unknown>): Promise<unknown> {
    const { getGlobalBrain, GlobalBrain } = await import('./global-brain.js');
    const projectDir = params.projectDir as string | undefined;
    const brain = getGlobalBrain();
    await brain.init();
    return brain.timeline({
      projectId: projectDir ? GlobalBrain.projectIdFor(projectDir) : params.projectId as string | undefined,
      agentTool: params.agentTool as any,
      category: params.category as string | undefined,
      limit: (params.limit as number) ?? 30,
    });
  }

  private async handleFirewallCheck(params: Record<string, unknown>): Promise<unknown> {
    const { AgentFirewall } = await import('./agent-firewall.js');
    return new AgentFirewall().check({
      command: params.command as string | undefined,
      filePath: params.filePath as string | undefined,
      url: params.url as string | undefined,
      content: params.content as string | undefined,
      toolName: params.toolName as string | undefined,
    });
  }

  private async handleAgentHandoff(params: Record<string, unknown>): Promise<unknown> {
    const { AgentHandoff } = await import('./agent-handoff.js');
    const projectDir = (params.projectDir as string) || process.cwd();
    return new AgentHandoff().generate({
      fromAgent: (params.fromAgent as any) || 'cursor',
      toAgent: (params.toAgent as any) || 'codex',
      projectDir,
      task: params.task as string | undefined,
      limit: (params.limit as number) ?? 12,
    });
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (!req.url) {
        this.sendJSON(res, 400, { error: 'Missing URL' });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      const origin = req.headers.origin;
      const allowedOrigin = this.options.corsOrigin;
      if (!origin || allowedOrigin === origin || allowedOrigin === '*') {
        res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
      }
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Shadow-Brain-Token');
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!this.isAuthorized(req)) {
        this.sendJSON(res, 401, {
          error: 'Unauthorized',
          message: 'Set SHADOW_BRAIN_MCP_TOKEN or pass --auth-token, then send Bearer or X-Shadow-Brain-Token.',
        });
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/mcp' || url.pathname === '/')) {
        await this.handleHTTPMCPRequest(req, res);
      } else if (req.method === 'GET' && url.pathname === '/sse') {
        this.handleSSEConnection(req, res);
      } else if (req.method === 'GET' && url.pathname === '/health') {
        // Lightweight health endpoint for tool connectivity checks
        this.sendJSON(res, 200, {
          status: 'ok',
          version: '5.2.0',
          uptime: process.uptime(),
          tools: Object.keys(this.toolHandlers).length,
        });
      } else if (req.method === 'POST' && url.pathname === '/v1/chat') {
        // Cursor compatibility — some versions POST to /v1/chat
        await this.handleHTTPMCPRequest(req, res);
      } else {
        this.sendJSON(res, 404, {
          error: 'Not found',
          endpoints: {
            'POST /mcp': 'JSON-RPC 2.0 MCP handler',
            'POST /': 'JSON-RPC 2.0 MCP handler (root path for Cursor)',
            'POST /v1/chat': 'Cursor compatibility endpoint',
            'GET /sse': 'Server-Sent Events for real-time updates',
            'GET /health': 'Health check endpoint',
          },
        });
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port, this.options.host, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const [id, client] of this.sseClients) {
      try {
        client.res.write('event: close\ndata: {"reason":"server shutting down"}\n\n');
        client.res.end();
      } catch {
        // client may have already disconnected
      }
    }
    this.sseClients.clear();

    if (this.server) {
      return new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          this.server = null;
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    if (request.jsonrpc !== '2.0') {
      return this.makeError(request.id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
    }

    const { method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.makeResult(request.id, this.handleInitialize());

        case 'notifications/initialized':
          // Cursor sends this after initialize — acknowledge silently
          return this.makeResult(request.id, {});

        case 'tools/list':
          return this.makeResult(request.id, { tools: this.getToolDefinitions() });

        case 'resources/list':
          return this.makeResult(request.id, { resources: [] });

        case 'prompts/list':
          return this.makeResult(request.id, { prompts: [] });

        case 'tools/call': {
          const toolName = params?.name as string;
          const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};

          if (!toolName) {
            return this.makeError(request.id, -32602, 'Missing tool name in params.name');
          }

          const handler = this.toolHandlers[toolName];
          if (!handler) {
            return this.makeError(request.id, -32601, `Unknown tool: ${toolName}`);
          }

          const result = await handler(toolArgs);
          return this.makeResult(request.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        }

        default:
          return this.makeError(request.id, -32601, `Method not found: ${method}`);
      }
    } catch (err: any) {
      return this.makeError(request.id, -32603, `Internal error: ${err.message}`);
    }
  }

  // ── Tool Handlers ──────────────────────────────────────────────────────

  private handleInitialize(): object {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
        logging: {},
      },
      serverInfo: {
        name: 'agent-shadow-brain',
        version: '5.2.0',
        description: 'Cross-agent memory and safety layer for AI coding agents',
      },
    };
  }

  private async handleAnalyze(params: Record<string, unknown>): Promise<unknown> {
    const maxFiles = (params.maxFiles as number) ?? 50;
    const insights = await this.orchestrator.reviewOnce();
    return {
      insightCount: insights.length,
      insights: insights.slice(0, maxFiles).map((i: any) => ({
        type: i.type,
        priority: i.priority,
        title: i.title,
        content: i.content,
        files: i.files ?? [],
        timestamp: i.timestamp?.toISOString?.() ?? i.timestamp,
      })),
    };
  }

  private async handleHealth(params: Record<string, unknown>): Promise<unknown> {
    const healthScore = await this.orchestrator.getHealthScore();
    const currentScore = healthScore.overall;

    if (this.lastHealthScore !== null && Math.abs(currentScore - this.lastHealthScore) >= 5) {
      this.broadcastSSE('health-change', {
        previous: this.lastHealthScore,
        current: currentScore,
        grade: healthScore.grade,
        trend: healthScore.trend,
      });
    }
    this.lastHealthScore = currentScore;

    return {
      overall: healthScore.overall,
      grade: healthScore.grade,
      trend: healthScore.trend,
      dimensions: healthScore.dimensions,
      topIssues: healthScore.topIssues,
      timestamp: healthScore.timestamp?.toISOString?.() ?? healthScore.timestamp,
    };
  }

  private async handleFixes(params: Record<string, unknown>): Promise<unknown> {
    const fixes = await this.orchestrator.getSmartFixes();
    return {
      count: fixes.length,
      fixes: fixes.map((f: any) => ({
        file: f.file,
        issue: f.issue,
        before: f.before,
        after: f.after,
        explanation: f.explanation,
        confidence: f.confidence,
        category: f.category,
      })),
    };
  }

  private async handleMetrics(params: Record<string, unknown>): Promise<unknown> {
    const metrics = await this.orchestrator.computeMetrics();
    return {
      totalFiles: metrics.totalFiles,
      totalLines: metrics.totalLines,
      codeLines: metrics.codeLines,
      commentLines: metrics.commentLines,
      blankLines: metrics.blankLines,
      languages: metrics.languages,
      largestFiles: metrics.largestFiles,
      complexityHotspots: metrics.complexityHotspots,
      avgFileSize: metrics.avgFileSize,
    };
  }

  private async handleSemantic(params: Record<string, unknown>): Promise<unknown> {
    const maxFiles = (params.maxFiles as number) ?? 100;
    const result = await this.orchestrator.getSemanticInsights(maxFiles);

    const symbolsObj: Record<string, unknown[]> = {};
    if (result.symbols instanceof Map) {
      for (const [file, syms] of result.symbols) {
        symbolsObj[file] = syms;
      }
    }

    return {
      symbolCount: result.symbols instanceof Map ? Array.from((result.symbols as Map<string, SymbolInfo[]>).values()).reduce((sum: number, s: SymbolInfo[]) => sum + s.length, 0) : 0,
      symbols: symbolsObj,
      unusedExports: result.unusedExports,
      deadCode: result.deadCode,
    };
  }

  private async handleDeps(params: Record<string, unknown>): Promise<unknown> {
    const graph = await this.orchestrator.getDependencyGraph();
    const details = this.orchestrator.getDependencyDetails(graph);

    return {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes,
      edges: graph.edges,
      orphans: details.orphans,
      cycles: details.cycles,
      hubs: details.hubs,
    };
  }

  private async handleLearn(params: Record<string, unknown>): Promise<unknown> {
    await this.orchestrator.runLearningCycle();
    const lessons = await this.orchestrator.getLearnedLessons();

    return {
      status: 'completed',
      lessonCount: lessons.length,
      lessons: lessons,
    };
  }

  private async handleMemory(params: Record<string, unknown>): Promise<unknown> {
    const action = (params.action as string) ?? 'stats';
    const hm = this.orchestrator.hierarchicalMemory;

    if (!hm) return { error: 'Hierarchical memory not initialized' };

    switch (action) {
      case 'stats':
        return hm.getStats?.() || { entries: 0 };
      case 'store': {
        const { content, category, importance } = params;
        const id = hm.store?.(content as string, category as string, (importance as number) ?? 0.5);
        return { id, stored: true };
      }
      case 'retrieve': {
        const { tier, limit } = params;
        const entries = hm.getByTier?.(tier as string) || [];
        return { entries: entries.slice(0, (limit as number) ?? 50) };
      }
      case 'search': {
        const { query, topK } = params;
        // Use context recall for semantic search
        const cr = this.orchestrator.contextRecall;
        if (cr) {
          const results = cr.recall({ keywords: (query as string).split(' ') }, (topK as number) ?? 10);
          return { results };
        }
        return { results: [] };
      }
      default:
        return { error: `Unknown memory action: ${action}` };
    }
  }

  private async handleRecall(params: Record<string, unknown>): Promise<unknown> {
    const context = {
      currentFile: params.file as string | undefined,
      currentCategory: params.category as string | undefined,
      projectType: params.projectType as string | undefined,
      keywords: (params.keywords as string[]) || [],
    };

    const cr = this.orchestrator.contextRecall;
    if (!cr) return { results: [], error: 'Context recall not initialized' };

    const results = cr.recall(context, (params.topK as number) ?? 20);
    return {
      count: results.length,
      results: results.map((r: any) => ({
        content: r.entry?.content?.slice(0, 200),
        relevanceScore: r.relevanceScore,
        triggers: r.activatedTriggers?.slice(0, 5),
      })),
    };
  }

  private async handleConsensus(params: Record<string, unknown>): Promise<unknown> {
    const ce = this.orchestrator.consensusEngine;
    if (!ce) return { error: 'Consensus engine not initialized' };

    const action = (params.action as string) ?? 'stats';

    switch (action) {
      case 'stats':
        return ce.getStats?.() || {};
      case 'propose': {
        const id = ce.propose?.(
          params.content as string,
          params.category as string,
          (params.confidence as number) ?? 0.5,
          (params.evidence as string[]) || []
        );
        return { proposalId: id };
      }
      case 'trust':
        return ce.getTrustScores?.() || [];
      default:
        return { error: `Unknown consensus action: ${action}` };
    }
  }

  private async handleTurbo(params: Record<string, unknown>): Promise<unknown> {
    const tm = this.orchestrator.turboMemory;
    if (!tm) return { error: 'TurboMemory not initialized' };

    const action = (params.action as string) ?? 'stats';

    switch (action) {
      case 'stats':
        return tm.stats?.() || {};
      case 'search': {
        const results = tm.search?.(params.query as string, (params.topK as number) ?? 10);
        return { results: results || [] };
      }
      default:
        return { error: `Unknown turbo action: ${action}` };
    }
  }

  private async handleSwarm(params: Record<string, unknown>): Promise<unknown> {
    const si = this.orchestrator.swarmIntelligence;
    if (!si) return { error: 'Swarm intelligence not initialized' };

    const action = (params.action as string) ?? 'state';

    switch (action) {
      case 'state':
        return si.getState?.() || {};
      case 'priorities': {
        const files = si.getHighPriorityFiles?.((params.count as number) ?? 10);
        return { files: files || [] };
      }
      default:
        return { error: `Unknown swarm action: ${action}` };
    }
  }

  private async handleEvolution(params: Record<string, unknown>): Promise<unknown> {
    const se = this.orchestrator.selfEvolution;
    if (!se) return { error: 'Self-evolution not initialized' };

    const action = (params.action as string) ?? 'snapshot';

    switch (action) {
      case 'snapshot':
        return se.getSnapshot?.() || {};
      case 'best_rules': {
        const rules = se.getBestRules?.((params.category as string) ?? 'all', (params.count as number) ?? 10);
        return { rules: rules || [] };
      }
      default:
        return { error: `Unknown evolution action: ${action}` };
    }
  }

  private async handleKnowledgeGraph(params: Record<string, unknown>): Promise<unknown> {
    const kg = this.orchestrator.knowledgeGraph;
    if (!kg) return { error: 'Knowledge graph not initialized' };

    const action = (params.action as string) ?? 'stats';

    switch (action) {
      case 'stats':
        return kg.getStats?.() || {};
      case 'top_entities': {
        const entities = kg.getTopEntities?.((params.count as number) ?? 20);
        return { entities: entities || [] };
      }
      default:
        return { error: `Unknown knowledge graph action: ${action}` };
    }
  }

  private async handlePredict(params: Record<string, unknown>): Promise<unknown> {
    const pe = this.orchestrator.predictiveEngine;
    if (!pe) return { error: 'Predictive engine not initialized' };

    return {
      predictionAvailable: true,
      note: 'Use the predict CLI command for full bug/debt risk scoring',
    };
  }

  private async handleAsk(params: Record<string, unknown>): Promise<unknown> {
    const query = params.query as string;
    if (!query) return { error: 'Missing query parameter' };

    // Natural language query — combine recall + search
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const results: unknown[] = [];

    // Context recall
    const cr = this.orchestrator.contextRecall;
    if (cr) {
      const recallResults = cr.recall({ keywords }, 10);
      for (const r of recallResults.slice(0, 5)) {
        results.push({
          source: 'memory',
          content: r.entry?.content?.slice(0, 300),
          relevance: r.relevanceScore,
        });
      }
    }

    // Pattern memory
    const pm = this.orchestrator.patternMemory;
    if (pm) {
      const patterns = pm.getPatternInsights?.(keywords.join(' '));
      if (patterns) {
        for (const p of patterns.slice(0, 3)) {
          results.push({ source: 'pattern', content: p });
        }
      }
    }

    return {
      query,
      resultCount: results.length,
      results,
    };
  }

  private async handleStatus(params: Record<string, unknown>): Promise<unknown> {
    const status = this.orchestrator.getStatus?.() || {};
    return {
      version: '5.2.0',
      ...status,
    };
  }

  private async handleModules(params: Record<string, unknown>): Promise<unknown> {
    const status = this.orchestrator.getStatus?.() || {};
    const modules: Array<{ name: string; version: string; status: string; details?: unknown }> = [];

    const moduleList = [
      { key: 'hierarchicalMemory', name: 'Hierarchical Memory' },
      { key: 'patternMemory', name: 'Pattern Memory' },
      { key: 'learningEngine', name: 'Learning Engine' },
      { key: 'neuralMesh', name: 'Neural Mesh' },
      { key: 'consensusEngine', name: 'Consensus Engine' },
      { key: 'contextRecall', name: 'Context Recall' },
      { key: 'turboMemory', name: 'TurboMemory' },
      { key: 'ssspRouter', name: 'SSSP Router' },
      { key: 'selfEvolution', name: 'Self Evolution' },
      { key: 'predictiveEngine', name: 'Predictive Engine' },
      { key: 'knowledgeGraph', name: 'Knowledge Graph' },
      { key: 'swarmIntelligence', name: 'Swarm Intelligence' },
      { key: 'adversarialDefense', name: 'Adversarial Defense' },
    ];

    for (const mod of moduleList) {
      const instance = (this.orchestrator as Record<string, unknown>)[mod.key];
      modules.push({
        name: mod.name,
        version: '5.2.0',
        status: instance ? 'active' : 'idle',
      });
    }

    return { modules, totalModules: modules.length, activeModules: modules.filter(m => m.status === 'active').length };
  }

  private async handleAutoConfig(params: Record<string, unknown>): Promise<unknown> {
    // Trigger auto-detection — useful for MCP tools to discover project info
    try {
      const { AutoSetup } = await import('./auto-setup.js');
      const setup = new AutoSetup(this.orchestrator.config?.projectDir || process.cwd());
      const result = await setup.detect();
      return {
        project: result.projectName,
        type: result.projectType,
        languages: result.languages,
        frameworks: result.frameworks,
        aiTools: result.aiTools.filter(t => t.detected).map(t => t.name),
        packageManager: result.packageManager,
      };
    } catch {
      return { error: 'Auto-setup module not available' };
    }
  }

  // ── Tool Definitions ───────────────────────────────────────────────────

  private getToolDefinitions(): MCPTool[] {
    return [
      {
        name: 'analyze',
        description: 'Run full analysis on project files and return insights',
        inputSchema: {
          type: 'object',
          properties: {
            maxFiles: { type: 'number', description: 'Maximum number of insights to return (default: 50)' },
          },
        },
      },
      {
        name: 'health',
        description: 'Get the current project health score with detailed breakdown',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'fixes',
        description: 'Get smart fix suggestions for current code issues',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'metrics',
        description: 'Get code metrics: LOC, complexity, language breakdown',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'semantic',
        description: 'Get semantic analysis: symbols, unused exports, dead code',
        inputSchema: {
          type: 'object',
          properties: {
            maxFiles: { type: 'number', description: 'Maximum files to analyze (default: 100)' },
          },
        },
      },
      {
        name: 'deps',
        description: 'Get dependency graph: imports, cycles, orphans, hubs',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'learn',
        description: 'Run a learning cycle to extract patterns and lessons from the project',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'memory',
        description: 'Manage infinite hierarchical memory — store, retrieve, search, stats',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['stats', 'store', 'retrieve', 'search'], description: 'Action to perform (default: stats)' },
            content: { type: 'string', description: 'Content to store (for store action)' },
            category: { type: 'string', description: 'Category for storage/retrieval' },
            importance: { type: 'number', description: 'Importance 0-1 (for store action)' },
            tier: { type: 'string', enum: ['raw', 'summary', 'pattern', 'principle'], description: 'Memory tier to retrieve' },
            query: { type: 'string', description: 'Search query (for search action)' },
            topK: { type: 'number', description: 'Max results to return' },
          },
        },
      },
      {
        name: 'recall',
        description: 'Context-triggered associative recall — activate memories based on current work context',
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Current file being edited' },
            category: { type: 'string', description: 'Current work category' },
            projectType: { type: 'string', description: 'Project type' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords from current context' },
            topK: { type: 'number', description: 'Max results (default: 20)' },
          },
        },
      },
      {
        name: 'consensus',
        description: 'Multi-agent consensus protocol — propose, vote, trust scores',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['stats', 'propose', 'trust'], description: 'Action (default: stats)' },
            content: { type: 'string', description: 'Proposal content (for propose action)' },
            category: { type: 'string', description: 'Proposal category' },
            confidence: { type: 'number', description: 'Confidence 0-1' },
          },
        },
      },
      {
        name: 'turbo',
        description: 'TurboQuant 6x compressed vector memory — stats and semantic search',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['stats', 'search'], description: 'Action (default: stats)' },
            query: { type: 'string', description: 'Search query' },
            topK: { type: 'number', description: 'Max results' },
          },
        },
      },
      {
        name: 'swarm',
        description: 'Swarm intelligence (Ant Colony) — file prioritization via pheromone trails',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['state', 'priorities'], description: 'Action (default: state)' },
            count: { type: 'number', description: 'Number of priority files (default: 10)' },
          },
        },
      },
      {
        name: 'evolution',
        description: 'Self-evolving genetic rules — view evolution snapshot and best rules',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['snapshot', 'best_rules'], description: 'Action (default: snapshot)' },
            category: { type: 'string', description: 'Category for best rules' },
            count: { type: 'number', description: 'Number of rules to return' },
          },
        },
      },
      {
        name: 'knowledge_graph',
        description: 'Knowledge graph with PageRank — code entity importance and relationships',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['stats', 'top_entities'], description: 'Action (default: stats)' },
            count: { type: 'number', description: 'Number of entities to return' },
          },
        },
      },
      {
        name: 'predict',
        description: 'Predictive bug forecasting — check bug risk and debt predictions',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'ask',
        description: 'Natural language query — ask the brain anything about the project',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language question about the project' },
          },
          required: ['query'],
        },
      },
      {
        name: 'status',
        description: 'Get full Shadow Brain status — version, modules, health, stats',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'modules',
        description: 'List all brain modules with their activation status',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'auto_config',
        description: 'Auto-detect project configuration — languages, frameworks, AI tools',
        inputSchema: { type: 'object', properties: {} },
      },
      // v5.2.0 — Subconscious Singularity
      {
        name: 'subconscious_inject',
        description: 'Generate a session-start briefing — proactive context injection for the agent (v5.2.0)',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: { type: 'string', description: 'Project directory (defaults to cwd)' },
            agentTool: { type: 'string', description: 'Agent tool name (claude-code, cursor, cline, etc.)' },
            currentTask: { type: 'string', description: 'Optional task hint for similarity search' },
          },
        },
      },
      {
        name: 'global_recall',
        description: 'Recall from the singleton global brain — works across all projects + all agents (v5.2.0)',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            agentTool: { type: 'string' },
            category: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number' },
            minImportance: { type: 'number' },
          },
        },
      },
      {
        name: 'global_stats',
        description: 'Get global brain + L0 cache stats (v5.2.0)',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'attach_status',
        description: 'Detect which AI agents are installed on this machine (v5.2.0)',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: { type: 'string' },
          },
        },
      },
      {
        name: 'global_timeline',
        description: 'Show the proof timeline of what agents learned and when (v5.2.0)',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: { type: 'string' },
            projectId: { type: 'string' },
            agentTool: { type: 'string' },
            category: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
      {
        name: 'firewall_check',
        description: 'Agent Safety Firewall — check a command, file path, URL, or prompt before the agent acts',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            filePath: { type: 'string' },
            url: { type: 'string' },
            content: { type: 'string' },
            toolName: { type: 'string' },
          },
        },
      },
      {
        name: 'agent_handoff',
        description: 'Create a cross-agent continuation packet from one AI coding agent to another',
        inputSchema: {
          type: 'object',
          properties: {
            fromAgent: { type: 'string' },
            toAgent: { type: 'string' },
            projectDir: { type: 'string' },
            task: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
    ];
  }

  // ── HTTP Handling ──────────────────────────────────────────────────────

  private async handleHTTPMCPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readRequestBody(req);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJSON(res, 200, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      });
      return;
    }

    if (Array.isArray(parsed)) {
      const results = await Promise.all(
        parsed.map((r) => this.handleRequest(r as MCPRequest)),
      );
      this.sendJSON(res, 200, results);
      return;
    }

    const response = await this.handleRequest(parsed as MCPRequest);
    this.sendJSON(res, 200, response);
  }

  private handleSSEConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
    const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': this.options.corsOrigin,
    });

    res.write(`event: connected\ndata: {"clientId":"${clientId}","version":"5.2.0"}\n\n`);

    const client: SSEClient = { res, id: clientId };
    this.sseClients.set(clientId, client);

    req.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    if (!this.options.authToken) return true;
    const auth = req.headers.authorization || '';
    const tokenHeader = req.headers['x-shadow-brain-token'];
    const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    return bearer === this.options.authToken || token === this.options.authToken;
  }

  private broadcastSSE(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const deadClients: string[] = [];

    for (const [id, client] of this.sseClients) {
      try {
        client.res.write(payload);
      } catch {
        deadClients.push(id);
      }
    }

    for (const id of deadClients) {
      this.sseClients.delete(id);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const maxSize = 10 * 1024 * 1024;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', reject);
    });
  }

  private sendJSON(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private makeResult(id: string | number | undefined, result: unknown): MCPResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private makeError(id: string | number | undefined, code: number, message: string, data?: unknown): MCPResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }
}
