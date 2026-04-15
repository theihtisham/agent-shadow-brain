// src/dashboard/server.ts — Real-time Web Dashboard with WebSocket
// Serves an embedded HTML UI + pushes live events from Orchestrator

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { Orchestrator } from '../brain/orchestrator.js';
import { BrainInsight, FileChange } from '../types.js';
import { HealthScore } from '../brain/health-score.js';
import { FixSuggestion } from '../brain/smart-fix.js';

export interface DashboardOptions {
  port?: number;
  host?: string;
  openBrowser?: boolean;
}

// ── Embedded HTML Client ──────────────────────────────────────────────────────
const HTML_CLIENT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🧠 Shadow Brain Dashboard</title>
<style>
  :root {
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --blue: #58a6ff; --purple: #bc8cff; --orange: #ffa657;
    --cyan: #39d353;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, monospace; font-size: 14px; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
  header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  header h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
  header h1 span { color: var(--blue); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); transition: background .3s; }
  .status-dot.connected { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
  .badge { background: var(--bg3); border: 1px solid var(--border); border-radius: 12px; padding: 2px 10px; font-size: 12px; color: var(--text2); }
  .badge.score { color: var(--green); border-color: var(--green); }
  .badge.grade { font-weight: 700; }
  .badge.grade.A { color: var(--green); border-color: var(--green); }
  .badge.grade.B { color: var(--yellow); border-color: var(--yellow); }
  .badge.grade.C { color: var(--orange); border-color: var(--orange); }
  .badge.grade.D,.badge.grade.F { color: var(--red); border-color: var(--red); }
  .trend { font-size: 16px; }
  .trend.improving { color: var(--green); }
  .trend.declining { color: var(--red); }
  .trend.stable { color: var(--text2); }
  .layout { display: grid; grid-template-columns: 340px 1fr; grid-template-rows: 1fr 1fr; gap: 1px; background: var(--border); flex: 1; overflow: hidden; }
  .panel { background: var(--bg); overflow: hidden; display: flex; flex-direction: column; }
  .panel-header { background: var(--bg2); padding: 8px 14px; font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .panel-body { flex: 1; overflow-y: auto; padding: 10px; }
  .panel-body::-webkit-scrollbar { width: 4px; } .panel-body::-webkit-scrollbar-thumb { background: var(--border); }
  /* Health panel */
  .health-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
  .health-big { grid-column: 1/-1; text-align: center; padding: 16px; background: var(--bg2); border-radius: 8px; border: 1px solid var(--border); }
  .health-big .num { font-size: 56px; font-weight: 900; line-height: 1; }
  .health-big .label { font-size: 12px; color: var(--text2); margin-top: 4px; }
  .dim { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
  .dim .name { font-size: 11px; color: var(--text2); margin-bottom: 6px; }
  .dim .bar-wrap { background: var(--bg3); border-radius: 3px; height: 6px; overflow: hidden; margin-bottom: 4px; }
  .dim .bar-fill { height: 100%; border-radius: 3px; transition: width .6s ease; }
  .dim .score-val { font-size: 13px; font-weight: 700; }
  /* Insights */
  .insight { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; border-left: 3px solid var(--border); animation: fadeIn .3s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
  .insight.critical { border-left-color: var(--red); }
  .insight.high { border-left-color: var(--orange); }
  .insight.medium { border-left-color: var(--yellow); }
  .insight.low { border-left-color: var(--text2); }
  .insight-title { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
  .insight-meta { font-size: 11px; color: var(--text2); display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
  .insight-content { font-size: 12px; color: var(--text2); line-height: 1.5; }
  .tag { background: var(--bg3); border-radius: 10px; padding: 1px 7px; font-size: 10px; }
  .tag.critical { background: rgba(248,81,73,.15); color: var(--red); }
  .tag.high { background: rgba(255,166,87,.15); color: var(--orange); }
  .tag.medium { background: rgba(210,153,34,.15); color: var(--yellow); }
  .tag.security { background: rgba(248,81,73,.12); color: var(--red); }
  .tag.performance { background: rgba(57,211,83,.12); color: var(--cyan); }
  .tag.quality { background: rgba(88,166,255,.12); color: var(--blue); }
  /* Fixes */
  .fix { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; animation: fadeIn .3s ease; }
  .fix-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .fix-file { font-size: 11px; color: var(--text2); margin-bottom: 8px; }
  .code-block { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 11px; line-height: 1.6; overflow-x: auto; }
  .code-before { border-left: 3px solid var(--red); }
  .code-after { border-left: 3px solid var(--green); }
  .fix-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
  .fix-label.before { color: var(--red); }
  .fix-label.after { color: var(--green); }
  .fix-explanation { font-size: 11px; color: var(--text2); margin-top: 8px; line-height: 1.5; }
  /* Log */
  .log-entry { font-family: monospace; font-size: 12px; padding: 3px 0; border-bottom: 1px solid var(--bg2); display: flex; gap: 10px; }
  .log-time { color: var(--text2); flex-shrink: 0; }
  .log-msg { flex: 1; word-break: break-all; }
  .log-msg.info { color: var(--blue); }
  .log-msg.success { color: var(--green); }
  .log-msg.warning { color: var(--yellow); }
  .log-msg.error { color: var(--red); }
  /* Empty state */
  .empty { text-align: center; color: var(--text2); padding: 40px 20px; font-size: 13px; }
  .empty .icon { font-size: 32px; margin-bottom: 10px; }
  .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .panel-count { background: var(--bg3); border-radius: 10px; padding: 1px 7px; font-size: 11px; color: var(--text2); }
</style>
</head>
<body>
<header>
  <div class="status-dot" id="statusDot"></div>
  <h1>🧠 <span>Shadow</span>Brain</h1>
  <span class="badge" id="badgeScore">—/100</span>
  <span class="badge grade" id="badgeGrade">—</span>
  <span class="trend" id="badgeTrend" title="Trend">→</span>
  <span class="badge" id="badgeAgents">No agents</span>
  <span style="flex:1"></span>
  <span class="badge" id="badgeProject" style="font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Connecting…</span>
</header>

<div class="layout">
  <!-- Top-left: Health Score -->
  <div class="panel" style="grid-row: 1">
    <div class="panel-header">⬟ Health Score</div>
    <div class="panel-body" id="healthPanel">
      <div class="empty"><div class="icon"><span class="spinner">⟳</span></div>Waiting for analysis…</div>
    </div>
  </div>

  <!-- Top-right: Insights stream -->
  <div class="panel" style="grid-row: 1">
    <div class="panel-header">
      💡 Live Insights
      <span class="panel-count" id="insightCount">0</span>
    </div>
    <div class="panel-body" id="insightsPanel">
      <div class="empty"><div class="icon">💡</div>Insights will appear here…</div>
    </div>
  </div>

  <!-- Bottom-left: Smart Fixes -->
  <div class="panel" style="grid-row: 2">
    <div class="panel-header">
      🔧 Smart Fixes
      <span class="panel-count" id="fixCount">0</span>
    </div>
    <div class="panel-body" id="fixesPanel">
      <div class="empty"><div class="icon">🔧</div>Fix suggestions will appear here…</div>
    </div>
  </div>

  <!-- Bottom-right: Activity Log -->
  <div class="panel" style="grid-row: 2">
    <div class="panel-header">📋 Activity Log</div>
    <div class="panel-body" id="logPanel"></div>
  </div>
</div>

<script>
const MAX_INSIGHTS = 50;
const MAX_LOG = 100;
let insightCount = 0;
let fixCount = 0;
let allInsights = [];

const statusDot = document.getElementById('statusDot');
const badgeScore = document.getElementById('badgeScore');
const badgeGrade = document.getElementById('badgeGrade');
const badgeTrend = document.getElementById('badgeTrend');
const badgeAgents = document.getElementById('badgeAgents');
const badgeProject = document.getElementById('badgeProject');
const healthPanel = document.getElementById('healthPanel');
const insightsPanel = document.getElementById('insightsPanel');
const fixesPanel = document.getElementById('fixesPanel');
const logPanel = document.getElementById('logPanel');
const insightCountEl = document.getElementById('insightCount');
const fixCountEl = document.getElementById('fixCount');

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = \`<span class="log-time">\${ts()}</span><span class="log-msg \${type}">\${escapeHtml(msg)}</span>\`;
  if (logPanel.children.length >= MAX_LOG) logPanel.removeChild(logPanel.lastChild);
  logPanel.insertBefore(el, logPanel.firstChild);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scoreColor(v) {
  if (v >= 85) return '#3fb950';
  if (v >= 70) return '#d29922';
  if (v >= 50) return '#ffa657';
  return '#f85149';
}

function renderHealth(score) {
  if (!score) return;
  const col = scoreColor(score.overall);
  const trendIcon = score.trend === 'improving' ? '↑' : score.trend === 'declining' ? '↓' : '→';
  badgeScore.textContent = score.overall + '/100';
  badgeScore.style.color = col;
  badgeScore.style.borderColor = col;
  badgeGrade.textContent = score.grade;
  const gradeClass = score.grade.replace('+','').charAt(0);
  badgeGrade.className = \`badge grade \${gradeClass}\`;
  badgeTrend.textContent = trendIcon;
  badgeTrend.className = \`trend \${score.trend}\`;

  const dimsHtml = score.dimensions.map(d => {
    const c = scoreColor(d.score);
    const det = d.details.map(x => \`<div style="font-size:10px;color:var(--text2);margin-top:2px">• \${escapeHtml(x)}</div>\`).join('');
    return \`<div class="dim">
      <div class="name">\${escapeHtml(d.name)}</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:\${d.score}%;background:\${c}"></div></div>
      <div class="score-val" style="color:\${c}">\${d.score}%</div>
      \${det}
    </div>\`;
  }).join('');

  const topIssues = score.topIssues.length > 0
    ? \`<div style="margin-top:10px;padding:8px;background:var(--bg2);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--red);font-weight:700;margin-bottom:6px">🔥 Top Issues</div>
        \${score.topIssues.map(i => \`<div style="font-size:11px;color:var(--text2);margin-bottom:3px">• \${escapeHtml(i)}</div>\`).join('')}
      </div>\`
    : '';

  healthPanel.innerHTML = \`
    <div class="health-big">
      <div class="num" style="color:\${col}">\${score.overall}</div>
      <div class="label">Health Score / 100 — Grade \${score.grade} \${trendIcon}</div>
    </div>
    <div class="health-grid">\${dimsHtml}</div>
    \${topIssues}
  \`;
}

function priorityTag(p) {
  return \`<span class="tag \${p}">\${p.toUpperCase()}</span>\`;
}

function typeTag(t) {
  const colors = { warning: '#f85149', suggestion: '#58a6ff', review: '#bc8cff', insight: '#39d353' };
  return \`<span class="tag" style="color:\${colors[t]||'#8b949e'}">\${t}</span>\`;
}

function renderInsight(insight) {
  const files = (insight.files || []).map(f => \`<code style="font-size:10px;background:var(--bg3);padding:1px 5px;border-radius:3px">\${escapeHtml(f)}</code>\`).join(' ');
  return \`<div class="insight \${insight.priority}">
    <div class="insight-title">\${escapeHtml(insight.title)}</div>
    <div class="insight-meta">
      \${priorityTag(insight.priority)}
      \${typeTag(insight.type)}
      \${files}
    </div>
    <div class="insight-content">\${escapeHtml(insight.content)}</div>
  </div>\`;
}

function addInsights(insights) {
  if (!insights || insights.length === 0) return;
  if (insightsPanel.querySelector('.empty')) insightsPanel.innerHTML = '';
  allInsights = [...insights, ...allInsights].slice(0, MAX_INSIGHTS);
  insightsPanel.innerHTML = allInsights.map(renderInsight).join('');
  insightCount += insights.length;
  insightCountEl.textContent = insightCount;
  log(\`\${insights.length} new insight(s) received\`, 'success');
}

function catTag(c) {
  return \`<span class="tag \${c}">\${c.toUpperCase()}</span>\`;
}

function renderFix(fix) {
  return \`<div class="fix">
    <div class="fix-title">\${escapeHtml(fix.issue)}</div>
    <div class="fix-file">📄 \${escapeHtml(fix.file)} &nbsp; \${catTag(fix.category)} &nbsp; <span class="tag">\${fix.confidence} confidence</span></div>
    <div class="fix-label before">Before</div>
    <pre class="code-block code-before">\${escapeHtml(fix.before)}</pre>
    <div class="fix-label after" style="margin-top:8px">After</div>
    <pre class="code-block code-after">\${escapeHtml(fix.after)}</pre>
    <div class="fix-explanation">💡 \${escapeHtml(fix.explanation)}</div>
  </div>\`;
}

function renderFixes(fixes) {
  if (!fixes || fixes.length === 0) return;
  if (fixesPanel.querySelector('.empty')) fixesPanel.innerHTML = '';
  fixesPanel.innerHTML = fixes.map(renderFix).join('');
  fixCount = fixes.length;
  fixCountEl.textContent = fixCount;
  log(\`\${fixes.length} smart fix suggestion(s) available\`, 'info');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(\`\${proto}//\${location.host}\`);

  ws.onopen = () => {
    statusDot.classList.add('connected');
    log('Connected to Shadow Brain', 'success');
  };

  ws.onclose = () => {
    statusDot.classList.remove('connected');
    log('Disconnected — reconnecting in 3s…', 'warning');
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    log('WebSocket error', 'error');
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'init':
        badgeProject.textContent = msg.projectDir || '';
        if (msg.agents && msg.agents.length > 0) {
          badgeAgents.textContent = msg.agents.join(', ');
        }
        log(\`Project: \${msg.projectDir}\`, 'info');
        break;
      case 'agents-detected':
        if (msg.agents && msg.agents.length > 0) {
          badgeAgents.textContent = msg.agents.join(', ');
          log(\`Agents: \${msg.agents.join(', ')}\`, 'info');
        }
        break;
      case 'analysis-start':
        log(\`Analysis started — \${msg.changeCount} change(s)\`, 'info');
        break;
      case 'insights':
        addInsights(msg.insights);
        break;
      case 'health-score':
        renderHealth(msg.score);
        break;
      case 'fixes':
        renderFixes(msg.fixes);
        break;
      case 'injection':
        if (msg.success) log(\`Injected → \${msg.adapter}: \${msg.insightTitle}\`, 'success');
        break;
      case 'info':
        log(msg.message, 'info');
        break;
      case 'error':
        log(\`Error: \${msg.error}\`, 'error');
        break;
    }
  };
}

connect();
</script>
</body>
</html>`;

// ── Dashboard Server ──────────────────────────────────────────────────────────
export class DashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private orchestrator: Orchestrator;
  private options: Required<DashboardOptions>;

  constructor(orchestrator: Orchestrator, options: DashboardOptions = {}) {
    this.orchestrator = orchestrator;
    this.options = {
      port: options.port ?? 7341,
      host: options.host ?? 'localhost',
      openBrowser: options.openBrowser ?? false,
    };

    // HTTP server — serves the embedded HTML client
    this.server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(HTML_CLIENT);
      } else if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.orchestrator.getStatus(), null, 2));
      } else if (req.url === '/api/health') {
        const h = this.orchestrator.getLastHealthScore();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(h, null, 2));
      } else if (req.url === '/api/fixes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.orchestrator.getLastFixes(), null, 2));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // WebSocket server on the same HTTP server
    this.wss = new WebSocketServer({ server: this.server });
    this.setupWebSocket();
    this.subscribeToOrchestrator();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send init state immediately
      const status = this.orchestrator.getStatus();
      this.send(ws, {
        type: 'init',
        projectDir: status.projectDir,
        agents: status.agents,
        personality: status.personality,
        provider: status.provider,
        model: status.model,
      });

      // Send cached health score if available
      const health = this.orchestrator.getLastHealthScore();
      if (health) {
        this.send(ws, { type: 'health-score', score: health });
      }

      // Send cached fixes if available
      const fixes = this.orchestrator.getLastFixes();
      if (fixes.length > 0) {
        this.send(ws, { type: 'fixes', fixes });
      }

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  private subscribeToOrchestrator(): void {
    this.orchestrator.on('agents-detected', ({ adapters }: any) => {
      this.broadcast({
        type: 'agents-detected',
        agents: adapters.map((a: any) => `${a.displayName} (${a.name})`),
      });
    });

    this.orchestrator.on('analysis-start', ({ changeCount }: any) => {
      this.broadcast({ type: 'analysis-start', changeCount });
    });

    this.orchestrator.on('insights', ({ insights }: any) => {
      this.broadcast({ type: 'insights', insights });
    });

    this.orchestrator.on('health-score', ({ score }: any) => {
      this.broadcast({ type: 'health-score', score });
    });

    this.orchestrator.on('fixes', ({ fixes }: any) => {
      this.broadcast({ type: 'fixes', fixes });
    });

    this.orchestrator.on('injection', ({ adapter, insight, success }: any) => {
      this.broadcast({
        type: 'injection',
        adapter,
        insightTitle: insight?.title || '',
        success,
      });
    });

    this.orchestrator.on('info', (message: string) => {
      this.broadcast({ type: 'info', message });
    });

    this.orchestrator.on('error', ({ error }: any) => {
      this.broadcast({ type: 'error', error: String(error?.message || error) });
    });
  }

  private send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private broadcast(data: object): void {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(this.options.port, this.options.host, () => {
        const url = `http://${this.options.host}:${this.options.port}`;
        resolve(url);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        try { client.close(); } catch { /* ignore */ }
      }
      this.clients.clear();
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }

  get port(): number {
    return this.options.port;
  }
}
