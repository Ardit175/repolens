import { describe, expect, it } from 'vitest';
import {
  formatImportCycles,
  getImportCycles,
  MAX_IMPORT_CYCLES,
  type ImportCycles,
} from './cycles.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { GraphEdge, GraphStore } from './graph/types.js';
import { loadFileLinks } from './map/links.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';
import type { VectorStore } from './store/types.js';

/** Files plus their imports as [module, line] pairs. */
async function setup(files: string[], imports: Record<string, Array<[string, number]>>) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const path of files) {
    const chunk = {
      path,
      language: 'typescript' as const,
      name: 'c',
      kind: 'file' as const,
      startLine: 1,
      endLine: 1,
      content: path,
      hash: path,
    };
    await store.upsert([{ id: chunkId(chunk), chunk, vector: [1, 0] }]);
  }
  const graph = new InMemoryGraphStore();
  for (const [path, list] of Object.entries(imports)) {
    const edges: GraphEdge[] = list.map(([module, line]) => ({
      path,
      language: 'typescript',
      kind: 'import',
      target: '*',
      module,
      line,
    }));
    await graph.replaceFile(path, 'h', edges);
  }
  return { store, graph };
}

/** Builds files src/<name>.ts from `name: [imported names]`, each import on its own line. */
function layout(spec: Record<string, string[]>) {
  const files = Object.keys(spec).map((name) => `src/${name}.ts`);
  const imports: Record<string, Array<[string, number]>> = {};
  for (const [name, targets] of Object.entries(spec)) {
    imports[`src/${name}.ts`] = targets.map((t, i) => [`./${t}`, i + 1]);
  }
  return { files, imports };
}

async function cycles(
  spec: Record<string, string[]>,
  input?: Parameters<typeof getImportCycles>[2],
) {
  const { files, imports } = layout(spec);
  const { store, graph } = await setup(files, imports);
  return getImportCycles(store, graph, input);
}

