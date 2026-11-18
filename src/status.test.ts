import { describe, expect, it, vi } from 'vitest';
import { InMemoryGraphStore } from './graph/store.js';
import { formatIndexStatus, getIndexStatus, type IndexStatus, type WatchState } from './status.js';
import { makeChunk, stored } from './store/contract.js';
import { InMemoryVectorStore } from './store/memory.js';
import { FakeEmbeddingProvider } from './testing.js';

const embeddings = new FakeEmbeddingProvider();
const vector = (): number[] => new Array<number>(embeddings.dimensions).fill(1);

async function populatedStore(): Promise<InMemoryVectorStore> {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(embeddings.dimensions);
  await store.upsert([
    stored(makeChunk('src/a.ts', { startLine: 1, hash: 'a1' }), vector()),
    stored(makeChunk('src/a.ts', { startLine: 10, hash: 'a2' }), vector()),
    stored(makeChunk('src/b.ts', { hash: 'b1' }), vector()),
    stored(makeChunk('tool.py', { language: 'python', hash: 'p1' }), vector()),
    stored(makeChunk('Makefile', { language: 'unknown', hash: 'm1' }), vector()),
  ]);
  return store;
}

describe('getIndexStatus', () => {
  it('reports an empty index without listing a missing collection', async () => {
    const store = new InMemoryVectorStore();
    const listIds = vi.spyOn(store, 'listIdsByPath');
    const status = await getIndexStatus({
      index: 'demo',
      store,
      graph: new InMemoryGraphStore(),
      embeddings,
    });
    expect(listIds).not.toHaveBeenCalled();
    expect(status).toEqual({
      index: 'demo',
      provider: { name: 'fake', dimensions: 64 },
      storedDimensions: undefined,
      files: 0,
      chunks: 0,
      languages: [],
      graphFiles: 0,
      warnings: [
        'Index "demo" is empty. Run `repolens index <path> --index demo` (or `repolens watch`) first.',
      ],
    });
    expect('watch' in status).toBe(false);
  });

  it('warns when the collection exists but holds no chunks', async () => {
    const store = new InMemoryVectorStore();
    await store.ensureCollection(64);
    const status = await getIndexStatus({
      index: 'demo',
      store,
      graph: new InMemoryGraphStore(),
      embeddings,
    });
    expect(status.storedDimensions).toBe(64);
    expect(status.warnings).toHaveLength(1);
    expect(status.warnings[0]).toContain('is empty');
  });

  it('counts files, chunks, languages and graph files', async () => {
    const graph = new InMemoryGraphStore();
    await graph.replaceFile('src/a.ts', 'h1', []);
    await graph.replaceFile('src/b.ts', 'h2', []);
    const status = await getIndexStatus({
      index: 'demo',
      store: await populatedStore(),
      graph,
      embeddings,
    });
    expect(status.storedDimensions).toBe(64);
    expect(status.files).toBe(4);
    expect(status.chunks).toBe(5);
    expect(status.graphFiles).toBe(2);
    expect(status.languages).toEqual([
      { language: 'typescript', files: 2, chunks: 3 },
      { language: 'other', files: 1, chunks: 1 },
      { language: 'python', files: 1, chunks: 1 },
    ]);
    expect(status.warnings).toEqual([]);
  });

  it('warns about a dimension mismatch', async () => {
    const store = new InMemoryVectorStore();
    await store.ensureCollection(3);
    await store.upsert([stored(makeChunk('a.ts'), [1, 0, 0])]);
    const status = await getIndexStatus({
      index: 'demo',
      store,
      graph: new InMemoryGraphStore(),
      embeddings,
    });
    expect(status.warnings).toEqual([
      'Index "demo" was built with 3-dimension vectors but the current provider "fake" makes 64-dimension vectors, so search will fail. Re-index with the same provider, or use another --index.',
    ]);
  });

  it('includes watch state and warns about a failed pass', async () => {
    const watch: WatchState = {
      root: '.',
      passes: 2,
      lastError: 'boom',
      lastErrorAt: new Date('2026-11-18T10:00:00.000Z'),
    };
    const status = await getIndexStatus({
      index: 'demo',
      store: await populatedStore(),
      graph: new InMemoryGraphStore(),
      embeddings,
      watch,
    });
    expect(status.watch).toBe(watch);
    expect(status.warnings).toEqual(["The watcher's last pass failed: boom"]);
  });
});

describe('formatIndexStatus', () => {
  const now = new Date('2026-11-18T10:00:12.000Z');

  it('formats a full status', () => {
    const status: IndexStatus = {
      index: 'repolens',
      provider: { name: 'azure', dimensions: 1536 },
      storedDimensions: 1536,
      files: 3,
      chunks: 5,
      languages: [
        { language: 'typescript', files: 2, chunks: 4 },
        { language: 'python', files: 1, chunks: 1 },
      ],
      graphFiles: 1,
      watch: {
        root: '/path/to/repo',
        passes: 4,
        lastPassAt: new Date('2026-11-18T10:00:00.000Z'),
      },
      warnings: ['First', 'Second'],
    };
    expect(formatIndexStatus(status, now)).toBe(
      [
        'Index: repolens',
        'Embeddings: azure (1536 dimensions)',
        'Stored vectors: 1536 dimensions',
        'Files: 3 (5 chunks)',
        'Languages: typescript 2 files / 4 chunks, python 1 file / 1 chunk',
        'Symbol graph: 1 file',
        'Watching: /path/to/repo, 4 passes, last pass 12s ago (2026-11-18T10:00:00.000Z)',
        'Warnings:',
        '- First',
        '- Second',
      ].join('\n'),
    );
  });

  it('formats an empty status', () => {
    const status: IndexStatus = {
      index: 'demo',
      provider: { name: 'fake', dimensions: 64 },
      storedDimensions: undefined,
      files: 0,
      chunks: 0,
      languages: [],
      graphFiles: 0,
      warnings: [],
    };
    expect(formatIndexStatus(status)).toBe(
      [
        'Index: demo',
        'Embeddings: fake (64 dimensions)',
        'Stored vectors: none (not indexed yet)',
        'Files: 0 (0 chunks)',
        'Symbol graph: 0 files',
        'Watching: no',
      ].join('\n'),
    );
  });

  it('formats ages in seconds, minutes and hours, and a watcher that never finished a pass', () => {
    const base: IndexStatus = {
      index: 'demo',
      provider: { name: 'fake', dimensions: 64 },
      storedDimensions: 64,
      files: 1,
      chunks: 1,
      languages: [],
      graphFiles: 0,
      warnings: [],
    };
    const watching = (lastPassAt?: Date): string =>
      formatIndexStatus(
        { ...base, watch: { root: '.', passes: 1, ...(lastPassAt ? { lastPassAt } : {}) } },
        now,
      );
    expect(watching(new Date('2026-11-18T09:59:00.000Z'))).toContain('1 pass, last pass 1m ago (');
    expect(watching(new Date('2026-11-18T09:01:00.000Z'))).toContain('last pass 59m ago');
    expect(watching(new Date('2026-11-18T07:30:00.000Z'))).toContain('last pass 2h ago');
    expect(watching()).toContain('1 pass, last pass never');
  });
});
