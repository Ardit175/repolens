import { describe, expect, it, vi } from 'vitest';
import type { Chunk } from './chunker/types.js';
import { UnknownFileError } from './deps.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { GraphEdge } from './graph/types.js';
import {
  formatAffectedTests,
  getAffectedTests,
  isTestFile,
  MAX_AFFECTED_TESTS,
  MAX_CHANGED_FILES,
  sourceStem,
  testSubject,
  type AffectedTests,
} from './affected-tests.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';

interface Layout {
  /** Every indexed file; each gets one fallback chunk, plus a symbol chunk when listed in `symbols`. */
  files: string[];
  /** Symbol names defined per file. */
  symbols?: Record<string, string[]>;
  /** Import modules per file. */
  imports?: Record<string, string[]>;
  /** Called symbol names per file. */
  calls?: Record<string, string[]>;
}

function chunk(path: string, name: string, kind: Chunk['kind']): Chunk {
  return {
    path,
    language: 'unknown',
    name,
    kind,
    startLine: 1,
    endLine: 5,
    content: name,
    hash: `${path}:${name}`,
  };
}

async function setup(layout: Layout) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const path of layout.files) {
    const chunks = (layout.symbols?.[path] ?? []).map((name) => chunk(path, name, 'function'));
    if (chunks.length === 0) chunks.push(chunk(path, path, 'file'));
    await store.upsert(chunks.map((c) => ({ id: chunkId(c), chunk: c, vector: [1, 0] })));
  }
  const graph = new InMemoryGraphStore();
  const paths = new Set([...Object.keys(layout.imports ?? {}), ...Object.keys(layout.calls ?? {})]);
  for (const path of paths) {
    const language = path.endsWith('.py') ? ('python' as const) : ('typescript' as const);
    const imports: GraphEdge[] = (layout.imports?.[path] ?? []).map((module, i) => ({
      path,
      language,
      kind: 'import',
      target: '*',
      module,
      line: i + 1,
    }));
    const calls: GraphEdge[] = (layout.calls?.[path] ?? []).map((target, i) => ({
      path,
      language,
      kind: 'call',
      target,
      line: i + 10,
    }));
    await graph.replaceFile(path, 'h', [...imports, ...calls]);
  }
  return { store, graph };
}

const BASE: Layout = {
  files: [
    'src/auth.ts',
    'src/db.ts',
    'src/session.ts',
    'src/auth.test.ts',
    'test/db.spec.ts',
    'test/session.spec.ts',
    'src/other.test.ts',
    'src/app.ts',
  ],
  symbols: { 'src/auth.ts': ['login'], 'src/db.ts': ['connect'] },
  imports: {
    'src/auth.test.ts': ['./auth'],
    'src/session.ts': ['./auth'],
    'test/session.spec.ts': ['../src/session'],
    'src/app.ts': ['./auth'],
  },
  calls: {
    'src/auth.test.ts': ['login', 'login'],
    'src/other.test.ts': ['login'],
  },
};

