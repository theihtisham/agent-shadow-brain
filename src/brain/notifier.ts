// src/brain/nototifier.ts — Webhook/Slack/Discord notification system

import { NotificationPayload } from '../types.js';
import * as http from 'http';
import * as https from 'https';

export interface NotifyConfig {
  webhook?: string;
  slack?: string;    // Slack webhook URL
  discord?: string;  // Discord webhook URL
  minInterval?: number; // Minimum seconds between notifications (default: 60)
}

export class Notifier {
  private config: NotifyConfig;
  private lastSent = 0;

  constructor(config: NotifyConfig) {
    this.config = config;
  }

  async send(payload: NotificationPayload): Promise<{ sent: boolean; channels: string[] }> {
    const channels: string[] = [];
    const minInterval = (this.config.minInterval || 60) * 1000;

    // Rate limit
    if (Date.now() - this.lastSent < minInterval) {
      return { sent: false, channels: [] };
    }

    // Check if we should notify for this type
    if (payload.type === 'error') {
      // Always notify on errors
    } else if (payload.type === 'critical-insight') {
      // Always notify on critical
    } else if (payload.type === 'analysis-complete') {
      // Only if explicitly configured
    }

    const promises: Promise<void>[] = [];

    if (this.config.webhook) {
      promises.push(this.sendWebhook(this.config.webhook, payload));
      channels.push('webhook');
    }

    if (this.config.slack) {
      promises.push(this.sendSlack(this.config.slack, payload));
      channels.push('slack');
    }

    if (this.config.discord) {
      promises.push(this.sendDiscord(this.config.discord, payload));
      channels.push('discord');
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
      this.lastSent = Date.now();
    }

    return { sent: channels.length > 0, channels };
  }

  async test(): Promise<{ channel: string; success: boolean; error?: string }[]> {
    const results: { channel: string; success: boolean; error?: string }[] = [];
    const testPayload: NotificationPayload = {
      type: 'analysis-complete',
      title: 'Shadow Brain Test',
      message: 'This is a test notification from Shadow Brain.',
      timestamp: new Date(),
    };

    if (this.config.slack) {
      try {
        await this.sendSlack(this.config.slack, testPayload);
        results.push({ channel: 'slack', success: true });
      } catch (err: any) {
        results.push({ channel: 'slack', success: false, error: err.message });
      }
    }

    if (this.config.discord) {
      try {
        await this.sendDiscord(this.config.discord, testPayload);
        results.push({ channel: 'discord', success: true });
      } catch (err: any) {
        results.push({ channel: 'discord', success: false, error: err.message });
      }
    }

    if (this.config.webhook) {
      try {
        await this.sendWebhook(this.config.webhook, testPayload);
        results.push({ channel: 'webhook', success: true });
      } catch (err: any) {
        results.push({ channel: 'webhook', success: false, error: err.message });
      }
    }

    return results;
  }

  private async sendWebhook(url: string, payload: NotificationPayload): Promise<void> {
    await this.httpPost(url, {
      source: 'shadow-brain',
      ...payload,
      timestamp: payload.timestamp.toISOString(),
    });
  }

  private async sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const emoji = payload.type === 'critical-insight' ? '🚨' : payload.type === 'health-drop' ? '📉' : payload.type === 'error' ? '❌' : '🧠';
    const color = payload.type === 'critical-insight' ? 'danger' : payload.type === 'health-drop' ? 'warning' : 'good';

    await this.httpPost(webhookUrl, {
      attachments: [{
        color,
        title: `${emoji} ${payload.title}`,
        text: payload.message,
        footer: 'Shadow Brain',
        ts: Math.floor(payload.timestamp.getTime() / 1000),
      }],
    });
  }

  private async sendDiscord(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const color = payload.type === 'critical-insight' ? 0xFF0000 : payload.type === 'health-drop' ? 0xFFAA00 : 0x00FF00;

    await this.httpPost(webhookUrl, {
      embeds: [{
        title: payload.title,
        description: payload.message.slice(0, 2048),
        color,
        footer: { text: 'Shadow Brain' },
        timestamp: payload.timestamp.toISOString(),
      }],
    });
  }

  private httpPost(url: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'Shadow-Brain/1.2.0',
        },
        timeout: 10000,
      };

      const req = lib.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(data);
      req.end();
    });
  }
}
