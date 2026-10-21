import { createHash } from 'node:crypto';
import type { QdrantConfig } from '../store/index.js';
import { DEFAULT_EDGE_LIMIT, sortEdges } from './order.js';
import type { EdgeQuery, GraphEdge, GraphStore } from './types.js';

const UPSERT_BATCH_SIZE = 100;
const SCROLL_PAGE_SIZE = 256;
const MAX_ERROR_BODY = 300;

type MarkerPayload = { path: string; marker: true; hash: string };

interface ScrollResult {
  points: { payload?: Record<string, unknown> }[];
  next_page_offset?: string | number | null;
}

/** Deterministic UUID-shaped id (Qdrant accepts only UUIDs or unsigned integers). */
function pointId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const NOT_MARKER = { key: 'marker', match: { value: true } };

/**
 * Stores graph edges in their own Qdrant collection. Qdrant points need a vector, so every
 * point carries a 1-dimension dummy vector. Each file also has one marker point that holds
 * the file's edge-set hash, which is how files with zero edges are still recorded.
 */
export class QdrantGraphStore implements GraphStore {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(config: QdrantConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.collection = config.collection ?? 'repolens_graph';
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? fetch;
  }

  async ensure(): Promise<void> {
    const existing = await this.send('GET', '', undefined, [404]);
    if (existing) return;
    await this.send('PUT', '', { vectors: { size: 1, distance: 'Dot' } });
  }

  async replaceFile(path: string, hash: string, edges: GraphEdge[]): Promise<void> {
    await this.deleteByPath(path);
    const points: { id: string; vector: number[]; payload: object }[] = edges.map((edge, i) => ({
      id: pointId(`${path}:${i}`),
      vector: [0],
      payload: { ...edge },
    }));
    // The marker goes last, so a file with a marker always has all of its edges.
    const marker: MarkerPayload = { path, marker: true, hash };
    points.push({ id: pointId(`${path}:marker`), vector: [0], payload: marker });
    for (let i = 0; i < points.length; i += UPSERT_BATCH_SIZE) {
      await this.send('PUT', '/points?wait=true', {
        points: points.slice(i, i + UPSERT_BATCH_SIZE),
      });
    }
  }

  async deleteByPath(path: string): Promise<void> {
    await this.send('POST', '/points/delete?wait=true', {
      filter: { must: [{ key: 'path', match: { value: path } }] },
    });
  }

  async listHashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    await this.scroll(
      { must: [{ key: 'marker', match: { value: true } }] },
      ['path', 'hash'],
      (payload) => {
        const { path, hash } = payload as Partial<MarkerPayload>;
        if (path !== undefined && hash !== undefined) hashes.set(path, hash);
      },
    );
    return hashes;
  }

  async findEdges(query: EdgeQuery): Promise<GraphEdge[]> {
    const must: object[] = [];
    for (const key of ['kind', 'target', 'from', 'path'] as const) {
      const value = query[key];
      if (value !== undefined) must.push({ key, match: { value } });
    }
    const edges: GraphEdge[] = [];
    await this.scroll({ must, must_not: [NOT_MARKER] }, true, (payload) =>
      edges.push(payload as unknown as GraphEdge),
    );
    return sortEdges(edges).slice(0, query.limit ?? DEFAULT_EDGE_LIMIT);
  }

  private async scroll(
    filter: object,
    withPayload: true | string[],
    onPayload: (payload: Record<string, unknown>) => void,
  ): Promise<void> {
    let offset: string | number | null | undefined;
    do {
      const response = await this.send('POST', '/points/scroll', {
        limit: SCROLL_PAGE_SIZE,
        with_payload: withPayload,
        with_vector: false,
        filter,
        ...(offset !== undefined && offset !== null ? { offset } : {}),
      });
      const body = (await response!.json()) as { result: ScrollResult };
      for (const point of body.result.points) {
        if (point.payload) onPayload(point.payload);
      }
      offset = body.result.next_page_offset;
    } while (offset !== undefined && offset !== null);
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
