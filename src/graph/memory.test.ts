import { expect, it } from 'vitest';
import { makeEdge, runGraphStoreContract } from './contract.js';
import { InMemoryGraphStore } from './memory.js';

runGraphStoreContract('InMemory', async () => new InMemoryGraphStore());

it('does not let callers mutate stored edges', async () => {
  const store = new InMemoryGraphStore();
  const edge = makeEdge('a.ts');
  await store.replaceFile('a.ts', 'h', [edge]);
  edge.target = 'changed';
  const [found] = await store.findEdges({});
  expect(found?.target).toBe('run');
});
