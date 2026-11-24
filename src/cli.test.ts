import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, main, type Deps } from './cli.js';
import { InMemoryGraphStore } from './graph/store.js';
import { GitError } from './git.js';
import { resolveIndexName, type IndexInfo } from './indexes.js';
import type { Runtime } from './runtime.js';
import { InMemoryVectorStore } from './store/index.js';
import { FakeEmbeddingProvider } from './testing.js';
import type { WatchOptions, Watcher } from './watch.js';

let dir: string;
let out: string;
let err: string;
const io = {
  out: (s: string) => void (out += s),
  err: (s: string) => void (err += s),
};

function write(rel: string, content = 'x'): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

async function run(...args: string[]): Promise<void> {
  await main(['node', 'repolens', ...args], io);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'repolens-cli-'));
  out = '';
  err = '';
  process.exitCode = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('repolens index', () => {
  it('prints totals and a per-language table sorted by count', async () => {
    write('a.ts');
    write('b.ts');
    write('c.ts');
    write('d.py');
    write('e.go');
    write('e2.go');
    write('notes.xyz');
    await run('index', dir, '--dry-run');
    expect(err).toBe('');
    expect(process.exitCode).toBeUndefined();
    expect(out).toContain('Indexed 7 files');
    expect(out).toContain('Unrecognised: 1');
    const lines = out.split('\n');
    const order = ['typescript', 'go', 'python'].map((l) =>
      lines.findIndex((x) => x.startsWith(l)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out).toMatch(/typescript\s+3/);
  });

  it('uses the shebang for files without a known extension', async () => {
    write('tool', '#!/usr/bin/env python3\nprint(1)\n');
    write('runner', '#!/bin/bash\necho hi\n');
    write('plain', 'just text\n');
    await run('index', dir, '--dry-run');
    expect(out).toMatch(/python\s+1/);
    expect(out).toMatch(/shell\s+1/);
    expect(out).toContain('Unrecognised: 1');
  });

  it('handles an empty directory', async () => {
    await run('index', dir, '--dry-run');
    expect(out).toContain('Indexed 0 files');
    expect(out).toContain('Unrecognised: 0');
  });

  it('honours --max-file-size', async () => {
    write('small.ts', 'a');
    write('big.ts', 'a'.repeat(1000));
    await run('index', dir, '--max-file-size', '100', '--dry-run');
    expect(out).toContain('Indexed 1 file\n');
  });

  it('reports a missing path', async () => {
    await run('index', path.join(dir, 'missing'), '--dry-run');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
    expect(out).toBe('');
  });

  it.each(['0', '-5', 'abc', '1.5'])('rejects --max-file-size %s', async (value) => {
    await run('index', dir, '--max-file-size', value);
    expect(err).toMatch(/^error: .*--max-file-size/);
    expect(err).toContain('positive integer');
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing path argument', async () => {
    await run('index');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
  });
});

describe('repolens program', () => {
  it('shows help without failing', async () => {
    await run('--help');
    expect(out).toContain('Usage: repolens');
    expect(out).toContain('index');
    expect(process.exitCode).toBeUndefined();
  });

  it('shows index help with the option', async () => {
    await run('index', '--help');
    expect(out).toContain('--max-file-size <bytes>');
  });

  it('prints the package version', async () => {
    await run('--version');
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands', async () => {
    await run('nope');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
  });

  it('works through buildProgram().parseAsync', async () => {
    write('a.rs');
    await buildProgram(io).parseAsync(['node', 'repolens', 'index', dir, '--dry-run']);
    expect(out).toMatch(/rust\s+1/);
  });
});

describe('repolens index, search and doctor with a store', () => {
  const served: string[] = [];
  const serve = async (_runtime: Runtime, version: string) => void served.push(version);
  const watchCalls: WatchOptions[] = [];
  const watcherClosed = { count: 0 };
  const exitCodes: number[] = [];
  const exit = (code: number) => void exitCodes.push(code);
  const watch = (options: WatchOptions): Watcher => {
    watchCalls.push(options);
    return {
      idle: async () => {},
      close: async () => void watcherClosed.count++,
    };
  };
  const sigintListeners = process.listeners('SIGINT');
  afterEach(() => {
    watchCalls.length = 0;
    requestedIndexes.length = 0;
    changedCalls.length = 0;
    changedResult = [];
    changedError = undefined;
    dropCalls.length = 0;
    indexInfos = [];
    dropResult = { chunks: true, graph: true };
    watcherClosed.count = 0;
    exitCodes.length = 0;
    for (const l of process.listeners('SIGINT')) {
      if (!sigintListeners.includes(l)) process.removeListener('SIGINT', l);
    }
    vi.restoreAllMocks();
  });
  const requestedIndexes: (string | undefined)[] = [];
  const dropCalls: string[] = [];
  const changedCalls: { root: string; ref: string | undefined }[] = [];
  let changedResult: string[] = [];
  let changedError: Error | undefined;
  const changedFiles = async (root: string, ref?: string) => {
    changedCalls.push({ root, ref });
    if (changedError) throw changedError;
    return changedResult;
  };
  let indexInfos: IndexInfo[] = [];
  let dropResult = { chunks: true, graph: true };
  const dropIndex = async (name: string) => {
    dropCalls.push(name);
    return dropResult;
  };
  const memory = () => {
    const store = new InMemoryVectorStore();
    const embeddings = new FakeEmbeddingProvider();
    const graph = new InMemoryGraphStore();
    const createRuntime = (index?: string) => {
      requestedIndexes.push(index);
      return { index: resolveIndexName(index), store, graph, embeddings };
    };
    return {
      store,
      graph,
      deps: {
        createRuntime,
        createEmbeddings: () => embeddings,
        listIndexes: async () => indexInfos,
        changedFiles,
        dropIndex,
        serve,
        watch,
        exit,
      },
    };
  };
  const runWith = async (deps: Deps, ...args: string[]) => {
    await buildProgram(io, deps).parseAsync(['node', 'repolens', ...args]);
  };

  it('indexes a directory and reports changed, unchanged and removed files', async () => {
    const { deps, store, graph } = memory();
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'index', dir);
    expect(out).toContain('Scanned 1 file');
    expect(out).toContain('Changed: 1 (1 chunks embedded)');
    expect(out).toContain('Graph files updated: 1');
    expect(await store.count()).toBe(1);
    expect(await graph.listHashes()).toHaveProperty('size', 1);
    out = '';
    await runWith(deps, 'index', dir);
    expect(out).toContain('Changed: 0 (0 chunks embedded)');
    expect(out).toContain('Unchanged: 1');
    expect(out).toContain('Graph files updated: 0');
  });

  it('searches the index with filters and a limit', async () => {
    const { deps } = memory();
    write('src/db.ts', 'export function openDatabase() { return connect(); }\n');
    write('lib/util.py', 'def open_database():\n    return connect()\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'search', 'open database', '--language', 'python', '-n', '3');
    expect(out).toContain('lib/util.py');
    expect(out).not.toContain('src/db.ts');
    out = '';
    await runWith(deps, 'search', 'open database', '--path', 'src/');
    expect(out).toContain('src/db.ts');
    expect(out).not.toContain('lib/util.py');
  });

  it('search boosts exact names unless --semantic is given', async () => {
    const { deps } = memory();
    write('src/noisy.ts', "export function noisy() { return 'run run run run'; }\n");
    write('src/target.ts', 'export function run() { return compute(one, two, three); }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'search', 'run', '-n', '1');
    expect(out).toContain('src/target.ts');
    expect(out).toContain('name match');
    out = '';
    await runWith(deps, 'search', 'run', '-n', '1', '--semantic');
    expect(out).toContain('src/noisy.ts');
    expect(out).not.toContain('name match');
  });

  it('prints a clear error when no store is configured', async () => {
    const saved = process.env.QDRANT_URL;
    delete process.env.QDRANT_URL;
    try {
      await run('search', 'anything');
    } finally {
      if (saved !== undefined) process.env.QDRANT_URL = saved;
    }
    expect(err).toContain('QDRANT_URL is not set');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an empty query and a bad limit', async () => {
    const { deps } = memory();
    await runWith(deps, 'search', ' ');
    expect(err).toContain('must not be empty');
    expect(process.exitCode).toBe(1);
    err = '';
    await run('search', 'x', '-n', '0');
    expect(err).toContain('must be a positive integer');
  });

  it('map writes a self-contained HTML file linking files by their imports', async () => {
    const { deps } = memory();
    write('src/a.ts', "import { b } from './b.js';\nexport function a() { return b(); }\n");
    write('src/b.ts', 'export function b() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    const target = path.join(dir, 'out', 'map.html');
    await runWith(deps, 'map', '-o', target);
    expect(err).toBe('');
    expect(out).toContain('2 files, 1 links');
    const html = readFileSync(target, 'utf8');
    expect(html).toContain('src/a.ts');
    expect(html).toContain('src/b.ts');
  });

  it('map --path limits the map to a directory', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    write('lib/b.ts', 'export function b() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    const target = path.join(dir, 'map.html');
    await runWith(deps, 'map', '-o', target, '--path', 'lib/');
    expect(out).toContain('1 files, 0 links');
    const html = readFileSync(target, 'utf8');
    expect(html).toContain('lib/b.ts');
    expect(html).not.toContain('src/a.ts');
  });

  it('map explains an empty index and writes nothing', async () => {
    const { deps } = memory();
    const target = path.join(dir, 'map.html');
    await runWith(deps, 'map', '-o', target);
    expect(err).toContain('The index has no files to map');
    expect(process.exitCode).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  it('map reports a missing Qdrant configuration', async () => {
    const failing = {
      createRuntime: () => {
        throw new Error('QDRANT_URL is not set.');
      },
      createEmbeddings: () => new FakeEmbeddingProvider(),
      listIndexes: async () => indexInfos,
      changedFiles,
      dropIndex,
      serve,
      watch,
      exit,
    };
    await runWith(failing, 'map');
    expect(err).toContain('QDRANT_URL is not set.');
    expect(process.exitCode).toBe(1);
  });

  it('serve starts the MCP server with the runtime and package version', async () => {
    const { deps } = memory();
    await runWith(deps, 'serve');
    expect(served).toEqual([expect.stringMatching(/^\d+\.\d+\.\d+/)]);
  });

  it('serve reports a missing Qdrant configuration', async () => {
    const failing = {
      createRuntime: () => {
        throw new Error('QDRANT_URL is not set.');
      },
      createEmbeddings: () => new FakeEmbeddingProvider(),
      listIndexes: async () => indexInfos,
      changedFiles,
      dropIndex,
      serve,
      watch,
      exit,
    };
    await runWith(failing, 'serve');
    expect(err).toContain('QDRANT_URL is not set.');
    expect(process.exitCode).toBe(1);
  });

  it('watch indexes once, announces watching and starts the watcher', async () => {
    const { deps, store } = memory();
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'watch', dir);
    expect(out).toContain('Changed: 1 (1 chunks embedded)');
    expect(out).toContain(`Watching ${dir} for changes (Ctrl+C to stop)\n`);
    expect(await store.count()).toBe(1);
    expect(watchCalls).toHaveLength(1);
    expect(watchCalls[0]!.root).toBe(dir);
    expect(watchCalls[0]!.debounceMs).toBe(300);
    expect(process.exitCode).toBeUndefined();
  });

  it('watch passes --debounce and --max-file-size through', async () => {
    const { deps, store } = memory();
    write('big.ts', `export function big() { return '${'x'.repeat(200)}'; }\n`);
    await runWith(deps, 'watch', dir, '--debounce', '50', '--max-file-size', '100');
    expect(watchCalls[0]!.debounceMs).toBe(50);
    expect(await store.count()).toBe(0);
    await watchCalls[0]!.reindex();
    expect(await store.count()).toBe(0);
  });

  it('watch rejects an invalid --debounce', async () => {
    const { deps } = memory();
    await runWith(deps, 'watch', dir, '--debounce', '0').catch(() => undefined);
    expect(err).toContain('must be a positive integer');
    expect(watchCalls).toHaveLength(0);
  });

  it('watch prints a line for passes that changed something', async () => {
    const { deps } = memory();
    await runWith(deps, 'watch', dir);
    out = '';
    const { onIndexed, reindex } = watchCalls[0]!;
    const stats = await reindex();
    onIndexed?.(stats, ['a.ts']);
    expect(out).toBe('');
    onIndexed?.({ ...stats, filesChanged: 2, filesRemoved: 1, chunksEmbedded: 5 }, [
      'a.ts',
      'b.ts',
    ]);
    expect(out).toBe('Re-indexed: 2 changed, 1 removed, 5 chunks embedded (a.ts, b.ts)\n');
    out = '';
    onIndexed?.({ ...stats, filesChanged: 1, chunksEmbedded: 1 }, ['a', 'b', 'c', 'd', 'e']);
    expect(out).toBe('Re-indexed: 1 changed, 0 removed, 1 chunks embedded (a, b, c, +2 more)\n');
    out = '';
    onIndexed?.({ ...stats, graphFilesUpdated: 1 }, []);
    expect(out).toBe('Re-indexed: 0 changed, 0 removed, 0 chunks embedded\n');
  });

  it('watch reports pass errors without failing or stopping', async () => {
    const { deps } = memory();
    await runWith(deps, 'watch', dir);
    watchCalls[0]!.onError?.(new Error('embedding failed'));
    watchCalls[0]!.onError?.('plain');
    expect(err).toBe('error: embedding failed\nerror: plain\n');
    expect(process.exitCode).toBeUndefined();
  });

  it('watch fails when the initial pass fails and does not start watching', async () => {
    const { deps, store } = memory();
    vi.spyOn(store, 'ensureCollection').mockRejectedValue(new Error('qdrant down'));
    await runWith(deps, 'watch', dir);
    expect(err).toContain('error: qdrant down');
    expect(process.exitCode).toBe(1);
    expect(watchCalls).toHaveLength(0);
  });

  it('watch and serve --watch reject a path that is not a directory', async () => {
    const { deps } = memory();
    write('file.txt');
    const file = path.join(dir, 'file.txt');
    await runWith(deps, 'watch', file);
    expect(err).toBe(`error: ${file} is not a directory\n`);
    expect(process.exitCode).toBe(1);
    err = '';
    served.length = 0;
    const missing = path.join(dir, 'nope');
    await runWith(deps, 'serve', '--watch', missing);
    expect(err).toBe(`error: ${missing} is not a directory\n`);
    expect(watchCalls).toHaveLength(0);
    expect(served).toHaveLength(0);
  });

  it('Ctrl+C closes the watcher and exits', async () => {
    const { deps } = memory();
    await runWith(deps, 'watch', dir);
    process.emit('SIGINT');
    await vi.waitFor(() => expect(exitCodes).toEqual([0]));
    expect(watcherClosed.count).toBe(1);
  });

  it('watch logs a fatal watcher error and exits with 1', async () => {
    const { deps } = memory();
    await runWith(deps, 'watch', dir);
    watchCalls[0]!.onFatal?.(new Error('EMFILE'));
    expect(err).toBe('error: file watcher stopped: EMFILE\n');
    expect(exitCodes).toEqual([1]);
  });

  it('watch ignores skipped and gitignored paths but not source files', async () => {
    const { deps } = memory();
    write('.gitignore', 'generated/\n');
    write('src/a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'watch', dir);
    const { isIgnored, reindex } = watchCalls[0]!;
    expect(isIgnored?.('node_modules/x.js')).toBe(true);
    expect(isIgnored?.('generated/out.ts')).toBe(true);
    expect(isIgnored?.('src/a.ts')).toBe(false);

    write('.gitignore', 'generated/\nsrc/\n');
    expect(isIgnored?.('src/a.ts')).toBe(false);
    await reindex();
    expect(isIgnored?.('src/a.ts')).toBe(true);
  });

  it('serve --watch indexes first, logs to stderr only, then serves', async () => {
    const { deps, store } = memory();
    served.length = 0;
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'serve', '--watch', dir);
    expect(out).toBe('');
    expect(err).toContain('Changed: 1 (1 chunks embedded)');
    expect(err).toContain(`Watching ${dir} for changes`);
    expect(await store.count()).toBe(1);
    expect(watchCalls).toHaveLength(1);
    expect(served).toHaveLength(1);
    watchCalls[0]!.onIndexed?.(
      { ...(await watchCalls[0]!.reindex()), filesChanged: 1, chunksEmbedded: 1 },
      ['a.ts'],
    );
    expect(out).toBe('');
    expect(err).toContain('Re-indexed: 1 changed');
  });

  it('serve --watch records watcher progress on the runtime it serves', async () => {
    const { deps } = memory();
    let served: Runtime | undefined;
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(
      {
        ...deps,
        serve: async (runtime) => {
          served = runtime;
        },
      },
      'serve',
      '--watch',
      dir,
    );
    expect(served?.watch).toMatchObject({ root: dir, passes: 1 });
    expect(served?.watch?.lastPassAt).toBeInstanceOf(Date);
    watchCalls[0]!.onError?.(new Error('embedding failed'));
    expect(served?.watch?.lastError).toBe('embedding failed');
    expect(served?.watch?.lastErrorAt).toBeInstanceOf(Date);
    watchCalls[0]!.onIndexed?.(await watchCalls[0]!.reindex(), []);
    expect(served?.watch?.passes).toBe(2);
    expect(served?.watch?.lastError).toBeUndefined();
    expect(served?.watch?.lastErrorAt).toBeUndefined();
  });

  it('status prints the size and health of an index', async () => {
    const { deps } = memory();
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'index', dir, '--index', 's');
    out = '';
    await runWith(deps, 'status', '--index', 's');
    expect(out).toContain('Index: s');
    expect(out).toContain('Files: 1 (1 chunk)');
    expect(out).toContain('Watching: no');
    expect(out.endsWith('\n')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('status warns about an empty index and still exits 0', async () => {
    const { deps } = memory();
    await runWith(deps, 'status');
    expect(out).toContain('Warnings:');
    expect(process.exitCode).toBeUndefined();
  });

  it('status --json prints parseable JSON', async () => {
    const { deps } = memory();
    write('a.ts', 'export function alpha() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'status', '--json');
    const status = JSON.parse(out) as { index: string; files: number; warnings: string[] };
    expect(status).toMatchObject({ index: 'repolens', files: 1, warnings: [] });
  });

  it('status rejects an invalid --index and reports runtime errors', async () => {
    const { deps } = memory();
    await runWith(deps, 'status', '--index', 'bad!name');
    expect(err).toMatch(/^error: /);
    expect(process.exitCode).toBe(1);
    expect(out).toBe('');
    err = '';
    await runWith(
      {
        ...deps,
        createRuntime: () => {
          throw new Error('QDRANT_URL is not set.');
        },
      },
      'status',
    );
    expect(err).toContain('QDRANT_URL is not set.');
  });

  it('deps prints what a file imports and who imports it', async () => {
    const { deps } = memory();
    write('src/a.ts', "import { b } from './b.js';\nexport function a() { return b(); }\n");
    write('src/b.ts', 'export function b() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'deps', 'src/a.ts');
    expect(out).toContain("Imports (1):\n  src/b.ts  line 1  './b.js'");
    expect(out).toContain('Imported by (0):');
    expect(out.endsWith('\n')).toBe(true);
    out = '';
    await runWith(deps, 'deps', 'src/b.ts', '--direction', 'importers');
    expect(out).toContain("Imported by (1):\n  src/a.ts  line 1  './b.js'");
    expect(out).toContain('Imports (0):');
    expect(process.exitCode).toBeUndefined();
  });

  it('deps --json prints the dependencies as JSON', async () => {
    const { deps } = memory();
    write('src/a.ts', "import { b } from './b.js';\nexport function a() { return b(); }\n");
    write('src/b.ts', 'export function b() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'deps', 'src/a.ts', '--json', '--depth', '2');
    const result = JSON.parse(out) as { path: string; imports: { path: string }[] };
    expect(result.path).toBe('src/a.ts');
    expect(result.imports.map((e) => e.path)).toEqual(['src/b.ts']);
  });

  it('deps reports an unknown file with exit code 1', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'deps', 'a.ts');
    expect(err).toBe('error: a.ts is not indexed. Did you mean src/a.ts?\n');
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });

  it('deps rejects a bad --direction and a bad --depth', async () => {
    await run('deps', 'a.ts', '--direction', 'sideways');
    expect(err).toContain('must be "imports", "importers" or "both"');
    expect(process.exitCode).toBe(1);
    err = '';
    await run('deps', 'a.ts', '--depth', '0');
    expect(err).toContain('must be a positive integer');
    err = '';
    await run('deps', 'a.ts', '--depth', '6');
    expect(err).toContain('must be at most 5');
  });

  it('impact prints importers and call sites', async () => {
    const { deps } = memory();
    write('src/a.ts', "import { b } from './b.js';\nexport function a() { return b(); }\n");
    write('src/b.ts', 'export function b() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'impact', 'src/b.ts');
    expect(out).toContain(
      'Affected files (1): 1 direct importer, 0 transitive, 0 name-only callers',
    );
    expect(out).toContain('src/a.ts  direct import\n    line 2  b  in a');
    expect(out.endsWith('\n')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('impact --json and --symbol print the result as JSON', async () => {
    const { deps } = memory();
    write('src/a.ts', "import { b } from './b.js';\nexport function a() { return b(); }\n");
    write('src/b.ts', 'export function b() { return 1; }\nexport function c() { return 2; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'impact', 'src/b.ts', '--json', '--symbol', 'b', '--depth', '2');
    const result = JSON.parse(out) as {
      path: string;
      symbol: string;
      symbols: { name: string }[];
      files: { path: string; link: string }[];
    };
    expect(result.path).toBe('src/b.ts');
    expect(result.symbol).toBe('b');
    expect(result.symbols.map((s) => s.name)).toEqual(['b']);
    expect(result.files).toMatchObject([{ path: 'src/a.ts', link: 'direct' }]);
  });

  it('impact reports an unknown file and an unknown symbol with exit code 1', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'impact', 'a.ts');
    expect(err).toBe('error: a.ts is not indexed. Did you mean src/a.ts?\n');
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
    err = '';
    await runWith(deps, 'impact', 'src/a.ts', '--symbol', 'nothing');
    expect(err).toContain('Symbol "nothing" is not defined in src/a.ts');
    expect(out).toBe('');
  });

  it('impact rejects a bad --depth', async () => {
    await run('impact', 'a.ts', '--depth', '0');
    expect(err).toContain('must be a positive integer');
    expect(process.exitCode).toBe(1);
    err = '';
    await run('impact', 'a.ts', '--depth', '6');
    expect(err).toContain('must be at most 5');
  });

  it('tests prints the tests to run with their reasons', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    write('src/a.test.ts', "import { a } from './a.js';\nexport const t = a();\n");
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'tests', 'src/a.ts');
    expect(out).toContain('Changed (1): src/a.ts');
    expect(out).toContain('Tests to run (1):');
    expect(out).toContain('src/a.test.ts\n    imports src/a.ts directly');
    expect(out.endsWith('\n')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('tests --json prints the result as JSON for several files', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    write('src/b.ts', 'export function b() { return 1; }\n');
    write('src/a.test.ts', "import { a } from './a.js';\nexport const t = a();\n");
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'tests', 'src/a.ts', 'src/b.ts', '--json', '--depth', '2');
    const result = JSON.parse(out) as {
      changed: string[];
      tests: { path: string; reasons: { kind: string }[] }[];
      total: number;
    };
    expect(result.changed).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.total).toBe(1);
    expect(result.tests[0]?.path).toBe('src/a.test.ts');
  });

  it('tests reports an unknown file with exit code 1', async () => {
    const { deps } = memory();
    write('src/a.ts', 'export function a() { return 1; }\n');
    await runWith(deps, 'index', dir);
    out = '';
    await runWith(deps, 'tests', 'a.ts');
    expect(err).toBe('error: a.ts is not indexed. Did you mean src/a.ts?\n');
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });

  describe('tests --changed', () => {
    const indexProject = async () => {
      const { deps } = memory();
      write('src/a.ts', 'export function a() { return 1; }\n');
      write('src/a.test.ts', "import { a } from './a.js';\nexport const t = a();\n");
      await runWith(deps, 'index', dir);
      out = '';
      requestedIndexes.length = 0;
      return deps;
    };

    it('takes the files from git, skips unindexed ones and prints them', async () => {
      const deps = await indexProject();
      changedResult = ['src/a.ts', 'notes.md'];
      await runWith(deps, 'tests', '--changed');
      expect(changedCalls).toEqual([{ root: '.', ref: undefined }]);
      expect(out).toContain('Changed (1): src/a.ts');
      expect(out).toContain('src/a.test.ts');
      expect(out).toContain('notes.md');
      expect(err).toBe('');
      expect(process.exitCode).toBeUndefined();
    });

    it('passes the ref and root to changedFiles', async () => {
      const deps = await indexProject();
      changedResult = ['src/a.ts'];
      await runWith(deps, 'tests', '--changed', 'main', '--root', 'x', '--json');
      expect(changedCalls).toEqual([{ root: 'x', ref: 'main' }]);
      const result = JSON.parse(out) as { changed: string[]; skipped: string[] };
      expect(result.changed).toEqual(['src/a.ts']);
      expect(result.skipped).toEqual([]);
    });

    it('says so and skips the runtime when nothing changed', async () => {
      const deps = await indexProject();
      await runWith(deps, 'tests', '--changed');
      expect(out).toBe('No changed files compared to HEAD.\n');
      await runWith(deps, 'tests', '--changed', 'main');
      expect(out).toContain('No changed files compared to main.\n');
      expect(requestedIndexes).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it('prints an empty JSON object with --json when nothing changed', async () => {
      const deps = await indexProject();
      await runWith(deps, 'tests', '--changed', '--json');
      expect(JSON.parse(out)).toEqual({
        changed: [],
        tests: [],
        total: 0,
        truncated: false,
        skipped: [],
      });
      expect(requestedIndexes).toEqual([]);
    });

    it('refuses more than 50 changed files', async () => {
      const deps = await indexProject();
      changedResult = Array.from({ length: 73 }, (_, i) => `src/f${i}.ts`);
      await runWith(deps, 'tests', '--changed');
      expect(err).toBe(
        'error: git reports 73 changed files; at most 50 are allowed. Pass a closer ref or list the files.\n',
      );
      expect(out).toBe('');
      expect(process.exitCode).toBe(1);
    });

    it('refuses files together with --changed', async () => {
      const { deps } = memory();
      await runWith(deps, 'tests', 'src/a.ts', '--changed');
      expect(err).toBe('error: pass files or --changed, not both.\n');
      expect(changedCalls).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('asks for files or --changed when given neither', async () => {
      const { deps } = memory();
      await runWith(deps, 'tests');
      expect(err).toContain('pass the changed files or use --changed');
      expect(process.exitCode).toBe(1);
    });

    it('reports a git error with exit code 1', async () => {
      const { deps } = memory();
      changedError = new GitError('/x is not inside a git repository');
      await runWith(deps, 'tests', '--changed', '--root', '/x');
      expect(err).toBe('error: /x is not inside a git repository\n');
      expect(out).toBe('');
      expect(process.exitCode).toBe(1);
    });
  });

  it('tests rejects a bad --depth', async () => {
    await run('tests', 'a.ts', '--depth', '0');
    expect(err).toContain('must be a positive integer');
    expect(process.exitCode).toBe(1);
    err = '';
    await run('tests', 'a.ts', '--depth', '6');
    expect(err).toContain('must be at most 5');
  });

  it('serve without --watch does not start a watcher', async () => {
    const { deps } = memory();
    await runWith(deps, 'serve');
    expect(watchCalls).toHaveLength(0);
  });

  it('bench indexes into memory and prints a markdown result', async () => {
    const { deps, store } = memory();
    write('src/auth.ts', 'export function loginUser(password: string) { return password; }\n');
    write('queries.json', '[{"query":"loginUser password","expect":["src/auth.ts"]}]');
    await runWith(
      deps,
      'bench',
      dir,
      '--queries',
      path.join(dir, 'queries.json'),
      '--label',
      'demo',
    );
    expect(out).toContain('### demo');
    expect(out).toContain('| Recall@5 (1 queries) | 100% |');
    expect(out).toContain('| Search mode | hybrid |');
    expect(await store.count()).toBe(0);
  });

  it('bench --qdrant uses the runtime store', async () => {
    const { deps, store } = memory();
    write('src/auth.ts', 'export function loginUser(password: string) { return password; }\n');
    write('queries.json', '[{"query":"loginUser","expect":["src/auth.ts"]}]');
    await runWith(deps, 'bench', dir, '--queries', path.join(dir, 'queries.json'), '--qdrant');
    expect(await store.count()).toBeGreaterThan(0);
  });

  it('bench --mode semantic is shown in the output and other modes are rejected', async () => {
    const { deps } = memory();
    write('src/auth.ts', 'export function loginUser(password: string) { return password; }\n');
    write('queries.json', '[{"query":"loginUser","expect":["src/auth.ts"]}]');
    const queries = path.join(dir, 'queries.json');
    await runWith(deps, 'bench', dir, '--queries', queries, '--mode', 'semantic');
    expect(out).toContain('| Search mode | semantic |');
    out = '';
    await run('bench', dir, '--queries', queries, '--mode', 'bogus');
    expect(err).toContain('must be "hybrid" or "semantic"');
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });

  it('bench reports an invalid queries file', async () => {
    const { deps } = memory();
    write('queries.json', '[]');
    await runWith(deps, 'bench', dir, '--queries', path.join(dir, 'queries.json'));
    expect(err).toContain('non-empty JSON array');
    expect(process.exitCode).toBe(1);
  });

  describe('named indexes', () => {
    it.each([
      ['index', (d: string) => ['index', d]],
      ['search', () => ['search', 'x']],
      ['watch', (d: string) => ['watch', d]],
      ['serve', () => ['serve']],
      ['status', () => ['status']],
      ['deps', () => ['deps', 'a.ts']],
      ['impact', () => ['impact', 'a.ts']],
      ['tests', () => ['tests', 'a.ts']],
      ['map', (d: string) => ['map', '-o', path.join(d, 'm.html')]],
      ['bench', (d: string) => ['bench', d, '--queries', path.join(d, 'q.json'), '--qdrant']],
    ])('%s passes --index to createRuntime, and undefined without it', async (_name, args) => {
      const { deps } = memory();
      write('q.json', '[{"query":"x","expect":["a.ts"]}]');
      await runWith(deps, ...args(dir), '--index', 'team-a');
      expect(requestedIndexes).toEqual(['team-a']);
      requestedIndexes.length = 0;
      await runWith(deps, ...args(dir));
      expect(requestedIndexes).toEqual([undefined]);
    });

    it('bench without --qdrant ignores --index', async () => {
      const { deps } = memory();
      write('q.json', '[{"query":"x","expect":["a.ts"]}]');
      await runWith(deps, 'bench', dir, '--queries', path.join(dir, 'q.json'), '--index', 'x');
      expect(requestedIndexes).toEqual([]);
    });

    it('rejects an invalid --index through the real runtime', async () => {
      await run('search', 'x', '--index', 'a b');
      expect(err).toMatch(/^error: .*a b/);
      expect(process.exitCode).toBe(1);
      expect(out).toBe('');
    });

    it('rejects an invalid --index on index before touching the store', async () => {
      const { deps } = memory();
      await runWith(deps, 'index', dir, '--index', 'a b');
      expect(err).toMatch(/^error: /);
      expect(process.exitCode).toBe(1);
      expect(requestedIndexes).toEqual([]);
    });

    it('index prints the index name first', async () => {
      const { deps } = memory();
      await runWith(deps, 'index', dir, '--index', 'team-a');
      expect(out.split('\n')[0]).toBe('Index: team-a');
    });

    it('index falls back to REPOLENS_INDEX, then to the default name', async () => {
      const { deps } = memory();
      const saved = process.env.REPOLENS_INDEX;
      try {
        process.env.REPOLENS_INDEX = 'from-env';
        await runWith(deps, 'index', dir);
        expect(out.split('\n')[0]).toBe('Index: from-env');
        out = '';
        delete process.env.REPOLENS_INDEX;
        await runWith(deps, 'index', dir);
        expect(out.split('\n')[0]).toBe('Index: repolens');
      } finally {
        if (saved === undefined) delete process.env.REPOLENS_INDEX;
        else process.env.REPOLENS_INDEX = saved;
      }
    });

    it('watch and serve --watch print the index name', async () => {
      const { deps } = memory();
      await runWith(deps, 'watch', dir, '--index', 'w');
      expect(out).toContain('Index: w\n');
      served.length = 0;
      err = '';
      await runWith(deps, 'serve', '--watch', dir, '--index', 's');
      expect(err).toContain('Index: s\n');
    });

    it('indexes prints an aligned table', async () => {
      const { deps } = memory();
      indexInfos = [
        { name: 'alpha', chunks: 1200, graphFiles: 80, dimensions: 384 },
        { name: 'repolens', chunks: 5, graphFiles: 2, dimensions: 1536 },
      ];
      await runWith(deps, 'indexes');
      expect(out).toBe(
        [
          'name      chunks  files  dims',
          'alpha       1200     80   384',
          'repolens       5      2  1536',
          '',
        ].join('\n'),
      );
    });

    it('indexes explains when there are none', async () => {
      const { deps } = memory();
      await runWith(deps, 'indexes');
      expect(out).toBe('No indexes yet. Run `repolens index <path>` to create one.\n');
      expect(process.exitCode).toBeUndefined();
    });

    it('indexes reports errors', async () => {
      const { deps } = memory();
      await runWith(
        { ...deps, listIndexes: () => Promise.reject(new Error('qdrant down')) },
        'indexes',
      );
      expect(err).toBe('error: qdrant down\n');
      expect(process.exitCode).toBe(1);
    });

    it('drop without --yes asks for confirmation and deletes nothing', async () => {
      const { deps } = memory();
      await runWith(deps, 'drop', 'old');
      expect(err).toBe(
        'This deletes index "old" and its graph. Run again with --yes to confirm.\n',
      );
      expect(process.exitCode).toBe(1);
      expect(dropCalls).toEqual([]);
    });

    it('drop --yes deletes an existing index', async () => {
      const { deps } = memory();
      await runWith(deps, 'drop', 'old', '--yes');
      expect(dropCalls).toEqual(['old']);
      expect(out).toBe('Dropped index "old".\n');
      expect(process.exitCode).toBeUndefined();
    });

    it('drop --yes reports a missing index', async () => {
      const { deps } = memory();
      dropResult = { chunks: false, graph: false };
      await runWith(deps, 'drop', 'ghost', '--yes');
      expect(err).toBe('No index named "ghost".\n');
      expect(out).toBe('');
      expect(process.exitCode).toBe(1);
    });

    it('drop validates the name before anything else', async () => {
      const { deps } = memory();
      await runWith(deps, 'drop', 'a b', '--yes');
      expect(err).toMatch(/^error: /);
      expect(process.exitCode).toBe(1);
      expect(dropCalls).toEqual([]);
    });

    it('drop reports errors from Qdrant', async () => {
      const { deps } = memory();
      await runWith(
        { ...deps, dropIndex: () => Promise.reject(new Error('boom')) },
        'drop',
        'x',
        '--yes',
      );
      expect(err).toBe('error: boom\n');
      expect(process.exitCode).toBe(1);
    });
  });

  it('doctor exits 1 and prints the failing check', async () => {
    const saved = process.env.QDRANT_URL;
    delete process.env.QDRANT_URL;
    try {
      await run('doctor');
    } finally {
      if (saved !== undefined) process.env.QDRANT_URL = saved;
    }
    expect(out).toContain('FAIL  Qdrant');
    expect(process.exitCode).toBe(1);
  });
});
