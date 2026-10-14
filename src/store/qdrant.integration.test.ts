import { randomUUID } from 'node:crypto';
import { afterAll, describe } from 'vitest';
import { runVectorStoreContract } from './contract.js';
import { QdrantVectorStore } from './qdrant.js';

const url = process.env.QDRANT_URL;

describe.skipIf(!url)('Qdrant integration', () => {
  const collections: string[] = [];

  afterAll(async () => {
    for (const name of collections) {
      await fetch(`${url}/collections/${name}`, {
        method: 'DELETE',
        headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {},
      });
    }
  });

  runVectorStoreContract('Qdrant', async () => {
    const collection = `repolens-test-${randomUUID()}`;
    collections.push(collection);
    return new QdrantVectorStore({ url: url!, collection, apiKey: process.env.QDRANT_API_KEY });
  });
});
