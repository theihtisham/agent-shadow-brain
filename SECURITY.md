# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 5.x     | :white_check_mark: |
| 4.x     | :white_check_mark: |
| < 4.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability, please follow these steps:

1. **Do not** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include the following information:
   - Type of vulnerability
   - Full path of affected file(s)
   - Steps to reproduce
   - Potential impact
   - Any suggested fix

You can report vulnerabilities through:

- [GitHub Security Advisories](../../security/advisories/new)
- [Private vulnerability reporting](../../security)

### What to Expect

- Acknowledgment within 48 hours
- Initial assessment within 5 business days
- Regular updates on progress
- Credit in the security advisory (unless you prefer to remain anonymous)

### Responsible Disclosure

We ask that you:

- Give us reasonable time to fix the issue before public disclosure
- Avoid accessing or modifying other users' data
- Do not degrade service quality during investigation

Thank you for helping keep this project secure.

## Agent Safety Defaults

Shadow Brain treats AI agent hooks and MCP servers as sensitive local automation.

- `postinstall` does not modify project files unless `SHADOW_BRAIN_POSTINSTALL_SETUP=1` is explicitly set.
- Use `shadow-brain attach-all --dry-run` before installing hooks.
- Use `shadow-brain audit-hooks` to inspect installed hook files.
- Use `shadow-brain detach-all` to remove Shadow Brain hooks without creating new ones.
- Use `shadow-brain firewall check` or `shadow-brain firewall hook` to block secret access, destructive commands, curl-to-shell installs, and prompt-injection payloads.
- For HTTP MCP mode, prefer `--auth-token` or `SHADOW_BRAIN_MCP_TOKEN`.
