import { describe, expect, it, vi } from 'vitest';
import { AzureEmbeddingProvider } from './azure.js';

const KEY = 'super-secret-key';
const config = { endpoint: 'https://example.openai.azure.com/', apiKey: KEY, deployment: 'emb' };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function okFetch() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    const data = input.map((text, index) => ({ index, embedding: [text.length] })).reverse();
    return jsonResponse({ data });
  });
}

describe('AzureEmbeddingProvider', () => {
  it('exposes name and dimensions', () => {
    const provider = new AzureEmbeddingProvider(config);
    expect(provider.name).toBe('azure');
    expect(provider.dimensions).toBe(1536);
  });

  it('returns [] for empty input without calling fetch', async () => {
    const fetch = okFetch();
    expect(await new AzureEmbeddingProvider({ ...config, fetch }).embed([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts to the deployment URL with the api-key header and sorts by index', async () => {
    const fetch = okFetch();
    const provider = new AzureEmbeddingProvider({ ...config, fetch });
    expect(await provider.embed(['a', 'bb', 'ccc'])).toEqual([[1], [2], [3]]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://example.openai.azure.com/openai/deployments/emb/embeddings?api-version=2024-02-01',
    );
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['api-key']).toBe(KEY);
    expect(JSON.parse(String(init?.body))).toEqual({ input: ['a', 'bb', 'ccc'] });
  });

  it('uses a custom api version', async () => {
    const fetch = okFetch();
    await new AzureEmbeddingProvider({ ...config, apiVersion: '2025-01-01', fetch }).embed(['a']);
    expect(String(fetch.mock.calls[0]![0])).toContain('api-version=2025-01-01');
  });

  it('batches 16 texts per request and keeps order across batches', async () => {
    const fetch = okFetch();
    const texts = Array.from({ length: 40 }, (_, i) => 'x'.repeat(i + 1));
    const result = await new AzureEmbeddingProvider({ ...config, fetch }).embed(texts);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual(texts.map((text) => [text.length]));
  });

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const ok = okFetch();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      )
      .mockImplementation(ok);
    const provider = new AzureEmbeddingProvider({ ...config, fetch, retry: { sleep } });
    expect(await provider.embed(['a'])).toEqual([[1]]);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries 5xx with backoff and gives up after the retries', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fetch = vi.fn(async () => new Response('down', { status: 503 }));
    const provider = new AzureEmbeddingProvider({ ...config, fetch, retry: { sleep } });
    await expect(provider.embed(['a'])).rejects.toThrow('status 503');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
  });

  it('does not retry other errors, truncates the body and never leaks the key', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const body = `invalid key ${KEY} ${'x'.repeat(1000)}`;
    const fetch = vi.fn(async () => new Response(body, { status: 401 }));
    const provider = new AzureEmbeddingProvider({ ...config, fetch, retry: { sleep } });
    const error = await provider.embed(['a']).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('status 401');
    expect(message).not.toContain(KEY);
    expect(message.length).toBeLessThan(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('copes with an unreadable error body', async () => {
    const response = new Response('x', { status: 400 });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('boom'));
    const provider = new AzureEmbeddingProvider({ ...config, fetch: async () => response });
    await expect(provider.embed(['a'])).rejects.toThrow('status 400');
  });

  it('ignores an unparseable Retry-After header', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const ok = okFetch();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': 'soon' } }))
      .mockImplementation(ok);
    await new AzureEmbeddingProvider({ ...config, fetch, retry: { sleep } }).embed(['a']);
    expect(sleep).toHaveBeenCalledWith(500);
  });
});
