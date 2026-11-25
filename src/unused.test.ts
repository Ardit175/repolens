import { describe, expect, it } from 'vitest';
import type { Chunk, SymbolKind } from './chunker/types.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { Language } from './language.js';
import type { GraphEdge } from './graph/types.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';
import {
  formatUnusedSymbols,
  getUnusedSymbols,
  MAX_UNUSED_SYMBOLS,
  type UnusedSymbols,
} from './unused.js';

interface SymbolSpec {
  name: string;
  kind?: SymbolKind;
  start?: number;
  parent?: string;
}

interface EdgeSpec {
  kind: 'call' | 'import';
  target: string;
  from?: string;
  fromParent?: string;
}

interface Layout {
  symbols: Record<string, SymbolSpec[]>;
  edges?: Record<string, EdgeSpec[]>;
}

function languageOf(path: string): Language {
  if (path.endsWith('.go')) return 'go';
  if (path.endsWith('.py')) return 'python';
  return 'typescript';
}

async function setup(layout: Layout) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const [path, symbols] of Object.entries(layout.symbols)) {
    const chunks: Chunk[] = symbols.map((s, i) => ({
      path,
      language: languageOf(path),
      name: s.name,
      kind: s.kind ?? 'function',
      ...(s.parent !== undefined ? { parent: s.parent } : {}),
      startLine: s.start ?? i * 10 + 1,
      endLine: (s.start ?? i * 10 + 1) + 5,
      content: s.name,
      hash: `${path}:${s.parent ?? ''}:${s.name}`,
    }));
    await store.upsert(chunks.map((chunk) => ({ id: chunkId(chunk), chunk, vector: [1, 0] })));
  }
  const graph = new InMemoryGraphStore();
  for (const [path, specs] of Object.entries(layout.edges ?? {})) {
    const edges: GraphEdge[] = specs.map((spec, i) => ({
      path,
      language: languageOf(path),
      kind: spec.kind,
      target: spec.target,
      ...(spec.kind === 'import' ? { module: './x' } : {}),
      line: i + 1,
      ...(spec.from !== undefined ? { from: spec.from } : {}),
      ...(spec.fromParent !== undefined ? { fromParent: spec.fromParent } : {}),
    }));
    await graph.replaceFile(path, 'h', edges);
  }
  return { store, graph };
}

async function unused(layout: Layout, input: Parameters<typeof getUnusedSymbols>[2] = {}) {
  const { store, graph } = await setup(layout);
  return getUnusedSymbols(store, graph, input);
}

function names(result: UnusedSymbols): string[] {
  return result.symbols.map((s) => (s.parent === undefined ? s.name : `${s.parent}.${s.name}`));
}

