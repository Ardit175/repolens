import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { QdrantGraphStore } from './graph/qdrant.js';
import { dropIndex, graphCollection, listIndexes, qdrantConnection } from './indexes.js';
import { QdrantVectorStore } from './store/qdrant.js';
import type { Chunk } from './chunker/types.js';

const url = process.env.QDRANT_URL;

function chunk(path: string): Chunk {
  return {
    path,
    language: 'typescript',
    name: 'run',
    kind: 'function',
    startLine: 1,
    endLine: 3,
    content: 'function run() {}',
    hash: `hash-${path}`,
  };
}

describe.skipIf(!url)('named indexes (Qdrant integration)', () => {
  const conn = () => qdrantConnection(process.env);
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) await dropIndex(conn(), name);
  });

  it('lists an index with its counts and drops both collections', async () => {
    const name = `repolens-test-${randomUUID().slice(0, 8)}`;
    created.push(name);
    const store = new QdrantVectorStore({ ...conn(), collection: name });
    await store.ensureCollection(3);
    await store.upsert([
      { id: randomUUID(), vector: [1, 0, 0], chunk: chunk('a.ts') },
      { id: randomUUID(), vector: [0, 1, 0], chunk: chunk('b.ts') },
    ]);
    const graph = new QdrantGraphStore({ ...conn(), collection: graphCollection(name) });
    await graph.ensure();
    await graph.replaceFile('a.ts', 'h1', [
      { path: 'a.ts', language: 'typescript', kind: 'import', target: 'x', line: 1 },
    ]);

    const found = (await listIndexes(conn())).find((i) => i.name === name);
    expect(found).toEqual({ name, chunks: 2, graphFiles: 1, dimensions: 3 });

    expect(await dropIndex(conn(), name)).toEqual({ chunks: true, graph: true });
    expect((await listIndexes(conn())).some((i) => i.name === name)).toBe(false);
    expect(await dropIndex(conn(), name)).toEqual({ chunks: false, graph: false });
  });
});
