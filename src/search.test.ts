import type { Chunk } from './chunker/types.js';
import { describe, expect, it } from 'vitest';
import { chunkId, InMemoryVectorStore } from './store/index.js';
import { makeChunk } from './store/contract.js';
import {
  extractIdentifiers,
  formatHits,
  MAX_NAME_TOKENS,
  searchIndex,
  type RankedHit,
} from './search.js';
import { FakeEmbeddingProvider } from './testing.js';

async function seeded() {
  const store = new InMemoryVectorStore();
  const embeddings = new FakeEmbeddingProvider();
  await store.ensureCollection(embeddings.dimensions);
  const chunks = [
    makeChunk('src/auth/login.ts', {
      name: 'loginUser',
      content: 'function loginUser password token session',
    }),
    makeChunk('src/db/pool.ts', {
      name: 'createPool',
      content: 'function createPool database connection pool',
    }),
    makeChunk('scripts/seed.py', {
      name: 'seed',
      language: 'python',
      content: 'def seed database rows',
    }),
  ];
  const vectors = await embeddings.embed(chunks.map((c) => c.content));
  await store.upsert(
    chunks.map((chunk, i) => ({ id: chunkId(chunk), chunk, vector: vectors[i]! })),
  );
  return { store, embeddings };
}

describe('searchIndex', () => {
  it('ranks the chunk sharing the query words first', async () => {
    const { store, embeddings } = await seeded();
    const hits = await searchIndex({
      store,
      embeddings,
      query: 'database connection pool',
      limit: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.chunk.name).toBe('createPool');
  });

  it('applies path and language filters', async () => {
    const { store, embeddings } = await seeded();
    const byPath = await searchIndex({
      store,
      embeddings,
      query: 'database',
      limit: 5,
      filter: { pathPrefix: 'scripts/' },
    });
    expect(byPath.map((h) => h.chunk.path)).toEqual(['scripts/seed.py']);
    const byLanguage = await searchIndex({
      store,
      embeddings,
      query: 'database',
      limit: 5,
      filter: { language: 'python' },
    });
    expect(byLanguage.map((h) => h.chunk.name)).toEqual(['seed']);
  });

  it('rejects a blank query', async () => {
    const { store, embeddings } = await seeded();
    await expect(searchIndex({ store, embeddings, query: '   ', limit: 3 })).rejects.toThrow(
      'must not be empty',
    );
  });
});

describe('formatHits', () => {
  it('says so when there are no results', () => {
    expect(formatHits([])).toBe('No results.\n');
  });

  it('shows location, qualified symbol, score and a truncated preview', () => {
    const content = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunk = makeChunk('src/a.ts', {
      name: 'run',
      parent: 'Job',
      kind: 'method',
      startLine: 4,
      endLine: 12,
      content,
    });
    const text = formatHits([{ chunk, score: 0.91234, nameMatch: false }]);
    expect(text).toContain('1. src/a.ts:4-12  Job.run (method, typescript)  score 0.912');
    expect(text).toContain('   | line 6');
    expect(text).not.toContain('line 7');
    expect(text).toContain('... (3 more lines)');
  });
});

describe('extractIdentifiers', () => {
  it.each([
    ['open database connection', []],
    ['where is parseConfig used', ['parseConfig']],
    ['where is load_settings defined', ['load_settings']],
    ['login', ['login']],
    ['HTTPServer', ['HTTPServer']],
    ['AuthService.login()', ['AuthService.login']],
    ['how does AuthService.login work?', ['AuthService.login']],
    ['find utf8 helper', ['utf8']],
    ['cost of $total', ['$total']],
    ['parseConfig and parseConfig again', ['parseConfig']],
    ['see ...parseConfig...', ['parseConfig']],
    ['9lives', []],
    ['a..b', []],
    ['  ', []],
  ])('%s -> %j', (query, expected) => {
    expect(extractIdentifiers(query)).toEqual(expected);
  });

  it('keeps at most five identifiers', () => {
    const query = Array.from({ length: 8 }, (_, i) => `fn_${i}`).join(' ');
    const found = extractIdentifiers(query);
    expect(found).toHaveLength(MAX_NAME_TOKENS);
    expect(found[0]).toBe('fn_0');
  });
});

describe('searchIndex hybrid mode', () => {
  const names = (hits: RankedHit[]) => hits.map((h) => h.chunk.name);

  /** `target` is named like the query but its text is far from it; `noisy` repeats the query word. */
  async function store() {
    const s = new InMemoryVectorStore();
    const embeddings = new FakeEmbeddingProvider();
    await s.ensureCollection(embeddings.dimensions);
    const chunks: Chunk[] = [
      makeChunk('src/noisy.ts', { name: 'noisy', content: 'run run run run' }),
      makeChunk('src/target.ts', { name: 'run', content: 'function run compute one two three' }),
      makeChunk('src/deep/other.ts', {
        name: 'run',
        content: 'compute alpha beta gamma delta epsilon',
      }),
      makeChunk('lib/other.py', {
        name: 'run',
        language: 'python',
        content: 'compute zeta eta theta iota kappa',
      }),
      makeChunk('src/svc.ts', {
        name: 'login',
        parent: 'AuthService',
        kind: 'method',
        content: 'login password token',
      }),
      makeChunk('src/other-svc.ts', {
        name: 'login',
        parent: 'OtherService',
        kind: 'method',
        content: 'login session cookie',
      }),
    ];
    const vectors = await embeddings.embed(chunks.map((c) => c.content));
    await s.upsert(chunks.map((chunk, i) => ({ id: chunkId(chunk), chunk, vector: vectors[i]! })));
    return { store: s, embeddings };
  }

  it('puts an exact-name chunk first even when its vector is the farthest', async () => {
    const deps = await store();
    const semantic = await searchIndex({ ...deps, query: 'run', limit: 1, mode: 'semantic' });
    expect(names(semantic)).toEqual(['noisy']);
    const hybrid = await searchIndex({ ...deps, query: 'run', limit: 1 });
    expect(names(hybrid)).toEqual(['run']);
    expect(hybrid[0]?.nameMatch).toBe(true);
  });

  it('orders vector-and-name hits, then name-only hits by path, then the rest', async () => {
    const deps = await store();
    const hits = await searchIndex({ ...deps, query: 'run', limit: 5 });
    const paths = hits.map((h) => h.chunk.path);
    expect(paths[0]).toBe('src/target.ts');
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.nameMatch).toBe(true);
    const named = hits.filter((h) => h.nameMatch);
    expect(named.map((h) => h.chunk.name)).toEqual(['run', 'run', 'run']);
    expect(hits.slice(0, 3)).toEqual(named);
    expect(hits[3]?.chunk.name).toBe('noisy');
    expect(hits[3]?.nameMatch).toBe(false);
  });

  it('gives name-only hits a null score, in path order', async () => {
    const deps = await store();
    const hits = await searchIndex({ ...deps, query: 'run', limit: 3 });
    expect(hits.map((h) => h.chunk.path)).toEqual([
      'src/target.ts',
      'lib/other.py',
      'src/deep/other.ts',
    ]);
    expect(hits.map((h) => h.score === null)).toEqual([false, true, true]);
  });

  it('matches Class.method only on that parent', async () => {
    const deps = await store();
    const hits = await searchIndex({ ...deps, query: 'AuthService.login', limit: 5 });
    expect(hits[0]?.chunk.parent).toBe('AuthService');
    expect(hits[0]?.nameMatch).toBe(true);
    const other = hits.find((h) => h.chunk.parent === 'OtherService');
    expect(other?.nameMatch ?? false).toBe(false);
    expect(hits.filter((h) => h.nameMatch)).toHaveLength(1);
  });

  it('applies the path and language filters to name matches', async () => {
    const deps = await store();
    const byPath = await searchIndex({
      ...deps,
      query: 'run',
      limit: 6,
      filter: { pathPrefix: 'src/deep/' },
    });
    expect(byPath.map((h) => h.chunk.path)).toEqual(['src/deep/other.ts']);
    const byLanguage = await searchIndex({
      ...deps,
      query: 'run',
      limit: 6,
      filter: { language: 'python' },
    });
    expect(byLanguage.map((h) => h.chunk.path)).toEqual(['lib/other.py']);
  });

  it('returns no duplicates and respects the limit', async () => {
    const deps = await store();
    const all = await searchIndex({ ...deps, query: 'run', limit: 6 });
    const ids = all.map((h) => chunkId(h.chunk));
    expect(new Set(ids).size).toBe(ids.length);
    expect(await searchIndex({ ...deps, query: 'run', limit: 2 })).toHaveLength(2);
  });

  it('ignores names in semantic mode', async () => {
    const deps = await store();
    const hits = await searchIndex({ ...deps, query: 'run', limit: 2, mode: 'semantic' });
    expect(names(hits)[0]).toBe('noisy');
    expect(hits.every((h) => !h.nameMatch && h.score !== null)).toBe(true);
  });

  it('leaves plain-language queries to the vector search', async () => {
    const deps = await store();
    const hits = await searchIndex({ ...deps, query: 'password token', limit: 2 });
    expect(hits.every((h) => !h.nameMatch)).toBe(true);
  });
});

describe('formatHits match description', () => {
  const chunk = makeChunk('src/a.ts', { name: 'run' });
  it.each([
    [{ chunk, score: 0.9123, nameMatch: false }, 'score 0.912'],
    [{ chunk, score: 0.9123, nameMatch: true }, 'score 0.912, name match'],
    [{ chunk, score: null, nameMatch: true }, '  name match'],
  ])('renders %j', (hit, suffix) => {
    expect(formatHits([hit]).trimEnd().split('\n')[0]).toMatch(new RegExp(`${suffix.trim()}$`));
  });
});
