// src/brain/auto-update.ts — Check for Shadow Brain updates

import * as https from 'https';

const CURRENT_VERSION = '1.2.0';
const PACKAGE_NAME = '@theihtisham/agent-shadow-brain';

export interface UpdateCheck {
  current: string;
  latest: string;
  hasUpdate: boolean;
  changelog?: string;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'registry.npmjs.org',
      path: `/${PACKAGE_NAME}/latest`,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          const latest = pkg.version || CURRENT_VERSION;
          resolve({
            current: CURRENT_VERSION,
            latest,
            hasUpdate: compareVersions(latest, CURRENT_VERSION) > 0,
            changelog: pkg.description,
          });
        } catch {
          resolve({ current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false });
        }
      });
    });

    req.on('error', () => {
      resolve({ current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ current: CURRENT_VERSION, latest: CURRENT_VERSION, hasUpdate: false });
    });

    req.end();
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export function formatUpdateNotice(check: UpdateCheck): string {
  if (!check.hasUpdate) return '';
  return `\n  A new version of Shadow Brain is available: ${check.latest} (current: ${check.current})\n  Update: npm i -g ${PACKAGE_NAME}@latest\n`;
}