describe('getImportCycles', () => {
  it('finds nothing in an acyclic graph', async () => {
    const result = await cycles({ a: ['b', 'c'], b: ['c'], c: [] });
    expect(result).toEqual({ cycles: [], total: 0, filesInCycles: 0, truncated: false });
  });

  it('finds a two-file cycle with its loop', async () => {
    const result = await cycles({ a: ['b'], b: ['a'] });
    expect(result.cycles).toEqual([
      {
        files: ['src/a.ts', 'src/b.ts'],
        loop: [
          { from: 'src/a.ts', to: 'src/b.ts', line: 1, module: './b' },
          { from: 'src/b.ts', to: 'src/a.ts', line: 1, module: './a' },
        ],
      },
    ]);
    expect(result).toMatchObject({ total: 1, filesInCycles: 2, truncated: false });
  });

  it('returns the shortest loop when the component has a longer one', async () => {
    // Loops: a->b->c->d->a (4) and a->c->d->a (3). The shortcut a->c must win.
    const result = await cycles({ a: ['b', 'c'], b: ['c'], c: ['d'], d: ['a'] });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]!.files).toEqual(
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].slice(0, 4),
    );
    expect(result.cycles[0]!.loop.map((s) => s.from)).toEqual(['src/a.ts', 'src/c.ts', 'src/d.ts']);
    expect(result.cycles[0]!.loop.at(-1)!.to).toBe('src/a.ts');
  });

  it('lists every member of the component even when the loop passes through only one of them', async () => {
    // b and c are both members; the loop uses b because it sorts first.
    const result = await cycles({ a: ['b', 'c'], b: ['a'], c: ['a'] });
    expect(result.cycles[0]!.files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(result.cycles[0]!.loop).toHaveLength(2);
    expect(result.cycles[0]!.loop[0]!.to).toBe('src/b.ts');
  });

  it('orders separate cycles by size, then by first file', async () => {
    const result = await cycles({
      a: ['b'],
      b: ['a'],
      x: ['y'],
      y: ['z'],
      z: ['x'],
      m: ['n'],
      n: ['m'],
    });
    expect(result.cycles.map((c) => c.files)).toEqual([
      ['src/x.ts', 'src/y.ts', 'src/z.ts'],
      ['src/a.ts', 'src/b.ts'],
      ['src/m.ts', 'src/n.ts'],
    ]);
    expect(result).toMatchObject({ total: 3, filesInCycles: 7 });
  });

  it('excludes a file that imports into a cycle without being part of it', async () => {
    const result = await cycles({ entry: ['a'], a: ['b'], b: ['a', 'leaf'], leaf: [] });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.filesInCycles).toBe(2);
  });

  it('keeps cycles with a member under the path prefix and drops the others', async () => {
    const files = ['src/a.ts', 'lib/b.ts', 'tools/c.ts', 'tools/d.ts'];
    const { store, graph } = await setup(files, {
      'src/a.ts': [['../lib/b', 1]],
      'lib/b.ts': [['../src/a', 1]],
      'tools/c.ts': [['./d', 1]],
      'tools/d.ts': [['./c', 1]],
    });
    const result = await getImportCycles(store, graph, { pathPrefix: './src/' });
    expect(result.cycles.map((c) => c.files)).toEqual([['lib/b.ts', 'src/a.ts']]);
    expect(result).toMatchObject({ total: 1, filesInCycles: 2 });
    const none = await getImportCycles(store, graph, { pathPrefix: 'nowhere/' });
    expect(none).toMatchObject({ cycles: [], total: 0 });
  });

  it('reports the lowest-line import when a file imports another twice', async () => {
    const { store, graph } = await setup(['src/a.ts', 'src/b.ts'], {
      'src/a.ts': [
        ['./b.js', 9],
        ['./b', 4],
      ],
      'src/b.ts': [['./a', 2]],
    });
    const result = await getImportCycles(store, graph);
    expect(result.cycles[0]!.loop[0]).toEqual({
      from: 'src/a.ts',
      to: 'src/b.ts',
      line: 4,
      module: './b',
    });
  });

  it('cuts the list at MAX_IMPORT_CYCLES and keeps the total', async () => {
    const count = MAX_IMPORT_CYCLES + 1;
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < count; i++) {
      const n = String(i).padStart(3, '0');
      spec[`a${n}`] = [`b${n}`];
      spec[`b${n}`] = [`a${n}`];
    }
    const result = await cycles(spec);
    expect(result.cycles).toHaveLength(MAX_IMPORT_CYCLES);
    expect(result).toMatchObject({ total: count, filesInCycles: count * 2, truncated: true });
  });

  it('handles a ring of thousands of files without overflowing the stack', async () => {
    const size = 5000;
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < size; i++) {
      spec[`f${String(i).padStart(4, '0')}`] = [`f${String((i + 1) % size).padStart(4, '0')}`];
    }
    const result = await cycles(spec);
    expect(result.total).toBe(1);
    expect(result.cycles[0]!.files).toHaveLength(size);
    expect(result.cycles[0]!.loop).toHaveLength(size);
  });

  it('reuses links that were passed in without reading the stores', async () => {
    const { files, imports } = layout({ a: ['b'], b: ['a'] });
    const { store, graph } = await setup(files, imports);
    const links = await loadFileLinks(store, graph);
    const failing = new Proxy(
      {},
      {
        get() {
          throw new Error('store must not be read');
        },
      },
    );
    const result = await getImportCycles(failing as VectorStore, failing as GraphStore, { links });
    expect(result.total).toBe(1);
  });
});

describe('formatImportCycles', () => {
  it('says (none) when there are no cycles', () => {
    const text = formatImportCycles({ cycles: [], total: 0, filesInCycles: 0, truncated: false });
    expect(text.split('\n')).toEqual([
      'Import cycles (0):',
      '  (none)',
      'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked, so cycles through them are not shown.',
    ]);
  });

  it('lists each cycle with its loop', async () => {
    const result = await cycles({ a: ['b'], b: ['c'], c: ['a'], x: ['y'], y: ['x'] });
    expect(formatImportCycles(result).split('\n')).toEqual([
      'Import cycles (2) covering 5 files:',
      '  1. 3 files: src/a.ts, src/b.ts, src/c.ts',
      '     src/a.ts:1 imports ./b -> src/b.ts',
      '     src/b.ts:1 imports ./c -> src/c.ts',
      '     src/c.ts:1 imports ./a -> src/a.ts',
      '  2. 2 files: src/x.ts, src/y.ts',
      '     src/x.ts:1 imports ./y -> src/y.ts',
      '     src/y.ts:1 imports ./x -> src/x.ts',
      'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked, so cycles through them are not shown.',
    ]);
  });

  it('notes the cut', () => {
    const result: ImportCycles = {
      cycles: [
        {
          files: ['a.ts', 'b.ts'],
          loop: [
            { from: 'a.ts', to: 'b.ts', line: 1, module: './b' },
            { from: 'b.ts', to: 'a.ts', line: 2, module: './a' },
          ],
        },
      ],
      total: 80,
      filesInCycles: 160,
      truncated: true,
    };
    expect(formatImportCycles(result)).toContain('... truncated: showing 1 of 80');
  });
});
