import { describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from '../graph/store.js';
import type { GraphEdge } from '../graph/types.js';
import { chunkId, InMemoryVectorStore } from '../store/index.js';
import { buildMapData } from './build.js';

type Edges = Record<string, Array<[module: string, target?: string]>>;

async function setup(
  files: Record<string, number>,
  edges: Edges = {},
  calls: Record<string, number> = {},
) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const [path, count] of Object.entries(files)) {
    for (let i = 0; i < count; i++) {
      const chunk = {
        path,
        language: 'unknown' as const,
        name: `c${i}`,
        kind: 'file' as const,
        startLine: i + 1,
        endLine: i + 1,
        content: `${path}${i}`,
        hash: `${path}${i}`,
      };
      await store.upsert([{ id: chunkId(chunk), chunk, vector: [1, 0] }]);
    }
  }
  const graph = new InMemoryGraphStore();
  const paths = new Set([...Object.keys(edges), ...Object.keys(calls)]);
  for (const path of paths) {
    const list: GraphEdge[] = (edges[path] ?? []).map(([module, target = '*'], i) => ({
      path,
      language: 'typescript',
      kind: 'import',
      target,
      module,
      line: i + 1,
    }));
    for (let i = 0; i < (calls[path] ?? 0); i++) {
      list.push({ path, language: 'typescript', kind: 'call', target: 'f', line: 100 + i });
    }
    await graph.replaceFile(path, 'h', list);
  }
  return { store, graph };
}

async function linksOf(files: Record<string, number>, edges: Edges) {
  const { store, graph } = await setup(files, edges);
  return buildMapData(store, graph);
}

