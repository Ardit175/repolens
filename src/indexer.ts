import { readFile } from 'node:fs/promises';
import { chunkFile, type Chunk } from './chunker/index.js';
import type { EmbeddingProvider } from './embeddings/index.js';
import { edgesHash, extractGraph } from './graph/index.js';
import type { GraphStore } from './graph/types.js';
import { detectLanguage } from './language.js';
import { chunkId, type StoredChunk, type VectorStore } from './store/index.js';
import { walkFiles, type WalkedFile } from './walker.js';

export interface IndexOptions {
  root: string;
  store: VectorStore;
  embeddings: EmbeddingProvider;
  /** When set, the symbol graph is kept in step with the files, independent of the chunks. */
  graph?: GraphStore;
  maxFileSize?: number;
  /** Called once per file that is re-chunked, for progress output. */
  onFile?: (path: string) => void;
}

export interface IndexStats {
  filesScanned: number;
  /** Files that were new or had a changed chunk and were re-embedded. */
  filesChanged: number;
  filesUnchanged: number;
  /** Files in the index that no longer exist on disk. */
  filesRemoved: number;
  chunksEmbedded: number;
  /** Files that could not be read or are not valid UTF-8 text. */
  filesSkipped: number;
  /** Files whose graph edges were rewritten because their edge set changed. 0 without a graph. */
  graphFilesUpdated: number;
}

/** Reads a file as UTF-8 text, or returns undefined if it is not text. */
async function readText(file: WalkedFile): Promise<string | undefined> {
  const buffer = await readFile(file.absolutePath);
  if (buffer.includes(0)) return undefined;
  return buffer.toString('utf8');
}

function sameIds(stored: string[] | undefined, current: string[]): boolean {
  if (stored === undefined || stored.length !== current.length) return false;
  const known = new Set(stored);
  return current.every((id) => known.has(id));
}

/**
 * Brings the vector store in line with the files under `root`. A file is re-embedded only
 * when the set of chunk ids (path, start line and content hash) differs from what is stored,
 * and files that disappeared are deleted.
 */
export async function indexRepository(options: IndexOptions): Promise<IndexStats> {
  const { root, store, embeddings, graph, onFile } = options;
  const files = await walkFiles(
    root,
    options.maxFileSize === undefined ? {} : { maxFileSize: options.maxFileSize },
  );
  await store.ensureCollection(embeddings.dimensions);
  const indexed = await store.listIdsByPath();
  let graphHashes = new Map<string, string>();
  if (graph) {
    await graph.ensure();
    graphHashes = await graph.listHashes();
  }

  const stats: IndexStats = {
    filesScanned: files.length,
    filesChanged: 0,
    filesUnchanged: 0,
    filesRemoved: 0,
    chunksEmbedded: 0,
    filesSkipped: 0,
    graphFilesUpdated: 0,
  };

  const seen = new Set<string>();
  for (const file of files) {
    let source: string | undefined;
    try {
      source = await readText(file);
    } catch {
      source = undefined;
    }
    if (source === undefined) {
      stats.filesSkipped++;
      continue;
    }
    seen.add(file.path);

    if (graph && (await updateGraph(graph, graphHashes, file.path, source))) {
      stats.graphFilesUpdated++;
    }

    const chunks = await chunkFile(file.path, detectLanguage(file.path), source);
    const items = chunks.map((chunk) => ({ id: chunkId(chunk), chunk }));
    if (
      sameIds(
        indexed.get(file.path),
        items.map((i) => i.id),
      )
    ) {
      stats.filesUnchanged++;
      continue;
    }

    onFile?.(file.path);
    if (items.length > 0) {
      const vectors = await embeddings.embed(items.map((i) => i.chunk.content));
      await store.deleteByPath(file.path);
      await store.upsert(toStored(items, vectors));
      stats.chunksEmbedded += items.length;
    } else {
      await store.deleteByPath(file.path);
    }
    stats.filesChanged++;
  }

  for (const stalePath of indexed.keys()) {
    if (seen.has(stalePath)) continue;
    await store.deleteByPath(stalePath);
    stats.filesRemoved++;
  }
  if (graph) {
    for (const stalePath of graphHashes.keys()) {
      if (!seen.has(stalePath)) await graph.deleteByPath(stalePath);
    }
  }
  return stats;
}

/** Rewrites a file's edges when their hash differs from the stored one. Returns true if it did. */
async function updateGraph(
  graph: GraphStore,
  hashes: Map<string, string>,
  path: string,
  source: string,
): Promise<boolean> {
  const language = detectLanguage(path);
  const edges = language ? await extractGraph(path, language, source) : [];
  const hash = edgesHash(edges);
  if (hashes.get(path) === hash) return false;
  await graph.replaceFile(path, hash, edges);
  return true;
}

function toStored(items: { id: string; chunk: Chunk }[], vectors: number[][]): StoredChunk[] {
  if (vectors.length !== items.length) {
    throw new Error(
      `Embedding provider returned ${vectors.length} vectors for ${items.length} chunks`,
    );
  }
  return items.map((item, i) => ({ id: item.id, chunk: item.chunk, vector: vectors[i]! }));
}