describe('getUnusedSymbols', () => {
  it('reports a function nothing calls or imports', async () => {
    const result = await unused({ symbols: { 'src/a.ts': [{ name: 'orphan' }] } });
    expect(result).toEqual({
      symbols: [{ path: 'src/a.ts', name: 'orphan', kind: 'function', startLine: 1, endLine: 6 }],
      total: 1,
      checked: 1,
      truncated: false,
    });
  });

  it('does not report a function called from another file', async () => {
    const result = await unused({
      symbols: { 'src/a.ts': [{ name: 'used' }], 'src/b.ts': [{ name: 'caller' }] },
      edges: { 'src/b.ts': [{ kind: 'call', target: 'used', from: 'caller' }] },
    });
    expect(names(result)).toEqual(['caller']);
    expect(result.checked).toBe(2);
  });

  it('does not report a function that is imported by name', async () => {
    const result = await unused({
      symbols: { 'src/a.ts': [{ name: 'helper' }] },
      edges: { 'src/b.ts': [{ kind: 'import', target: 'helper' }] },
    });
    expect(result.total).toBe(0);
    expect(result.checked).toBe(1);
  });

  it('treats a function that only calls itself as unused', async () => {
    const result = await unused({
      symbols: { 'src/a.ts': [{ name: 'fact' }] },
      edges: { 'src/a.ts': [{ kind: 'call', target: 'fact', from: 'fact' }] },
    });
    expect(names(result)).toEqual(['fact']);
  });

  it('counts a recursive method as unused but a call from a sibling as a use', async () => {
    const symbols = {
      'src/a.ts': [
        { name: 'walk', kind: 'method' as const, parent: 'Tree' },
        { name: 'visit', kind: 'method' as const, parent: 'Tree' },
      ],
    };
    const selfOnly = await unused({
      symbols,
      edges: { 'src/a.ts': [{ kind: 'call', target: 'walk', from: 'walk', fromParent: 'Tree' }] },
    });
    expect(names(selfOnly)).toEqual(['Tree.walk', 'Tree.visit']);
    const sibling = await unused({
      symbols,
      edges: { 'src/a.ts': [{ kind: 'call', target: 'walk', from: 'visit', fromParent: 'Tree' }] },
    });
    expect(names(sibling)).toEqual(['Tree.visit']);
  });

  it('counts a call to a same-named method of another class as a use (name match)', async () => {
    const result = await unused({
      symbols: {
        'src/a.ts': [{ name: 'save', kind: 'method', parent: 'Repo' }],
        'src/b.ts': [{ name: 'run' }],
      },
      edges: { 'src/b.ts': [{ kind: 'call', target: 'save', from: 'run' }] },
    });
    expect(names(result)).toEqual(['run']);
  });

  it('ignores classes and fallback file chunks', async () => {
    const result = await unused({
      symbols: {
        'src/a.ts': [
          { name: 'Thing', kind: 'class' },
          { name: 'src/a.ts', kind: 'file' },
        ],
      },
    });
    expect(result).toMatchObject({ total: 0, checked: 0 });
  });

  describe('test files', () => {
    const layout: Layout = {
      symbols: {
        'src/a.ts': [{ name: 'covered' }],
        'src/a.test.ts': [{ name: 'checksCovered' }],
      },
      edges: { 'src/a.test.ts': [{ kind: 'call', target: 'covered', from: 'checksCovered' }] },
    };

    it('are not reported by default, and their calls count as uses', async () => {
      const result = await unused(layout);
      expect(result).toMatchObject({ total: 0, checked: 1 });
    });

    it('are reported with includeTests', async () => {
      const result = await unused(layout, { includeTests: true });
      expect(result.symbols.map((s) => s.path)).toEqual(['src/a.test.ts']);
      expect(result.checked).toBe(2);
    });
  });

  it('never reports names that are called implicitly', async () => {
    const result = await unused({
      symbols: {
        'src/a.ts': [
          { name: 'main' },
          { name: 'constructor', kind: 'method', parent: 'A' },
          { name: 'toString', kind: 'method', parent: 'A' },
          { name: 'real' },
        ],
        'lib/m.py': [
          { name: '__init__', kind: 'method', parent: 'M' },
          { name: '__repr__', kind: 'method', parent: 'M' },
        ],
        'pkg/x_test.go': [{ name: 'TestFoo' }, { name: 'Test' }, { name: 'BenchmarkFoo' }],
        'pkg/x.go': [{ name: 'Testing' }, { name: 'String', kind: 'method', parent: 'T' }],
      },
    });
    expect(names(result)).toEqual(['Testing', 'real']);
    expect(result.checked).toBe(2);
  });

  it('filters the report by path prefix but counts usage across the whole index', async () => {
    const layout: Layout = {
      symbols: {
        'src/a.ts': [{ name: 'usedElsewhere' }, { name: 'orphanA' }],
        'lib/b.ts': [{ name: 'orphanB' }],
        'tools/c.ts': [{ name: 'caller' }],
      },
      edges: { 'tools/c.ts': [{ kind: 'call', target: 'usedElsewhere', from: 'caller' }] },
    };
    const result = await unused(layout, { pathPrefix: './src/' });
    expect(names(result)).toEqual(['orphanA']);
    expect(result.checked).toBe(2);
    expect(await unused(layout, { pathPrefix: 'nowhere/' })).toMatchObject({
      total: 0,
      checked: 0,
      symbols: [],
    });
  });

  it('filters the report by language but counts usage across languages', async () => {
    const layout: Layout = {
      symbols: {
        'src/a.ts': [{ name: 'orphanTs' }, { name: 'sharedName' }],
        'lib/b.py': [{ name: 'orphanPy' }, { name: 'callerPy' }],
      },
      edges: { 'lib/b.py': [{ kind: 'call', target: 'sharedName', from: 'callerPy' }] },
    };
    const python = await unused(layout, { language: 'python' });
    expect(names(python)).toEqual(['orphanPy', 'callerPy']);
    const ts = await unused(layout, { language: 'typescript' });
    expect(names(ts)).toEqual(['orphanTs']);
  });

  it('orders by path then start line', async () => {
    const result = await unused({
      symbols: {
        'src/b.ts': [
          { name: 'late', start: 40 },
          { name: 'early', start: 2 },
        ],
        'src/a.ts': [{ name: 'only', start: 9 }],
      },
    });
    expect(result.symbols.map((s) => [s.path, s.startLine])).toEqual([
      ['src/a.ts', 9],
      ['src/b.ts', 2],
      ['src/b.ts', 40],
    ]);
  });

  it('cuts the list at MAX_UNUSED_SYMBOLS and keeps the total', async () => {
    const count = MAX_UNUSED_SYMBOLS + 5;
    const result = await unused({
      symbols: { 'src/a.ts': Array.from({ length: count }, (_, i) => ({ name: `f${i}` })) },
    });
    expect(result.symbols).toHaveLength(MAX_UNUSED_SYMBOLS);
    expect(result).toMatchObject({ total: count, checked: count, truncated: true });
  });
});

describe('formatUnusedSymbols', () => {
  it('lists each symbol with its location, kind and qualified name', async () => {
    const result = await unused({
      symbols: {
        'src/a.ts': [{ name: 'orphan' }, { name: 'save', kind: 'method', parent: 'Repo' }],
      },
    });
    const text = formatUnusedSymbols(result);
    expect(text).toContain('Unused symbols (2) of 2 functions and methods checked:');
    expect(text).toContain('  src/a.ts:1-6  function  orphan');
    expect(text).toContain('  src/a.ts:11-16  method  Repo.save');
    expect(text).toContain('Matched by name:');
    expect(text).not.toContain('truncated');
  });

  it('says (none) when everything is used', () => {
    const text = formatUnusedSymbols({ symbols: [], total: 0, checked: 3, truncated: false });
    expect(text).toContain('Unused symbols (0) of 3 functions and methods checked:\n  (none)');
  });

  it('notes the cut', () => {
    const text = formatUnusedSymbols({
      symbols: [{ path: 'a.ts', name: 'f', kind: 'function', startLine: 1, endLine: 2 }],
      total: 250,
      checked: 300,
      truncated: true,
    });
    expect(text).toContain('... truncated: showing 1 of 250');
  });
});
