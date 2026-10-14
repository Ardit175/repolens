import { describe, expect, it } from 'vitest';
import { makeChunk, stored } from './contract.js';
import { QdrantVectorStore } from './qdrant.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  // Request bodies are arbitrary JSON; tests assert on their shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(responses: Response[], apiKey?: string) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  }) as unknown as typeof fetch;
  const store = new QdrantVectorStore({
    url: 'http://qdrant:6333/',
    apiKey,
    fetch: fakeFetch,
  });
  return { store, calls };
}

const collectionInfo = (size: number) =>
  json({ result: { config: { params: { vectors: { size } } } } });

describe('QdrantVectorStore', () => {
  describe('ensureCollection', () => {
    it('creates a Cosine collection when it does not exist', async () => {
      const { store, calls } = setup([json({}, 404), json({ result: true })]);
      await store.ensureCollection(384);
      expect(calls[0]).toMatchObject({
        url: 'http://qdrant:6333/collections/repolens',
        method: 'GET',
      });
      expect(calls[1]).toMatchObject({
        url: 'http://qdrant:6333/collections/repolens',
        method: 'PUT',
        body: { vectors: { size: 384, distance: 'Cosine' } },
      });
    });

    it('does nothing when the size matches', async () => {
      const { store, calls } = setup([collectionInfo(384)]);
      await store.ensureCollection(384);
      expect(calls).toHaveLength(1);
    });

    it('throws when the size differs', async () => {
      const { store } = setup([collectionInfo(1536)]);
      await expect(store.ensureCollection(384)).rejects.toThrow(/1536 dimensions, but 384/);
    });
  });

  describe('upsert', () => {
    it('sends points in batches of 100 with chunk payload and dir_prefixes', async () => {
      const items = Array.from({ length: 205 }, (_, i) =>
        stored(makeChunk(`src/a/f${i}.ts`), [1, 0, 0]),
      );
      const { store, calls } = setup([json({}), json({}), json({})]);
      await store.upsert(items);
      expect(calls.map((c) => c.body.points.length)).toEqual([100, 100, 5]);
      expect(calls[0]).toMatchObject({
        url: 'http://qdrant:6333/collections/repolens/points?wait=true',
        method: 'PUT',
      });
      const point = calls[0]!.body.points[0];
      expect(point.id).toBe(items[0]!.id);
      expect(point.vector).toEqual([1, 0, 0]);
      expect(point.payload).toMatchObject({ ...items[0]!.chunk, dir_prefixes: ['src/', 'src/a/'] });
    });

    it('sends no request for an empty list and no prefixes for a root file', async () => {
      const { store, calls } = setup([json({})]);
      await store.upsert([]);
      expect(calls).toHaveLength(0);
      await store.upsert([stored(makeChunk('a.ts'), [1])]);
      expect(calls[0]!.body.points[0].payload.dir_prefixes).toEqual([]);
    });
  });

  it('deleteByPath filters on payload path', async () => {
    const { store, calls } = setup([json({})]);
    await store.deleteByPath('src/a.ts');
    expect(calls[0]).toMatchObject({
      url: 'http://qdrant:6333/collections/repolens/points/delete?wait=true',
      method: 'POST',
      body: { filter: { must: [{ key: 'path', match: { value: 'src/a.ts' } }] } },
    });
  });

  describe('listHashesByPath', () => {
    it('follows next_page_offset and groups hashes by path', async () => {
      const { store, calls } = setup([
        json({
          result: {
            points: [
              { payload: { path: 'a.ts', hash: 'h1' } },
              { payload: { path: 'a.ts', hash: 'h2' } },
              { payload: {} },
            ],
            next_page_offset: 'page-2',
          },
        }),
        json({
          result: { points: [{ payload: { path: 'b.ts', hash: 'h3' } }], next_page_offset: null },
        }),
      ]);
      const map = await store.listHashesByPath();
      expect(map).toEqual(
        new Map([
          ['a.ts', ['h1', 'h2']],
          ['b.ts', ['h3']],
        ]),
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]!.body).toMatchObject({ with_payload: ['path', 'hash'], with_vector: false });
      expect(calls[0]!.body.offset).toBeUndefined();
      expect(calls[1]!.body.offset).toBe('page-2');
      expect(calls[1]!.url).toBe('http://qdrant:6333/collections/repolens/points/scroll');
    });
  });

  describe('search', () => {
    it('sends the vector without a filter and strips dir_prefixes from hits', async () => {
      const chunk = makeChunk('src/a.ts');
      const { store, calls } = setup([
        json({ result: [{ score: 0.9, payload: { ...chunk, dir_prefixes: ['src/'] } }] }),
      ]);
      const hits = await store.search([1, 0, 0], 5);
      expect(calls[0]!.url).toBe('http://qdrant:6333/collections/repolens/points/search');
      expect(calls[0]!.body).toEqual({ vector: [1, 0, 0], limit: 5, with_payload: true });
      expect(hits).toEqual([{ chunk, score: 0.9 }]);
    });

    it('builds a filter from language and path prefix', async () => {
      const { store, calls } = setup([json({ result: [] })]);
      await store.search([1], 3, { language: 'python', pathPrefix: 'src/a/' });
      expect(calls[0]!.body.filter).toEqual({
        must: [
          { key: 'language', match: { value: 'python' } },
          { key: 'dir_prefixes', match: { value: 'src/a/' } },
        ],
      });
    });
  });

  it('count asks for an exact count', async () => {
    const { store, calls } = setup([json({ result: { count: 42 } })]);
    expect(await store.count()).toBe(42);
    expect(calls[0]).toMatchObject({ method: 'POST', body: { exact: true } });
  });

  describe('errors and auth', () => {
    it('throws with status and a truncated body, without the api key', async () => {
      const { store } = setup([new Response('x'.repeat(1000), { status: 500 })], 'secret-key');
      const error = await store.count().catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('500');
      expect(message.length).toBeLessThan(400);
      expect(message).not.toContain('secret-key');
    });

    it('sends the api-key header only when configured', async () => {
      const withKey = setup([json({ result: { count: 0 } })], 'secret-key');
      await withKey.store.count();
      expect(withKey.calls[0]!.headers['api-key']).toBe('secret-key');
      const without = setup([json({ result: { count: 0 } })]);
      await without.store.count();
      expect(without.calls[0]!.headers['api-key']).toBeUndefined();
    });
  });

  it('defaults to the global fetch and the repolens collection', () => {
    expect(() => new QdrantVectorStore({ url: 'http://localhost:6333' })).not.toThrow();
  });
});
