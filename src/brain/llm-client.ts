// src/brain/llm-client.ts — Multi-provider LLM client

import * as https from 'https';
import * as http from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from '../types.js';
import { z, ZodSchema } from 'zod';

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3',
  openrouter: 'anthropic/claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  deepseek: 'deepseek-chat',
};

export class LLMError extends Error {
  constructor(
    message: string,
    public provider: LLMProvider,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }

  isRetryable(): boolean {
    if (!this.statusCode) return true; // Network errors are retryable
    return this.statusCode === 429 || this.statusCode >= 500;
  }
}

export class LLMClient {
  private provider: LLMProvider;
  private apiKey?: string;
  private model: string;
  private anthropicClient: any;

  constructor(config: { provider: LLMProvider; apiKey?: string; model?: string }) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODELS[config.provider];

    if (this.provider === 'anthropic' && this.apiKey) {
      try {
        this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
      } catch { /* will use HTTP fallback */ }
    }
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    switch (this.provider) {
      case 'anthropic': return this.callAnthropic(prompt, systemPrompt);
      case 'openai': return this.callOpenAI(prompt, systemPrompt);
      case 'ollama': return this.callOllama(prompt, systemPrompt);
      case 'openrouter': return this.callOpenRouter(prompt, systemPrompt);
      default: throw new LLMError(`Unknown provider: ${this.provider}`, this.provider);
    }
  }

  async completeWithSchema<T>(prompt: string, schema: ZodSchema<T>, systemPrompt?: string): Promise<T> {
    const jsonPrompt = prompt + '\n\nRespond with valid JSON only. No markdown, no code fences, no explanation — just the JSON.';
    const response = await this.complete(jsonPrompt, systemPrompt);

    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return schema.parse(parsed);
    } catch {
      // Retry once with stronger instruction
      const retryPrompt = jsonPrompt + '\n\nIMPORTANT: Your previous response was not valid JSON. Output ONLY the raw JSON array/object.';
      const retryResponse = await this.complete(retryPrompt, systemPrompt);
      const cleaned = retryResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return schema.parse(parsed);
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private async callAnthropic(prompt: string, systemPrompt?: string): Promise<string> {
    if (this.anthropicClient) {
      return this.retry(async () => {
        const response = await this.anthropicClient.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt || 'You are a helpful AI assistant.',
          messages: [{ role: 'user', content: prompt }],
        });
        return response.content[0]?.text || '';
      });
    }

    // HTTP fallback
    return this.retry(async () => {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt || 'You are a helpful AI assistant.',
        messages: [{ role: 'user', content: prompt }],
      });

      return this.httpsRequest({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
      }, body);
    });
  }

  private async callOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
    return this.retry(async () => {
      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      });

      return this.httpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }, body);
    });
  }

  private async callOllama(prompt: string, systemPrompt?: string): Promise<string> {
    return this.retry(async () => {
      const body = JSON.stringify({
        model: this.model,
        prompt,
        system: systemPrompt || 'You are a helpful AI assistant.',
        stream: false,
      });

      return this.httpRequest({
        hostname: 'localhost',
        port: 11434,
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, body);
    });
  }

  private async callOpenRouter(prompt: string, systemPrompt?: string): Promise<string> {
    return this.retry(async () => {
      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      });

      return this.httpsRequest({
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/theihtisham/agent-shadow-brain',
        },
      }, body);
    });
  }

  private async retry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;

        if (err instanceof LLMError && !err.isRetryable()) {
          throw err;
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  private httpsRequest(options: https.RequestOptions, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new LLMError(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`, this.provider, res.statusCode));
            return;
          }

          try {
            const json = JSON.parse(data);
            // OpenAI / OpenRouter format
            if (json.choices?.[0]?.message?.content) {
              resolve(json.choices[0].message.content);
              return;
            }
            // Anthropic format
            if (json.content?.[0]?.text) {
              resolve(json.content[0].text);
              return;
            }
            resolve(data);
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', (err) => reject(new LLMError(err.message, this.provider)));
      req.write(body);
      req.end();
    });
  }

  private httpRequest(options: http.RequestOptions, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new LLMError(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`, this.provider, res.statusCode));
            return;
          }

          try {
            const json = JSON.parse(data);
            // Ollama format
            if (json.response) {
              resolve(json.response);
              return;
            }
            resolve(data);
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', (err) => reject(new LLMError(err.message, this.provider)));
      req.write(body);
      req.end();
    });
  }
}
