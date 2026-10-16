import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime.js';

describe('createRuntime', () => {
  it('explains how to start Qdrant when QDRANT_URL is missing', () => {
    expect(() => createRuntime({})).toThrow('docker compose up -d qdrant');
  });

  it('builds a Qdrant store and local embeddings from the environment', () => {
    const runtime = createRuntime({
      QDRANT_URL: 'http://localhost:6333',
      REPOLENS_EMBEDDINGS: 'local',
    });
    expect(runtime.embeddings.name).toContain('local');
    expect(runtime.store).toBeDefined();
  });
});
