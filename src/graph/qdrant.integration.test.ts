import { randomUUID } from 'node:crypto';
import { afterAll, describe } from 'vitest';
import { runGraphStoreContract } from './contract.js';
import { QdrantGraphStore } from './qdrant.js';

const url = process.env.QDRANT_URL;

describe.skipIf(!url)('Qdrant graph integration', () => {
  const collections: string[] = [];

  afterAll(async () => {
    for (const name of collections) {
      await fetch(`${url}/collections/${name}`, {
        method: 'DELETE',
        headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {},
      });
    }
  });

  runGraphStoreContract('Qdrant', async () => {
    const collection = `repolens-graph-test-${randomUUID()}`;
    collections.push(collection);
    return new QdrantGraphStore({ url: url!, collection, apiKey: process.env.QDRANT_API_KEY });
  });
});
