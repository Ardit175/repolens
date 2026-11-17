import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDEX,
  dropIndex,
  graphCollection,
  listIndexes,
  qdrantConnection,
  resolveIndexName,
  validateIndexName,
  type QdrantConnection,
} from './indexes.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
  key: string | null;
}

interface FakeOptions {
  collections: Record<string, { size: number; count: number; graphFiles?: number }>;
  /** Extra graph-only collections (no chunk collection). */
  orphanGraphs?: string[];
}

/** A tiny fake Qdrant: collection list, info, count and delete. */
function fakeQdrant(options: FakeOptions): { conn: QdrantConnection; calls: Call[] } {
  const calls: Call[] = [];
  const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });
  const fetchFn = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url: input, body, key: new Headers(init.headers).get('api-key') });
    const path = url.pathname;
    const names = Object.keys(options.collections);
    const graphs = [
      ...names
        .filter((n) => options.collections[n]!.graphFiles !== undefined)
        .map((n) => `${n}_graph`),
      ...(options.orphanGraphs ?? []),
    ];
    if (path === '/collections') {
      return json({ result: { collections: [...graphs, ...names].map((name) => ({ name })) } });
    }
    const match = /^\/collections\/([^/]+)(\/points\/count)?$/.exec(path);
    const name = match![1]!;
    const isGraph = name.endsWith('_graph');
    const base = isGraph ? name.slice(0, -'_graph'.length) : name;
    const known = isGraph ? graphs.includes(name) : names.includes(name);
    if (!known) return new Response('not found', { status: 404 });
    if (method === 'DELETE') return json({ result: true });
    if (match![2]) {
      const info = options.collections[base]!;
      return json({ result: { count: isGraph ? info.graphFiles : info.count } });
    }
    return json({
      result: { config: { params: { vectors: { size: options.collections[base]?.size ?? 1 } } } },
    });
  }) as unknown as typeof fetch;
  return { conn: { url: 'http://q:6333/', fetch: fetchFn }, calls };
}

describe('validateIndexName', () => {
  it.each(['repolens', 'web', 'my-repo_2', 'A', 'a'.repeat(48)])('accepts %s', (name) => {
    expect(validateIndexName(name)).toBe(name);
  });

  it.each(['x y', '', 'a'.repeat(49), 'web_graph', '-web', '_web', 'a/b', 'é'])(
    'rejects %j',
    (name) => {
      expect(() => validateIndexName(name)).toThrow(
        `Invalid index name "${name}": use 1-48 letters`,
      );
    },
  );
});

describe('resolveIndexName', () => {
  it('prefers the option over the environment', () => {
    expect(resolveIndexName('a', { REPOLENS_INDEX: 'b' })).toBe('a');
  });

  it('falls back to REPOLENS_INDEX, then the default', () => {
    expect(resolveIndexName(undefined, { REPOLENS_INDEX: 'b' })).toBe('b');
    expect(resolveIndexName(undefined, {})).toBe(DEFAULT_INDEX);
    expect(resolveIndexName(undefined, { REPOLENS_INDEX: '' })).toBe(DEFAULT_INDEX);
  });

  it('reads process.env by default', () => {
    const saved = process.env.REPOLENS_INDEX;
    process.env.REPOLENS_INDEX = 'from-process';
    try {
      expect(resolveIndexName()).toBe('from-process');
    } finally {
      if (saved === undefined) delete process.env.REPOLENS_INDEX;
      else process.env.REPOLENS_INDEX = saved;
    }
  });

  it('throws for an invalid name from either source', () => {
    expect(() => resolveIndexName('x y', {})).toThrow('Invalid index name');
    expect(() => resolveIndexName(undefined, { REPOLENS_INDEX: 'a_graph' })).toThrow(
      'Invalid index name',
    );
  });
});

describe('graphCollection', () => {
  it('appends _graph', () => {
    expect(graphCollection('web')).toBe('web_graph');
  });
});

describe('qdrantConnection', () => {
  it('reads url and api key', () => {
    expect(qdrantConnection({ QDRANT_URL: 'http://q', QDRANT_API_KEY: 'k' })).toEqual({
      url: 'http://q',
      apiKey: 'k',
    });
    expect(qdrantConnection({ QDRANT_URL: 'http://q' })).toEqual({ url: 'http://q' });
  });

  it('explains how to start Qdrant when the url is missing', () => {
    expect(() => qdrantConnection({})).toThrow('docker compose up -d qdrant');
  });
});

