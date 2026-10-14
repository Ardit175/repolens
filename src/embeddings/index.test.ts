import { describe, expect, it } from 'vitest';
import {
  AzureEmbeddingProvider,
  createEmbeddingProvider,
  LocalEmbeddingProvider,
} from './index.js';

const azureEnv = {
  AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'secret-value',
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'emb',
};

describe('createEmbeddingProvider', () => {
  it('defaults to auto and falls back to local without Azure variables', () => {
    expect(createEmbeddingProvider({})).toBeInstanceOf(LocalEmbeddingProvider);
    expect(createEmbeddingProvider({ ...azureEnv, AZURE_OPENAI_API_KEY: '' })).toBeInstanceOf(
      LocalEmbeddingProvider,
    );
  });

  it('auto picks Azure when all variables are set', () => {
    expect(createEmbeddingProvider(azureEnv)).toBeInstanceOf(AzureEmbeddingProvider);
    expect(createEmbeddingProvider({ ...azureEnv, REPOLENS_EMBEDDINGS: 'auto' })).toBeInstanceOf(
      AzureEmbeddingProvider,
    );
  });

  it('local mode ignores Azure variables', () => {
    expect(createEmbeddingProvider({ ...azureEnv, REPOLENS_EMBEDDINGS: 'local' })).toBeInstanceOf(
      LocalEmbeddingProvider,
    );
  });

  it('azure mode builds the Azure provider', () => {
    expect(createEmbeddingProvider({ ...azureEnv, REPOLENS_EMBEDDINGS: 'azure' }).name).toBe(
      'azure',
    );
  });

  it('azure mode names the missing variables but not values', () => {
    const env = { REPOLENS_EMBEDDINGS: 'azure', AZURE_OPENAI_API_KEY: 'secret-value' };
    let message = '';
    try {
      createEmbeddingProvider(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('AZURE_OPENAI_ENDPOINT');
    expect(message).toContain('AZURE_OPENAI_EMBEDDING_DEPLOYMENT');
    expect(message).not.toContain('AZURE_OPENAI_API_KEY');
    expect(message).not.toContain('secret-value');
  });

  it('rejects an invalid mode and lists the valid ones', () => {
    expect(() => createEmbeddingProvider({ REPOLENS_EMBEDDINGS: 'gpu' })).toThrow(
      /"gpu".*auto, azure, local/,
    );
  });

  it('passes overrides to the chosen provider', async () => {
    const provider = createEmbeddingProvider(
      { REPOLENS_EMBEDDINGS: 'local' },
      { local: { pipelineFactory: async () => async () => ({ tolist: () => [[1]] }) } },
    );
    expect(await provider.embed(['a'])).toEqual([[1]]);

    let called = false;
    const azure = createEmbeddingProvider(azureEnv, {
      azure: {
        fetch: async () => {
          called = true;
          return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }));
        },
      },
    });
    expect(await azure.embed(['a'])).toEqual([[1]]);
    expect(called).toBe(true);
  });
});
