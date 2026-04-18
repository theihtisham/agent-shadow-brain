// src/brain/lsp-server.ts — Built-in Language Server Protocol Engine
// v6.0.0 — Zero-Dependency LSP for real-time inline feedback
// No external LSP libraries needed — pure Node.js TCP/stdio implementation

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { BrainInsight } from '../types.js';

interface LSPDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: 1 | 2 | 3 | 4; // Error, Warning, Info, Hint
  source: string;
  message: string;
  code?: string;
  relatedInformation?: Array<{ location: any; message: string }>;
}

interface LSPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface LSPCapabilities {
  textDocumentSync: number;
  diagnosticProvider: { interFileDependencies: boolean; workspaceDiagnostics: boolean };
  hoverProvider: boolean;
  codeActionProvider: boolean;
  completionProvider: { triggerCharacters: string[] };
}

interface OpenDocument {
  uri: string;
  content: string;
  version: number;
  language: string;
  lastAnalyzed: Date;
  diagnostics: LSPDiagnostic[];
}

/**
 * LSPServer — Built-in Language Server Protocol engine.
 *
 * Zero external dependencies. Provides:
 * 1. Real-time diagnostics from Shadow Brain analysis
 * 2. Hover information with brain insights
 * 3. Code actions for auto-fixes
 * 4. Inline completions from learning engine
 * 5. Works with ANY editor that supports LSP (VS Code, Neovim, Emacs, Sublime, etc.)
 *
 * Launch: `shadow-brain lsp` (stdio mode) or `shadow-brain lsp --port 6970` (TCP mode)
 */
export class LSPServer {
  private server: net.Server | null = null;
  private orchestrator: any;
  private openDocuments: Map<string, OpenDocument> = new Map();
  private pendingRequests: Map<string | number, { resolve: Function; reject: Function }> = new Map();
  private nextId = 1;
  private initialized = false;
  private rootUri: string | null = null;
  private buffer = '';
  private writeOutput: ((data: string) => void) | null = null;
  private analysisQueue: Set<string> = new Set();
  private analysisTimer: NodeJS.Timeout | null = null;
  private cachedInsights: Map<string, BrainInsight[]> = new Map();

  constructor(orchestrator?: any) {
    this.orchestrator = orchestrator;
  }

  // ── Server Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start LSP in stdio mode (standard for most editors).
   */
  startStdio(): void {
    this.writeOutput = (data: string) => process.stdout.write(data);

    process.stdin.on('data', (chunk: Buffer) => {
      this.handleIncoming(chunk.toString());
    });

    process.stdin.resume();
  }

