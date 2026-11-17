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

  describe('named indexes', () => {
    async function collectUrls(run: () => Promise<void>): Promise<string[]> {
      const urls: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string) => {
        urls.push(url);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      try {
        await run();
      } finally {
        globalThis.fetch = realFetch;
      }
      return urls;
    }

    const base = { QDRANT_URL: 'http://qdrant:6333', REPOLENS_EMBEDDINGS: 'local' };

    it('uses the index option for the chunk and graph collections', async () => {
      const urls = await collectUrls(async () => {
        const runtime = createRuntime(base, { index: 'web' });
        await runtime.graph.ensure();
        await runtime.store.ensureCollection(0).catch(() => undefined);
      });
      expect(urls).toEqual([
        'http://qdrant:6333/collections/web_graph',
        'http://qdrant:6333/collections/web',
      ]);
    });

    it('uses REPOLENS_INDEX when no option is given', async () => {
      const urls = await collectUrls(async () => {
        await createRuntime({ ...base, REPOLENS_INDEX: 'api' }).graph.ensure();
      });
      expect(urls).toEqual(['http://qdrant:6333/collections/api_graph']);
    });

    it('rejects an invalid index name', () => {
      expect(() => createRuntime(base, { index: 'x y' })).toThrow('Invalid index name');
    });
  });
});
