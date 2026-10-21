import { beforeAll, describe, expect, it } from 'vitest';
import type { Runtime } from '../runtime.js';
import { seededRuntime } from './fixtures.js';
import { InMemoryGraphStore } from '../graph/store.js';
import type { GraphEdge } from '../graph/types.js';
import {
  callGraph,
  fileContext,
  findReferences,
  getSymbol,
  listFiles,
  MAX_GRAPH_LEVEL_NODES,
  searchCode,
  ToolError,
} from './tools.js';

let runtime: Runtime;
beforeAll(async () => {
  runtime = await seededRuntime();
});

describe('searchCode', () => {
  it('returns the best match first with its code', async () => {
    const text = await searchCode(runtime, { query: 'openDatabase url connected', limit: 2 });
    expect(text.split('\n')[0]).toContain('src/db.ts');
    expect(text).toContain('openDatabase');
    expect(text).toContain('```typescript');
  });

  it('applies the language filter', async () => {
    const text = await searchCode(runtime, { query: 'database', language: 'python' });
    expect(text).toContain('scripts/seed.py');
    expect(text).not.toContain('src/db.ts');
  });

  it('says so when nothing matches the filters', async () => {
    expect(await searchCode(runtime, { query: 'database', path: 'nope/' })).toBe('No results.');
  });

  it('rejects an empty query', async () => {
    await expect(searchCode(runtime, { query: '  ' })).rejects.toThrow('must not be empty');
  });
});

describe('getSymbol', () => {
  it('finds a method by bare name', async () => {
    const text = await getSymbol(runtime, { name: 'login' });
    expect(text).toContain('src/auth.ts:2-4  AuthService.login (method, typescript)');
    expect(text).toContain('password.length > 0');
  });

  it('accepts Class.method and restricts to the parent', async () => {
    expect(await getSymbol(runtime, { name: 'AuthService.logout' })).toContain('logout');
    await expect(getSymbol(runtime, { name: 'Other.logout' })).rejects.toBeInstanceOf(ToolError);
  });

  it('restricts to a path', async () => {
    await expect(getSymbol(runtime, { name: 'login', path: 'src/db.ts' })).rejects.toThrow(
      'in src/db.ts',
    );
  });

  it('explains an unknown symbol and rejects a blank one', async () => {
    await expect(getSymbol(runtime, { name: 'missing' })).rejects.toThrow('search_code');
    await expect(getSymbol(runtime, { name: ' ' })).rejects.toThrow('must not be empty');
  });
});

describe('listFiles', () => {
  it('lists every indexed file sorted', async () => {
    expect(await listFiles(runtime, {})).toBe('3 files\nscripts/seed.py\nsrc/auth.ts\nsrc/db.ts');
  });

  it('filters by prefix and truncates at the limit', async () => {
    expect(await listFiles(runtime, { path: 'src/', limit: 1 })).toBe(
      '2 files\nsrc/auth.ts\n... 1 more',
    );
    expect(await listFiles(runtime, { path: 'zzz/' })).toBe('No files.');
  });

  it('tells the user to index when the store is empty', async () => {
    const { InMemoryVectorStore } = await import('../store/index.js');
    const empty: Runtime = { ...runtime, store: new InMemoryVectorStore() };
    expect(await listFiles(empty, {})).toContain('repolens index');
  });
});

describe('fileContext', () => {
  it('shows an outline followed by each chunk in line order', async () => {
    const text = await fileContext(runtime, { path: 'src/auth.ts' });
    expect(text).toContain('Outline:\n- AuthService (class) lines');
    expect(text).toContain('- AuthService.login (method)');
    expect(text.indexOf('AuthService.login')).toBeLessThan(text.indexOf('AuthService.logout'));
    expect(text).toContain('```typescript');
  });

  it('rejects a path that is not indexed', async () => {
    await expect(fileContext(runtime, { path: 'src/none.ts' })).rejects.toThrow('list_files');
  });
});

function call(target: string, from: string | undefined, line: number, path = 'a.ts'): GraphEdge {
  return {
    path,
    language: 'typescript',
    kind: 'call',
    target,
    ...(from === undefined ? {} : { from }),
    line,
  };
}

async function withEdges(edges: GraphEdge[]): Promise<Runtime> {
  const graph = new InMemoryGraphStore();
  await graph.replaceFile('a.ts', 'h', edges);
  return { ...runtime, graph };
}

describe('findReferences', () => {
  it('lists imports and calls with their locations', async () => {
    const text = await findReferences(runtime, { name: 'openDatabase' });
    expect(text).toContain('References to "openDatabase" (3)');
    expect(text).toContain('src/auth.ts:1  import from "./db.js"');
    expect(text).toContain('src/auth.ts:3  call in AuthService.login');
  });

  it('describes top-level calls', async () => {
    const rt = await withEdges([call('x', undefined, 4)]);
    expect(await findReferences(rt, { name: 'x' })).toContain('a.ts:4  call in top level');
  });

  it('answers normally and states the name-only limit when nothing is found', async () => {
    const text = await findReferences(runtime, { name: 'ghost' });
    expect(text).toContain('No references to "ghost" found');
    expect(text).toContain('name only');
  });

  it('truncates at the limit and rejects a blank name', async () => {
    const text = await findReferences(runtime, { name: 'openDatabase', limit: 1 });
    expect(text).toContain('(first 1)');
    expect(text).toContain('... more');
    await expect(findReferences(runtime, { name: ' ' })).rejects.toThrow('must not be empty');
  });
});

describe('callGraph', () => {
  it('renders callers as an indented tree up to the depth', async () => {
    expect(await callGraph(runtime, { name: 'openDatabase' })).toBe(
      [
        'openDatabase',
        '  seed_database  scripts/seed.py:2',
        '  login  src/auth.ts:3',
        '    logout  src/auth.ts:6',
      ].join('\n'),
    );
  });

  it('enforces the depth limit', async () => {
    const text = await callGraph(runtime, { name: 'openDatabase', depth: 1 });
    expect(text).not.toContain('logout');
  });

  it('follows callees, scoped to the symbol file', async () => {
    expect(await callGraph(runtime, { name: 'login', direction: 'callees' })).toBe(
      'login\n  openDatabase  src/auth.ts:3',
    );
  });

  it('marks cycles as seen instead of looping', async () => {
    const rt = await withEdges([call('b', 'a', 1), call('a', 'b', 2)]);
    expect(await callGraph(rt, { name: 'a', depth: 5 })).toBe(
      ['a', '  b  a.ts:2', '    a  a.ts:1 (seen)'].join('\n'),
    );
  });

  it('caps each level and reports the remainder', async () => {
    const edges = Array.from({ length: MAX_GRAPH_LEVEL_NODES + 3 }, (_, i) =>
      call('target', `caller${String(i).padStart(2, '0')}`, i + 1),
    );
    const text = await callGraph(await withEdges(edges), { name: 'target', depth: 1 });
    expect(text.split('\n')).toHaveLength(1 + MAX_GRAPH_LEVEL_NODES + 1);
    expect(text).toContain('  ... 3 more');
  });

  it('says so when there are no callers and ignores calls without an enclosing symbol', async () => {
    const rt = await withEdges([call('x', undefined, 1)]);
    const text = await callGraph(rt, { name: 'x' });
    expect(text).toContain('(no callers found)');
  });

  it('errors for callees of an unknown symbol and for a blank name', async () => {
    await expect(callGraph(runtime, { name: 'ghost', direction: 'callees' })).rejects.toThrow(
      'search_code',
    );
    await expect(callGraph(runtime, { name: '' })).rejects.toThrow('must not be empty');
  });
});
