// src/brain/mcp-server.ts — JSON-RPC 2.0 MCP server over HTTP
// Exposes analysis tools via Model Context Protocol
// v5.0.1 — Infinite Intelligence Edition (Cursor + Claude Code + Kilo Code compatible)

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
    };
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (!req.url) {
        this.sendJSON(res, 400, { error: 'Missing URL' });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      // CORS headers — permissive for Cursor, Claude Code, and other AI tools
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
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
          version: '5.0.1',
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
        version: '5.0.1',
        description: 'World\'s #1 AI coding intelligence layer — infinite memory, multi-agent consensus, self-evolving',
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
      version: '5.0.1',
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
        version: '5.0.1',
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
      'Access-Control-Allow-Origin': '*',
    });

    res.write(`event: connected\ndata: {"clientId":"${clientId}","version":"5.0.1"}\n\n`);

    const client: SSEClient = { res, id: clientId };
    this.sseClients.set(clientId, client);

    req.on('close', () => {
      this.sseClients.delete(clientId);
    });
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
