// src/brain/agent-firewall.ts — Local safety firewall for AI agent tool calls

import { FirewallCheckInput, FirewallDecision, FirewallFinding } from '../types.js';

const SECRET_PATH = /(^|[/\\])(\.env(\.|$)|id_rsa|id_ed25519|\.npmrc|\.pypirc|\.netrc|credentials|secrets?)([/\\]|$)/i;
const DESTRUCTIVE_COMMANDS = [
  /\brm\s+-rf\s+(?:\/|\*|~|\$HOME|\.{1,2})(?:\s|$)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\b(?:mkfs|diskpart|format)\b/i,
  /\bdd\s+if=.*\s+of=\/dev\//i,
  /\bchmod\s+-R\s+777\b/i,
];
const PACKAGE_RISKS = [
  /\b(?:curl|wget)\b[^|;&]*(?:\||&&)\s*(?:sh|bash|zsh)\b/i,
  /\bnpm\s+(?:install|i)\s+(?:-g\s+)?(?:https?:|git\+|github:)/i,
  /\bpip\s+install\s+(?:https?:|git\+)/i,
  /\b(?:npx|pnpm dlx|bunx)\s+[^;\n]*--yes\b/i,
];
const PROMPT_INJECTION = [
  /ignore (?:all )?(?:previous|prior|system|developer) instructions/i,
  /reveal (?:the )?(?:system prompt|developer message|hidden instructions)/i,
  /exfiltrat(?:e|ion)|send (?:all )?(?:files|secrets|credentials)/i,
  /disable (?:security|safety|guardrails|firewall)/i,
];
const SECRET_CONTENT = [
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i,
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*[A-Za-z0-9_\-./+=]{12,}/i,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
];

export class AgentFirewall {
  check(input: FirewallCheckInput): FirewallDecision {
    const findings: FirewallFinding[] = [];

    if (input.filePath && SECRET_PATH.test(input.filePath)) {
      findings.push({
        type: 'secret-access',
        severity: 'critical',
        blocked: true,
        reason: 'Agent attempted to access a sensitive credential path.',
        evidence: input.filePath,
        recommendation: 'Use a redacted example file or explicitly approve the path for this session.',
      });
    }

    if (input.command) {
      for (const pattern of DESTRUCTIVE_COMMANDS) {
        if (pattern.test(input.command)) {
          findings.push({
            type: 'destructive-command',
            severity: 'critical',
            blocked: true,
            reason: 'Command matches a destructive shell pattern.',
            evidence: input.command,
            recommendation: 'Use a scoped command, dry-run flag, or require explicit human approval.',
          });
          break;
        }
      }

      for (const pattern of PACKAGE_RISKS) {
        if (pattern.test(input.command)) {
          findings.push({
            type: 'package-risk',
            severity: 'high',
            blocked: true,
            reason: 'Command downloads or executes remote code without a pinned, reviewable artifact.',
            evidence: input.command,
            recommendation: 'Pin the package/version, inspect it first, and avoid curl-to-shell execution.',
          });
          break;
        }
      }
    }

    if (input.url) {
      try {
        const url = new URL(input.url);
        if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
          findings.push({
            type: 'network-risk',
            severity: 'medium',
            blocked: false,
            reason: 'Agent is using a non-HTTPS external URL.',
            evidence: input.url,
            recommendation: 'Prefer HTTPS or a localhost development target.',
          });
        }
      } catch {
        findings.push({
          type: 'network-risk',
          severity: 'low',
          blocked: false,
          reason: 'URL could not be parsed for safety checks.',
          evidence: input.url,
          recommendation: 'Verify the destination manually before allowing the agent to proceed.',
        });
      }
    }

    if (input.content) {
      for (const pattern of PROMPT_INJECTION) {
        if (pattern.test(input.content)) {
          findings.push({
            type: 'prompt-injection',
            severity: 'high',
            blocked: true,
            reason: 'Content contains prompt-injection language aimed at overriding instructions or leaking data.',
            evidence: this.excerpt(input.content),
            recommendation: 'Treat this content as untrusted. Summarize it instead of injecting it directly.',
          });
          break;
        }
      }

      for (const pattern of SECRET_CONTENT) {
        if (pattern.test(input.content)) {
          findings.push({
            type: 'secret-access',
            severity: 'critical',
            blocked: true,
            reason: 'Content appears to contain a secret or credential.',
            evidence: this.excerpt(input.content),
            recommendation: 'Redact secrets before storing, sharing, or injecting this context.',
          });
          break;
        }
      }
    }

    const riskScore = findings.reduce((score, finding) => {
      const weight = finding.severity === 'critical' ? 1 : finding.severity === 'high' ? 0.7 : finding.severity === 'medium' ? 0.4 : 0.15;
      return Math.max(score, weight);
    }, 0);

    const allowed = !findings.some(f => f.blocked);
    return {
      allowed,
      riskScore,
      findings,
      summary: findings.length
        ? `${findings.filter(f => f.blocked).length} blocked, ${findings.length} finding(s), risk ${(riskScore * 100).toFixed(0)}%`
        : 'Allowed: no firewall findings',
    };
  }

  formatClaudeHookDecision(decision: FirewallDecision): string {
    if (decision.allowed) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.summary,
      },
    });
  }

  private excerpt(content: string): string {
    return content.replace(/\s+/g, ' ').slice(0, 180);
  }
}
