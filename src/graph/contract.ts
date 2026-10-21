import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphStore } from './types.js';

export function makeEdge(path: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return { path, language: 'typescript', kind: 'call', target: 'run', line: 1, ...overrides };
}

/** Behavior every GraphStore must share. `makeStore` must return an empty, fresh store. */
export function runGraphStoreContract(name: string, makeStore: () => Promise<GraphStore>): void {
  describe(`${name} GraphStore contract`, () => {
    let store: GraphStore;

    beforeEach(async () => {
      store = await makeStore();
      await store.ensure();
    });

    it('starts empty and ensure is idempotent', async () => {
      await store.ensure();
      expect(await store.listHashes()).toEqual(new Map());
      expect(await store.findEdges({})).toEqual([]);
    });

    it('stores edges with all fields and records the hash', async () => {
      const edge = makeEdge('src/a.ts', {
        from: 'login',
        fromParent: 'Auth',
        line: 7,
      });
      const imp = makeEdge('src/a.ts', { kind: 'import', target: 'x', module: './x.js', line: 1 });
      await store.replaceFile('src/a.ts', 'h1', [edge, imp]);
      expect(await store.listHashes()).toEqual(new Map([['src/a.ts', 'h1']]));
      expect(await store.findEdges({ path: 'src/a.ts' })).toEqual([imp, edge]);
    });

    it('records a file with zero edges by its hash', async () => {
      await store.replaceFile('src/empty.ts', 'h0', []);
      expect(await store.listHashes()).toEqual(new Map([['src/empty.ts', 'h0']]));
      expect(await store.findEdges({})).toEqual([]);
    });

    it('replaces the previous edges and hash of a file only', async () => {
      await store.replaceFile('a.ts', 'h1', [makeEdge('a.ts', { target: 'old' })]);
      await store.replaceFile('b.ts', 'hb', [makeEdge('b.ts', { target: 'keep' })]);
      await store.replaceFile('a.ts', 'h2', [makeEdge('a.ts', { target: 'new' })]);
      expect((await store.findEdges({})).map((e) => e.target)).toEqual(['new', 'keep']);
      expect(await store.listHashes()).toEqual(
        new Map([
          ['a.ts', 'h2'],
          ['b.ts', 'hb'],
        ]),
      );
    });

    it('filters by kind, target, from and path, and combines filters', async () => {
      await store.replaceFile('a.ts', 'ha', [
        makeEdge('a.ts', { target: 'run', from: 'main', line: 3 }),
        makeEdge('a.ts', { target: 'stop', from: 'main', line: 4 }),
        makeEdge('a.ts', { kind: 'import', target: 'run', module: './r.js', line: 1 }),
      ]);
      await store.replaceFile('b.ts', 'hb', [makeEdge('b.ts', { target: 'run', from: 'other' })]);
      expect(await store.findEdges({ target: 'run' })).toHaveLength(3);
      expect(await store.findEdges({ kind: 'import' })).toHaveLength(1);
      expect(await store.findEdges({ from: 'main' })).toHaveLength(2);
      expect(await store.findEdges({ path: 'b.ts' })).toHaveLength(1);
      const both = await store.findEdges({ kind: 'call', target: 'run', from: 'main' });
      expect(both.map((e) => e.line)).toEqual([3]);
      expect(await store.findEdges({ target: 'missing' })).toEqual([]);
    });

    it('orders by path then line and honours the limit', async () => {
      await store.replaceFile('b.ts', 'hb', [makeEdge('b.ts', { line: 2 })]);
      await store.replaceFile('a.ts', 'ha', [
        makeEdge('a.ts', { line: 9 }),
        makeEdge('a.ts', { line: 4 }),
      ]);
      const all = await store.findEdges({});
      expect(all.map((e) => `${e.path}:${e.line}`)).toEqual(['a.ts:4', 'a.ts:9', 'b.ts:2']);
      expect(await store.findEdges({ limit: 2 })).toHaveLength(2);
    });

    it('stores more edges than one write batch holds', async () => {
      const edges = Array.from({ length: 250 }, (_, i) => makeEdge('big.ts', { line: i + 1 }));
      await store.replaceFile('big.ts', 'hbig', edges);
      expect(await store.findEdges({ path: 'big.ts', limit: 1000 })).toHaveLength(250);
    });

    it('deletes the edges and hash of a path only', async () => {
      await store.replaceFile('a.ts', 'ha', [makeEdge('a.ts')]);
      await store.replaceFile('b.ts', 'hb', [makeEdge('b.ts')]);
      await store.deleteByPath('a.ts');
      expect(await store.listHashes()).toEqual(new Map([['b.ts', 'hb']]));
      expect((await store.findEdges({})).map((e) => e.path)).toEqual(['b.ts']);
    });
  });
}
