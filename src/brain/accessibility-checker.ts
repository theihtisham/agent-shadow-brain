// src/brain/accessibility-checker.ts — Web Accessibility (a11y) issue detection
// v3.0.0 — Scans HTML/JSX/Vue/Svelte templates for WCAG compliance issues

import { BrainInsight, A11yIssue } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache',
]);

const TEMPLATE_EXTENSIONS = new Set(['.html', '.jsx', '.tsx', '.vue', '.svelte']);

interface A11yRule {
  name: string;
  wcagLevel: 'A' | 'AA' | 'AAA';
  wcagCriterion: string;
  check: (content: string, lines: string[], filePath: string) => A11yIssue[];
}

const RULES: A11yRule[] = [
  {
    name: 'img-alt',
    wcagLevel: 'A',
    wcagCriterion: '1.1.1',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // Match <img> without alt attribute
      const imgRegex = /<img\b[^>]*>/g;
      let match: RegExpExecArray | null;
      while ((match = imgRegex.exec(content)) !== null) {
        const tag = match[0];
        if (!/\balt\s*=/.test(tag)) {
          const line = lines.findIndex((_, i, arr) =>
            arr.slice(0, i + 1).join('\n').length > match!.index
          ) + 1;
          issues.push({
            rule: 'img-alt',
            severity: 'critical',
            element: tag.slice(0, 80),
            file: filePath,
            line: Math.max(1, line),
            message: 'Image missing alt attribute',
            suggestion: 'Add descriptive alt text: alt="Description of image" or alt="" for decorative images',
            wcagLevel: 'A',
            wcagCriterion: '1.1.1',
          });
        } else if (/alt\s*=\s*["']\s*["']/.test(tag) && !/role\s*=\s*["']presentation["']/.test(tag)) {
          // Empty alt without presentation role — only flag if it's not clearly decorative
          const line = lines.findIndex((_, i, arr) =>
            arr.slice(0, i + 1).join('\n').length > match!.index
          ) + 1;
          issues.push({
            rule: 'img-alt',
            severity: 'moderate',
            element: tag.slice(0, 80),
            file: filePath,
            line: Math.max(1, line),
            message: 'Image has empty alt text — ensure it is decorative',
            suggestion: 'If decorative, add role="presentation". If meaningful, add descriptive alt text.',
            wcagLevel: 'A',
            wcagCriterion: '1.1.1',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'button-label',
    wcagLevel: 'A',
    wcagCriterion: '4.1.2',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // <button> with no text content and no aria-label
      const btnRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
      let match: RegExpExecArray | null;
      while ((match = btnRegex.exec(content)) !== null) {
        const attrs = match[1];
        const innerContent = match[2].trim();
        const hasAriaLabel = /\baria-label\s*=/.test(attrs);
        const hasAriaLabelledBy = /\baria-labelledby\s*=/.test(attrs);
        const hasTitle = /\btitle\s*=/.test(attrs);
        const hasTextContent = innerContent.length > 0 && !/^<[^>]+>$/.test(innerContent);
        const hasImgAlt = /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/.test(innerContent);

        if (!hasTextContent && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgAlt) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'button-label',
            severity: 'critical',
            element: match[0].slice(0, 80),
            file: filePath,
            line,
            message: 'Button has no accessible label',
            suggestion: 'Add text content, aria-label, or aria-labelledby to provide an accessible name',
            wcagLevel: 'A',
            wcagCriterion: '4.1.2',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'input-label',
    wcagLevel: 'A',
    wcagCriterion: '1.3.1',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // <input> without associated label, aria-label, or aria-labelledby
      const inputRegex = /<input\b([^>]*)>/g;
      let match: RegExpExecArray | null;
      while ((match = inputRegex.exec(content)) !== null) {
        const attrs = match[1];
        const type = /type\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1] || 'text';
        const hiddenTypes = ['hidden', 'submit', 'reset', 'button', 'image'];
        if (hiddenTypes.includes(type)) continue;

        const hasAriaLabel = /\baria-label\s*=/.test(attrs);
        const hasAriaLabelledBy = /\baria-labelledby\s*=/.test(attrs);
        const hasTitle = /\btitle\s*=/.test(attrs);
        const hasId = /\bid\s*=/.test(attrs);

        if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
          if (hasId) {
            // Check if there's a matching <label for="id">
            const id = /id\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];
            if (id && new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${id}["']`).test(content)) {
              continue; // has associated label
            }
          }
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'input-label',
            severity: 'critical',
            element: match[0].slice(0, 80),
            file: filePath,
            line,
            message: `Input (type="${type}") missing label association`,
            suggestion: 'Add a <label for="id">, aria-label, or aria-labelledby attribute',
            wcagLevel: 'A',
            wcagCriterion: '1.3.1',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'heading-order',
    wcagLevel: 'AA',
    wcagCriterion: '1.3.1',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      const headingRegex = /<h([1-6])\b/g;
      let lastLevel = 0;
      let match: RegExpExecArray | null;
      while ((match = headingRegex.exec(content)) !== null) {
        const level = parseInt(match[1]);
        if (lastLevel > 0 && level > lastLevel + 1) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'heading-order',
            severity: 'moderate',
            element: match[0],
            file: filePath,
            line,
            message: `Heading level skipped: h${lastLevel} to h${level}`,
            suggestion: `Headings should not skip levels. Use h${lastLevel + 1} or restructure heading hierarchy.`,
            wcagLevel: 'AA',
            wcagCriterion: '1.3.1',
          });
        }
        lastLevel = level;
      }
      return issues;
    },
  },
  {
    name: 'color-contrast',
    wcagLevel: 'AA',
    wcagCriterion: '1.4.3',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // Check for inline styles with low-contrast colors (heuristic)
      const styleRegex = /style\s*=\s*["']([^"']*color\s*:[^"']*)["']/gi;
      let match: RegExpExecArray | null;
      while ((match = styleRegex.exec(content)) !== null) {
        const styleContent = match[1];
        // Flag if only color is set without background-color or vice versa
        const hasColor = /(?:^|;)\s*color\s*:/.test(styleContent);
        const hasBgColor = /background(-color)?\s*:/.test(styleContent);
        if (hasColor && !hasBgColor) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'color-contrast',
            severity: 'serious',
            element: match[0].slice(0, 80),
            file: filePath,
            line,
            message: 'Inline color without matching background-color — contrast cannot be verified',
            suggestion: 'Ensure sufficient color contrast (4.5:1 for normal text, 3:1 for large text). Prefer CSS classes over inline styles.',
            wcagLevel: 'AA',
            wcagCriterion: '1.4.3',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'aria-valid',
    wcagLevel: 'A',
    wcagCriterion: '4.1.2',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // Check for common invalid aria usage
      const ariaRoleRegex = /role\s*=\s*["']([^"']+)["']/gi;
      const validRoles = new Set([
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
        'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo',
        'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form',
        'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox',
        'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem',
        'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option',
        'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
        'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
        'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist',
        'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree',
        'treegrid', 'treeitem',
      ]);
      let match: RegExpExecArray | null;
      while ((match = ariaRoleRegex.exec(content)) !== null) {
        const role = match[1].toLowerCase();
        if (!validRoles.has(role)) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'aria-valid',
            severity: 'serious',
            element: match[0],
            file: filePath,
            line,
            message: `Invalid ARIA role: "${role}"`,
            suggestion: `Use a valid WAI-ARIA role. See https://www.w3.org/TR/wai-aria-1.2/#role_definitions`,
            wcagLevel: 'A',
            wcagCriterion: '4.1.2',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'link-purpose',
    wcagLevel: 'AA',
    wcagCriterion: '2.4.4',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // Links with non-descriptive text
      const vagueTexts = ['click here', 'here', 'read more', 'more', 'link', 'this', 'go', 'learn more'];
      const linkRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(content)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
        if (vagueTexts.includes(text)) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'link-purpose',
            severity: 'serious',
            element: match[0].slice(0, 80),
            file: filePath,
            line,
            message: `Link text "${text}" is not descriptive`,
            suggestion: 'Use descriptive link text that makes sense out of context, e.g., "Read the accessibility guide"',
            wcagLevel: 'AA',
            wcagCriterion: '2.4.4',
          });
        }
      }
      return issues;
    },
  },
  {
    name: 'form-submit',
    wcagLevel: 'A',
    wcagCriterion: '3.3.2',
    check: (content, lines, filePath) => {
      const issues: A11yIssue[] = [];
      // Forms without submit buttons
      const formRegex = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
      let match: RegExpExecArray | null;
      while ((match = formRegex.exec(content)) !== null) {
        const formContent = match[1];
        const hasSubmit = /<button[^>]*type\s*=\s*["']submit["']/i.test(formContent) ||
          /<input[^>]*type\s*=\s*["']submit["']/i.test(formContent) ||
          /<input[^>]*type\s*=\s*["']image["']/i.test(formContent);
        if (!hasSubmit) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            rule: 'form-submit',
            severity: 'moderate',
            element: '<form>...</form>',
            file: filePath,
            line,
            message: 'Form missing submit button',
            suggestion: 'Add a submit button (<button type="submit">) or ensure JS-based submission has accessible alternative',
            wcagLevel: 'A',
            wcagCriterion: '3.3.2',
          });
        }
      }
      return issues;
    },
  },
];

