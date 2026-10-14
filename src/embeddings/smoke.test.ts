import { describe, expect, it } from 'vitest';
import { createEmbeddingProvider } from './index.js';

describe.skipIf(!(process.env.RUN_SMOKE === '1' && process.env.AZURE_OPENAI_API_KEY))(
  'Azure embeddings smoke test',
  () => {
    it('embeds one string with the real service', async () => {
      const provider = createEmbeddingProvider({ ...process.env, REPOLENS_EMBEDDINGS: 'azure' });
      const [vector] = await provider.embed(['hello from repolens']);
      expect(vector).toHaveLength(1536);
    });
  },
);
