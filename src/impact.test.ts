import { describe, expect, it } from 'vitest';
import type { Chunk, SymbolKind } from './chunker/types.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { GraphEdge } from './graph/types.js';
import { UnknownFileError } from './deps.js';
import {
  formatChangeImpact,
  getChangeImpact,
  MAX_CALL_EDGES,
  MAX_IMPACT_FILES,
  UnknownSymbolError,
  type ChangeImpact,
} from './impact.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';

interface SymbolSpec {
  name: string;
  kind: SymbolKind;
  start: number;
  end: number;
  parent?: string;
}

interface CallSpec {
  target: string;
  line: number;
  from?: string;
  fromParent?: string;
}

interface Layout {
  /** Symbols per file. A file with an empty list gets one fallback `file` chunk. */
  symbols: Record<string, SymbolSpec[]>;
  /** Import modules as [module, line] pairs per file. */
  imports?: Record<string, Array<[string, number]>>;
  calls?: Record<string, CallSpec[]>;
}

async function setup(layout: Layout) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const [path, symbols] of Object.entries(layout.symbols)) {
    const chunks: Chunk[] =
      symbols.length === 0
        ? [fileChunk(path)]
        : symbols.map((s) => ({
            path,
            language: 'typescript',
            name: s.name,
            kind: s.kind,
            ...(s.parent !== undefined ? { parent: s.parent } : {}),
            startLine: s.start,
            endLine: s.end,
            content: s.name,
            hash: `${path}:${s.name}`,
          }));
    await store.upsert(chunks.map((chunk) => ({ id: chunkId(chunk), chunk, vector: [1, 0] })));
  }
  const graph = new InMemoryGraphStore();
  const paths = new Set([...Object.keys(layout.imports ?? {}), ...Object.keys(layout.calls ?? {})]);
  for (const path of paths) {
    const language = path.endsWith('.go') ? ('go' as const) : ('typescript' as const);
    const imports: GraphEdge[] = (layout.imports?.[path] ?? []).map(([module, line]) => ({
      path,
      language,
      kind: 'import',
      target: '*',
      module,
      line,
    }));
    const calls: GraphEdge[] = (layout.calls?.[path] ?? []).map((call) => ({
      path,
      language,
      kind: 'call',
      target: call.target,
      line: call.line,
      ...(call.from !== undefined ? { from: call.from } : {}),
      ...(call.fromParent !== undefined ? { fromParent: call.fromParent } : {}),
    }));
    await graph.replaceFile(path, 'h', [...imports, ...calls]);
  }
  return { store, graph };
}

function fileChunk(path: string): Chunk {
  return {
    path,
    language: 'unknown',
    name: path,
    kind: 'file',
    startLine: 1,
    endLine: 1,
    content: path,
    hash: path,
  };
}

const UTIL: SymbolSpec[] = [
  { name: 'parseConfig', kind: 'function', start: 3, end: 10 },
  { name: 'Loader', kind: 'class', start: 12, end: 30 },
  { name: 'load', kind: 'method', parent: 'Loader', start: 14, end: 20 },
];

const BASE: Layout = {
  symbols: {
    'src/util.ts': UTIL,
    'src/a.ts': [],
    'src/b.ts': [],
    'src/c.go': [],
  },
  imports: {
    'src/a.ts': [['./util', 1]],
    'src/b.ts': [['./a', 1]],
  },
  calls: {
    'src/util.ts': [{ target: 'parseConfig', line: 25, from: 'load', fromParent: 'Loader' }],
    'src/a.ts': [
      { target: 'parseConfig', line: 14, from: 'main' },
      { target: 'load', line: 20, from: 'main' },
    ],
    'src/c.go': [{ target: 'parseConfig', line: 5, from: 'start', fromParent: 'Server' }],
  },
};

