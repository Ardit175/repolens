import type { Chunk } from '../chunker/types.js';
import { DEFAULT_FIND_LIMIT, sortChunks } from './order.js';
import type { ChunkQuery, SearchFilter, SearchHit, StoredChunk, VectorStore } from './types.js';

export interface QdrantConfig {
  url: string;
  /** Defaults to `repolens`. */
  collection?: string;
  apiKey?: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

const UPSERT_BATCH_SIZE = 100;
const SCROLL_PAGE_SIZE = 256;
const MAX_ERROR_BODY = 300;

type Payload = Chunk & { dir_prefixes: string[] };

interface ScrollResult {
  points: { id?: string | number; payload?: Partial<Payload> }[];
  next_page_offset?: string | number | null;
}

/** Every ancestor directory of a path, e.g. `src/a/b.ts` gives `['src/', 'src/a/']`. */
function dirPrefixes(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, i) => `${parts.slice(0, i + 1).join('/')}/`);
}

export class QdrantVectorStore implements VectorStore {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(config: QdrantConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.collection = config.collection ?? 'repolens';
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? fetch;
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const existing = await this.send('GET', '', undefined, [404]);
    if (existing) {
      const body = (await existing.json()) as {
        result?: { config?: { params?: { vectors?: { size?: number } } } };
      };
      const size = body.result?.config?.params?.vectors?.size;
      if (size !== dimensions) {
        throw new Error(
          `Qdrant collection "${this.collection}" has ${String(size)} dimensions, but ${dimensions} were requested`,
        );
      }
      return;
    }
    await this.send('PUT', '', { vectors: { size: dimensions, distance: 'Cosine' } });
  }

  async upsert(items: StoredChunk[]): Promise<void> {
    for (let i = 0; i < items.length; i += UPSERT_BATCH_SIZE) {
      const points = items.slice(i, i + UPSERT_BATCH_SIZE).map((item) => ({
        id: item.id,
        vector: item.vector,
        payload: { ...item.chunk, dir_prefixes: dirPrefixes(item.chunk.path) },
      }));
      await this.send('PUT', '/points?wait=true', { points });
    }
  }

  async deleteByPath(path: string): Promise<void> {
    await this.send('POST', '/points/delete?wait=true', {
      filter: { must: [{ key: 'path', match: { value: path } }] },
    });
  }

  async listIdsByPath(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    let offset: string | number | null | undefined;
    do {
      const response = await this.send('POST', '/points/scroll', {
        limit: SCROLL_PAGE_SIZE,
        with_payload: ['path'],
        with_vector: false,
        ...(offset !== undefined && offset !== null ? { offset } : {}),
      });
      const body = (await response!.json()) as { result: ScrollResult };
      for (const point of body.result.points) {
        const path = point.payload?.path;
        if (path === undefined || point.id === undefined) continue;
        const ids = result.get(path);
        if (ids) ids.push(String(point.id));
        else result.set(path, [String(point.id)]);
      }
      offset = body.result.next_page_offset;
    } while (offset !== undefined && offset !== null);
    return result;
  }

  async search(vector: number[], limit: number, filter?: SearchFilter): Promise<SearchHit[]> {
    const must: object[] = [];
    if (filter?.language !== undefined) {
      must.push({ key: 'language', match: { value: filter.language } });
    }
    if (filter?.pathPrefix !== undefined) {
      must.push({ key: 'dir_prefixes', match: { value: filter.pathPrefix } });
    }
    const response = await this.send('POST', '/points/search', {
      vector,
      limit,
      with_payload: true,
      ...(must.length > 0 ? { filter: { must } } : {}),
    });
    const body = (await response!.json()) as { result: { score: number; payload: Payload }[] };
    return body.result.map(({ score, payload }) => {
      const chunk: Partial<Payload> = { ...payload };
      delete chunk.dir_prefixes;
      return { chunk: chunk as Chunk, score };
    });
  }

  async findChunks(query: ChunkQuery): Promise<Chunk[]> {
    const must: object[] = [];
    if (query.path !== undefined) must.push({ key: 'path', match: { value: query.path } });
    if (query.name !== undefined) must.push({ key: 'name', match: { value: query.name } });
    const limit = query.limit ?? DEFAULT_FIND_LIMIT;
    const chunks: Chunk[] = [];
    let offset: string | number | null | undefined;
    do {
      const response = await this.send('POST', '/points/scroll', {
        limit: SCROLL_PAGE_SIZE,
        with_payload: true,
        with_vector: false,
        ...(must.length > 0 ? { filter: { must } } : {}),
        ...(offset !== undefined && offset !== null ? { offset } : {}),
      });
      const body = (await response!.json()) as { result: ScrollResult };
      for (const point of body.result.points) {
        const chunk: Partial<Payload> = { ...point.payload };
        delete chunk.dir_prefixes;
        chunks.push(chunk as Chunk);
      }
      offset = body.result.next_page_offset;
    } while (offset !== undefined && offset !== null);
    return sortChunks(chunks).slice(0, limit);
  }

  async count(): Promise<number> {
    const response = await this.send('POST', '/points/count', { exact: true });
    const body = (await response!.json()) as { result: { count: number } };
    return body.result.count;
  }

  /** Returns undefined when the status is listed in `allowed` (the caller handles it). */
  private async send(
    method: string,
    suffix: string,
    body?: unknown,
    allowed: number[] = [],
  ): Promise<Response | undefined> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.apiKey) headers['api-key'] = this.apiKey;
    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collection)}${suffix}`;
    const response = await this.fetchFn(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (allowed.includes(response.status)) return undefined;
    if (!response.ok) {
      const text = (await response.text()).slice(0, MAX_ERROR_BODY);
      throw new Error(`Qdrant ${method} ${suffix || '/'} failed with ${response.status}: ${text}`);
    }
    return response;
  }
}
