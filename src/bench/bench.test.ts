import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryVectorStore } from '../store/index.js';
import { FakeEmbeddingProvider } from '../testing.js';
import { formatBenchmark, parseQueries, percentile, runBenchmark } from './bench.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'repolens-bench-'));
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(
    path.join(dir, 'src/auth.ts'),
    'export function loginUser(password: string) {\n  return password.length > 0;\n}\n',
  );
  writeFileSync(
    path.join(dir, 'src/db.ts'),
    'export function openDatabase(connection: string) {\n  return { connection };\n}\n',
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('percentile', () => {
  it('uses the nearest rank and handles empty input', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe('parseQueries', () => {
  it('accepts a valid file', () => {
    expect(parseQueries('[{"query":"login","expect":["src/auth.ts"]}]')).toEqual([
      { query: 'login', expect: ['src/auth.ts'] },
    ]);
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['[]', 'non-empty JSON array'],
    ['{"a":1}', 'non-empty JSON array'],
    ['[{"expect":["a"]}]', 'Query #1 needs a non-empty "query"'],
    ['[{"query":"  ","expect":["a"]}]', 'Query #1 needs a non-empty "query"'],
    ['[{"query":"q"},{"query":"q","expect":[]}]', 'Query #1 needs "expect"'],
    ['[{"query":"q","expect":[1]}]', 'needs "expect"'],
    ['[null]', 'needs a non-empty "query"'],
  ])('rejects %s', (json, message) => {
    expect(() => parseQueries(json)).toThrow(message);
  });
});

describe('runBenchmark', () => {
  it('measures recall, MRR and timings and lists misses', async () => {
    let tick = 0;
    const result = await runBenchmark({
      root: dir,
      store: new InMemoryVectorStore(),
      embeddings: new FakeEmbeddingProvider(),
      queries: [
        { query: 'loginUser password', expect: ['src/auth.ts'] },
        { query: 'openDatabase connection', expect: ['src/db.ts'] },
        { query: 'loginUser password', expect: ['src/nowhere.ts'] },
      ],
      limit: 1,
      now: () => (tick += 10),
    });
    expect(result.provider).toBe('fake');
    expect(result.files).toBe(2);
    expect(result.chunks).toBe(2);
    expect(result.indexMs).toBe(10);
    expect(result.searchP50Ms).toBe(10);
    expect(result.recallAtK).toBeCloseTo(2 / 3);
    expect(result.mrr).toBeCloseTo(2 / 3);
    expect(result.misses).toEqual(['loginUser password']);
  });

  it('counts a lower-ranked hit as 1/rank', async () => {
    const result = await runBenchmark({
      root: dir,
      store: new InMemoryVectorStore(),
      embeddings: new FakeEmbeddingProvider(),
      queries: [{ query: 'loginUser password', expect: ['src/db.ts'] }],
      limit: 2,
    });
    expect(result.recallAtK).toBe(1);
    expect(result.mrr).toBe(0.5);
  });

  it('rejects an empty query list', async () => {
    await expect(
      runBenchmark({
        root: dir,
        store: new InMemoryVectorStore(),
        embeddings: new FakeEmbeddingProvider(),
        queries: [],
        limit: 5,
      }),
    ).rejects.toThrow('No queries');
  });
});

describe('formatBenchmark', () => {
  const base = {
    provider: 'azure',
    files: 120,
    chunks: 900,
    indexMs: 12_340,
    queries: 10,
    limit: 5,
    searchP50Ms: 41.2,
    searchP95Ms: 88.9,
    recallAtK: 0.8,
    mrr: 0.654,
    misses: [] as string[],
  };

  it('renders a markdown table', () => {
    const text = formatBenchmark(base, 'express @ abc123');
    expect(text).toContain('### express @ abc123');
    expect(text).toContain('| Index time | 12.3 s |');
    expect(text).toContain('| Search latency p50 / p95 | 41 ms / 89 ms |');
    expect(text).toContain('| Recall@5 (10 queries) | 80% |');
    expect(text).toContain('| MRR | 0.65 |');
    expect(text).not.toContain('Missed queries');
  });

  it('lists missed queries', () => {
    expect(formatBenchmark({ ...base, misses: ['where is x'] }, 'r')).toContain('- where is x');
  });
});
