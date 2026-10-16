import { describe, expect, it } from 'vitest';
import { chunkId, InMemoryVectorStore } from './store/index.js';
import { makeChunk } from './store/contract.js';
import { formatHits, searchIndex } from './search.js';
import { FakeEmbeddingProvider } from './testing.js';

async function seeded() {
  const store = new InMemoryVectorStore();
  const embeddings = new FakeEmbeddingProvider();
  await store.ensureCollection(embeddings.dimensions);
  const chunks = [
    makeChunk('src/auth/login.ts', {
      name: 'loginUser',
      content: 'function loginUser password token session',
    }),
    makeChunk('src/db/pool.ts', {
      name: 'createPool',
      content: 'function createPool database connection pool',
    }),
    makeChunk('scripts/seed.py', {
      name: 'seed',
      language: 'python',
      content: 'def seed database rows',
    }),
  ];
  const vectors = await embeddings.embed(chunks.map((c) => c.content));
  await store.upsert(
    chunks.map((chunk, i) => ({ id: chunkId(chunk), chunk, vector: vectors[i]! })),
  );
  return { store, embeddings };
}

describe('searchIndex', () => {
  it('ranks the chunk sharing the query words first', async () => {
    const { store, embeddings } = await seeded();
    const hits = await searchIndex({
      store,
      embeddings,
      query: 'database connection pool',
      limit: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.chunk.name).toBe('createPool');
  });

  it('applies path and language filters', async () => {
    const { store, embeddings } = await seeded();
    const byPath = await searchIndex({
      store,
      embeddings,
      query: 'database',
      limit: 5,
      filter: { pathPrefix: 'scripts/' },
    });
    expect(byPath.map((h) => h.chunk.path)).toEqual(['scripts/seed.py']);
    const byLanguage = await searchIndex({
      store,
      embeddings,
      query: 'database',
      limit: 5,
      filter: { language: 'python' },
    });
    expect(byLanguage.map((h) => h.chunk.name)).toEqual(['seed']);
  });

  it('rejects a blank query', async () => {
    const { store, embeddings } = await seeded();
    await expect(searchIndex({ store, embeddings, query: '   ', limit: 3 })).rejects.toThrow(
      'must not be empty',
    );
  });
});

describe('formatHits', () => {
  it('says so when there are no results', () => {
    expect(formatHits([])).toBe('No results.\n');
  });

  it('shows location, qualified symbol, score and a truncated preview', () => {
    const content = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunk = makeChunk('src/a.ts', {
      name: 'run',
      parent: 'Job',
      kind: 'method',
      startLine: 4,
      endLine: 12,
      content,
    });
    const text = formatHits([{ chunk, score: 0.91234 }]);
    expect(text).toContain('1. src/a.ts:4-12  Job.run (method, typescript)  score 0.912');
    expect(text).toContain('   | line 6');
    expect(text).not.toContain('line 7');
    expect(text).toContain('... (3 more lines)');
  });
});