describe('buildMapData', () => {
  it('returns an empty map for an empty index', async () => {
    const { store, graph } = await setup({});
    expect(await buildMapData(store, graph)).toEqual({
      nodes: [],
      links: [],
      unresolvedImports: 0,
    });
  });

  it('builds nodes with language, chunk and reference counts', async () => {
    const { store, graph } = await setup(
      { 'src/b.ts': 2, 'src/a.py': 1, README: 1 },
      { 'src/b.ts': [['./a.js']], 'ghost.ts': [['./x']] },
      { 'src/b.ts': 2, 'ghost.ts': 1 },
    );
    const { nodes } = await buildMapData(store, graph);
    expect(nodes).toEqual([
      { id: 'README', language: undefined, chunks: 1, references: 0 },
      { id: 'src/a.py', language: 'python', chunks: 1, references: 0 },
      { id: 'src/b.ts', language: 'typescript', chunks: 2, references: 3 },
    ]);
  });

  it('resolves TS relative imports, including .js to .ts and index files', async () => {
    const data = await linksOf(
      {
        'src/main.ts': 1,
        'src/util.ts': 1,
        'src/ui/view.tsx': 1,
        'src/lib/index.ts': 1,
        'src/plain.js': 1,
        'src/esm.mts': 1,
        'lib/shared.ts': 1,
      },
      {
        'src/main.ts': [
          ['./util.js'],
          ['./ui/view.jsx'],
          ['./lib'],
          ['./plain'],
          ['./esm.mjs'],
          ['../lib/shared'],
          ['./missing'],
          ['../../outside'],
          ['..'],
        ],
      },
    );
    expect(data.links.map((l) => l.to)).toEqual([
      'lib/shared.ts',
      'src/esm.mts',
      'src/lib/index.ts',
      'src/plain.js',
      'src/ui/view.tsx',
      'src/util.ts',
    ]);
    expect(data.unresolvedImports).toBe(3);
  });

  it('resolves an exact path with extension', async () => {
    const data = await linksOf({ 'a.ts': 1, 'b.json': 1 }, { 'a.ts': [['./b.json']] });
    expect(data.links).toEqual([{ from: 'a.ts', to: 'b.json', weight: 1 }]);
  });

  it('resolves Python dotted modules to modules and packages', async () => {
    const data = await linksOf(
      { 'app.py': 1, 'pkg/util.py': 1, 'pkg/sub/__init__.py': 1 },
      { 'app.py': [['pkg.util'], ['pkg.sub'], ['pkg.nope']] },
    );
    expect(data.links.map((l) => l.to)).toEqual(['pkg/sub/__init__.py', 'pkg/util.py']);
    expect(data.unresolvedImports).toBe(1);
  });

  it('resolves Python relative imports', async () => {
    const data = await linksOf(
      {
        'pkg/a/main.py': 1,
        'pkg/a/helper.py': 1,
        'pkg/a/__init__.py': 1,
        'pkg/shared.py': 1,
        'pkg/b/__init__.py': 1,
        'top.py': 1,
      },
      {
        'pkg/a/main.py': [
          ['.helper'],
          ['..shared'],
          ['.', 'helper'],
          ['.', '*'],
          ['..b'],
          ['...nothing'],
          ['....beyond'],
        ],
        'top.py': [['..up']],
      },
    );
    expect(data.links).toEqual([
      { from: 'pkg/a/main.py', to: 'pkg/a/__init__.py', weight: 1 },
      { from: 'pkg/a/main.py', to: 'pkg/a/helper.py', weight: 2 },
      { from: 'pkg/a/main.py', to: 'pkg/b/__init__.py', weight: 1 },
      { from: 'pkg/a/main.py', to: 'pkg/shared.py', weight: 1 },
    ]);
    expect(data.unresolvedImports).toBe(3);
  });

  it('matches Python modules by path suffix only when unique', async () => {
    const data = await linksOf(
      {
        'main.py': 1,
        'src/pkg/util.py': 1,
        'src/one/mod.py': 1,
        'lib/one/mod.py': 1,
      },
      { 'main.py': [['pkg.util'], ['one.mod']] },
    );
    expect(data.links).toEqual([{ from: 'main.py', to: 'src/pkg/util.py', weight: 1 }]);
    expect(data.unresolvedImports).toBe(1);
  });

  it('counts packages, node builtins and C# namespaces as unresolved', async () => {
    const { store, graph } = await setup({ 'a.ts': 1, 'b.cs': 1, 'c.go': 1 }, {});
    await graph.replaceFile('a.ts', 'h', [
      { path: 'a.ts', language: 'typescript', kind: 'import', target: 'z', module: 'zod', line: 1 },
      {
        path: 'a.ts',
        language: 'typescript',
        kind: 'import',
        target: '*',
        module: 'node:fs',
        line: 2,
      },
    ]);
    await graph.replaceFile('b.cs', 'h', [
      {
        path: 'b.cs',
        language: 'csharp',
        kind: 'import',
        target: '*',
        module: 'System.Linq',
        line: 1,
      },
    ]);
    await graph.replaceFile('c.go', 'h', [
      { path: 'c.go', language: 'go', kind: 'import', target: '*', module: './a', line: 1 },
      { path: 'c.go', language: 'go', kind: 'import', target: '*', line: 2 },
    ]);
    const data = await buildMapData(store, graph);
    expect(data.links).toEqual([]);
    expect(data.unresolvedImports).toBe(5);
  });

  it('drops self-links and aggregates weights', async () => {
    const data = await linksOf(
      { 'a.ts': 1, 'b.ts': 1 },
      {
        'a.ts': [['./a'], ['./b', 'x'], ['./b', 'y'], ['./b.js', 'z']],
        'b.ts': [['./a']],
      },
    );
    expect(data.links).toEqual([
      { from: 'a.ts', to: 'b.ts', weight: 3 },
      { from: 'b.ts', to: 'a.ts', weight: 1 },
    ]);
    expect(data.unresolvedImports).toBe(0);
  });

  it('filters by pathPrefix without counting dropped targets as unresolved', async () => {
    const { store, graph } = await setup(
      { 'src/a.ts': 1, 'src/b.ts': 1, 'test/t.ts': 1 },
      {
        'src/a.ts': [['./b'], ['../test/t'], ['zod']],
        'test/t.ts': [['../src/a'], ['./nope']],
      },
    );
    const data = await buildMapData(store, graph, { pathPrefix: 'src/' });
    expect(data.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(data.links).toEqual([{ from: 'src/a.ts', to: 'src/b.ts', weight: 1 }]);
    expect(data.unresolvedImports).toBe(1);
  });

  it('is deterministic regardless of insertion order', async () => {
    const files = { 'z.ts': 1, 'a.ts': 1, 'm.ts': 1 };
    const edges: Edges = { 'z.ts': [['./a'], ['./m']], 'm.ts': [['./a']], 'a.ts': [['./z']] };
    const forward = await linksOf(files, edges);
    const reversed = await linksOf(
      Object.fromEntries(Object.entries(files).reverse()),
      Object.fromEntries(Object.entries(edges).reverse()),
    );
    expect(reversed).toEqual(forward);
    expect(forward.nodes.map((n) => n.id)).toEqual(['a.ts', 'm.ts', 'z.ts']);
    expect(forward.links.map((l) => `${l.from}>${l.to}`)).toEqual([
      'a.ts>z.ts',
      'm.ts>a.ts',
      'z.ts>a.ts',
      'z.ts>m.ts',
    ]);
  });
});