describe('getChangeImpact', () => {
  it('lists a direct importer with its calls and a name-only caller', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts' });
    expect(impact).toEqual({
      path: 'src/util.ts',
      symbols: [
        { name: 'parseConfig', kind: 'function', startLine: 3, endLine: 10, callSites: 2 },
        { name: 'Loader', kind: 'class', startLine: 12, endLine: 30, callSites: 0 },
        {
          name: 'load',
          parent: 'Loader',
          kind: 'method',
          startLine: 14,
          endLine: 20,
          callSites: 1,
        },
      ],
      files: [
        {
          path: 'src/a.ts',
          link: 'direct',
          importDepth: 1,
          calls: [
            { symbol: 'parseConfig', line: 14, from: 'main' },
            { symbol: 'Loader.load', line: 20, from: 'main' },
          ],
        },
        {
          path: 'src/c.go',
          link: 'name-only',
          calls: [{ symbol: 'parseConfig', line: 5, from: 'start', fromParent: 'Server' }],
        },
      ],
      counts: { direct: 1, transitive: 0, nameOnly: 1, callSites: 3 },
      truncated: false,
    });
  });

  it('excludes calls made inside the start file', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts' });
    expect(impact.files.map((f) => f.path)).not.toContain('src/util.ts');
  });

  it('reports a transitive importer with the file it came through', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts', depth: 2 });
    expect(impact.files.map((f) => [f.path, f.link, f.importDepth, f.via])).toEqual([
      ['src/a.ts', 'direct', 1, undefined],
      ['src/b.ts', 'transitive', 2, 'src/a.ts'],
      ['src/c.go', 'name-only', undefined, undefined],
    ]);
    expect(impact.counts).toMatchObject({ direct: 1, transitive: 1, nameOnly: 1 });
    const direct = await getChangeImpact(store, graph, { path: 'src/util.ts' });
    expect(direct.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/c.go']);
  });

  it('treats a caller that imports the file only beyond the depth as name-only', async () => {
    const layout: Layout = {
      ...BASE,
      calls: { ...BASE.calls, 'src/b.ts': [{ target: 'parseConfig', line: 2 }] },
    };
    const { store, graph } = await setup(layout);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts' });
    const b = impact.files.find((f) => f.path === 'src/b.ts');
    expect(b).toEqual({
      path: 'src/b.ts',
      link: 'name-only',
      calls: [{ symbol: 'parseConfig', line: 2 }],
    });
  });

  it('narrows to a symbol by name', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, {
      path: 'src/util.ts',
      symbol: '  parseConfig ',
    });
    expect(impact.symbol).toBe('parseConfig');
    expect(impact.symbols.map((s) => s.name)).toEqual(['parseConfig']);
    expect(impact.files.flatMap((f) => f.calls.map((c) => c.symbol))).toEqual([
      'parseConfig',
      'parseConfig',
    ]);
    expect(impact.counts.callSites).toBe(2);
  });

  it('narrows to a method by Class.method and by bare name', async () => {
    const { store, graph } = await setup(BASE);
    const qualified = await getChangeImpact(store, graph, {
      path: 'src/util.ts',
      symbol: 'Loader.load',
    });
    expect(qualified.symbols.map((s) => s.name)).toEqual(['load']);
    expect(qualified.files.map((f) => f.path)).toEqual(['src/a.ts']);
    const bare = await getChangeImpact(store, graph, { path: 'src/util.ts', symbol: 'load' });
    expect(bare.symbols).toEqual(qualified.symbols);
  });

  it('treats a blank symbol as not given', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts', symbol: '  ' });
    expect(impact).not.toHaveProperty('symbol');
    expect(impact.symbols).toHaveLength(3);
  });

  it('names the symbols of the file when the symbol is unknown', async () => {
    const { store, graph } = await setup(BASE);
    const error = await getChangeImpact(store, graph, {
      path: 'src/util.ts',
      symbol: 'nope',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(UnknownSymbolError);
    expect(error.message).toBe(
      'Symbol "nope" is not defined in src/util.ts. Symbols in this file: parseConfig, Loader, Loader.load',
    );
  });

  it('lists at most ten symbols in the error', async () => {
    const symbols: SymbolSpec[] = Array.from({ length: 12 }, (_, i) => ({
      name: `f${String(i).padStart(2, '0')}`,
      kind: 'function',
      start: i * 2 + 1,
      end: i * 2 + 2,
    }));
    const { store, graph } = await setup({ symbols: { 'x.ts': symbols } });
    await expect(getChangeImpact(store, graph, { path: 'x.ts', symbol: 'g' })).rejects.toThrow(
      'f00, f01, f02, f03, f04, f05, f06, f07, f08, f09, ...',
    );
  });

  it('says so when the file has no symbol chunks', async () => {
    const { store, graph } = await setup(BASE);
    await expect(
      getChangeImpact(store, graph, { path: 'src/a.ts', symbol: 'main' }),
    ).rejects.toThrow('Symbol "main" is not defined in src/a.ts. It has no symbol chunks.');
  });

  it('ignores fallback file chunks', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/a.ts' });
    expect(impact.symbols).toEqual([]);
    expect(impact.files.map((f) => f.path)).toEqual(['src/b.ts']);
    expect(impact.counts.callSites).toBe(0);
  });

  it('lets an unknown file error through, normalising the path first', async () => {
    const { store, graph } = await setup(BASE);
    await expect(getChangeImpact(store, graph, { path: 'src/nope.ts' })).rejects.toThrow(
      UnknownFileError,
    );
    const impact = await getChangeImpact(store, graph, { path: ' .\\src\\util.ts ' });
    expect(impact.path).toBe('src/util.ts');
  });

  it('rejects a depth outside 1 to 5', async () => {
    const { store, graph } = await setup(BASE);
    for (const depth of [0, 6, 1.5]) {
      await expect(getChangeImpact(store, graph, { path: 'src/util.ts', depth })).rejects.toThrow(
        RangeError,
      );
    }
  });

  it('orders direct, transitive, then name-only, and by call count within a group', async () => {
    const layout: Layout = {
      symbols: {
        'lib.ts': [{ name: 'run', kind: 'function', start: 1, end: 5 }],
        'd1.ts': [],
        'd2.ts': [],
        't1.ts': [],
        'n1.ts': [],
        'n2.ts': [],
      },
      imports: {
        'd1.ts': [['./lib', 1]],
        'd2.ts': [['./lib', 1]],
        't1.ts': [['./d1', 1]],
      },
      calls: {
        'd1.ts': [{ target: 'run', line: 2 }],
        'd2.ts': [
          { target: 'run', line: 7 },
          { target: 'run', line: 3 },
        ],
        'n1.ts': [{ target: 'run', line: 1 }],
        'n2.ts': [
          { target: 'run', line: 4 },
          { target: 'run', line: 2 },
        ],
      },
    };
    const { store, graph } = await setup(layout);
    const impact = await getChangeImpact(store, graph, { path: 'lib.ts', depth: 2 });
    expect(impact.files.map((f) => f.path)).toEqual(['d2.ts', 'd1.ts', 't1.ts', 'n2.ts', 'n1.ts']);
    expect(impact.files[0]?.calls.map((c) => c.line)).toEqual([3, 7]);
  });

  it('counts a call once when two symbols share the same qualified name', async () => {
    const layout: Layout = {
      symbols: {
        'lib.ts': [
          { name: 'run', kind: 'function', start: 1, end: 3 },
          { name: 'run', kind: 'function', start: 5, end: 7 },
        ],
        'u.ts': [],
      },
      imports: { 'u.ts': [['./lib', 1]] },
      calls: { 'u.ts': [{ target: 'run', line: 2 }] },
    };
    const { store, graph } = await setup(layout);
    const impact = await getChangeImpact(store, graph, { path: 'lib.ts' });
    expect(impact.counts.callSites).toBe(1);
    expect(impact.files[0]?.calls).toHaveLength(1);
  });

  it('caps the files and reports truncation', async () => {
    const callers = Array.from(
      { length: MAX_IMPACT_FILES + 5 },
      (_, i) => `u${String(i).padStart(3, '0')}.go`,
    );
    const layout: Layout = {
      symbols: {
        'lib.ts': [{ name: 'run', kind: 'function', start: 1, end: 3 }],
        ...Object.fromEntries(callers.map((file) => [file, []])),
      },
      calls: Object.fromEntries(callers.map((file) => [file, [{ target: 'run', line: 1 }]])),
    };
    const { store, graph } = await setup(layout);
    const impact = await getChangeImpact(store, graph, { path: 'lib.ts' });
    expect(impact.truncated).toBe(true);
    expect(impact.files).toHaveLength(MAX_IMPACT_FILES);
    expect(impact.counts.nameOnly).toBe(MAX_IMPACT_FILES + 5);
    expect(impact.files[0]?.path).toBe('u000.go');
  });

  it('returns every importer when unbounded and cuts at the limit by default', async () => {
    const importers = Array.from(
      { length: MAX_IMPACT_FILES + 20 },
      (_, i) => `src/u${String(i).padStart(3, '0')}.ts`,
    );
    const layout: Layout = {
      symbols: Object.fromEntries(['lib.ts', ...importers].map((file) => [file, []])),
      imports: Object.fromEntries(importers.map((file) => [file, [['../lib', 1]]])),
    };
    const { store, graph } = await setup(layout);
    const all = await getChangeImpact(store, graph, { path: 'lib.ts', unbounded: true });
    expect(all.files).toHaveLength(importers.length);
    expect(all.counts.direct).toBe(importers.length);
    expect(all.truncated).toBe(false);
    const cut = await getChangeImpact(store, graph, { path: 'lib.ts' });
    expect(cut.files).toHaveLength(MAX_IMPACT_FILES);
    expect(cut.truncated).toBe(true);
  });

  it('reports truncation when a call lookup hits its limit', async () => {
    const calls = Array.from({ length: MAX_CALL_EDGES }, (_, i) => ({
      target: 'run',
      line: i + 1,
    }));
    const layout: Layout = {
      symbols: {
        'lib.ts': [{ name: 'run', kind: 'function', start: 1, end: 3 }],
        'u.go': [],
      },
      calls: { 'u.go': calls },
    };
    const { store, graph } = await setup(layout);
    const impact = await getChangeImpact(store, graph, { path: 'lib.ts' });
    expect(impact.truncated).toBe(true);
    expect(impact.counts.callSites).toBe(MAX_CALL_EDGES);
  });

  it('is not truncated for a small result', async () => {
    const { store, graph } = await setup(BASE);
    const impact = await getChangeImpact(store, graph, { path: 'src/util.ts' });
    expect(impact.truncated).toBe(false);
  });
});

