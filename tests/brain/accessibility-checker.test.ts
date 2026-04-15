import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AccessibilityChecker } from '../../src/brain/accessibility-checker.js';

describe('AccessibilityChecker', () => {
  let tempDir: string;
  let checker: AccessibilityChecker;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-test-'));
    checker = new AccessibilityChecker(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  function writeTestFile(name: string, content: string): string {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  describe('analyzeFile()', () => {
    it('detects images without alt attribute', () => {
      const filePath = writeTestFile('no-alt.html', `
        <html>
        <body>
          <img src="photo.jpg" />
          <img src="logo.png" alt="Company Logo" />
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const imgAltIssues = issues.filter(i => i.rule === 'img-alt' && i.message.includes('missing alt'));
      expect(imgAltIssues.length).toBe(1);
      expect(imgAltIssues[0].severity).toBe('critical');
      expect(imgAltIssues[0].wcagCriterion).toBe('1.1.1');
    });

    it('detects buttons without accessible labels', () => {
      const filePath = writeTestFile('no-label-btn.html', `
        <html>
        <body>
          <button></button>
          <button>Click Me</button>
          <button aria-label="Close menu"><span class="icon"></span></button>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const btnIssues = issues.filter(i => i.rule === 'button-label');
      expect(btnIssues.length).toBe(1); // only the empty button
      expect(btnIssues[0].severity).toBe('critical');
    });

    it('detects inputs without label associations', () => {
      const filePath = writeTestFile('no-input-label.html', `
        <html>
        <body>
          <input type="text" name="username" />
          <label for="email">Email</label>
          <input type="email" id="email" name="email" />
          <input type="text" aria-label="Search" />
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const inputIssues = issues.filter(i => i.rule === 'input-label');
      expect(inputIssues.length).toBe(1); // only the username input
      expect(inputIssues[0].severity).toBe('critical');
    });

    it('detects heading level skips', () => {
      const filePath = writeTestFile('heading-skip.html', `
        <html>
        <body>
          <h1>Title</h1>
          <h3>Skipped h2</h3>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const headingIssues = issues.filter(i => i.rule === 'heading-order');
      expect(headingIssues.length).toBe(1);
      expect(headingIssues[0].message).toContain('skipped');
      expect(headingIssues[0].message).toContain('h1 to h3');
    });

    it('detects vague link text', () => {
      const filePath = writeTestFile('vague-links.html', `
        <html>
        <body>
          <a href="/details">click here</a>
          <a href="/docs">Read the full documentation</a>
          <a href="/more">more</a>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const linkIssues = issues.filter(i => i.rule === 'link-purpose');
      expect(linkIssues.length).toBe(2); // "click here" and "more"
      const texts = linkIssues.map(i => i.message.match(/"([^"]+)"/)?.[1]);
      expect(texts).toContain('click here');
      expect(texts).toContain('more');
    });

    it('detects inline color without background-color', () => {
      const filePath = writeTestFile('color-contrast.html', `
        <html>
        <body>
          <p style="color: red;">Warning text</p>
          <p style="color: blue; background-color: white;">Safe text</p>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const contrastIssues = issues.filter(i => i.rule === 'color-contrast');
      expect(contrastIssues.length).toBe(1);
      expect(contrastIssues[0].severity).toBe('serious');
    });

    it('detects invalid ARIA roles', () => {
      const filePath = writeTestFile('invalid-aria.html', `
        <html>
        <body>
          <div role="button">Click</div>
          <div role="not-a-real-role">Bad</div>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const ariaIssues = issues.filter(i => i.rule === 'aria-valid');
      expect(ariaIssues.length).toBe(1);
      expect(ariaIssues[0].message).toContain('not-a-real-role');
    });

    it('detects forms without submit buttons', () => {
      const filePath = writeTestFile('no-submit.html', `
        <html>
        <body>
          <form>
            <input type="text" aria-label="Name" />
          </form>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      const formIssues = issues.filter(i => i.rule === 'form-submit');
      expect(formIssues.length).toBe(1);
      expect(formIssues[0].message).toContain('missing submit');
    });

    it('returns no issues for valid accessible HTML', () => {
      const filePath = writeTestFile('valid.html', `
        <html>
        <body>
          <h1>Title</h1>
          <h2>Subtitle</h2>
          <img src="photo.jpg" alt="A beautiful landscape" />
          <button aria-label="Close">X</button>
          <form>
            <label for="name">Name</label>
            <input type="text" id="name" />
            <button type="submit">Submit</button>
          </form>
          <a href="/docs">Read the documentation</a>
        </body>
        </html>
      `);

      const issues = checker.analyzeFile(filePath);
      // The valid HTML should produce zero or near-zero issues
      // (the label+input combo should not trigger input-label since it has for/id)
      const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'serious');
      expect(criticalIssues).toHaveLength(0);
    });

    it('returns empty array for non-existent file', () => {
      const issues = checker.analyzeFile(path.join(tempDir, 'nonexistent.html'));
      expect(issues).toHaveLength(0);
    });
  });
});
