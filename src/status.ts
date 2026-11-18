import type { EmbeddingProvider } from './embeddings/index.js';
import type { GraphStore } from './graph/types.js';
import { detectLanguage } from './language.js';
import type { VectorStore } from './store/index.js';

/** Live state of a watcher feeding this index, kept up to date by `repolens watch` / `serve --watch`. */
export interface WatchState {
  /** Directory being watched, as given on the command line. */
  root: string;
  /** Completed index passes (the first pass counts). */
  passes: number;
  /** When the last pass finished successfully. */
  lastPassAt?: Date;
  /** Message of the last failed pass or watcher error, cleared by the next successful pass. */
  lastError?: string;
  lastErrorAt?: Date;
}

export interface LanguageCount {
  language: string;
  files: number;
  chunks: number;
}

export interface IndexStatus {
  index: string;
  provider: { name: string; dimensions: number };
  /** Vector size stored in the collection; undefined when nothing was indexed yet. */
  storedDimensions: number | undefined;
  files: number;
  chunks: number;
  /** Sorted by chunks descending, then language name. */
  languages: LanguageCount[];
  /** Files with symbol graph data. */
  graphFiles: number;
  watch?: WatchState;
  /** Plain-language problems a caller should know about (empty index, dimension mismatch, watcher error). */
  warnings: string[];
}

export interface IndexStatusInput {
  index: string;
  store: VectorStore;
  graph: GraphStore;
  embeddings: EmbeddingProvider;
  watch?: WatchState | undefined;
}

function countLanguages(idsByPath: Map<string, string[]>): LanguageCount[] {
  const byLanguage = new Map<string, LanguageCount>();
  for (const [path, ids] of idsByPath) {
    const language = detectLanguage(path) ?? 'other';
    const entry = byLanguage.get(language) ?? { language, files: 0, chunks: 0 };
    entry.files += 1;
    entry.chunks += ids.length;
    byLanguage.set(language, entry);
  }
  return [...byLanguage.values()].sort(
    (a, b) => b.chunks - a.chunks || a.language.localeCompare(b.language),
  );
}

/** Summarises an index. A missing chunk or graph collection counts as empty. */
export async function getIndexStatus(input: IndexStatusInput): Promise<IndexStatus> {
  const { index, store, graph, embeddings, watch } = input;
  const provider = { name: embeddings.name, dimensions: embeddings.dimensions };
  const storedDimensions = await store.dimensions();
  let languages: LanguageCount[] = [];
  let files = 0;
  let chunks = 0;
  if (storedDimensions !== undefined) {
    const idsByPath = await store.listIdsByPath();
    files = idsByPath.size;
    for (const ids of idsByPath.values()) chunks += ids.length;
    languages = countLanguages(idsByPath);
  }
  const graphFiles = (await graph.listHashes()).size;

  const warnings: string[] = [];
  if (storedDimensions === undefined || chunks === 0) {
    warnings.push(
      `Index "${index}" is empty. Run \`repolens index <path> --index ${index}\` (or \`repolens watch\`) first.`,
    );
  }
  if (storedDimensions !== undefined && storedDimensions !== provider.dimensions) {
    warnings.push(
      `Index "${index}" was built with ${storedDimensions}-dimension vectors but the current provider "${provider.name}" makes ${provider.dimensions}-dimension vectors, so search will fail. Re-index with the same provider, or use another --index.`,
    );
  }
  if (watch?.lastError) {
    warnings.push(`The watcher's last pass failed: ${watch.lastError}`);
  }

  return {
    index,
    provider,
    storedDimensions,
    files,
    chunks,
    languages,
    graphFiles,
    ...(watch !== undefined ? { watch } : {}),
    warnings,
  };
}

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

function age(then: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function formatWatch(watch: WatchState | undefined, now: Date): string {
  if (!watch) return 'Watching: no';
  const last = watch.lastPassAt
    ? `last pass ${age(watch.lastPassAt, now)} (${watch.lastPassAt.toISOString()})`
    : 'last pass never';
  return `Watching: ${watch.root}, ${plural(watch.passes, 'pass', 'passes')}, ${last}`;
}

export function formatIndexStatus(status: IndexStatus, now: Date = new Date()): string {
  const lines = [
    `Index: ${status.index}`,
    `Embeddings: ${status.provider.name} (${status.provider.dimensions} dimensions)`,
    status.storedDimensions === undefined
      ? 'Stored vectors: none (not indexed yet)'
      : `Stored vectors: ${status.storedDimensions} dimensions`,
    `Files: ${status.files} (${plural(status.chunks, 'chunk')})`,
  ];
  if (status.languages.length > 0) {
    const parts = status.languages.map(
      (l) => `${l.language} ${plural(l.files, 'file')} / ${plural(l.chunks, 'chunk')}`,
    );
    lines.push(`Languages: ${parts.join(', ')}`);
  }
  lines.push(`Symbol graph: ${plural(status.graphFiles, 'file')}`);
  lines.push(formatWatch(status.watch, now));
  if (status.warnings.length > 0) {
    lines.push('Warnings:', ...status.warnings.map((w) => `- ${w}`));
  }
  return lines.join('\n');
}
