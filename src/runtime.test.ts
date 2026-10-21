import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime.js';

describe('createRuntime', () => {
  it('explains how to start Qdrant when QDRANT_URL is missing', () => {
    expect(() => createRuntime({})).toThrow('docker compose up -d qdrant');
  });

  it('builds a Qdrant store and local embeddings from the environment', () => {
    const runtime = createRuntime({
      QDRANT_URL: 'http://localhost:6333',
      REPOLENS_EMBEDDINGS: 'local',
    });
    expect(runtime.embeddings.name).toContain('local');
    expect(runtime.store).toBeDefined();
    expect(runtime.graph).toBeDefined();
  });

  it('points the graph store at its own collection with the same url and key', async () => {
    const urls: string[] = [];
    const keys: (string | null)[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      urls.push(url);
      keys.push(new Headers(init.headers).get('api-key'));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const runtime = createRuntime({
        QDRANT_URL: 'http://qdrant:6333',
        QDRANT_API_KEY: 'k',
        REPOLENS_EMBEDDINGS: 'local',
      });
      await runtime.graph.ensure();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(urls).toEqual(['http://qdrant:6333/collections/repolens_graph']);
    expect(keys).toEqual(['k']);
  });
});
