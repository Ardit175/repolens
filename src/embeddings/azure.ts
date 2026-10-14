import { embedInBatches, RetryableError, type RetryOptions } from './batching.js';
import type { EmbeddingProvider } from './types.js';

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

interface EmbeddingsResponse {
  data: { index: number; embedding: number[] }[];
}

const BATCH_SIZE = 16;
const MAX_ERROR_BODY = 300;

export class AzureEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'azure';
  readonly dimensions = 1536;

  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly retry: RetryOptions;

  constructor(config: AzureConfig) {
    const endpoint = config.endpoint.replace(/\/+$/, '');
    const apiVersion = config.apiVersion ?? '2024-02-01';
    this.url = `${endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=${encodeURIComponent(apiVersion)}`;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? fetch;
    this.retry = config.retry ?? {};
  }

  embed(texts: string[]): Promise<number[][]> {
    return embedInBatches(texts, BATCH_SIZE, (batch) => this.request(batch), this.retry);
  }

  private async request(input: string[]): Promise<number[][]> {
    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    if (!response.ok) throw await this.errorFor(response);
    const body = (await response.json()) as EmbeddingsResponse;
    return [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }

  private async errorFor(response: Response): Promise<Error> {
    const text = (await response.text().catch(() => '')).replaceAll(this.apiKey, '[redacted]');
    const message = `Azure embeddings request failed with status ${response.status}: ${text.slice(0, MAX_ERROR_BODY)}`;
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
      return new RetryableError(message, retryAfterMs);
    }
    return new Error(message);
  }
}
