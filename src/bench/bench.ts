import { indexRepository } from '../indexer.js';
import type { EmbeddingProvider } from '../embeddings/index.js';
import { searchIndex } from '../search.js';
import type { VectorStore } from '../store/index.js';

/** One benchmark question: a query and the files that a good answer should come from. */
export interface BenchQuery {
  query: string;
  /** POSIX paths relative to the indexed root. A hit on any of them counts as correct. */
  expect: string[];
}

export interface BenchResult {
  provider: string;
  files: number;
  chunks: number;
  indexMs: number;
  queries: number;
  limit: number;
  searchP50Ms: number;
  searchP95Ms: number;
  /** Share of queries with an expected file among the top `limit` hits, 0 to 1. */
  recallAtK: number;
  /** Mean of 1/rank of the first expected file, 0 when none was found. */
  mrr: number;
  /** Queries with no expected file in the top results, for inspecting misses. */
  misses: string[];
}

export interface BenchOptions {
  root: string;
  store: VectorStore;
  embeddings: EmbeddingProvider;
  queries: BenchQuery[];
  limit: number;
  /** Millisecond clock, injectable for tests. */
  now?: () => number;
}

/** Validates the JSON of a queries file: an array of `{ query, expect: [path, ...] }`. */
export function parseQueries(json: string): BenchQuery[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Queries file is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Queries file must be a non-empty JSON array');
  }
  return data.map((item: unknown, i): BenchQuery => {
    const entry = item as { query?: unknown; expect?: unknown };
    const where = `Query #${i + 1}`;
    if (typeof entry?.query !== 'string' || entry.query.trim() === '') {
      throw new Error(`${where} needs a non-empty "query" string`);
    }
    if (
      !Array.isArray(entry.expect) ||
      entry.expect.length === 0 ||
      !entry.expect.every((p) => typeof p === 'string' && p !== '')
    ) {
      throw new Error(`${where} needs "expect" as a non-empty array of file paths`);
    }
    return { query: entry.query, expect: entry.expect as string[] };
  });
}

/** Nearest-rank percentile of an unsorted list; 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Indexes `root` into `store`, then runs every query and measures time and ranking quality. */
export async function runBenchmark(options: BenchOptions): Promise<BenchResult> {
  const { root, store, embeddings, queries, limit } = options;
  const now = options.now ?? (() => performance.now());
  if (queries.length === 0) throw new Error('No queries to run');

  const indexStart = now();
  const stats = await indexRepository({ root, store, embeddings });
  const indexMs = now() - indexStart;

  const latencies: number[] = [];
  const misses: string[] = [];
  let found = 0;
  let reciprocalRanks = 0;
  for (const { query, expect } of queries) {
    const start = now();
    const hits = await searchIndex({ store, embeddings, query, limit });
    latencies.push(now() - start);
    const rank = hits.findIndex((hit) => expect.includes(hit.chunk.path));
    if (rank === -1) {
      misses.push(query);
    } else {
      found++;
      reciprocalRanks += 1 / (rank + 1);
    }
  }

  return {
    provider: embeddings.name,
    files: stats.filesScanned,
    chunks: await store.count(),
    indexMs,
    queries: queries.length,
    limit,
    searchP50Ms: percentile(latencies, 50),
    searchP95Ms: percentile(latencies, 95),
    recallAtK: found / queries.length,
    mrr: reciprocalRanks / queries.length,
    misses,
  };
}

/** Renders a result as a markdown table row block ready to paste into docs/benchmarks.md. */
export function formatBenchmark(result: BenchResult, label: string): string {
  const lines = [
    `### ${label}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Embedding provider | ${result.provider} |`,
    `| Files scanned | ${result.files} |`,
    `| Chunks indexed | ${result.chunks} |`,
    `| Index time | ${(result.indexMs / 1000).toFixed(1)} s |`,
    `| Search latency p50 / p95 | ${result.searchP50Ms.toFixed(0)} ms / ${result.searchP95Ms.toFixed(0)} ms |`,
    `| Recall@${result.limit} (${result.queries} queries) | ${(result.recallAtK * 100).toFixed(0)}% |`,
    `| MRR | ${result.mrr.toFixed(2)} |`,
  ];
  if (result.misses.length > 0) {
    lines.push('', 'Missed queries:', ...result.misses.map((q) => `- ${q}`));
  }
  return lines.join('\n') + '\n';
}
