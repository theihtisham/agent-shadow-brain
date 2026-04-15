// Shadow Brain VS Code Extension
// Provides inline insights, health badges, and real-time analysis in VS Code

const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');

let statusBarItem;
let diagnosticCollection;
let outputChannel;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Shadow Brain');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  diagnosticCollection = vscode.languages.createDiagnosticCollection('shadow-brain');

  // Status bar item
  statusBarItem.text = '$(brain) Shadow Brain';
  statusBarItem.tooltip = 'Shadow Brain — Active';
  statusBarItem.command = 'shadow-brain.showPanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('shadow-brain.review', () => runCommand('review', 'Reviewing project...')),
    vscode.commands.registerCommand('shadow-brain.health', () => runCommand('health', 'Computing health score...')),
    vscode.commands.registerCommand('shadow-brain.scan', () => runCommand('scan', 'Scanning for vulnerabilities...')),
    vscode.commands.registerCommand('shadow-brain.fix', () => runCommand('fix', 'Generating fix suggestions...')),
    vscode.commands.registerCommand('shadow-brain.metrics', () => runCommand('metrics', 'Computing code metrics...')),
    vscode.commands.registerCommand('shadow-brain.start', () => runCommand('start', 'Starting Shadow Brain watch mode...')),
    vscode.commands.registerCommand('shadow-brain.stop', () => {
      // Signal stop
      statusBarItem.text = '$(brain) Shadow Brain: Stopped';
      statusBarItem.backgroundColor = undefined;
      vscode.window.showInformationMessage('Shadow Brain stopped.');
    }),
    vscode.commands.registerCommand('shadow-brain.showPanel', () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand('shadow-brain.inject', async () => {
      const msg = await vscode.window.showInputBox({ prompt: 'Enter insight to inject into agent memory' });
      if (msg) runCommand(`inject "${msg}"`, 'Injecting insight...');
    }),
  );

  // File save watcher — analyze on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const cfg = vscode.workspace.getConfiguration('shadowBrain');
      if (cfg.get('analyzeOnSave', true)) {
        analyzeFile(doc);
      }
    })
  );

  // Active editor diagnostics
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) updateDiagnostics(editor.document);
    })
  );

  outputChannel.appendLine('Shadow Brain v2.0.0 activated');
}

function runCommand(cmd, statusMsg) {
  const workspaceRoot = vscode.workspace.rootPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('Shadow Brain requires an open workspace.');
    return;
  }

  statusBarItem.text = `$(loading~spin) ${statusMsg}`;
  outputChannel.appendLine(`Running: shadow-brain ${cmd}`);

  const shadowBrainCmd = `npx @theihtisham/agent-shadow-brain ${cmd} "${workspaceRoot}" --output json`;

  exec(shadowBrainCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      statusBarItem.text = '$(brain) Shadow Brain: Error';
      outputChannel.appendLine(`Error: ${err.message}`);
      vscode.window.showErrorMessage(`Shadow Brain error: ${err.message}`);
      return;
    }

    try {
      const result = JSON.parse(stdout);
      displayResults(result, cmd);
    } catch {
      outputChannel.appendLine(stdout || stderr);
      statusBarItem.text = '$(brain) Shadow Brain: Done';
    }
  });
}

function displayResults(result, cmd) {
  if (cmd.includes('health') && result.overall !== undefined) {
    const grade = result.grade || '?';
    statusBarItem.text = `$(brain) Health: ${result.overall}/100 (${grade})`;
    statusBarItem.backgroundColor = result.overall >= 80 ? undefined :
      result.overall >= 60 ? new vscode.ThemeColor('statusBarItem.warningBackground') :
      new vscode.ThemeColor('statusBarItem.errorBackground');
    outputChannel.appendLine(`Health Score: ${result.overall}/100 (${grade})`);
  } else if (Array.isArray(result)) {
    const criticals = result.filter(r => r.priority === 'critical').length;
    const warnings = result.filter(r => r.priority === 'high').length;
    statusBarItem.text = `$(brain) ${result.length} insights${criticals > 0 ? ` (${criticals} critical)` : ''}`;
    if (criticals > 0) {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    for (const insight of result) {
      const icon = insight.priority === 'critical' ? '🔴' : insight.priority === 'high' ? '🟡' : '🔵';
      outputChannel.appendLine(`${icon} [${insight.priority}] ${insight.title}: ${insight.content}`);
    }
  }
}

function analyzeFile(doc) {
  const content = doc.getText();
  const diagnostics = [];

  // Quick inline checks
  const secretPatterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{10,}/i,
    /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}/i,
    /sk-[a-zA-Z0-9]{32,}/,
  ];

  for (const pattern of secretPatterns) {
    const match = pattern.exec(content);
    if (match) {
      const pos = doc.positionAt(match.index);
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(pos, pos.translate(0, match[0].length)),
        'Shadow Brain: Possible secret/key exposed in code',
        vscode.DiagnosticSeverity.Error
      ));
    }
  }

  // Check for eval
  const evalMatch = /\beval\s*\(/.exec(content);
  if (evalMatch) {
    const pos = doc.positionAt(evalMatch.index);
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(pos, pos.translate(0, evalMatch[0].length)),
      'Shadow Brain: Avoid eval() — security risk',
      vscode.DiagnosticSeverity.Warning
    ));
  }

  // Check for console.log in production
  const consoleLogs = content.match(/console\.log\s*\(/g);
  if (consoleLogs && consoleLogs.length > 3) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      `Shadow Brain: ${consoleLogs.length} console.log() calls — use a logging library`,
      vscode.DiagnosticSeverity.Information
    ));
  }

  diagnosticCollection.set(doc.uri, diagnostics);
}

function updateDiagnostics(doc) {
  diagnosticCollection.delete(doc.uri);
  const cfg = vscode.workspace.getConfiguration('shadowBrain');
  if (cfg.get('inlineDiagnostics', true)) {
    analyzeFile(doc);
  }
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (outputChannel) outputChannel.dispose();
}

module.exports = { activate, deactivate };
