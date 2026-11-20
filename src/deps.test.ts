import { describe, expect, it } from 'vitest';
import {
  formatFileDependencies,
  getFileDependencies,
  MAX_DEPS_PER_LEVEL,
  UnknownFileError,
  type FileDependencies,
} from './deps.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { GraphEdge } from './graph/types.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';

/** Files plus their imports as [module, line] pairs. */
async function setup(files: string[], imports: Record<string, Array<[string, number]>> = {}) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const path of files) {
    const chunk = {
      path,
      language: 'unknown' as const,
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

const CHAIN = {
  files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/main.ts'],
  imports: {
    'src/a.ts': [
      ['./b', 1],
      ['./c', 2],
      ['react', 4],
    ] as Array<[string, number]>,
    'src/b.ts': [['./c', 7]] as Array<[string, number]>,
    'src/main.ts': [['./a', 3]] as Array<[string, number]>,
  },
};

describe('getFileDependencies', () => {
  it('lists what a file imports and who imports it', async () => {
    const { store, graph } = await setup(CHAIN.files, CHAIN.imports);
    const deps = await getFileDependencies(store, graph, { path: 'src/a.ts' });
    expect(deps).toEqual({
      path: 'src/a.ts',
      imports: [
        { path: 'src/b.ts', depth: 1, via: 'src/a.ts', line: 1, module: './b' },
        { path: 'src/c.ts', depth: 1, via: 'src/a.ts', line: 2, module: './c' },
      ],
      importers: [{ path: 'src/main.ts', depth: 1, via: 'src/a.ts', line: 3, module: './a' }],
      unresolved: [{ module: 'react', line: 4 }],
      truncated: false,
    });
  });

  it('honours the direction', async () => {
    const { store, graph } = await setup(CHAIN.files, CHAIN.imports);
    const imports = await getFileDependencies(store, graph, {
      path: 'src/a.ts',
      direction: 'imports',
    });
    expect(imports.imports).toHaveLength(2);
    expect(imports.importers).toEqual([]);
    expect(imports.unresolved).toHaveLength(1);
    const importers = await getFileDependencies(store, graph, {
      path: 'src/a.ts',
      direction: 'importers',
    });
    expect(importers.imports).toEqual([]);
    expect(importers.importers).toHaveLength(1);
    expect(importers.unresolved).toEqual([]);
  });

  it('follows imports to depth 2 and records the file they came through', async () => {
    const { store, graph } = await setup(CHAIN.files, CHAIN.imports);
    const deps = await getFileDependencies(store, graph, {
      path: 'src/main.ts',
      direction: 'imports',
      depth: 3,
    });
    expect(deps.imports.map((e) => [e.path, e.depth, e.via])).toEqual([
      ['src/a.ts', 1, 'src/main.ts'],
      ['src/b.ts', 2, 'src/a.ts'],
      ['src/c.ts', 2, 'src/a.ts'],
    ]);
  });

  it('follows importers to depth 2 using the importer own import line', async () => {
    const { store, graph } = await setup(CHAIN.files, CHAIN.imports);
    const deps = await getFileDependencies(store, graph, {
      path: 'src/c.ts',
      direction: 'importers',
      depth: 2,
    });
    expect(deps.importers).toEqual([
      { path: 'src/a.ts', depth: 1, via: 'src/c.ts', line: 2, module: './c' },
      { path: 'src/b.ts', depth: 1, via: 'src/c.ts', line: 7, module: './c' },
      { path: 'src/main.ts', depth: 2, via: 'src/a.ts', line: 3, module: './a' },
    ]);
  });

  it('lists each file once and never lists the start file in a cycle', async () => {
    const { store, graph } = await setup(['a.ts', 'b.ts'], {
      'a.ts': [['./b', 1]],
      'b.ts': [['./a', 1]],
    });
    const deps = await getFileDependencies(store, graph, { path: 'a.ts', depth: 5 });
    expect(deps.imports.map((e) => e.path)).toEqual(['b.ts']);
    expect(deps.importers.map((e) => e.path)).toEqual(['b.ts']);
  });

  it('uses the lowest line when a file imports another more than once', async () => {
    const { store, graph } = await setup(['a.ts', 'b.ts'], {
      'a.ts': [
        ['./b', 9],
        ['./b.js', 2],
      ],
    });
    const deps = await getFileDependencies(store, graph, { path: 'a.ts' });
    expect(deps.imports[0]).toMatchObject({ line: 2, module: './b.js' });
  });

  it('normalises the requested path', async () => {
    const { store, graph } = await setup(CHAIN.files, CHAIN.imports);
    const deps = await getFileDependencies(store, graph, { path: '  .\\src\\a.ts ' });
    expect(deps.path).toBe('src/a.ts');
    expect(deps.imports).toHaveLength(2);
  });

  it('suggests indexed files with the same name for an unknown path', async () => {
    const { store, graph } = await setup(['src/a.ts', 'lib/a.ts', 'src/b.ts']);
    const error = await getFileDependencies(store, graph, { path: 'a.ts' }).catch((e) => e);
    expect(error).toBeInstanceOf(UnknownFileError);
    expect(error.message).toBe('a.ts is not indexed. Did you mean lib/a.ts, src/a.ts?');
  });

  it('points to list_files when nothing is similar', async () => {
    const { store, graph } = await setup(['src/b.ts']);
    await expect(getFileDependencies(store, graph, { path: 'nope.ts' })).rejects.toThrow(
      'nope.ts is not indexed. Use list_files to see indexed paths.',
    );
  });

  it('suggests at most three files', async () => {
    const { store, graph } = await setup(['a/x.ts', 'b/x.ts', 'c/x.ts', 'd/x.ts']);
    await expect(getFileDependencies(store, graph, { path: 'x.ts' })).rejects.toThrow(
      'Did you mean a/x.ts, b/x.ts, c/x.ts?',
    );
  });

  it('rejects a depth outside 1 to 5', async () => {
    const { store, graph } = await setup(['a.ts']);
    for (const depth of [0, 6, 1.5]) {
      await expect(getFileDependencies(store, graph, { path: 'a.ts', depth })).rejects.toThrow(
        RangeError,
      );
    }
  });

  it('caps each level and reports truncation', async () => {
    const importers = Array.from({ length: MAX_DEPS_PER_LEVEL + 5 }, (_, i) => {
      return `src/user${String(i).padStart(3, '0')}.ts`;
    });
    const imports: Record<string, Array<[string, number]>> = {};
    for (const file of importers) imports[file] = [['./target', 1]];
    const { store, graph } = await setup(['src/target.ts', ...importers], imports);
    const deps = await getFileDependencies(store, graph, {
      path: 'src/target.ts',
      direction: 'importers',
    });
    expect(deps.truncated).toBe(true);
    expect(deps.importers).toHaveLength(MAX_DEPS_PER_LEVEL);
    expect(deps.importers[0]?.path).toBe('src/user000.ts');
  });
});

describe('formatFileDependencies', () => {
  const full: FileDependencies = {
    path: 'src/a.ts',
    imports: [
      { path: 'src/b.ts', depth: 1, via: 'src/a.ts', line: 1, module: './b' },
      { path: 'src/c.ts', depth: 2, via: 'src/b.ts', line: 2, module: './c' },
    ],
    importers: [{ path: 'src/main.ts', depth: 1, via: 'src/a.ts', line: 3, module: './a' }],
    unresolved: [{ module: 'react', line: 4 }],
    truncated: false,
  };

  it('renders every section', () => {
    expect(formatFileDependencies(full)).toBe(
      [
        'src/a.ts',
        'Imports (2):',
        "  src/b.ts  line 1  './b'",
        "  src/c.ts  line 2  './c'  (depth 2 via src/b.ts)",
        'Imported by (1):',
        "  src/main.ts  line 3  './a'",
        'Unresolved imports (1): react (line 4)',
        'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked.',
      ].join('\n'),
    );
  });

  it('renders none lines and the truncation notice', () => {
    const text = formatFileDependencies({
      path: 'a.ts',
      imports: [],
      importers: [],
      unresolved: [],
      truncated: true,
    });
    expect(text).toBe(
      [
        'a.ts',
        'Imports (0):',
        '  (none)',
        'Imported by (0):',
        '  (none)',
        'Unresolved imports: (none)',
        `... truncated: each level shows at most ${MAX_DEPS_PER_LEVEL} files`,
        'Imports resolve by path only; packages, C# namespaces and Swift modules are not linked.',
      ].join('\n'),
    );
  });
});
