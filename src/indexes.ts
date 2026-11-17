export const DEFAULT_INDEX = 'repolens';

const GRAPH_SUFFIX = '_graph';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const MAX_ERROR_BODY = 300;

export const QDRANT_URL_MISSING =
  'QDRANT_URL is not set. Start Qdrant with `docker compose up -d qdrant` and set QDRANT_URL=http://localhost:6333 (see .env.example).';

/** Throws an Error explaining the naming rule when the index name is invalid. */
export function validateIndexName(name: string): string {
  if (!NAME_PATTERN.test(name) || name.endsWith(GRAPH_SUFFIX)) {
    throw new Error(
      `Invalid index name "${name}": use 1-48 letters, digits, "-" or "_", starting with a letter or digit, not ending in "_graph"`,
    );
  }
  return name;
}

/** option > env.REPOLENS_INDEX (if non-empty) > DEFAULT_INDEX. Throws Error if invalid. */
export function resolveIndexName(option?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.REPOLENS_INDEX ? env.REPOLENS_INDEX : undefined;
  return validateIndexName(option ?? fromEnv ?? DEFAULT_INDEX);
}

/** The graph collection for an index. */
export function graphCollection(index: string): string {
  return `${index}${GRAPH_SUFFIX}`;
}

export interface QdrantConnection {
  url: string;
  apiKey?: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Reads the Qdrant url and optional api key from the environment. */
export function qdrantConnection(env: NodeJS.ProcessEnv = process.env): QdrantConnection {
  const url = env.QDRANT_URL;
  if (!url) throw new Error(QDRANT_URL_MISSING);
  return { url, ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}) };
}

export interface IndexInfo {
  name: string;
  /** Points in the chunk collection. */
  chunks: number;
  /** Files recorded in the graph; 0 when there is no graph collection. */
  graphFiles: number;
  /** Vector size of the chunk collection. */
  dimensions: number;
}

async function send(
  conn: QdrantConnection,
  method: string,
  path: string,
  body?: unknown,
  allowed: number[] = [],
): Promise<Response | undefined> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (conn.apiKey) headers['api-key'] = conn.apiKey;
  const fetchFn = conn.fetch ?? fetch;
  const response = await fetchFn(`${conn.url.replace(/\/+$/, '')}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (allowed.includes(response.status)) return undefined;
  if (!response.ok) {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY);
    throw new Error(`Qdrant ${method} ${path} failed with ${response.status}: ${text}`);
  }
  return response;
}

async function count(
  conn: QdrantConnection,
  collection: string,
  filter?: object,
): Promise<number | undefined> {
  const response = await send(
    conn,
    'POST',
    `/collections/${encodeURIComponent(collection)}/points/count`,
    { exact: true, ...(filter ? { filter } : {}) },
    [404],
  );
  if (!response) return undefined;
  const body = (await response.json()) as { result: { count: number } };
  return body.result.count;
}

async function listCollectionNames(conn: QdrantConnection): Promise<string[]> {
  const response = await send(conn, 'GET', '/collections');
  const body = (await response!.json()) as { result: { collections: { name: string }[] } };
  return body.result.collections.map((c) => c.name);
}

/** Every index in Qdrant, sorted by name. Graph collections without a chunk collection are ignored. */
export async function listIndexes(conn: QdrantConnection): Promise<IndexInfo[]> {
  const names = await listCollectionNames(conn);
  const indexes: IndexInfo[] = [];
  for (const name of names.filter((n) => !n.endsWith(GRAPH_SUFFIX)).sort()) {
    const info = await send(conn, 'GET', `/collections/${encodeURIComponent(name)}`);
    const body = (await info!.json()) as {
      result?: { config?: { params?: { vectors?: { size?: number } } } };
    };
    const chunks = (await count(conn, name)) ?? 0;
    const graphFiles =
      (await count(conn, graphCollection(name), {
        must: [{ key: 'marker', match: { value: true } }],
      })) ?? 0;
    indexes.push({
      name,
      chunks,
      graphFiles,
      dimensions: body.result?.config?.params?.vectors?.size ?? 0,
    });
  }
  return indexes;
}

/** Deletes the chunk and graph collections of an index. Returns which of them existed. */
export async function dropIndex(
  conn: QdrantConnection,
  name: string,
): Promise<{ chunks: boolean; graph: boolean }> {
  validateIndexName(name);
  // Qdrant answers 200 when deleting a missing collection, so check for it first.
  const remove = async (collection: string): Promise<boolean> => {
    const path = `/collections/${encodeURIComponent(collection)}`;
    if (!(await send(conn, 'GET', path, undefined, [404]))) return false;
    await send(conn, 'DELETE', path);
    return true;
  };
  const chunks = await remove(name);
  const graph = await remove(graphCollection(name));
  return { chunks, graph };
}