export class AccessibilityChecker {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async analyzeProject(maxFiles: number = 200): Promise<BrainInsight[]> {
    const files = this.collectTemplateFiles(this.projectDir, maxFiles);
    const allIssues: A11yIssue[] = [];

    for (const filePath of files) {
      const issues = this.analyzeFile(filePath);
      allIssues.push(...issues);
    }

    return allIssues.map(issue => this.issueToInsight(issue));
  }

  analyzeFile(filePath: string): A11yIssue[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split('\n');
    const relPath = path.relative(this.projectDir, filePath);
    const issues: A11yIssue[] = [];

    for (const rule of RULES) {
      const ruleIssues = rule.check(content, lines, relPath);
      issues.push(...ruleIssues);
    }

    return issues;
  }

  private issueToInsight(issue: A11yIssue): BrainInsight {
    return {
      type: 'a11y',
      priority: issue.severity === 'critical' ? 'critical' :
        issue.severity === 'serious' ? 'high' :
        issue.severity === 'moderate' ? 'medium' : 'low',
      title: `[a11y] ${issue.rule}: ${issue.message}`,
      content:
        `WCAG ${issue.wcagLevel} (${issue.wcagCriterion}) violation in ${issue.file}:${issue.line}\n` +
        `  Element: ${issue.element}\n` +
        `  Severity: ${issue.severity}\n` +
        `  Fix: ${issue.suggestion}`,
      files: [issue.file],
      timestamp: new Date(),
      confidence: 0.9,
      metadata: { rule: issue.rule, wcag: `${issue.wcagLevel} ${issue.wcagCriterion}` },
    };
  }

  private collectTemplateFiles(dir: string, maxFiles: number): string[] {
    const results: string[] = [];
    const walk = (currentDir: string, depth: number): void => {
      if (results.length >= maxFiles || depth > 10) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= maxFiles) return;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && TEMPLATE_EXTENSIONS.has(path.extname(entry.name))) {
          results.push(fullPath);
        }
      }
    };
    walk(dir, 0);
    return results;
  }
}
