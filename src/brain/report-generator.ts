// src/brain/report-generator.ts — HTML report + GitHub Actions CI config generator

import { BrainInsight, FileChange, ProjectContext } from '../types.js';
import { HealthScore } from './health-score.js';
import { FixSuggestion } from './smart-fix.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ReportOptions {
  format: 'html' | 'markdown' | 'json' | 'github-actions';
  outputPath: string;
  projectName?: string;
  includeHealthScore?: boolean;
  includeFixes?: boolean;
}

export class ReportGenerator {
  generate(
    insights: BrainInsight[],
    changes: FileChange[],
    context: ProjectContext,
    health?: HealthScore,
    fixes?: FixSuggestion[],
    opts: Partial<ReportOptions> = {},
  ): string {
    const format = opts.format || 'html';

    switch (format) {
      case 'html': return this.generateHTML(insights, context, health, fixes);
      case 'markdown': return this.generateMarkdown(insights, context, health, fixes);
      case 'json': return this.generateJSON(insights, changes, context, health, fixes);
      case 'github-actions': return this.generateGitHubActionsWorkflow(context);
      default: return this.generateMarkdown(insights, context, health, fixes);
    }
  }

  saveReport(content: string, outputPath: string): string {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, content, 'utf-8');
    return outputPath;
  }

  // ─── HTML ────────────────────────────────────────────────────────────────────
  private generateHTML(
    insights: BrainInsight[],
    context: ProjectContext,
    health?: HealthScore,
    fixes?: FixSuggestion[],
  ): string {
    const criticalCount = insights.filter(i => i.priority === 'critical').length;
    const highCount = insights.filter(i => i.priority === 'high').length;
    const mediumCount = insights.filter(i => i.priority === 'medium').length;
    const gradeColor = health ? (health.overall >= 85 ? '#22c55e' : health.overall >= 70 ? '#eab308' : health.overall >= 50 ? '#f97316' : '#ef4444') : '#6b7280';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow Brain Report — ${context.name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0f0f1a; color:#e2e8f0; min-height:100vh; }
    .header { background:linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%); padding:32px 48px; border-bottom:1px solid #312e81; }
    .header h1 { font-size:28px; font-weight:700; color:#a5b4fc; display:flex; align-items:center; gap:12px; }
    .header .meta { color:#6b7280; font-size:14px; margin-top:8px; }
    .container { max-width:1100px; margin:0 auto; padding:32px 48px; }
    .score-card { background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border:1px solid #312e81; border-radius:16px; padding:28px; margin-bottom:32px; display:grid; grid-template-columns:200px 1fr; gap:28px; }
    .score-circle { width:140px; height:140px; border-radius:50%; border:6px solid ${gradeColor}; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 0 30px ${gradeColor}33; }
    .score-number { font-size:42px; font-weight:800; color:${gradeColor}; line-height:1; }
    .score-label { font-size:13px; color:#6b7280; margin-top:4px; }
    .score-grade { font-size:22px; font-weight:700; color:${gradeColor}; margin-top:4px; }
    .score-dims { display:grid; gap:12px; }
    .dim-row { display:grid; grid-template-columns:120px 1fr 50px; align-items:center; gap:12px; }
    .dim-name { font-size:13px; color:#94a3b8; }
    .dim-bar { height:8px; background:#1e293b; border-radius:4px; overflow:hidden; }
    .dim-fill { height:100%; border-radius:4px; transition:width .3s ease; }
    .dim-val { font-size:13px; color:#94a3b8; text-align:right; }
    .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:32px; }
    .stat { background:#1a1a2e; border:1px solid #312e81; border-radius:12px; padding:20px; text-align:center; }
    .stat-num { font-size:32px; font-weight:800; }
    .stat-label { font-size:12px; color:#6b7280; margin-top:4px; }
    .critical { color:#f87171; } .high { color:#fb923c; } .medium { color:#facc15; } .low { color:#4ade80; }
    .section-title { font-size:18px; font-weight:600; color:#a5b4fc; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
    .insight-card { background:#1a1a2e; border:1px solid #1e293b; border-radius:12px; padding:20px; margin-bottom:12px; border-left:4px solid; }
    .insight-card.critical { border-left-color:#f87171; }
    .insight-card.high { border-left-color:#fb923c; }
    .insight-card.medium { border-left-color:#facc15; }
    .insight-card.low { border-left-color:#4ade80; }
    .insight-header { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
    .badge { font-size:11px; font-weight:600; padding:3px 8px; border-radius:20px; text-transform:uppercase; }
    .badge-critical { background:#7f1d1d; color:#fca5a5; }
    .badge-high { background:#7c2d12; color:#fdba74; }
    .badge-medium { background:#713f12; color:#fde047; }
    .badge-low { background:#14532d; color:#86efac; }
    .insight-title { font-size:15px; font-weight:600; color:#e2e8f0; }
    .insight-content { color:#94a3b8; font-size:14px; line-height:1.6; }
    .insight-files { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
    .file-tag { background:#0f172a; border:1px solid #1e293b; border-radius:6px; padding:2px 8px; font-size:11px; font-family:monospace; color:#64748b; }
    .fix-card { background:#0d1b0d; border:1px solid #14532d; border-radius:12px; padding:20px; margin-bottom:12px; }
    .fix-label { font-size:11px; font-weight:600; color:#4ade80; text-transform:uppercase; margin-bottom:4px; }
    pre { background:#0f0f1a; border:1px solid #1e293b; border-radius:8px; padding:14px; font-size:13px; overflow-x:auto; white-space:pre-wrap; }
    pre.before { border-color:#7f1d1d; background:#1a0000; color:#fca5a5; }
    pre.after { border-color:#14532d; background:#001a00; color:#86efac; }
    .explanation { color:#64748b; font-size:13px; margin-top:10px; font-style:italic; }
    .trend { font-size:13px; color:#6b7280; }
    .trend.improving { color:#4ade80; }
    .trend.declining { color:#f87171; }
    footer { text-align:center; padding:32px; color:#374151; font-size:12px; border-top:1px solid #1e293b; margin-top:40px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧠 Shadow Brain Report</h1>
    <div class="meta">Project: <strong>${context.name}</strong> &nbsp;·&nbsp; ${new Date().toLocaleString()} &nbsp;·&nbsp; Branch: ${context.gitBranch || 'N/A'}</div>
  </div>
  <div class="container">

    ${health ? `
    <div class="score-card">
      <div class="score-circle">
        <div class="score-number">${health.overall}</div>
        <div class="score-label">out of 100</div>
        <div class="score-grade">${health.grade}</div>
      </div>
      <div>
        <div style="font-size:16px; font-weight:600; color:#e2e8f0; margin-bottom:4px;">Code Health Score</div>
        <div class="trend ${health.trend}">Trend: ${health.trend === 'improving' ? '↑ Improving' : health.trend === 'declining' ? '↓ Declining' : '→ Stable'}</div>
        <div class="score-dims" style="margin-top:16px;">
          ${health.dimensions.map(d => {
            const fillColor = d.score >= 90 ? '#22c55e' : d.score >= 75 ? '#3b82f6' : d.score >= 55 ? '#eab308' : '#ef4444';
            return `<div class="dim-row">
            <div class="dim-name">${d.name}</div>
            <div class="dim-bar"><div class="dim-fill" style="width:${d.score}%; background:${fillColor};"></div></div>
            <div class="dim-val">${d.score}%</div>
          </div>`;
          }).join('')}
        </div>
      </div>
    </div>` : ''}

    <div class="stats">
      <div class="stat"><div class="stat-num critical">${criticalCount}</div><div class="stat-label">Critical</div></div>
      <div class="stat"><div class="stat-num high">${highCount}</div><div class="stat-label">High Priority</div></div>
      <div class="stat"><div class="stat-num medium">${mediumCount}</div><div class="stat-label">Medium</div></div>
      <div class="stat"><div class="stat-num" style="color:#a5b4fc;">${insights.length}</div><div class="stat-label">Total Insights</div></div>
    </div>

    <div class="section-title">🔍 Insights</div>
    ${insights.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority];
    }).map(i => `
    <div class="insight-card ${i.priority}">
      <div class="insight-header">
        <span class="badge badge-${i.priority}">${i.priority}</span>
        <span class="badge" style="background:#1e293b;color:#64748b;">${i.type}</span>
        <span class="insight-title">${i.title}</span>
      </div>
      <div class="insight-content">${i.content.replace(/\n/g, '<br>')}</div>
      ${i.files && i.files.length > 0 ? `<div class="insight-files">${i.files.map(f => `<span class="file-tag">${f}</span>`).join('')}</div>` : ''}
    </div>`).join('')}

    ${fixes && fixes.length > 0 ? `
    <div class="section-title" style="margin-top:32px;">🔧 Smart Fix Suggestions</div>
    ${fixes.map(f => `
    <div class="fix-card">
      <div style="font-size:15px; font-weight:600; color:#86efac; margin-bottom:12px;">${f.issue}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div><div class="fix-label">Before</div><pre class="before">${f.before}</pre></div>
        <div><div class="fix-label">After</div><pre class="after">${f.after}</pre></div>
      </div>
      <div class="explanation">💡 ${f.explanation}</div>
    </div>`).join('')}` : ''}

  </div>
  <footer>Generated by <strong>Agent Shadow Brain</strong> · @theihtisham/agent-shadow-brain · <a href="https://github.com/theihtisham/agent-shadow-brain" style="color:#4ade80;">GitHub</a></footer>
</body>
</html>`;
  }

  // ─── Markdown ────────────────────────────────────────────────────────────────
  private generateMarkdown(
    insights: BrainInsight[],
    context: ProjectContext,
    health?: HealthScore,
    fixes?: FixSuggestion[],
  ): string {
    const lines: string[] = [
      `# 🧠 Shadow Brain Report — ${context.name}`,
      ``,
      `> Generated: ${new Date().toLocaleString()} · Branch: \`${context.gitBranch || 'N/A'}\``,
      ``,
    ];

    if (health) {
      const trendIcon = health.trend === 'improving' ? '↑' : health.trend === 'declining' ? '↓' : '→';
      lines.push(`## Code Health Score: ${health.overall}/100 (${health.grade}) ${trendIcon}`, ``);
      lines.push(`| Dimension | Score | Status |`);
      lines.push(`|-----------|-------|--------|`);
      for (const d of health.dimensions) {
        lines.push(`| ${d.name} | ${d.score}% | ${d.status} |`);
      }
      lines.push(``);
    }

    lines.push(`## Summary`, ``);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of insights) counts[i.priority]++;
    lines.push(`- 🔴 Critical: **${counts.critical}**`);
    lines.push(`- 🟠 High: **${counts.high}**`);
    lines.push(`- 🟡 Medium: **${counts.medium}**`);
    lines.push(`- 🟢 Low: **${counts.low}**`);
    lines.push(``);

    lines.push(`## Insights`, ``);
    for (const i of insights) {
      const icon = i.priority === 'critical' ? '🔴' : i.priority === 'high' ? '🟠' : i.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`### ${icon} ${i.title}`);
      lines.push(`**Priority:** ${i.priority} | **Type:** ${i.type}`);
      if (i.files?.length) lines.push(`**Files:** ${i.files.map(f => `\`${f}\``).join(', ')}`);
      lines.push(``, i.content, ``);
    }

    if (fixes && fixes.length > 0) {
      lines.push(`## 🔧 Smart Fix Suggestions`, ``);
      for (const f of fixes) {
        lines.push(`### ${f.issue}`, ``, `**File:** \`${f.file}\``, ``);
        lines.push(`**Before:**`, `\`\`\``, f.before, `\`\`\``, ``);
        lines.push(`**After:**`, `\`\`\``, f.after, `\`\`\``, ``);
        lines.push(`> 💡 ${f.explanation}`, ``);
      }
    }

    lines.push(`---`, `*Generated by [Agent Shadow Brain](https://github.com/theihtisham/agent-shadow-brain)*`);

    return lines.join('\n');
  }

  // ─── JSON ────────────────────────────────────────────────────────────────────
  private generateJSON(
    insights: BrainInsight[],
    changes: FileChange[],
    context: ProjectContext,
    health?: HealthScore,
    fixes?: FixSuggestion[],
  ): string {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      project: context.name,
      branch: context.gitBranch,
      health,
      insights,
      fixes,
      summary: {
        total: insights.length,
        critical: insights.filter(i => i.priority === 'critical').length,
        high: insights.filter(i => i.priority === 'high').length,
        medium: insights.filter(i => i.priority === 'medium').length,
        low: insights.filter(i => i.priority === 'low').length,
        filesChanged: changes.length,
      },
    }, null, 2);
  }

  // ─── GitHub Actions Workflow ─────────────────────────────────────────────────
  generateGitHubActionsWorkflow(context: ProjectContext): string {
    const hasNode = context.language?.some(l => ['TypeScript', 'JavaScript'].includes(l));
    const hasPython = context.language?.some(l => l === 'Python');
    const hasGo = context.language?.some(l => l === 'Go');
    const hasRust = context.language?.some(l => l === 'Rust');

    return `# .github/workflows/shadow-brain.yml
# Auto-generated by Agent Shadow Brain — https://github.com/theihtisham/agent-shadow-brain
name: Shadow Brain CI

on:
  push:
    branches: [main, master, develop]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  pull-requests: write

jobs:
  shadow-brain-review:
    name: AI Code Review
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need full history for git diff

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Shadow Brain
        run: npm install -g @theihtisham/agent-shadow-brain

      - name: Run Shadow Brain Review
        run: |
          shadow-brain review . \\
            --provider ollama \\
            --depth standard \\
            --output json > shadow-brain-report.json
        continue-on-error: true

      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: shadow-brain-report
          path: shadow-brain-report.json

      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let report = {};
            try { report = JSON.parse(fs.readFileSync('shadow-brain-report.json', 'utf8')); } catch {}

            const critical = report.summary?.critical || 0;
            const high = report.summary?.high || 0;
            const score = report.health?.overall || 'N/A';
            const grade = report.health?.grade || '';
            const insightsText = (report.insights || []).slice(0, 5).map(i =>
              \`- **[\${i.priority.toUpperCase()}]** \${i.title}\`
            ).join('\\n');

            const body = \`## 🧠 Shadow Brain Review

| Metric | Value |
|--------|-------|
| Health Score | \${score}/100 (\${grade}) |
| Critical Issues | \${critical} |
| High Priority | \${high} |

**Top Insights:**
\${insightsText || 'No issues found!'}

_Generated by [Agent Shadow Brain](https://github.com/theihtisham/agent-shadow-brain)_\`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body,
            });

  ${hasNode ? `
  lint-and-type-check:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test --if-present
` : ''}${hasPython ? `
  python-checks:
    name: Python Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install ruff mypy pytest
      - run: ruff check .
      - run: pytest --tb=short
` : ''}${hasGo ? `
  go-checks:
    name: Go Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: go vet ./...
      - run: go test ./...
` : ''}${hasRust ? `
  rust-checks:
    name: Rust Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - run: cargo clippy -- -D warnings
      - run: cargo test
` : ''}`;
  }

  generatePreCommitHook(): string {
    return `#!/bin/sh
# .git/hooks/pre-commit — Auto-generated by Shadow Brain
# Install: chmod +x .git/hooks/pre-commit

echo "\\n🧠 Shadow Brain pre-commit review...\\n"

# Run shadow brain quick review
shadow-brain review . --depth quick --output text

# Ask if review found critical issues
CRITICAL=$(shadow-brain review . --depth quick --output json 2>/dev/null | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.summary?.critical||0)}catch{console.log(0)}")

if [ "$CRITICAL" -gt "0" ]; then
  echo "\\n🚨 Shadow Brain found $CRITICAL critical issue(s). Commit anyway? [y/N]"
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "Commit aborted."
    exit 1
  fi
fi

echo "✓ Shadow Brain check complete\\n"
`;
  }
}
