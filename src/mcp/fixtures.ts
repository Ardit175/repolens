import { chunkFile } from '../chunker/index.js';
import { InMemoryGraphStore } from '../graph/store.js';
import type { Runtime } from '../runtime.js';
import { chunkId, InMemoryVectorStore } from '../store/index.js';
import { FakeEmbeddingProvider } from '../testing.js';

const SOURCES: Record<string, string> = {
  'src/auth.ts': `export class AuthService {
  login(user: string, password: string): boolean {
    return password.length > 0 && user.length > 0;
  }
  logout(user: string): void {
    console.log(user);
  }
}
`,
  'src/db.ts': `export function openDatabase(url: string) {
  return { url, connected: true };
}
`,
  'scripts/seed.py': `def seed_database(rows):
    return len(rows)
`,
};

/** A runtime over an in-memory store holding a few real chunks, for tool and MCP tests. */
export async function seededRuntime(): Promise<Runtime> {
  const store = new InMemoryVectorStore();
  const embeddings = new FakeEmbeddingProvider();
  await store.ensureCollection(embeddings.dimensions);
  for (const [path, source] of Object.entries(SOURCES)) {
    const language = path.endsWith('.py') ? 'python' : 'typescript';
    const chunks = await chunkFile(path, language, source);
    const vectors = await embeddings.embed(chunks.map((c) => c.content));
    await store.upsert(
      chunks.map((chunk, i) => ({ id: chunkId(chunk), chunk, vector: vectors[i]! })),
    );
  }
  return { store, graph: new InMemoryGraphStore(), embeddings };
}