describe('isTestFile', () => {
  it.each([
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'foo.test.js',
    'pkg/test_foo.py',
    'pkg/foo_test.py',
    'pkg/foo_test.go',
    'spec/user_spec.rb',
    'lib/user_test.rb',
    'lib/test_user.rb',
    'src/foo_test.rs',
    'src/foo_test.c',
    'src/foo_test.cc',
    'src/foo_test.cpp',
    'src/foo_test.cxx',
    'src/test_foo.c',
    'src/test_foo.cc',
    'src/test_foo.cpp',
    'src/test_foo.cxx',
    'src/test_foo.rs',
    'a/UserServiceTest.java',
    'a/UserServiceTests.cs',
    'a/UserSpec.swift',
    'a/UserTest.kt',
    'a/UserTest.scala',
    'a/UserTest.php',
    'src/__tests__/helpers.ts',
    'tests/parser.rs',
    'test/helpers.js',
    'spec/helpers.rb',
    'pkg/tests/util.py',
  ])('accepts %s', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    'src/testing.ts',
    'src/latest.ts',
    'contest.py',
    'src/Test.java',
    'src/usertest.java',
    'src/foo.ts',
    'tests/readme.txt',
    'test/fixtures/ts/foo.test.ts',
    'tests/testdata/foo_test.go',
    'src/__snapshots__/foo.test.ts',
    'src/__fixtures__/__tests__/a.ts',
  ])('rejects %s', (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe('testSubject and sourceStem', () => {
  it.each([
    ['src/foo.test.ts', 'foo'],
    ['src/foo.spec.ts', 'foo'],
    ['pkg/test_foo.py', 'foo'],
    ['pkg/foo_test.go', 'foo'],
    ['spec/user_spec.rb', 'user'],
    ['a/UserServiceTest.java', 'userservice'],
    ['a/UserServiceTests.cs', 'userservice'],
    ['tests/parser.rs', 'parser'],
    ['src/__tests__/Helpers.ts', 'helpers'],
  ])('testSubject(%s) is %s', (path, expected) => {
    expect(testSubject(path)).toBe(expected);
  });

  it('returns undefined for a non-test file', () => {
    expect(testSubject('src/foo.ts')).toBeUndefined();
  });

  it('takes the stem without the last extension, lower-cased', () => {
    expect(sourceStem('src/foo.ts')).toBe('foo');
    expect(sourceStem('a/UserService.java')).toBe('userservice');
    expect(sourceStem('a/foo.config.ts')).toBe('foo.config');
  });
});

describe('getAffectedTests', () => {
  it('picks a direct importer and keeps non-test importers out', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.ts'] });
    const paths = result.tests.map((t) => t.path);
    expect(paths).not.toContain('src/session.ts');
    expect(paths).not.toContain('src/app.ts');
    expect(result.tests.find((t) => t.path === 'src/auth.test.ts')?.reasons).toEqual([
      { kind: 'imports', changed: 'src/auth.ts', depth: 1 },
      { kind: 'calls', changed: 'src/auth.ts', calls: 2 },
      { kind: 'name', changed: 'src/auth.ts' },
    ]);
  });

  it('follows imports through other files and names the via file', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.ts'] });
    expect(result.tests.find((t) => t.path === 'test/session.spec.ts')?.reasons).toEqual([
      { kind: 'imports', changed: 'src/auth.ts', depth: 2, via: 'src/session.ts' },
    ]);
    const shallow = await getAffectedTests(store, graph, { paths: ['src/auth.ts'], depth: 1 });
    expect(shallow.tests.map((t) => t.path)).not.toContain('test/session.spec.ts');
  });

  it('marks a caller that does not import the file as name-only', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.ts'] });
    expect(result.tests.find((t) => t.path === 'src/other.test.ts')?.reasons).toEqual([
      { kind: 'calls', changed: 'src/auth.ts', calls: 1, nameOnly: true },
    ]);
  });

  it('picks a test by naming convention only when the language matches', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/db.ts'] });
    expect(result.tests).toEqual([
      { path: 'test/db.spec.ts', reasons: [{ kind: 'name', changed: 'src/db.ts' }] },
    ]);
    const mismatch = await setup({
      files: ['src/foo.py', 'src/foo.test.ts', 'tests/test_foo.py'],
    });
    const other = await getAffectedTests(mismatch.store, mismatch.graph, { paths: ['src/foo.py'] });
    expect(other.tests.map((t) => t.path)).toEqual(['tests/test_foo.py']);
  });

  it('keeps only the name matches closest to the changed file by directory', async () => {
    const { store, graph } = await setup({
      files: [
        'src/api/index.ts',
        'src/api/index.test.ts',
        'src/ui/index.test.ts',
        'test/api/index.test.ts',
      ],
    });
    const result = await getAffectedTests(store, graph, { paths: ['src/api/index.ts'] });
    expect(result.tests.map((t) => t.path)).toEqual(['src/api/index.test.ts']);
    const nested = await setup({
      files: ['src/ui/form/index.ts', 'src/ui/index.test.ts', 'test/index.test.ts'],
    });
    const near = await getAffectedTests(nested.store, nested.graph, {
      paths: ['src/ui/form/index.ts'],
    });
    expect(near.tests.map((t) => t.path)).toEqual(['src/ui/index.test.ts']);
  });

  it('reports a changed test file and does not name-match from it', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.test.ts'] });
    expect(result.tests).toEqual([
      { path: 'src/auth.test.ts', reasons: [{ kind: 'changed', changed: 'src/auth.test.ts' }] },
    ]);
  });

  it('skips name-only calls from a changed test but keeps calls backed by an import', async () => {
    const { store, graph } = await setup({
      files: ['src/a.test.ts', 'src/b.test.ts', 'src/c.test.ts', 'src/helpers.test.ts'],
      symbols: { 'src/helpers.test.ts': ['write'] },
      imports: { 'src/c.test.ts': ['./helpers.test'] },
      calls: { 'src/a.test.ts': ['write'], 'src/c.test.ts': ['write'] },
    });
    const result = await getAffectedTests(store, graph, { paths: ['src/helpers.test.ts'] });
    expect(result.tests.map((t) => t.path)).toEqual(['src/helpers.test.ts', 'src/c.test.ts']);
    expect(result.tests[1]?.reasons).toEqual([
      { kind: 'imports', changed: 'src/helpers.test.ts', depth: 1 },
      { kind: 'calls', changed: 'src/helpers.test.ts', calls: 1 },
    ]);
  });

  it('merges reasons from several changed files on one test and dedupes paths', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, {
      paths: ['./src/db.ts', 'src/auth.ts', 'src/db.ts', 'src/session.ts'],
    });
    expect(result.changed).toEqual(['src/db.ts', 'src/auth.ts', 'src/session.ts']);
    const spec = result.tests.find((t) => t.path === 'test/session.spec.ts');
    expect(spec?.reasons).toEqual([
      { kind: 'imports', changed: 'src/session.ts', depth: 1 },
      { kind: 'name', changed: 'src/session.ts' },
      { kind: 'imports', changed: 'src/auth.ts', depth: 2, via: 'src/session.ts' },
    ]);
  });

  it('keeps the smallest depth when a test reaches a changed file twice', async () => {
    const layout: Layout = {
      files: ['lib.ts', 'mid.ts', 'a.test.ts'],
      imports: { 'mid.ts': ['./lib'], 'a.test.ts': ['./lib', './mid'] },
    };
    const { store, graph } = await setup(layout);
    const result = await getAffectedTests(store, graph, { paths: ['lib.ts'] });
    expect(result.tests[0]?.reasons).toEqual([{ kind: 'imports', changed: 'lib.ts', depth: 1 }]);
  });

  it('ranks by best reason, then number of reasons, then path', async () => {
    const layout: Layout = {
      files: [
        'lib.ts',
        'mid.ts',
        'lib.test.ts',
        'b.test.ts',
        'a.test.ts',
        'far.test.ts',
        'name.test.ts',
        'ghost.test.ts',
        'z.test.ts',
        'lib/helpers.ts',
      ],
      symbols: { 'lib.ts': ['run'] },
      imports: {
        'mid.ts': ['./lib'],
        'b.test.ts': ['./lib'],
        'a.test.ts': ['./lib'],
        'far.test.ts': ['./mid'],
        'z.test.ts': ['./lib'],
      },
      calls: { 'ghost.test.ts': ['run'], 'z.test.ts': ['run'] },
    };
    const { store, graph } = await setup(layout);
    const result = await getAffectedTests(store, graph, { paths: ['lib.ts'] });
    expect(result.tests.map((t) => t.path)).toEqual([
      'z.test.ts',
      'a.test.ts',
      'b.test.ts',
      'lib.test.ts',
      'far.test.ts',
      'ghost.test.ts',
    ]);
  });

  it('rejects an unknown path', async () => {
    const { store, graph } = await setup(BASE);
    await expect(getAffectedTests(store, graph, { paths: ['nope.ts'] })).rejects.toThrow(
      UnknownFileError,
    );
  });

  it('validates the input', async () => {
    const { store, graph } = await setup(BASE);
    await expect(getAffectedTests(store, graph, { paths: [] })).rejects.toThrow(
      'at least one path is required',
    );
    const many = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => `f${i}.ts`);
    await expect(getAffectedTests(store, graph, { paths: many })).rejects.toThrow(RangeError);
    for (const depth of [0, 6, 1.5]) {
      await expect(
        getAffectedTests(store, graph, { paths: ['src/auth.ts'], depth }),
      ).rejects.toThrow('depth must be an integer from 1 to 5');
    }
  });

  it('loads the file links once for several paths', async () => {
    const { store, graph } = await setup(BASE);
    const spy = vi.spyOn(store, 'listIdsByPath');
    await getAffectedTests(store, graph, { paths: ['src/auth.ts', 'src/db.ts', 'src/session.ts'] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cuts the list at the maximum and reports the total', async () => {
    const tests = Array.from(
      { length: MAX_AFFECTED_TESTS + 1 },
      (_, i) => `d${String(i).padStart(3, '0')}/lib.test.ts`,
    );
    const { store, graph } = await setup({ files: ['lib.ts', ...tests] });
    const result = await getAffectedTests(store, graph, { paths: ['lib.ts'] });
    expect(result.total).toBe(MAX_AFFECTED_TESTS + 1);
    expect(result.tests).toHaveLength(MAX_AFFECTED_TESTS);
    expect(result.truncated).toBe(true);
    expect(result.tests[0]?.path).toBe('d000/lib.test.ts');
  });

  it('lists test importers that sort after more than 100 source importers', async () => {
    const sources = Array.from(
      { length: 150 },
      (_, i) => `src/user${String(i).padStart(3, '0')}.ts`,
    );
    const tests = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'];
    const imports: Record<string, string[]> = {};
    for (const file of [...sources, ...tests]) imports[file] = ['../src/core'];
    const { store, graph } = await setup({ files: ['src/core.ts', ...sources, ...tests], imports });
    const result = await getAffectedTests(store, graph, { paths: ['src/core.ts'] });
    expect(result.tests.map((t) => t.path)).toEqual(tests);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('records unindexed paths with skipUnknown and still processes the rest', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, {
      paths: ['./gone.ts', 'src/auth.ts', 'gone.ts', 'other\\missing.ts'],
      skipUnknown: true,
    });
    expect(result.changed).toEqual(['src/auth.ts']);
    expect(result.skipped).toEqual(['gone.ts', 'other/missing.ts']);
    expect(result.tests.map((t) => t.path)).toContain('src/auth.test.ts');
  });

  it('returns an empty result when every path is skipped', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['gone.ts'], skipUnknown: true });
    expect(result).toEqual({
      changed: [],
      skipped: ['gone.ts'],
      tests: [],
      total: 0,
      truncated: false,
    });
  });

  it('throws for an unindexed path without skipUnknown and has no skipped paths otherwise', async () => {
    const { store, graph } = await setup(BASE);
    await expect(getAffectedTests(store, graph, { paths: ['gone.ts'] })).rejects.toThrow(
      UnknownFileError,
    );
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.ts'] });
    expect(result.skipped).toEqual([]);
  });

  it('is not truncated for a small result', async () => {
    const { store, graph } = await setup(BASE);
    const result = await getAffectedTests(store, graph, { paths: ['src/auth.ts'] });
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(result.tests.length);
  });
});

