import { describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from './graph/store.js';
import type { GraphEdge } from './graph/types.js';
import { detectLanguage } from './language.js';
import { loadFileLinks } from './map/links.js';
import {
  formatUnimportedFiles,
  getUnimportedFiles,
  MAX_UNIMPORTED_FILES,
  type UnimportedFilesInput,
} from './orphans.js';
import { chunkId, InMemoryVectorStore } from './store/index.js';

/** Files plus their imports as module specifiers, one import per line. */
async function setup(files: string[], imports: Record<string, string[]> = {}) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const path of files) {
    const chunk = {
      path,
      language: detectLanguage(path) ?? ('markdown' as const),
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
  for (const [path, modules] of Object.entries(imports)) {
    const edges: GraphEdge[] = modules.map((module, i) => ({
      path,
      language: 'typescript',
      kind: 'import',
      target: '*',
      module,
      line: i + 1,
    }));
    await graph.replaceFile(path, 'h', edges);
  }
  return { store, graph };
}

async function unimported(
  files: string[],
  imports: Record<string, string[]> = {},
  input?: UnimportedFilesInput,
) {
  const { store, graph } = await setup(files, imports);
  return getUnimportedFiles(store, graph, input);
}

const paths = (result: { files: { path: string }[] }) => result.files.map((f) => f.path);

describe('getUnimportedFiles', () => {
  it('lists files nothing imports and skips the ones that are imported', async () => {
    const result = await unimported(['src/a.ts', 'src/b.ts', 'src/c.ts'], {
      'src/a.ts': ['./b.js'],
    });
    expect(result.files).toEqual([
      { path: 'src/a.ts', language: 'typescript', imports: 1 },
      { path: 'src/c.ts', language: 'typescript', imports: 0 },
    ]);
    expect(result).toMatchObject({
      total: 2,
      checked: 3,
      skipped: 0,
      truncated: false,
    });
  });

  it('does not count a file as imported by itself', async () => {
    const result = await unimported(['src/a.ts'], { 'src/a.ts': ['./a.js'] });
    expect(paths(result)).toEqual(['src/a.ts']);
  });

  it('counts imports from test files as uses', async () => {
    const result = await unimported(['src/a.ts', 'src/a.test.ts'], {
      'src/a.test.ts': ['./a.js'],
    });
    expect(paths(result)).toEqual([]);
  });

  it('leaves out test files unless includeTests is set', async () => {
    const files = ['src/a.ts', 'src/a.test.ts', 'tests/helper.ts'];
    const imports = { 'src/a.test.ts': ['./a.js'] };
    expect(paths(await unimported(files, imports))).toEqual([]);
    const withTests = await unimported(files, imports, { includeTests: true });
    expect(paths(withTests)).toEqual(['src/a.test.ts', 'tests/helper.ts']);
  });

  it.each([
    'src/main.ts',
    'src/index.js',
    'src/cli.ts',
    'src/App.tsx',
    'src/server.ts',
    'pkg/__main__.py',
    'pkg/__init__.py',
    'setup.py',
    'tests_dir/conftest.py',
    'manage.py',
    'proj/wsgi.py',
    'proj/asgi.py',
    'web/lib.js',
    'pkg/mod.go',
  ])('treats %s as an entry point', async (file) => {
    const result = await unimported([file, 'src/dead.ts']);
    expect(paths(result)).toEqual(['src/dead.ts']);
    expect(result.checked).toBe(1);
  });

  it.each(['bin/tool.ts', 'pkg/scripts/seed.py', 'examples/demo/run.js'])(
    'treats %s in a bin, scripts or examples directory as an entry point',
    async (file) => {
      expect(paths(await unimported([file, 'src/dead.ts']))).toEqual(['src/dead.ts']);
    },
  );

  it('does not treat a file that only contains an entry directory name as one', async () => {
    const result = await unimported(['src/binary/x.ts', 'src/scripts.ts']);
    expect(paths(result)).toEqual(['src/binary/x.ts', 'src/scripts.ts']);
  });

  it.each(['vite.config.ts', 'web/eslint.config.js', 'jest.CONFIG.cjs'])(
    'treats %s as a tool config file',
    async (file) => {
      expect(paths(await unimported([file, 'src/dead.ts']))).toEqual(['src/dead.ts']);
    },
  );

  it('does not treat a file named config as a tool config file', async () => {
    expect(paths(await unimported(['src/config.ts']))).toEqual(['src/config.ts']);
  });

  it('leaves out Go files that sit next to a main.go and keeps other Go files', async () => {
    const result = await unimported([
      'cmd/main.go',
      'cmd/flags.go',
      'main.go',
      'root.go',
      'pkg/util.go',
    ]);
    expect(paths(result)).toEqual(['pkg/util.go']);
  });

  it('skips languages without path resolution and counts them', async () => {
    const result = await unimported(['src/a.ts', 'App.cs', 'App.swift', 'README.md', 'go.mod']);
    expect(paths(result)).toEqual(['src/a.ts']);
    expect(result.skipped).toBe(4);
    expect(result.checked).toBe(1);
  });

  it('skips JVM, PHP and Rust files and counts them', async () => {
    const files = ['A.java', 'B.kt', 'C.scala', 'd.php', 'e.rs', 'src/a.ts'];
    const result = await unimported(files);
    expect(paths(result)).toEqual(['src/a.ts']);
    expect(result.skipped).toBe(5);
  });

  it('skips C and C++ sources but checks headers', async () => {
    const files = ['n/a.c', 'n/b.cpp', 'n/c.cc', 'n/d.cxx', 'n/lone.h', 'n/used.h', 'n/u.hpp'];
    const result = await unimported(files, { 'n/a.c': ['./used.h'] });
    expect(paths(result)).toEqual(['n/lone.h', 'n/u.hpp']);
    expect(result.skipped).toBe(4);
  });

  it('filters by path prefix but counts imports from the whole index', async () => {
    const files = ['src/a.ts', 'src/b.ts', 'lib/c.ts', 'lib/d.ts'];
    const imports = { 'lib/c.ts': ['../src/b.js'] };
    const result = await unimported(files, imports, { pathPrefix: './src' });
    expect(paths(result)).toEqual(['src/a.ts']);
    expect(result.checked).toBe(2);
  });

  it('filters by language', async () => {
    const files = ['src/a.ts', 'lib/b.py', 'lib/c.rb'];
    const result = await unimported(files, {}, { language: 'python' });
    expect(result.files).toEqual([{ path: 'lib/b.py', language: 'python', imports: 0 }]);
    expect(result.skipped).toBe(0);
  });

  it('cuts the list at the maximum and keeps the total', async () => {
    const files = Array.from({ length: MAX_UNIMPORTED_FILES + 5 }, (_, i) => {
      return `src/f${String(i).padStart(3, '0')}.ts`;
    });
    const result = await unimported(files);
    expect(result.files).toHaveLength(MAX_UNIMPORTED_FILES);
    expect(result.total).toBe(MAX_UNIMPORTED_FILES + 5);
    expect(result.truncated).toBe(true);
    expect(result.files[0]?.path).toBe('src/f000.ts');
  });

  it('reuses links that were passed in without reading the stores', async () => {
    const { store, graph } = await setup(['src/a.ts', 'src/b.ts'], { 'src/a.ts': ['./b.js'] });
    const links = await loadFileLinks(store, graph);
    const untouched = {
      listIdsByPath: () => Promise.reject(new Error('store was read')),
    } as unknown as InMemoryVectorStore;
    const result = await getUnimportedFiles(untouched, graph, { links });
    expect(paths(result)).toEqual(['src/a.ts']);
  });
});

describe('formatUnimportedFiles', () => {
  it('prints (none) and the note for an empty result', async () => {
    const text = formatUnimportedFiles(
      await unimported(['src/a.ts', 'src/b.ts'], {
        'src/a.ts': ['./b.js'],
        'src/b.ts': ['./a.js'],
      }),
    );
    expect(text).toBe(
      [
        'Unimported files (0) of 2 files checked:',
        '  (none)',
        'Only TS/JS, Python, Ruby, Go and C/C++ headers are checked, and imports resolve by path only, so files reached through packages, dynamic imports or framework conventions can show up here. They are candidates, not proof.',
      ].join('\n'),
    );
  });

  it('prints one line per file and the skipped count', async () => {
    const text = formatUnimportedFiles(
      await unimported(['src/a.ts', 'src/b.ts', 'App.cs'], { 'src/a.ts': ['./b.js'] }),
    );
    expect(text).toContain('Unimported files (1) of 2 files checked:');
    expect(text).toContain('  src/a.ts (typescript, imports 1)');
    expect(text).toContain(
      'Skipped 1 files whose language or kind is used without a path-resolvable import (for example JVM, PHP, Rust, C#, Swift, C/C++ sources).',
    );
    expect(text).not.toContain('truncated');
  });

  it('prints a cut note when the list was truncated', async () => {
    const files = Array.from({ length: MAX_UNIMPORTED_FILES + 1 }, (_, i) => `s/f${i}.ts`);
    const text = formatUnimportedFiles(await unimported(files));
    expect(text).toContain(
      `... truncated: showing ${MAX_UNIMPORTED_FILES} of ${MAX_UNIMPORTED_FILES + 1}`,
    );
  });
});
