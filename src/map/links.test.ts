import { describe, expect, it } from 'vitest';
import { InMemoryGraphStore } from '../graph/store.js';
import type { GraphEdge } from '../graph/types.js';
import { chunkId, InMemoryVectorStore } from '../store/index.js';
import { loadFileLinks } from './links.js';

async function setup(files: string[], imports: Record<string, string[]>) {
  const store = new InMemoryVectorStore();
  await store.ensureCollection(2);
  for (const path of files) {
    const chunk = {
      path,
      language: 'unknown' as const,
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
    edges.push({ path, language: 'typescript', kind: 'call', target: 'f', line: 50 });
    await graph.replaceFile(path, 'h', edges);
  }
  return { store, graph };
}

describe('loadFileLinks', () => {
  it('is empty for an empty index', async () => {
    const { store, graph } = await setup([], {});
    const links = await loadFileLinks(store, graph);
    expect(links.indexed.size).toBe(0);
    expect(links.resolved).toEqual([]);
    expect(links.unresolved).toEqual([]);
  });

  it('resolves imports to indexed files and reports the rest as unresolved', async () => {
    const { store, graph } = await setup(['src/a.ts', 'src/b.ts', 'src/c.ts'], {
      'src/a.ts': ['./b', './c.js', 'react', './self'],
      'src/b.ts': ['./a'],
      'ghost.ts': ['./a'],
    });
    const links = await loadFileLinks(store, graph);
    expect([...links.indexed].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(links.idsByPath.get('src/a.ts')).toHaveLength(1);
    expect(links.imports).toHaveLength(6);
    expect(links.calls).toHaveLength(3);
    expect(links.resolved.map(({ from, to, edge }) => [from, to, edge.module])).toEqual([
      ['src/a.ts', 'src/b.ts', './b'],
      ['src/a.ts', 'src/c.ts', './c.js'],
      ['src/b.ts', 'src/a.ts', './a'],
    ]);
    expect(links.unresolved.map((edge) => edge.module)).toEqual(['react', './self']);
  });

  it('does not count a file that imports itself as a link', async () => {
    const { store, graph } = await setup(['src/a.ts'], { 'src/a.ts': ['./a'] });
    const links = await loadFileLinks(store, graph);
    expect(links.resolved).toEqual([]);
    expect(links.unresolved).toEqual([]);
  });
});