describe('formatAffectedTests', () => {
  const note =
    'Picked by import links, call sites (matched by name) and test file naming conventions.';

  it('renders every reason kind', () => {
    const result: AffectedTests = {
      changed: ['src/auth.ts', 'src/db.ts'],
      skipped: [],
      total: 3,
      truncated: false,
      tests: [
        {
          path: 'src/auth.test.ts',
          reasons: [
            { kind: 'changed', changed: 'src/auth.test.ts' },
            { kind: 'imports', changed: 'src/auth.ts', depth: 1 },
            { kind: 'calls', changed: 'src/auth.ts', calls: 4 },
          ],
        },
        {
          path: 'test/db.spec.ts',
          reasons: [
            { kind: 'imports', changed: 'src/auth.ts', depth: 2, via: 'src/session.ts' },
            { kind: 'name', changed: 'src/db.ts' },
          ],
        },
        {
          path: 'src/other.test.ts',
          reasons: [{ kind: 'calls', changed: 'src/auth.ts', calls: 1, nameOnly: true }],
        },
      ],
    };
    expect(formatAffectedTests(result)).toBe(
      [
        'Changed (2): src/auth.ts, src/db.ts',
        'Tests to run (3):',
        '  src/auth.test.ts',
        '    is a changed file',
        '    imports src/auth.ts directly',
        '    makes 4 calls into src/auth.ts',
        '  test/db.spec.ts',
        '    imports src/auth.ts at depth 2 via src/session.ts',
        '    named after src/db.ts',
        '  src/other.test.ts',
        '    makes 1 call into src/auth.ts by name only (no import, may be unrelated)',
        note,
      ].join('\n'),
    );
  });

  it('renders the empty case', () => {
    expect(
      formatAffectedTests({
        changed: ['a.ts'],
        skipped: [],
        tests: [],
        total: 0,
        truncated: false,
      }),
    ).toBe(
      [
        'Changed (1): a.ts',
        'Tests to run (0):',
        '  (none). No indexed test file imports, calls or is named after the changed files.',
        note,
      ].join('\n'),
    );
  });

  it('renders the skipped line and an empty changed list', () => {
    expect(
      formatAffectedTests({
        changed: [],
        skipped: ['a.ts', 'b.ts'],
        tests: [],
        total: 0,
        truncated: false,
      }),
    ).toBe(
      [
        'Changed (0): (none)',
        'Skipped (not indexed, 2): a.ts, b.ts',
        'Tests to run (0):',
        '  (none). No indexed test file imports, calls or is named after the changed files.',
        note,
      ].join('\n'),
    );
  });

  it('renders the truncation notices', () => {
    const tests = [{ path: 'a.test.ts', reasons: [{ kind: 'name' as const, changed: 'a.ts' }] }];
    const cut = formatAffectedTests({
      changed: ['a.ts'],
      skipped: [],
      tests,
      total: 300,
      truncated: true,
    });
    expect(cut).toContain(`... truncated: showing ${MAX_AFFECTED_TESTS} of 300\n${note}`);
    const limited = formatAffectedTests({
      changed: ['a.ts'],
      skipped: [],
      tests,
      total: 1,
      truncated: true,
    });
    expect(limited).toContain(`... some links were left out because of a limit\n${note}`);
  });
});