describe('listIndexes', () => {
  it('lists chunk collections sorted by name with graph file counts', async () => {
    const { conn, calls } = fakeQdrant({
      collections: {
        web: { size: 384, count: 10, graphFiles: 3 },
        api: { size: 1536, count: 7 },
        repolens: { size: 1536, count: 2, graphFiles: 1 },
      },
      orphanGraphs: ['lost_graph'],
    });
    expect(await listIndexes(conn)).toEqual([
      { name: 'api', chunks: 7, graphFiles: 0, dimensions: 1536 },
      { name: 'repolens', chunks: 2, graphFiles: 1, dimensions: 1536 },
      { name: 'web', chunks: 10, graphFiles: 3, dimensions: 384 },
    ]);
    const graphCount = calls.find((c) => c.url.endsWith('/collections/web_graph/points/count'));
    expect(graphCount?.method).toBe('POST');
    expect(graphCount?.body).toEqual({
      exact: true,
      filter: { must: [{ key: 'marker', match: { value: true } }] },
    });
    expect(calls.some((c) => c.url.includes('lost_graph'))).toBe(false);
  });

  it('returns an empty list when Qdrant has no collections', async () => {
    expect(await listIndexes(fakeQdrant({ collections: {} }).conn)).toEqual([]);
  });

  it('sends the api key on every request', async () => {
    const { conn, calls } = fakeQdrant({
      collections: { web: { size: 4, count: 1, graphFiles: 1 } },
    });
    await listIndexes({ ...conn, apiKey: 'secret' });
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((c) => c.key === 'secret')).toBe(true);
  });

  it('omits the api key header when none is set', async () => {
    const { conn, calls } = fakeQdrant({ collections: { web: { size: 4, count: 1 } } });
    await listIndexes(conn);
    expect(calls.every((c) => c.key === null)).toBe(true);
  });

  it('throws with method, path, status and a truncated body on errors', async () => {
    const conn: QdrantConnection = {
      url: 'http://q:6333',
      fetch: (async () =>
        new Response('x'.repeat(1000), { status: 500 })) as unknown as typeof fetch,
    };
    const error = await listIndexes(conn).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/^Qdrant GET \/collections failed with 500: x{300}$/);
  });

  it('uses the global fetch when none is injected', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: { collections: [] } }))) as unknown as typeof fetch;
    try {
      expect(await listIndexes({ url: 'http://q' })).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('dropIndex', () => {
  it('deletes both collections', async () => {
    const { conn, calls } = fakeQdrant({
      collections: { web: { size: 4, count: 1, graphFiles: 1 } },
    });
    expect(await dropIndex(conn, 'web')).toEqual({ chunks: true, graph: true });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /collections/web',
      'DELETE /collections/web',
      'GET /collections/web_graph',
      'DELETE /collections/web_graph',
    ]);
  });

  it('reports only the collection that existed', async () => {
    const chunksOnly = fakeQdrant({ collections: { web: { size: 4, count: 1 } } });
    expect(await dropIndex(chunksOnly.conn, 'web')).toEqual({ chunks: true, graph: false });
    const graphOnly = fakeQdrant({ collections: {}, orphanGraphs: ['web_graph'] });
    expect(await dropIndex(graphOnly.conn, 'web')).toEqual({ chunks: false, graph: true });
  });

  it('reports nothing when neither existed', async () => {
    expect(await dropIndex(fakeQdrant({ collections: {} }).conn, 'web')).toEqual({
      chunks: false,
      graph: false,
    });
  });

  it('validates the name before calling Qdrant', async () => {
    const { conn, calls } = fakeQdrant({ collections: {} });
    await expect(dropIndex(conn, 'web_graph')).rejects.toThrow('Invalid index name');
    expect(calls).toEqual([]);
  });

  it('throws on non-404 errors and sends the api key', async () => {
    const seen: (string | null)[] = [];
    const conn: QdrantConnection = {
      url: 'http://q:6333',
      apiKey: 'k',
      fetch: (async (_u: string, init: RequestInit) => {
        seen.push(new Headers(init.headers).get('api-key'));
        return new Response('denied', { status: 403 });
      }) as unknown as typeof fetch,
    };
    await expect(dropIndex(conn, 'web')).rejects.toThrow(
      'Qdrant GET /collections/web failed with 403: denied',
    );
    expect(seen).toEqual(['k']);
  });
});
