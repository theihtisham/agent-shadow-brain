// src/brain/mcp-server.ts — JSON-RPC 2.0 MCP server over HTTP
// Exposes analysis tools via Model Context Protocol

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
    };
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (!req.url) {
        this.sendJSON(res, 400, { error: 'Missing URL' });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/mcp') {
        await this.handleHTTPMCPRequest(req, res);
      } else if (req.method === 'GET' && url.pathname === '/sse') {
        this.handleSSEConnection(req, res);
      } else {
        this.sendJSON(res, 404, {
          error: 'Not found',
          endpoints: {
            'POST /mcp': 'JSON-RPC 2.0 MCP handler',
            'GET /sse': 'Server-Sent Events for real-time updates',
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
    // Close all SSE clients
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
    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
      return this.makeError(request.id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
    }

    const { method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.makeResult(request.id, this.handleInitialize());

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
      },
      serverInfo: {
        name: 'agent-shadow-brain',
        version: '2.0.0',
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

    // Broadcast health change via SSE if score changed significantly
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

    // Convert Map to serializable object
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

  // ── Tool Definitions ───────────────────────────────────────────────────

  private getToolDefinitions(): MCPTool[] {
    return [
      {
        name: 'analyze',
        description: 'Run full analysis on project files and return insights',
        inputSchema: {
          type: 'object',
          properties: {
            maxFiles: {
              type: 'number',
              description: 'Maximum number of insights to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'health',
        description: 'Get the current project health score with detailed breakdown',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'fixes',
        description: 'Get smart fix suggestions for current code issues',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'metrics',
        description: 'Get code metrics: LOC, complexity, language breakdown',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'semantic',
        description: 'Get semantic analysis: symbols, unused exports, dead code',
        inputSchema: {
          type: 'object',
          properties: {
            maxFiles: {
              type: 'number',
              description: 'Maximum files to analyze (default: 100)',
            },
          },
        },
      },
      {
        name: 'deps',
        description: 'Get dependency graph: imports, cycles, orphans, hubs',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'learn',
        description: 'Run a learning cycle to extract patterns and lessons from the project',
        inputSchema: {
          type: 'object',
          properties: {},
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

    // Support batch requests
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

    // Send initial connection event
    res.write(`event: connected\ndata: {"clientId":"${clientId}"}\n\n`);

    const client: SSEClient = { res, id: clientId };
    this.sseClients.set(clientId, client);

    // Handle client disconnect
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
      const maxSize = 10 * 1024 * 1024; // 10 MB limit

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
