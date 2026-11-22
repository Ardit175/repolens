import { chunkFile } from '../chunker/index.js';
import { InMemoryGraphStore } from '../graph/store.js';
import type { GraphEdge } from '../graph/types.js';
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

const EDGES: Record<string, GraphEdge[]> = {
  'src/auth.ts': [
    {
      path: 'src/auth.ts',
      language: 'typescript',
      kind: 'import',
      target: 'openDatabase',
      module: './db.js',
      line: 1,
    },
    {
      path: 'src/auth.ts',
      language: 'typescript',
      kind: 'call',
      target: 'openDatabase',
      from: 'login',
      fromParent: 'AuthService',
      line: 3,
    },
    {
      path: 'src/auth.ts',
      language: 'typescript',
      kind: 'call',
      target: 'login',
      from: 'logout',
      fromParent: 'AuthService',
      line: 6,
    },
  ],
  'scripts/seed.py': [
    {
      path: 'scripts/seed.py',
      language: 'python',
      kind: 'call',
      target: 'openDatabase',
      from: 'seed_database',
      line: 2,
    },
  ],
};

const TEST_SOURCES: Record<string, string> = {
  'src/auth.test.ts': `import { AuthService } from './auth.js';

export function checksLogin(): boolean {
  return new AuthService().login('ada', 'secret');
}
`,
};

const TEST_EDGES: Record<string, GraphEdge[]> = {
  'src/auth.test.ts': [
    {
      path: 'src/auth.test.ts',
      language: 'typescript',
      kind: 'import',
      target: 'AuthService',
      module: './auth.js',
      line: 1,
    },
    {
      path: 'src/auth.test.ts',
      language: 'typescript',
      kind: 'call',
      target: 'login',
      from: 'checksLogin',
      line: 4,
    },
  ],
};

/** A runtime over in-memory stores holding a few real chunks and hand-written graph edges, for tool and MCP tests. `withTests` adds a test file for src/auth.ts. */
export async function seededRuntime(options: { withTests?: boolean } = {}): Promise<Runtime> {
  const sources = options.withTests === true ? { ...SOURCES, ...TEST_SOURCES } : SOURCES;
  const allEdges = options.withTests === true ? { ...EDGES, ...TEST_EDGES } : EDGES;
  const store = new InMemoryVectorStore();
  const embeddings = new FakeEmbeddingProvider();
  await store.ensureCollection(embeddings.dimensions);
  for (const [path, source] of Object.entries(sources)) {
    const language = path.endsWith('.py') ? 'python' : 'typescript';
    const chunks = await chunkFile(path, language, source);
    const vectors = await embeddings.embed(chunks.map((c) => c.content));
    await store.upsert(
      chunks.map((chunk, i) => ({ id: chunkId(chunk), chunk, vector: vectors[i]! })),
    );
  }
  const graph = new InMemoryGraphStore();
  for (const [path, edges] of Object.entries(allEdges))
    await graph.replaceFile(path, 'fixture', edges);
  return { index: 'test', store, graph, embeddings };
}
