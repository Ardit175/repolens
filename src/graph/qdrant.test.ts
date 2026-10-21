import { describe, expect, it } from 'vitest';
import { makeEdge } from './contract.js';
import { QdrantGraphStore } from './qdrant.js';

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
  const store = new QdrantGraphStore({ url: 'http://qdrant:6333/', apiKey, fetch: fakeFetch });
  return { store, calls };
}

const BASE = 'http://qdrant:6333/collections/repolens_graph';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('QdrantGraphStore', () => {
  describe('ensure', () => {
    it('creates a 1-dimension collection when it does not exist', async () => {
      const { store, calls } = setup([json({}, 404), json({ result: true })]);
      await store.ensure();
      expect(calls[0]).toMatchObject({ url: BASE, method: 'GET' });
      expect(calls[1]).toMatchObject({
        url: BASE,
        method: 'PUT',
        body: { vectors: { size: 1, distance: 'Dot' } },
      });
    });

    it('does nothing when the collection exists', async () => {
      const { store, calls } = setup([json({ result: {} })]);
      await store.ensure();
      expect(calls).toHaveLength(1);
    });
  });

  describe('replaceFile', () => {
    it('deletes the path, then upserts edges in batches of 100 with the marker last', async () => {
      const edges = Array.from({ length: 150 }, (_, i) => makeEdge('src/a.ts', { line: i + 1 }));
      const { store, calls } = setup([json({}), json({}), json({})]);
      await store.replaceFile('src/a.ts', 'hash-1', edges);
      expect(calls[0]).toMatchObject({
        url: `${BASE}/points/delete?wait=true`,
        body: { filter: { must: [{ key: 'path', match: { value: 'src/a.ts' } }] } },
      });
      expect(calls.slice(1).map((c) => c.body.points.length)).toEqual([100, 51]);
      expect(calls[1]).toMatchObject({ url: `${BASE}/points?wait=true`, method: 'PUT' });
      const first = calls[1]!.body.points[0];
      expect(first.id).toMatch(UUID);
      expect(first.vector).toEqual([0]);
      expect(first.payload).toEqual(edges[0]);
      const marker = calls[2]!.body.points.at(-1);
      expect(marker.payload).toEqual({ path: 'src/a.ts', marker: true, hash: 'hash-1' });
      const ids = calls.slice(1).flatMap((c) => c.body.points.map((p: { id: string }) => p.id));
      expect(new Set(ids).size).toBe(151);
    });

    it('writes only the marker for a file without edges, with a stable id', async () => {
      const { store, calls } = setup([json({}), json({}), json({}), json({})]);
      await store.replaceFile('a.ts', 'h', []);
      await store.replaceFile('a.ts', 'h', []);
      expect(calls[1]!.body.points).toHaveLength(1);
      expect(calls[1]!.body.points[0].id).toBe(calls[3]!.body.points[0].id);
    });
  });

  it('deleteByPath filters on payload path', async () => {
    const { store, calls } = setup([json({})]);
    await store.deleteByPath('src/a.ts');
    expect(calls[0]).toMatchObject({
      url: `${BASE}/points/delete?wait=true`,
      body: { filter: { must: [{ key: 'path', match: { value: 'src/a.ts' } }] } },
    });
  });

  describe('listHashes', () => {
    it('scrolls marker points across pages', async () => {
      const { store, calls } = setup([
        json({
          result: {
            points: [{ payload: { path: 'a.ts', hash: 'h1' } }, { payload: {} }, {}],
            next_page_offset: 'p2',
          },
        }),
        json({ result: { points: [{ payload: { path: 'b.ts', hash: 'h2' } }] } }),
      ]);
      expect(await store.listHashes()).toEqual(
        new Map([
          ['a.ts', 'h1'],
          ['b.ts', 'h2'],
        ]),
      );
      expect(calls[0]!.body).toMatchObject({
        with_payload: ['path', 'hash'],
        filter: { must: [{ key: 'marker', match: { value: true } }] },
      });
      expect(calls[1]!.body.offset).toBe('p2');
    });
  });

  describe('findEdges', () => {
    it('filters by every field, excludes markers, pages and sorts', async () => {
      const late = makeEdge('b.ts', { line: 1 });
      const early = makeEdge('a.ts', { line: 9 });
      const { store, calls } = setup([
        json({ result: { points: [{ payload: late }], next_page_offset: 'p2' } }),
        json({ result: { points: [{ payload: early }] } }),
      ]);
      const edges = await store.findEdges({
        kind: 'call',
        target: 'run',
        from: 'main',
        path: 'a.ts',
      });
      expect(edges).toEqual([early, late]);
      expect(calls[0]!.body.filter).toEqual({
        must: [
          { key: 'kind', match: { value: 'call' } },
          { key: 'target', match: { value: 'run' } },
          { key: 'from', match: { value: 'main' } },
          { key: 'path', match: { value: 'a.ts' } },
        ],
        must_not: [{ key: 'marker', match: { value: true } }],
      });
      expect(calls[0]!.body).toMatchObject({ with_payload: true, with_vector: false });
      expect(calls[1]!.body.offset).toBe('p2');
    });

    it('honours the limit', async () => {
      const { store } = setup([
        json({
          result: { points: [{ payload: makeEdge('a.ts') }, { payload: makeEdge('b.ts') }] },
        }),
      ]);
      expect(await store.findEdges({ limit: 1 })).toHaveLength(1);
    });
  });

  describe('errors and auth', () => {
    it('throws with status and a truncated body, without the api key', async () => {
      const { store } = setup([new Response('x'.repeat(1000), { status: 500 })], 'secret-key');
      const error = (await store.listHashes().catch((e: Error) => e)) as Error;
      expect(error.message).toContain('500');
      expect(error.message.length).toBeLessThan(400);
      expect(error.message).not.toContain('secret-key');
    });

    it('sends the api-key header only when configured', async () => {
      const withKey = setup([json({})], 'secret-key');
      await withKey.store.deleteByPath('a.ts');
      expect(withKey.calls[0]!.headers['api-key']).toBe('secret-key');
      const without = setup([json({})]);
      await without.store.deleteByPath('a.ts');
      expect(without.calls[0]!.headers['api-key']).toBeUndefined();
    });
  });

  it('defaults to the global fetch', () => {
    expect(() => new QdrantGraphStore({ url: 'http://localhost:6333' })).not.toThrow();
  });
});
