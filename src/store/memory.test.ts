import { describe, expect, it } from 'vitest';
import { runVectorStoreContract, makeChunk, stored } from './contract.js';
import { chunkId } from './ids.js';
import { InMemoryVectorStore } from './memory.js';

runVectorStoreContract('InMemory', async () => new InMemoryVectorStore());

describe('InMemoryVectorStore', () => {
  it('throws on a dimension mismatch in upsert and search', async () => {
    const store = new InMemoryVectorStore();
    await store.ensureCollection(3);
    await expect(store.upsert([stored(makeChunk('a.ts'), [1, 0])])).rejects.toThrow(/2 dimensions/);
    await expect(store.search([1, 0], 5)).rejects.toThrow(/expects 3/);
    expect(await store.count()).toBe(0);
  });

  it('scores a zero vector as 0', async () => {
    const store = new InMemoryVectorStore();
    await store.ensureCollection(2);
    await store.upsert([stored(makeChunk('a.ts'), [0, 0])]);
    const [hit] = await store.search([1, 0], 1);
    expect(hit?.score).toBe(0);
  });
});

describe('chunkId', () => {
  it('is a deterministic UUID-shaped string that depends on path, line and hash', () => {
    const chunk = makeChunk('src/a.ts');
    expect(chunkId(chunk)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(chunkId({ ...chunk })).toBe(chunkId(chunk));
    expect(chunkId({ ...chunk, startLine: 2 })).not.toBe(chunkId(chunk));
    expect(chunkId({ ...chunk, hash: 'other' })).not.toBe(chunkId(chunk));
    expect(chunkId({ ...chunk, path: 'src/b.ts' })).not.toBe(chunkId(chunk));
  });
});