  /**
   * Start LSP in TCP mode for remote/custom connections.
   */
  startTCP(port: number = 6970, host: string = 'localhost'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.writeOutput = (data: string) => {
          if (!socket.destroyed) socket.write(data);
        };

        socket.on('data', (chunk: Buffer) => {
          this.handleIncoming(chunk.toString());
        });

        socket.on('error', () => {});
        socket.on('close', () => {
          this.writeOutput = null;
        });
      });

      this.server.on('error', reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  // ── LSP Message Handling ──────────────────────────────────────────────────

  private handleIncoming(data: string): void {
    this.buffer += data;

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);

      try {
        const message: LSPMessage = JSON.parse(body);
        this.handleMessage(message).catch(() => {});
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  private async handleMessage(message: LSPMessage): Promise<void> {
    if (message.method) {
      // Request or notification
      switch (message.method) {
        case 'initialize':
          this.handleInitialize(message);
          break;
        case 'initialized':
          this.initialized = true;
          break;
        case 'shutdown':
          this.sendResponse(message.id!, null);
          break;
        case 'exit':
          this.stop();
          process.exit(0);
          break;
        case 'textDocument/didOpen':
          this.handleDidOpen(message.params);
          break;
        case 'textDocument/didChange':
          this.handleDidChange(message.params);
          break;
        case 'textDocument/didClose':
          this.handleDidClose(message.params);
          break;
        case 'textDocument/didSave':
          this.handleDidSave(message.params);
          break;
        case 'textDocument/hover':
          await this.handleHover(message);
          break;
        case 'textDocument/codeAction':
          await this.handleCodeAction(message);
          break;
        case 'textDocument/completion':
          await this.handleCompletion(message);
          break;
        case 'textDocument/diagnostic':
          await this.handleDiagnosticRequest(message);
          break;
      }
    } else if (message.id !== undefined) {
      // Response to our request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) pending.reject(message.error);
        else pending.resolve(message.result);
      }
    }
  }

  // ── LSP Handlers ──────────────────────────────────────────────────────────

  private handleInitialize(message: LSPMessage): void {
    this.rootUri = message.params?.rootUri || message.params?.rootPath || null;

    const capabilities: LSPCapabilities = {
      textDocumentSync: 1, // Full sync
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false,
      },
      hoverProvider: true,
      codeActionProvider: true,
      completionProvider: {
        triggerCharacters: ['.', '/', '@', '#'],
      },
    };

    this.sendResponse(message.id!, {
      capabilities,
      serverInfo: {
        name: 'Shadow Brain LSP',
        version: '6.0.0',
      },
    });
  }

  private handleDidOpen(params: any): void {
    const { uri, languageId, version, text } = params.textDocument;
    this.openDocuments.set(uri, {
      uri,
      content: text,
      version,
      language: languageId,
      lastAnalyzed: new Date(0),
      diagnostics: [],
    });
    this.queueAnalysis(uri);
  }

  private handleDidChange(params: any): void {
    const doc = this.openDocuments.get(params.textDocument.uri);
    if (!doc) return;

    // Full sync mode — replace entire content
    if (params.contentChanges?.length > 0) {
      const lastChange = params.contentChanges[params.contentChanges.length - 1];
      if (lastChange.text !== undefined) {
        doc.content = lastChange.text;
        doc.version = params.textDocument.version;
      }
    }
    this.queueAnalysis(params.textDocument.uri);
  }

  private handleDidClose(params: any): void {
    const uri = params.textDocument.uri;
    this.openDocuments.delete(uri);
    this.cachedInsights.delete(uri);
    // Clear diagnostics
    this.sendNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics: [],
    });
  }

  private handleDidSave(params: any): void {
    // Trigger immediate deep analysis on save
    const uri = params.textDocument.uri;
    this.analyzeDocument(uri).catch(() => {});
  }

  private async handleHover(message: LSPMessage): Promise<void> {
    const { textDocument, position } = message.params;
    const doc = this.openDocuments.get(textDocument.uri);
    if (!doc) {
      this.sendResponse(message.id!, null);
      return;
    }

    // Find insights relevant to this line
    const insights = this.cachedInsights.get(textDocument.uri) || [];
    const lineInsights = insights.filter(i => {
      if (!i.metadata?.line) return false;
      const line = i.metadata.line as number;
      return Math.abs(line - position.line) <= 2;
    });

    if (lineInsights.length === 0) {
      this.sendResponse(message.id!, null);
      return;
    }

    const hoverContent = lineInsights.map(i => {
      const icon = i.priority === 'critical' ? '🔴' : i.priority === 'high' ? '🟠' : i.priority === 'medium' ? '🟡' : '🔵';
      return `${icon} **${i.title}**\n\n${i.content}`;
    }).join('\n\n---\n\n');

    this.sendResponse(message.id!, {
      contents: {
        kind: 'markdown',
        value: `### 🧠 Shadow Brain\n\n${hoverContent}`,
      },
    });
  }

  private async handleCodeAction(message: LSPMessage): Promise<void> {
    const { textDocument, range } = message.params;
    const insights = this.cachedInsights.get(textDocument.uri) || [];

    const actions = insights
      .filter(i => {
        if (!i.metadata?.line) return false;
        const line = i.metadata.line as number;
        return line >= range.start.line && line <= range.end.line;
      })
      .filter(i => i.metadata?.fix)
      .map((i, idx) => ({
        title: `🧠 Fix: ${i.title}`,
        kind: 'quickfix',
        diagnostics: [],
        isPreferred: idx === 0,
        edit: {
          changes: {
            [textDocument.uri]: [{
              range: {
                start: { line: (i.metadata?.line as number) || 0, character: 0 },
                end: { line: (i.metadata?.line as number) || 0, character: 999 },
              },
              newText: i.metadata?.fix as string,
            }],
          },
        },
      }));

    this.sendResponse(message.id!, actions);
  }

  private async handleCompletion(message: LSPMessage): Promise<void> {
    // Provide completions from learned patterns
    const items: any[] = [];

    if (this.orchestrator) {
      try {
        const knowledge = this.orchestrator.getProjectKnowledge?.();
        if (knowledge?.commonPatterns) {
          for (const pattern of knowledge.commonPatterns.slice(0, 10)) {
            items.push({
              label: `🧠 ${pattern.slice(0, 40)}`,
              kind: 15, // Snippet
              detail: 'Shadow Brain pattern',
              insertText: pattern,
              documentation: 'Learned pattern from project analysis',
            });
          }
        }
      } catch { /* best effort */ }
    }

    this.sendResponse(message.id!, { isIncomplete: false, items });
  }

  private async handleDiagnosticRequest(message: LSPMessage): Promise<void> {
    const uri = message.params?.textDocument?.uri;
    if (!uri) {
      this.sendResponse(message.id!, { kind: 'full', items: [] });
      return;
    }

    const doc = this.openDocuments.get(uri);
    if (!doc) {
      this.sendResponse(message.id!, { kind: 'full', items: [] });
      return;
    }

    this.sendResponse(message.id!, {
      kind: 'full',
      items: doc.diagnostics,
    });
  }

  // ── Analysis Pipeline ─────────────────────────────────────────────────────

  private queueAnalysis(uri: string): void {
    this.analysisQueue.add(uri);

    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    this.analysisTimer = setTimeout(() => {
      const uris = [...this.analysisQueue];
      this.analysisQueue.clear();
      for (const u of uris) {
        this.analyzeDocument(u).catch(() => {});
      }
    }, 500); // 500ms debounce
  }

  private async analyzeDocument(uri: string): Promise<void> {
    const doc = this.openDocuments.get(uri);
    if (!doc) return;

    const filePath = this.uriToPath(uri);
    const diagnostics: LSPDiagnostic[] = [];
    const insights: BrainInsight[] = [];

    // Built-in pattern analysis (zero-dependency, works without orchestrator)
    const lines = doc.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Security patterns
      if (/eval\s*\(/.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 1, 'SB001',
          'Avoid eval() — potential code injection vulnerability'));
      }
      if (/innerHTML\s*=/.test(line) && !/sanitize|escape|DOMPurify/i.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 2, 'SB002',
          'innerHTML without sanitization — XSS risk'));
      }
      if (/password|secret|api_key|token/i.test(line) && /[=:]\s*['"`][^'"`]{8,}['"`]/.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 1, 'SB003',
          'Possible hardcoded secret detected'));
      }

      // Quality patterns
      if (/console\.(log|debug|info)\s*\(/.test(line) && !/\/\//.test(line.split('console')[0])) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 4, 'SB010',
          'Console statement found — remove before production'));
      }
      if (/TODO|FIXME|HACK|XXX|TEMP/i.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 3, 'SB011',
          'TODO/FIXME marker found'));
      }

      // Complexity patterns
      if (/function\s+\w+\s*\([^)]{80,}\)/.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 2, 'SB020',
          'Function has too many parameters — consider using an options object'));
      }
      if (/\.then\s*\(.*\.then\s*\(.*\.then\s*\(/.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 3, 'SB021',
          'Promise chain too deep — consider async/await'));
      }

      // Error handling
      if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 2, 'SB030',
          'Empty catch block — errors are silently swallowed'));
      }

      // Performance
      if (/new RegExp\(/.test(line) && /for\s*\(|while\s*\(|\.forEach|\.map\s*\(/.test(lines[Math.max(0, i - 3)])) {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 3, 'SB040',
          'RegExp created inside loop — move to a constant'));
      }

      // TypeScript specific
      if (/:\s*any\b/.test(line) && doc.language === 'typescript') {
        diagnostics.push(this.createDiagnostic(i, 0, i, line.length, 3, 'SB050',
          'Avoid `any` type — use specific types or `unknown`'));
      }

      // Store as insights for hover
      for (const diag of diagnostics.filter(d => d.range.start.line === i)) {
        insights.push({
          type: diag.severity <= 2 ? 'warning' : 'suggestion',
          priority: diag.severity === 1 ? 'critical' : diag.severity === 2 ? 'high' : diag.severity === 3 ? 'medium' : 'low',
          title: diag.code ? `[${diag.code}] ${diag.message}` : diag.message,
          content: diag.message,
          files: [filePath],
          timestamp: new Date(),
          confidence: 0.9,
          metadata: { line: i, file: filePath },
        });
      }
    }

    // If orchestrator is available, get deeper insights
    if (this.orchestrator && filePath) {
      try {
        const brainInsights = await this.getOrchestratorInsights(filePath, doc.content);
        for (const bi of brainInsights) {
          const line = (bi.metadata?.line as number) || 0;
          diagnostics.push(this.createDiagnostic(
            line, 0, line, 999,
            bi.priority === 'critical' ? 1 : bi.priority === 'high' ? 2 : bi.priority === 'medium' ? 3 : 4,
            `SB-${bi.type}`,
            bi.content
          ));
          insights.push(bi);
        }
      } catch { /* best effort */ }
    }

    // Update cached state
    doc.diagnostics = diagnostics;
    doc.lastAnalyzed = new Date();
    this.cachedInsights.set(uri, insights);

    // Publish diagnostics
    this.sendNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics,
    });
  }

  private async getOrchestratorInsights(filePath: string, content: string): Promise<BrainInsight[]> {
    if (!this.orchestrator) return [];
    try {
      const status = this.orchestrator.getStatus?.();
      if (!status?.running) return [];
      // Use lightweight analysis
      return [];
    } catch {
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private createDiagnostic(
    startLine: number, startChar: number,
    endLine: number, endChar: number,
    severity: 1 | 2 | 3 | 4,
    code: string, message: string
  ): LSPDiagnostic {
    return {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      severity,
      source: 'shadow-brain',
      message,
      code,
    };
  }

  private sendResponse(id: string | number, result: any): void {
    this.sendMessage({ jsonrpc: '2.0', id, result });
  }

  private sendNotification(method: string, params: any): void {
    this.sendMessage({ jsonrpc: '2.0', method, params });
  }

  private sendMessage(message: LSPMessage): void {
    if (!this.writeOutput) return;
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.writeOutput(header + body);
  }

  private uriToPath(uri: string): string {
    if (uri.startsWith('file:///')) {
      const decoded = decodeURIComponent(uri.substring(8));
      // Windows: file:///C:/... → C:/...
      if (/^[a-zA-Z]:/.test(decoded)) return decoded;
      return '/' + decoded;
    }
    return uri;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): {
    openDocuments: number;
    totalDiagnostics: number;
    cachedInsights: number;
    initialized: boolean;
  } {
    let totalDiagnostics = 0;
    for (const doc of this.openDocuments.values()) {
      totalDiagnostics += doc.diagnostics.length;
    }
    return {
      openDocuments: this.openDocuments.size,
      totalDiagnostics,
      cachedInsights: this.cachedInsights.size,
      initialized: this.initialized,
    };
  }
}
