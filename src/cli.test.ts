import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, main, type Deps } from './cli.js';
import { InMemoryGraphStore } from './graph/store.js';
import type { Runtime } from './runtime.js';
import { InMemoryVectorStore } from './store/index.js';
import { FakeEmbeddingProvider } from './testing.js';

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
  const memory = () => {
    const store = new InMemoryVectorStore();
    const embeddings = new FakeEmbeddingProvider();
    const graph = new InMemoryGraphStore();
    return {
      store,
      graph,
      deps: {
        createRuntime: () => ({ store, graph, embeddings }),
        createEmbeddings: () => embeddings,
        serve,
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
      serve,
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
      serve,
    };
    await runWith(failing, 'serve');
    expect(err).toContain('QDRANT_URL is not set.');
    expect(process.exitCode).toBe(1);
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
    expect(await store.count()).toBe(0);
  });

  it('bench --qdrant uses the runtime store', async () => {
    const { deps, store } = memory();
    write('src/auth.ts', 'export function loginUser(password: string) { return password; }\n');
    write('queries.json', '[{"query":"loginUser","expect":["src/auth.ts"]}]');
    await runWith(deps, 'bench', dir, '--queries', path.join(dir, 'queries.json'), '--qdrant');
    expect(await store.count()).toBeGreaterThan(0);
  });

  it('bench reports an invalid queries file', async () => {
    const { deps } = memory();
    write('queries.json', '[]');
    await runWith(deps, 'bench', dir, '--queries', path.join(dir, 'queries.json'));
    expect(err).toContain('non-empty JSON array');
    expect(process.exitCode).toBe(1);
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
