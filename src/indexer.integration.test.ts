import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QdrantGraphStore } from './graph/store.js';
import { indexRepository } from './indexer.js';
import { searchIndex } from './search.js';
import { QdrantVectorStore } from './store/index.js';
import { FakeEmbeddingProvider } from './testing.js';

const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;

describe.skipIf(!url)('index and search against real Qdrant', () => {
  const collection = `repolens-test-${randomUUID()}`;
  const graphCollection = `${collection}-graph`;
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'repolens-e2e-'));
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(
      path.join(dir, 'src/db.ts'),
      'export function openDatabase() { return connect(); }\n',
    );
    writeFileSync(path.join(dir, 'tool.py'), 'def render_report():\n    return "report"\n');
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    for (const name of [collection, graphCollection]) {
      await fetch(`${url}/collections/${name}`, {
        method: 'DELETE',
        headers: apiKey ? { 'api-key': apiKey } : {},
      });
    }
  });

  it('indexes, skips unchanged files on the second run and finds the right chunk', async () => {
    const store = new QdrantVectorStore({ url: url!, collection, ...(apiKey ? { apiKey } : {}) });
    const embeddings = new FakeEmbeddingProvider();

    const graph = new QdrantGraphStore({
      url: url!,
      collection: graphCollection,
      ...(apiKey ? { apiKey } : {}),
    });

    const first = await indexRepository({ root: dir, store, embeddings, graph });
    expect(first).toMatchObject({ filesChanged: 2, chunksEmbedded: 2, graphFilesUpdated: 2 });
    expect((await graph.listHashes()).size).toBe(2);

    const second = await indexRepository({ root: dir, store, embeddings, graph });
    expect(second).toMatchObject({
      filesChanged: 0,
      filesUnchanged: 2,
      chunksEmbedded: 0,
      graphFilesUpdated: 0,
    });

    const hits = await searchIndex({ store, embeddings, query: 'open database connect', limit: 1 });
    expect(hits[0]?.chunk.path).toBe('src/db.ts');
    const filtered = await searchIndex({
      store,
      embeddings,
      query: 'report',
      limit: 5,
      filter: { language: 'python' },
    });
    expect(filtered.map((h) => h.chunk.path)).toEqual(['tool.py']);
  });
});
