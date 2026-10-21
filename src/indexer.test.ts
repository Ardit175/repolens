import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from './graph/store.js';
import { indexRepository } from './indexer.js';
import { InMemoryVectorStore } from './store/index.js';
import { FakeEmbeddingProvider } from './testing.js';

let dir: string;
let store: InMemoryVectorStore;
let embeddings: FakeEmbeddingProvider;

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const index = () => indexRepository({ root: dir, store, embeddings });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'repolens-indexer-'));
  store = new InMemoryVectorStore();
  embeddings = new FakeEmbeddingProvider();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('indexRepository', () => {
  it('embeds every chunk on the first run', async () => {
    write('a.ts', 'export function one() { return 1; }\nexport function two() { return 2; }\n');
    write('b.py', 'def three():\n    return 3\n');
    const stats = await index();
    expect(stats).toMatchObject({
      filesScanned: 2,
      filesChanged: 2,
      filesUnchanged: 0,
      chunksEmbedded: 3,
    });
    expect(await store.count()).toBe(3);
  });

  it('does not embed anything when nothing changed', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    await index();
    embeddings.textsEmbedded = 0;
    const stats = await index();
    expect(stats).toMatchObject({ filesChanged: 0, filesUnchanged: 1, chunksEmbedded: 0 });
    expect(embeddings.textsEmbedded).toBe(0);
  });

  it('re-embeds only the file that changed and replaces its old chunks', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    write('b.ts', 'export function two() { return 2; }\n');
    await index();
    write('a.ts', 'export function one() { return 100; }\n');
    const stats = await index();
    expect(stats).toMatchObject({ filesChanged: 1, filesUnchanged: 1, chunksEmbedded: 1 });
    expect(await store.count()).toBe(2);
  });

  it('re-indexes a file whose chunks only moved to other lines', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    await index();
    write('a.ts', '// header\n\nexport function one() { return 1; }\n');
    const stats = await index();
    expect(stats.filesChanged).toBe(1);
    const hits = await store.search(await embedOne('one'), 5);
    expect(hits.every((h) => h.chunk.startLine >= 1)).toBe(true);
    expect(await store.count()).toBe(1);
  });

  it('removes chunks of deleted files', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    write('b.ts', 'export function two() { return 2; }\n');
    await index();
    unlinkSync(path.join(dir, 'b.ts'));
    const stats = await index();
    expect(stats.filesRemoved).toBe(1);
    expect(await store.count()).toBe(1);
  });

  it('clears the chunks of a file that became empty', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    await index();
    write('a.ts', '');
    const stats = await index();
    expect(stats.filesChanged).toBe(1);
    expect(await store.count()).toBe(0);
  });

  it('ignores binary files and reports progress for changed files', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    writeFileSync(path.join(dir, 'blob.dat'), Buffer.from([1, 2, 0, 3]));
    const seen: string[] = [];
    const stats = await indexRepository({
      root: dir,
      store,
      embeddings,
      onFile: (p) => seen.push(p),
    });
    expect(stats).toMatchObject({ filesScanned: 1, filesSkipped: 0 });
    expect(seen).toEqual(['a.ts']);
  });

  it('fails without touching the stored chunks when embedding throws', async () => {
    write('a.ts', 'export function one() { return 1; }\n');
    await index();
    write('a.ts', 'export function one() { return 5; }\n');
    embeddings.embed = async () => {
      throw new Error('rate limited');
    };
    await expect(index()).rejects.toThrow('rate limited');
    expect(await store.count()).toBe(1);
  });
});

describe('indexRepository with a graph', () => {
  let graph: InMemoryGraphStore;
  const indexWithGraph = () => indexRepository({ root: dir, store, embeddings, graph });

  beforeEach(() => {
    graph = new InMemoryGraphStore();
  });

  it('reports 0 graph files when no graph is given', async () => {
    write('a.ts', 'export function one() { return two(); }\n');
    expect((await index()).graphFilesUpdated).toBe(0);
  });

  it('builds the graph on the first run, including files without edges', async () => {
    write('a.ts', 'export function one() { return two(); }\n');
    write('b.ts', 'export const x = 1;\n');
    const stats = await indexWithGraph();
    expect(stats.graphFilesUpdated).toBe(2);
    expect([...(await graph.listHashes()).keys()].sort()).toEqual(['a.ts', 'b.ts']);
    const calls = await graph.findEdges({ kind: 'call', target: 'two' });
    expect(calls.map((e) => [e.path, e.from])).toEqual([['a.ts', 'one']]);
  });

  it('updates no graph files when nothing changed', async () => {
    write('a.ts', 'export function one() { return two(); }\n');
    await indexWithGraph();
    expect((await indexWithGraph()).graphFilesUpdated).toBe(0);
  });

  it('updates exactly the file whose call changed', async () => {
    write('a.ts', 'export function one() { return two(); }\n');
    write('b.ts', 'export function three() { return four(); }\n');
    await indexWithGraph();
    write('a.ts', 'export function one() { return five(); }\n');
    const stats = await indexWithGraph();
    expect(stats.graphFilesUpdated).toBe(1);
    expect(await graph.findEdges({ kind: 'call', target: 'two' })).toEqual([]);
    expect(await graph.findEdges({ kind: 'call', target: 'five' })).toHaveLength(1);
    expect(await graph.findEdges({ kind: 'call', target: 'four' })).toHaveLength(1);
  });

  it('removes the edges of deleted files', async () => {
    write('a.ts', 'export function one() { return two(); }\n');
    write('b.ts', 'export function three() { return four(); }\n');
    await indexWithGraph();
    unlinkSync(path.join(dir, 'b.ts'));
    await indexWithGraph();
    expect([...(await graph.listHashes()).keys()]).toEqual(['a.ts']);
    expect(await graph.findEdges({ target: 'four' })).toEqual([]);
  });

  it('records files in languages without a graph extractor as having no edges', async () => {
    write('notes.md', '# Notes\n');
    write('data.txt', 'plain text\n');
    expect((await indexWithGraph()).graphFilesUpdated).toBe(2);
    expect(await graph.findEdges({})).toEqual([]);
  });
});

async function embedOne(text: string): Promise<number[]> {
  return (await new FakeEmbeddingProvider().embed([text]))[0]!;
}
