import { beforeAll, describe, expect, it } from 'vitest';
import type { Runtime } from '../runtime.js';
import { seededRuntime } from './fixtures.js';
import { InMemoryGraphStore } from '../graph/store.js';
import type { GraphEdge } from '../graph/types.js';
import {
  affectedTests,
  callGraph,
  changeImpact,
  fileContext,
  fileDependencies,
  findReferences,
  getSymbol,
  importCycles,
  indexStatus,
  listFiles,
  MAX_GRAPH_LEVEL_NODES,
  searchCode,
  ToolError,
  unusedSymbols,
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

  it('puts the symbol named in the query first and marks it as a name match', async () => {
    const text = await searchCode(runtime, { query: 'AuthService.login', limit: 3 });
    const first = text.split('\n')[0];
    expect(first).toContain('AuthService.login');
    expect(first).toMatch(/name match$/);
  });

  it('prints only the score in semantic mode', async () => {
    const text = await searchCode(runtime, { query: 'login', limit: 1, mode: 'semantic' });
    expect(text.split('\n')[0]).toMatch(/score \d\.\d{3}$/);
    expect(text).not.toContain('name match');
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

describe('indexStatus', () => {
  it('describes the seeded index without a watcher', async () => {
    const text = await indexStatus(await seededRuntime());
    expect(text).toContain('Index: test');
    expect(text).toContain('Files: 3');
    expect(text).toMatch(/typescript\D+2/);
    expect(text).toMatch(/python\D+1/);
    expect(text).toContain('Symbol graph: 2 files');
    expect(text).toContain('Watching: no');
  });

  it('shows the watcher and its last error as a warning', async () => {
    const watched = await seededRuntime();
    watched.watch = { root: 'repo', passes: 2, lastPassAt: new Date(), lastError: 'boom' };
    const text = await indexStatus(watched);
    expect(text).toContain('Watching: repo, 2 passes');
    expect(text).toContain('Warnings:');
    expect(text).toContain('boom');
  });
});

describe('fileDependencies', () => {
  it('renders the dependencies of a file', async () => {
    const text = await fileDependencies(runtime, { path: 'src/auth.ts', direction: 'imports' });
    expect(text.split('\n')[0]).toBe('src/auth.ts');
    expect(text).toContain("Imports (1):\n  src/db.ts  line 1  './db.js'");
    expect(text).toContain('Imported by (0):');
  });

  it('shows importers', async () => {
    const text = await fileDependencies(runtime, { path: 'src/db.ts', depth: 1 });
    expect(text).toContain("Imported by (1):\n  src/auth.ts  line 1  './db.js'");
  });

  it('turns an unknown file into a ToolError with suggestions', async () => {
    const failure = fileDependencies(runtime, { path: 'auth.ts' });
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toThrow('Did you mean src/auth.ts?');
  });
});

describe('changeImpact', () => {
  it('lists the direct importer and the call sites of a file', async () => {
    const text = await changeImpact(runtime, { path: 'src/db.ts' });
    expect(text.split('\n')[0]).toBe('src/db.ts');
    expect(text).toContain(
      'Affected files (2): 1 direct importer, 0 transitive, 1 name-only caller',
    );
    expect(text).toContain(
      'src/auth.ts  direct import\n    line 3  openDatabase  in AuthService.login',
    );
    expect(text).toContain('scripts/seed.py  name-only caller');
  });

  it('narrows the impact to one symbol', async () => {
    const text = await changeImpact(runtime, { path: 'src/auth.ts', symbol: 'AuthService.login' });
    expect(text).toContain('src/auth.ts  (symbol: AuthService.login)');
    expect(text).toContain('Affected files (0):');
  });

  it('turns an unknown file into a ToolError with suggestions', async () => {
    const failure = changeImpact(runtime, { path: 'db.ts' });
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toThrow('Did you mean src/db.ts?');
  });

  it('turns an unknown symbol into a ToolError that lists the symbols', async () => {
    const failure = changeImpact(runtime, { path: 'src/db.ts', symbol: 'nothing' });
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toThrow('Symbols in this file: openDatabase');
  });

  it('lets an invalid depth through as a RangeError', async () => {
    await expect(changeImpact(runtime, { path: 'src/db.ts', depth: 9 })).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});

describe('affectedTests', () => {
  let withTests: Runtime;
  beforeAll(async () => {
    withTests = await seededRuntime({ withTests: true });
  });

  it('lists the tests that import or call the changed file, with reasons', async () => {
    const text = await affectedTests(withTests, { paths: ['src/auth.ts'] });
    expect(text).toContain('Changed (1): src/auth.ts');
    expect(text).toContain('Tests to run (1):');
    expect(text).toContain(
      'src/auth.test.ts\n    imports src/auth.ts directly\n    makes 1 call into src/auth.ts',
    );
  });

  it('answers normally when no test is affected', async () => {
    const text = await affectedTests(withTests, { paths: ['scripts/seed.py'], depth: 1 });
    expect(text).toContain('Tests to run (0):');
    expect(text).toContain('(none)');
  });

  it('turns an unknown file into a ToolError with suggestions', async () => {
    const failure = affectedTests(withTests, { paths: ['db.ts'] });
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toThrow('Did you mean src/db.ts?');
  });

  it('turns too many paths and a bad depth into ToolErrors', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`);
    await expect(affectedTests(withTests, { paths: many })).rejects.toBeInstanceOf(ToolError);
    await expect(affectedTests(withTests, { paths: [] })).rejects.toBeInstanceOf(ToolError);
    await expect(affectedTests(withTests, { paths: ['src/db.ts'], depth: 9 })).rejects.toThrow(
      'depth must be an integer from 1 to 5',
    );
  });
});

describe('unusedSymbols', () => {
  it('lists functions and methods nothing calls, and skips the ones that are called', async () => {
    const text = await unusedSymbols(await seededRuntime(), {});
    expect(text).toContain('Unused symbols (2) of 4 functions and methods checked:');
    expect(text).toContain('scripts/seed.py:1-2  function  seed_database');
    expect(text).toContain('src/auth.ts:5-7  method  AuthService.logout');
    expect(text).not.toContain('openDatabase');
    expect(text).not.toContain('AuthService.login');
  });

  it('filters by path and language and counts test calls as uses', async () => {
    const withTests = await seededRuntime({ withTests: true });
    const text = await unusedSymbols(withTests, { path: 'src/', language: 'typescript' });
    expect(text).toContain('Unused symbols (1) of 3');
    const all = await unusedSymbols(withTests, { include_tests: true });
    expect(all).toContain('src/auth.test.ts:3-5  function  checksLogin');
  });

  it('answers normally for a prefix that matches nothing', async () => {
    const text = await unusedSymbols(await seededRuntime(), { path: 'nowhere/' });
    expect(text).toContain('Unused symbols (0) of 0');
    expect(text).toContain('(none)');
  });
});

describe('importCycles', () => {
  async function cyclic(): Promise<Runtime> {
    const graph = new InMemoryGraphStore();
    const edge = (path: string, module: string, line: number): GraphEdge => ({
      path,
      language: 'typescript',
      kind: 'import',
      target: 'x',
      module,
      line,
    });
    await graph.replaceFile('src/auth.ts', 'h', [edge('src/auth.ts', './db.js', 1)]);
    await graph.replaceFile('src/db.ts', 'h', [edge('src/db.ts', './auth.js', 4)]);
    return { ...(await seededRuntime()), graph };
  }

  it('answers (none) when no files import each other in a ring', async () => {
    const text = await importCycles(await seededRuntime(), {});
    expect(text).toContain('Import cycles (0):');
    expect(text).toContain('(none)');
  });

  it('lists a cycle with the lines of its import loop', async () => {
    const text = await importCycles(await cyclic(), {});
    expect(text).toContain('Import cycles (1) covering 2 files:');
    expect(text).toContain('1. 2 files: src/auth.ts, src/db.ts');
    expect(text).toContain('src/auth.ts:1 imports ./db.js -> src/db.ts');
    expect(text).toContain('src/db.ts:4 imports ./auth.js -> src/auth.ts');
  });

  it('keeps a cycle when a file under the path matches, and drops it otherwise', async () => {
    const rt = await cyclic();
    expect(await importCycles(rt, { path: 'src/' })).toContain('Import cycles (1)');
    expect(await importCycles(rt, { path: 'scripts/' })).toContain('Import cycles (0):');
  });
});
