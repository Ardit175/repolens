import { AzureEmbeddingProvider, type AzureConfig } from './azure.js';
import { LocalEmbeddingProvider, type LocalConfig } from './local.js';
import type { EmbeddingProvider } from './types.js';

export { AzureEmbeddingProvider, type AzureConfig } from './azure.js';
export { embedInBatches, RetryableError, type RetryOptions } from './batching.js';
export {
  LocalEmbeddingProvider,
  type FeaturePipeline,
  type FeatureTensor,
  type LocalConfig,
  type PipelineFactory,
} from './local.js';
export type { EmbeddingProvider } from './types.js';

export const EMBEDDING_MODES = ['auto', 'azure', 'local'] as const;
export type EmbeddingMode = (typeof EMBEDDING_MODES)[number];

export interface ProviderOverrides {
  azure?: Pick<AzureConfig, 'apiVersion' | 'fetch' | 'retry'>;
  local?: LocalConfig;
}

const AZURE_VARS = [
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
] as const;

function parseMode(value: string | undefined): EmbeddingMode {
  const mode = value === undefined || value === '' ? 'auto' : value;
  if (!(EMBEDDING_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `Invalid REPOLENS_EMBEDDINGS value "${mode}". Valid values: ${EMBEDDING_MODES.join(', ')}`,
    );
  }
  return mode as EmbeddingMode;
}

/** Picks the embedding provider from REPOLENS_EMBEDDINGS (auto, azure or local). */
export function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ProviderOverrides = {},
): EmbeddingProvider {
  const mode = parseMode(env.REPOLENS_EMBEDDINGS);
  const missing = AZURE_VARS.filter((name) => !env[name]);

  if (mode === 'azure' && missing.length > 0) {
    throw new Error(
      `REPOLENS_EMBEDDINGS=azure requires these environment variables: ${missing.join(', ')}`,
    );
  }
  if (mode === 'local' || (mode === 'auto' && missing.length > 0)) {
    return new LocalEmbeddingProvider(overrides.local);
  }
  return new AzureEmbeddingProvider({
    endpoint: env.AZURE_OPENAI_ENDPOINT!,
    apiKey: env.AZURE_OPENAI_API_KEY!,
    deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
    ...overrides.azure,
  });
}
