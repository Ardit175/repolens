import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from './graph/store.js';
import { indexRepository, type IndexStats } from './indexer.js';
import { InMemoryVectorStore } from './store/index.js';
import { FakeEmbeddingProvider } from './testing.js';
import { MAX_WATCH_RESTARTS, watchRepository, type WatchListener, type Watcher } from './watch.js';

const EMPTY_STATS: IndexStats = {
  filesScanned: 0,
  filesChanged: 0,
  filesUnchanged: 0,
  filesRemoved: 0,
  chunksEmbedded: 0,
  filesSkipped: 0,
  graphFilesUpdated: 0,
};

interface Deferred {
  promise: Promise<IndexStats>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<IndexStats>((r) => {
    resolve = () => r(EMPTY_STATS);
  });
  return { promise, resolve };
}

interface SetupOptions {
  isIgnored?: (relativePath: string) => boolean;
  watchThrows?: () => boolean;
}

function setup(reindex: () => Promise<IndexStats>, extra: SetupOptions = {}) {
  let emit: WatchListener = () => {};
  const fsState = { started: 0, closed: 0 };
  const errorHandlers: Array<(error: unknown) => void> = [];
  const indexed: string[][] = [];
  const errors: unknown[] = [];
  const fatals: unknown[] = [];
  const watcher = watchRepository({
    root: '/repo',
    reindex,
    debounceMs: 20,
    onIndexed: (_stats, paths) => void indexed.push(paths),
    onError: (error) => void errors.push(error),
    onFatal: (error) => void fatals.push(error),
    ...(extra.isIgnored ? { isIgnored: extra.isIgnored } : {}),
    watch: (_root, listener, onError) => {
      if (fsState.started > 0 && extra.watchThrows?.()) throw new Error('restart failed');
      fsState.started++;
      emit = listener;
      errorHandlers.push(onError);
      return { close: () => void fsState.closed++ };
    },
  });
  return {
    watcher,
    emit: (p: string | null) => emit(p),
    failWatcher: (error: unknown, which = errorHandlers.length - 1) => errorHandlers[which]!(error),
    fsState,
    indexed,
    errors,
    fatals,
  };
}

const open: Watcher[] = [];
function track(watcher: Watcher): Watcher {
  open.push(watcher);
  return watcher;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((w) => w.close()));
});