describe('formatChangeImpact', () => {
  const small: ChangeImpact = {
    path: 'src/util.ts',
    symbol: 'parseConfig',
    symbols: [
      { name: 'parseConfig', kind: 'function', startLine: 3, endLine: 10, callSites: 2 },
      { name: 'load', parent: 'Loader', kind: 'method', startLine: 12, endLine: 20, callSites: 0 },
    ],
    files: [
      {
        path: 'src/a.ts',
        link: 'direct',
        importDepth: 1,
        calls: [{ symbol: 'parseConfig', line: 14, from: 'main' }],
      },
      { path: 'src/b.ts', link: 'transitive', importDepth: 2, via: 'src/a.ts', calls: [] },
      {
        path: 'src/c.go',
        link: 'name-only',
        calls: [{ symbol: 'parseConfig', line: 5, from: 'start', fromParent: 'Server' }],
      },
    ],
    counts: { direct: 1, transitive: 1, nameOnly: 1, callSites: 2 },
    truncated: false,
  };
  const note =
    'Links resolve by import path; name-only callers match by symbol name and may be unrelated.';

  it('renders a small case exactly', () => {
    expect(formatChangeImpact(small)).toBe(
      [
        'src/util.ts  (symbol: parseConfig)',
        'Symbols (2):',
        '  parseConfig (function) lines 3-10  2 call sites',
        '  Loader.load (method) lines 12-20  0 call sites',
        'Affected files (3): 1 direct importer, 1 transitive, 1 name-only caller; 2 call sites',
        '  src/a.ts  direct import',
        '    line 14  parseConfig  in main',
        '  src/b.ts  transitive (depth 2 via src/a.ts)',
        '  src/c.go  name-only caller',
        '    line 5  parseConfig  in Server.start',
        note,
      ].join('\n'),
    );
  });

  it('renders the empty case', () => {
    const text = formatChangeImpact({
      path: small.path,
      truncated: false,
      symbols: [],
      files: [],
      counts: { direct: 0, transitive: 0, nameOnly: 0, callSites: 0 },
    });
    expect(text).toBe(
      ['src/util.ts', 'Symbols (0):', '  (none)', 'Affected files (0):', '  (none)', note].join(
        '\n',
      ),
    );
  });

  it('uses plurals, top level and the truncation notice', () => {
    const text = formatChangeImpact({
      path: 'lib.ts',
      symbols: [{ name: 'run', kind: 'function', startLine: 1, endLine: 2, callSites: 1 }],
      files: [
        { path: 'a.ts', link: 'direct', importDepth: 1, calls: [{ symbol: 'run', line: 1 }] },
        { path: 'b.ts', link: 'direct', importDepth: 1, calls: [] },
        { path: 'c.ts', link: 'name-only', calls: [] },
        { path: 'd.ts', link: 'name-only', calls: [] },
      ],
      counts: { direct: 2, transitive: 0, nameOnly: 2, callSites: 1 },
      truncated: true,
    });
    expect(text).toContain('  run (function) lines 1-2  1 call site\n');
    expect(text).toContain(
      'Affected files (4): 2 direct importers, 0 transitive, 2 name-only callers; 1 call site\n',
    );
    expect(text).toContain('    line 1  run  in top level\n');
    expect(text).toContain(
      `... truncated: at most ${MAX_IMPACT_FILES} files and ${MAX_CALL_EDGES} calls per symbol are read\n${note}`,
    );
  });
});
