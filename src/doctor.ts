export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  fetch?: typeof fetch;
  /** Milliseconds to wait for Qdrant. Default 3000. */
  timeoutMs?: number;
}

const MIN_NODE_MAJOR = 22;

function checkNode(version: string): CheckResult {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  return major >= MIN_NODE_MAJOR
    ? { name: 'Node.js', status: 'ok', detail: version }
    : {
        name: 'Node.js',
        status: 'fail',
        detail: `${version}, repolens needs Node ${MIN_NODE_MAJOR} or newer`,
      };
}

function checkEmbeddings(env: NodeJS.ProcessEnv): CheckResult {
  const mode = env.REPOLENS_EMBEDDINGS || 'auto';
  const azureSet = [
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
  ];
  const missing = azureSet.filter((name) => !env[name]);
  if (!['auto', 'azure', 'local'].includes(mode)) {
    return {
      name: 'Embeddings',
      status: 'fail',
      detail: `REPOLENS_EMBEDDINGS="${mode}" is not auto, azure or local`,
    };
  }
  if (mode === 'azure' && missing.length > 0) {
    return {
      name: 'Embeddings',
      status: 'fail',
      detail: `azure selected but missing ${missing.join(', ')}`,
    };
  }
  if (mode === 'local' || missing.length > 0) {
    return {
      name: 'Embeddings',
      status: 'ok',
      detail: 'local model (Xenova/all-MiniLM-L6-v2), no key needed',
    };
  }
  return { name: 'Embeddings', status: 'ok', detail: 'Azure OpenAI' };
}

async function checkQdrant(env: NodeJS.ProcessEnv, options: DoctorOptions): Promise<CheckResult> {
  const url = env.QDRANT_URL;
  if (!url) {
    return {
      name: 'Qdrant',
      status: 'fail',
      detail:
        'QDRANT_URL is not set. Run `docker compose up -d qdrant` and set QDRANT_URL=http://localhost:6333',
    };
  }
  const fetchFn = options.fetch ?? fetch;
  try {
    const response = await fetchFn(`${url.replace(/\/+$/, '')}/collections`, {
      headers: env.QDRANT_API_KEY ? { 'api-key': env.QDRANT_API_KEY } : {},
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
    });
    if (!response.ok) {
      return { name: 'Qdrant', status: 'fail', detail: `${url} answered HTTP ${response.status}` };
    }
    return { name: 'Qdrant', status: 'ok', detail: `reachable at ${url}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      name: 'Qdrant',
      status: 'fail',
      detail: `cannot reach ${url} (${reason}). Is the container running?`,
    };
  }
}

/** Runs the environment checks that `repolens index` and `search` depend on. */
export async function runDoctor(options: DoctorOptions = {}): Promise<CheckResult[]> {
  const env = options.env ?? process.env;
  return [
    checkNode(options.nodeVersion ?? process.version),
    checkEmbeddings(env),
    await checkQdrant(env, options),
  ];
}

export function formatDoctor(results: CheckResult[]): string {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' } as const;
  const width = Math.max(...results.map((r) => r.name.length));
  return (
    results.map((r) => `${mark[r.status]}  ${r.name.padEnd(width)}  ${r.detail}`).join('\n') + '\n'
  );
}