describe('watchRepository', () => {
  it('coalesces a burst into one pass with sorted, deduped paths', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS));
    track(t.watcher);
    t.emit('b.ts');
    t.emit('a.ts');
    t.emit('b.ts');
    t.emit('sub\\c.ts');
    await t.watcher.idle();
    expect(passes).toBe(1);
    expect(t.indexed).toEqual([['a.ts', 'b.ts', 'sub/c.ts']]);
  });

  it('ignores anything inside .git', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS));
    track(t.watcher);
    t.emit('.git/index');
    t.emit('sub/.git/HEAD');
    t.emit('.git\\objects\\ab');
    await t.watcher.idle();
    expect(passes).toBe(0);
    t.emit('.github/ci.yml');
    await t.watcher.idle();
    expect(passes).toBe(1);
  });

  it('drops events for ignored paths and reports only the rest from a mixed burst', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS), {
      isIgnored: (p) => p.startsWith('dist/') || p.endsWith('.log'),
    });
    track(t.watcher);
    t.emit('dist/out.js');
    t.emit('debug.log');
    await t.watcher.idle();
    expect(passes).toBe(0);
    t.emit('dist/out.js');
    t.emit('src/b.ts');
    t.emit('a.log');
    t.emit('src/a.ts');
    await t.watcher.idle();
    expect(passes).toBe(1);
    expect(t.indexed).toEqual([['src/a.ts', 'src/b.ts']]);
  });

  it('still triggers a pass for a null filename when a predicate is set', async () => {
    const t = setup(async () => EMPTY_STATS, { isIgnored: () => true });
    track(t.watcher);
    t.emit(null);
    await t.watcher.idle();
    expect(t.indexed).toEqual([[]]);
  });

  it('reports a watcher error, restarts the fs watcher and runs a catch-up pass', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS));
    track(t.watcher);
    const failure = new Error('EMFILE');
    t.failWatcher(failure);
    expect(t.errors).toEqual([failure]);
    expect(t.fsState).toEqual({ started: 2, closed: 1 });
    await t.watcher.idle();
    expect(passes).toBe(1);
    t.emit('a.ts');
    await t.watcher.idle();
    expect(t.indexed).toEqual([[], ['a.ts']]);
    expect(t.fatals).toEqual([]);
  });

  it('ignores errors from a watcher that was already replaced', async () => {
    const t = setup(async () => EMPTY_STATS);
    track(t.watcher);
    t.failWatcher(new Error('first'));
    t.failWatcher(new Error('late'), 0);
    expect(t.fsState.started).toBe(2);
    expect(t.errors).toHaveLength(1);
  });

  it('stops with onFatal once after more than MAX_WATCH_RESTARTS errors', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS));
    for (let i = 0; i < MAX_WATCH_RESTARTS; i++) t.failWatcher(new Error(`e${i}`));
    expect(t.fatals).toEqual([]);
    const last = new Error('last');
    t.failWatcher(last);
    expect(t.fatals).toEqual([last]);
    expect(t.fsState.started).toBe(MAX_WATCH_RESTARTS + 1);
    expect(t.fsState.closed).toBe(MAX_WATCH_RESTARTS + 1);
    await t.watcher.idle();
    const before = passes;
    t.emit('a.ts');
    t.failWatcher(new Error('after'));
    await sleep(60);
    expect(passes).toBe(before);
    expect(t.fatals).toHaveLength(1);
    await t.watcher.close();
    expect(t.fsState.closed).toBe(MAX_WATCH_RESTARTS + 1);
  });

  it('treats a throwing restart as an error and goes fatal once restarts run out', async () => {
    const t = setup(async () => EMPTY_STATS, { watchThrows: () => true });
    t.failWatcher(new Error('original'));
    expect(t.fatals).toEqual([new Error('restart failed')]);
    expect(t.errors).toHaveLength(1 + MAX_WATCH_RESTARTS);
    expect(t.fsState.closed).toBe(1);
  });

  it('lets a failure of the very first start throw', () => {
    expect(() =>
      watchRepository({
        root: '/repo',
        reindex: async () => EMPTY_STATS,
        watch: () => {
          throw new Error('cannot watch');
        },
      }),
    ).toThrow('cannot watch');
  });

  it('does not restart after close', async () => {
    const t = setup(async () => EMPTY_STATS);
    await t.watcher.close();
    t.failWatcher(new Error('late'));
    expect(t.fsState).toEqual({ started: 1, closed: 1 });
    expect(t.errors).toEqual([]);
  });

  it('runs exactly one follow-up pass for events during a pass, without overlap', async () => {
    const gates: Deferred[] = [];
    let running = 0;
    let maxRunning = 0;
    const t = setup(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      const gate = deferred();
      gates.push(gate);
      try {
        return await gate.promise;
      } finally {
        running--;
      }
    });
    track(t.watcher);
    t.emit('a.ts');
    await waitFor(() => gates.length === 1);
    t.emit('b.ts');
    await sleep(60);
    t.emit('c.ts');
    await sleep(60);
    expect(gates).toHaveLength(1);
    gates[0]!.resolve();
    await waitFor(() => gates.length === 2);
    gates[1]!.resolve();
    await t.watcher.idle();
    expect(gates).toHaveLength(2);
    expect(maxRunning).toBe(1);
    expect(t.indexed).toEqual([['a.ts'], ['b.ts', 'c.ts']]);
  });

  it('reports a failing pass and keeps watching', async () => {
    let calls = 0;
    const t = setup(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return EMPTY_STATS;
    });
    track(t.watcher);
    t.emit('a.ts');
    await t.watcher.idle();
    expect(t.errors).toEqual([new Error('boom')]);
    t.emit('b.ts');
    await t.watcher.idle();
    expect(t.indexed).toEqual([['b.ts']]);
  });

  it('cancels a pending pass on close, closes the fs watcher and is idempotent', async () => {
    let passes = 0;
    const t = setup(async () => (passes++, EMPTY_STATS));
    t.emit('a.ts');
    await t.watcher.close();
    await t.watcher.close();
    t.emit('b.ts');
    await sleep(60);
    await t.watcher.idle();
    expect(passes).toBe(0);
    expect(t.fsState.closed).toBe(1);
  });

  it('waits for a running pass on close and starts no follow-up', async () => {
    const gate = deferred();
    let passes = 0;
    const t = setup(() => (passes++, gate.promise));
    t.emit('a.ts');
    await waitFor(() => passes === 1);
    t.emit('b.ts');
    let closed = false;
    const closing = t.watcher.close().then(() => void (closed = true));
    await sleep(40);
    expect(closed).toBe(false);
    gate.resolve();
    await closing;
    await sleep(60);
    expect(passes).toBe(1);
  });

  it('triggers a pass with no paths when the platform gives no filename', async () => {
    const t = setup(async () => EMPTY_STATS);
    track(t.watcher);
    t.emit(null);
    await t.watcher.idle();
    expect(t.indexed).toEqual([[]]);
  });

  it('idle resolves immediately when nothing is happening', async () => {
    const t = setup(async () => EMPTY_STATS);
    track(t.watcher);
    await t.watcher.idle();
  });
});

describe('watchRepository with the real file system', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('re-indexes a file written after the initial pass', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'repolens-watch-'));
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function alpha() { return 1; }\n');
    const store = new InMemoryVectorStore();
    const graph = new InMemoryGraphStore();
    const embeddings = new FakeEmbeddingProvider();
    const reindex = () => indexRepository({ root: dir, store, graph, embeddings });
    await reindex();

    let notify!: () => void;
    const indexedOnce = new Promise<void>((resolve) => (notify = resolve));
    const watcher = watchRepository({
      root: dir,
      reindex,
      debounceMs: 50,
      onIndexed: (stats) => {
        if (stats.filesChanged > 0) notify();
      },
    });
    try {
      writeFileSync(path.join(dir, 'src', 'b.ts'), 'export function betaFeature() { return 2; }\n');
      await withTimeout(indexedOnce, 5000);
      const found = await store.findChunks({ name: 'betaFeature' });
      expect(found.map((c) => c.path)).toEqual(['src/b.ts']);
    } finally {
      await watcher.close();
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await sleep(5);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}
