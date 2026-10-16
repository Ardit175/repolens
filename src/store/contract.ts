import { beforeEach, describe, expect, it } from 'vitest';
import type { Chunk } from '../chunker/types.js';
import { chunkId } from './ids.js';
import type { StoredChunk, VectorStore } from './types.js';

export function makeChunk(path: string, overrides: Partial<Chunk> = {}): Chunk {
  return {
    path,
    language: 'typescript',
    name: 'fn',
    kind: 'function',
    startLine: 1,
    endLine: 3,
    content: `function fn() {}`,
    hash: `hash-${path}-${overrides.startLine ?? 1}`,
    ...overrides,
  };
}

export function stored(chunk: Chunk, vector: number[]): StoredChunk {
  return { id: chunkId(chunk), vector, chunk };
}

/** Behavior every VectorStore must share. `makeStore` must return an empty, fresh store. */
export function runVectorStoreContract(name: string, makeStore: () => Promise<VectorStore>): void {
  describe(`${name} VectorStore contract`, () => {
    let store: VectorStore;

    beforeEach(async () => {
      store = await makeStore();
      await store.ensureCollection(3);
    });

    it('starts empty', async () => {
      expect(await store.count()).toBe(0);
      expect(await store.listIdsByPath()).toEqual(new Map());
    });

    it('ensureCollection is idempotent and rejects other dimensions', async () => {
      await store.ensureCollection(3);
      await expect(store.ensureCollection(5)).rejects.toThrow();
    });

    it('ranks search hits by cosine similarity', async () => {
      const a = makeChunk('src/a.ts');
      const b = makeChunk('src/b.ts');
      const c = makeChunk('src/c.ts');
      await store.upsert([stored(a, [1, 0, 0]), stored(b, [1, 1, 0]), stored(c, [0, 0, 1])]);
      const hits = await store.search([1, 0, 0], 3);
      expect(hits.map((h) => h.chunk.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
      expect(hits[0]?.score).toBeCloseTo(1, 4);
      expect(hits[1]?.score).toBeCloseTo(Math.SQRT1_2, 4);
      expect(hits[0]?.chunk).toEqual(a);
    });

    it('respects the limit', async () => {
      await store.upsert([
        stored(makeChunk('a.ts'), [1, 0, 0]),
        stored(makeChunk('b.ts'), [0, 1, 0]),
      ]);
      expect(await store.search([1, 0, 0], 1)).toHaveLength(1);
    });

    it('replaces an item that has the same id', async () => {
      const chunk = makeChunk('src/a.ts');
      await store.upsert([stored(chunk, [1, 0, 0])]);
      await store.upsert([stored(chunk, [0, 1, 0])]);
      expect(await store.count()).toBe(1);
      const [hit] = await store.search([0, 1, 0], 1);
      expect(hit?.score).toBeCloseTo(1, 4);
    });

    it('filters by path prefix', async () => {
      await store.upsert([
        stored(makeChunk('src/a/x.ts'), [1, 0, 0]),
        stored(makeChunk('src/b/y.ts'), [1, 0, 0]),
        stored(makeChunk('lib/z.ts'), [1, 0, 0]),
      ]);
      const nested = await store.search([1, 0, 0], 10, { pathPrefix: 'src/a/' });
      expect(nested.map((h) => h.chunk.path)).toEqual(['src/a/x.ts']);
      const top = await store.search([1, 0, 0], 10, { pathPrefix: 'src/' });
      expect(top.map((h) => h.chunk.path).sort()).toEqual(['src/a/x.ts', 'src/b/y.ts']);
    });

    it('filters by language and combines filters', async () => {
      await store.upsert([
        stored(makeChunk('src/a.ts'), [1, 0, 0]),
        stored(makeChunk('src/b.py', { language: 'python' }), [1, 0, 0]),
        stored(makeChunk('lib/c.py', { language: 'python' }), [1, 0, 0]),
      ]);
      const py = await store.search([1, 0, 0], 10, { language: 'python' });
      expect(py.map((h) => h.chunk.path).sort()).toEqual(['lib/c.py', 'src/b.py']);
      const both = await store.search([1, 0, 0], 10, { language: 'python', pathPrefix: 'src/' });
      expect(both.map((h) => h.chunk.path)).toEqual(['src/b.py']);
    });

    it('deletes all chunks of a path only', async () => {
      await store.upsert([
        stored(makeChunk('src/a.ts', { startLine: 1 }), [1, 0, 0]),
        stored(makeChunk('src/a.ts', { startLine: 10 }), [0, 1, 0]),
        stored(makeChunk('src/b.ts'), [0, 0, 1]),
      ]);
      await store.deleteByPath('src/a.ts');
      expect(await store.count()).toBe(1);
      const hits = await store.search([0, 0, 1], 10);
      expect(hits.map((h) => h.chunk.path)).toEqual(['src/b.ts']);
    });

    it('lists chunk ids by path', async () => {
      const first = makeChunk('src/a.ts', { startLine: 1, hash: 'h1' });
      const second = makeChunk('src/a.ts', { startLine: 10, hash: 'h2' });
      const third = makeChunk('src/b.ts', { hash: 'h3' });
      const ids = [chunkId(first), chunkId(second)].sort();
      await store.upsert([
        stored(first, [1, 0, 0]),
        stored(second, [0, 1, 0]),
        stored(third, [0, 0, 1]),
      ]);
      const map = await store.listIdsByPath();
      expect([...map.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
      expect([...(map.get('src/a.ts') ?? [])].sort()).toEqual(ids);
      expect(map.get('src/b.ts')).toEqual([chunkId(third)]);
    });
  });
}
