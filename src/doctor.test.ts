import { describe, expect, it } from 'vitest';
import { formatDoctor, runDoctor } from './doctor.js';

const okFetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
const azureEnv = {
  AZURE_OPENAI_ENDPOINT: 'https://x',
  AZURE_OPENAI_API_KEY: 'k',
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'd',
};

const byName = (results: Awaited<ReturnType<typeof runDoctor>>, name: string) =>
  results.find((r) => r.name === name)!;

describe('runDoctor', () => {
  it('passes with local embeddings and a reachable Qdrant', async () => {
    const results = await runDoctor({
      env: { QDRANT_URL: 'http://q:6333/' },
      nodeVersion: 'v22.1.0',
      fetch: okFetch,
    });
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(byName(results, 'Embeddings').detail).toContain('local');
  });

  it('fails on an old Node version', async () => {
    const results = await runDoctor({
      env: { QDRANT_URL: 'http://q' },
      nodeVersion: 'v20.11.0',
      fetch: okFetch,
    });
    expect(byName(results, 'Node.js').status).toBe('fail');
  });

  it('fails with a hint when QDRANT_URL is missing', async () => {
    const results = await runDoctor({ env: {}, nodeVersion: 'v22.0.0' });
    expect(byName(results, 'Qdrant')).toMatchObject({ status: 'fail' });
    expect(byName(results, 'Qdrant').detail).toContain('docker compose up -d qdrant');
  });

  it('reports an unreachable Qdrant and a non-200 answer', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const bad = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const env = { QDRANT_URL: 'http://q' };
    expect(byName(await runDoctor({ env, fetch: down }), 'Qdrant').detail).toContain(
      'ECONNREFUSED',
    );
    expect(byName(await runDoctor({ env, fetch: bad }), 'Qdrant').detail).toContain('HTTP 401');
  });

  it('sends the API key to Qdrant', async () => {
    let header: unknown;
    const spy = (async (_url: unknown, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)['api-key'];
      return new Response('{}');
    }) as typeof fetch;
    await runDoctor({ env: { QDRANT_URL: 'http://q', QDRANT_API_KEY: 'secret' }, fetch: spy });
    expect(header).toBe('secret');
  });

  it('checks the embedding configuration', async () => {
    const opts = { fetch: okFetch };
    const azure = await runDoctor({ ...opts, env: { QDRANT_URL: 'http://q', ...azureEnv } });
    expect(byName(azure, 'Embeddings').detail).toBe('Azure OpenAI');
    const partial = await runDoctor({
      ...opts,
      env: { QDRANT_URL: 'http://q', REPOLENS_EMBEDDINGS: 'azure' },
    });
    expect(byName(partial, 'Embeddings')).toMatchObject({ status: 'fail' });
    const invalid = await runDoctor({
      ...opts,
      env: { QDRANT_URL: 'http://q', REPOLENS_EMBEDDINGS: 'gpu' },
    });
    expect(byName(invalid, 'Embeddings').status).toBe('fail');
  });
});

describe('formatDoctor', () => {
  it('prints one aligned line per check', () => {
    const text = formatDoctor([
      { name: 'Node.js', status: 'ok', detail: 'v22' },
      { name: 'Qdrant', status: 'fail', detail: 'down' },
    ]);
    expect(text).toBe('ok    Node.js  v22\nFAIL  Qdrant   down\n');
  });
});
