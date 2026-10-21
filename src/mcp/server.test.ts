import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seededRuntime } from './fixtures.js';
import { createServer } from './server.js';

let client: Client;

beforeEach(async () => {
  const server = createServer(await seededRuntime(), '1.2.3');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content[0]?.text ?? '' };
}

describe('repolens MCP server', () => {
  it('identifies itself and advertises the six tools with schemas', async () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'repolens', version: '1.2.3' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'call_graph',
      'file_context',
      'find_references',
      'get_symbol',
      'list_files',
      'search_code',
    ]);
    const search = tools.find((t) => t.name === 'search_code');
    expect(search?.inputSchema.required).toEqual(['query']);
    expect(search?.annotations?.readOnlyHint).toBe(true);
  });

  it('search_code returns matching code', async () => {
    const { isError, text } = await call('search_code', {
      query: 'openDatabase url connected',
      limit: 1,
    });
    expect(isError).toBe(false);
    expect(text).toContain('src/db.ts');
  });

  it('get_symbol returns code for a known symbol and an error result for an unknown one', async () => {
    const found = await call('get_symbol', { name: 'AuthService.login' });
    expect(found.isError).toBe(false);
    expect(found.text).toContain('password.length');
    const missing = await call('get_symbol', { name: 'nothing' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No symbol named "nothing"');
  });

  it('list_files lists and filters', async () => {
    const all = await call('list_files', {});
    expect(all.text).toContain('3 files');
    const some = await call('list_files', { path: 'scripts/' });
    expect(some.text).toBe('1 file\nscripts/seed.py');
  });

  it('file_context returns the outline of a file', async () => {
    const { isError, text } = await call('file_context', { path: 'src/db.ts' });
    expect(isError).toBe(false);
    expect(text).toContain('- openDatabase (function)');
    expect((await call('file_context', { path: 'nope.ts' })).isError).toBe(true);
  });

  it('find_references lists calls and imports, and answers normally when there are none', async () => {
    const found = await call('find_references', { name: 'openDatabase' });
    expect(found.isError).toBe(false);
    expect(found.text).toContain('src/auth.ts:1  import from "./db.js"');
    expect(found.text).toContain('src/auth.ts:3  call in AuthService.login');
    expect(found.text).toContain('scripts/seed.py:2  call in seed_database');
    const none = await call('find_references', { name: 'nothing' });
    expect(none.isError).toBe(false);
    expect(none.text).toContain('name only');
  });

  it('call_graph walks callers and callees and reports unknown symbols as errors', async () => {
    const callers = await call('call_graph', { name: 'openDatabase', depth: 2 });
    expect(callers.text).toContain('  login  src/auth.ts:3');
    expect(callers.text).toContain('    logout  src/auth.ts:6');
    const callees = await call('call_graph', { name: 'logout', direction: 'callees' });
    expect(callees.text).toContain('  login  src/auth.ts:6\n    openDatabase  src/auth.ts:3');
    const missing = await call('call_graph', { name: 'nothing', direction: 'callees' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('search_code');
  });

  it('rejects out-of-range call_graph depth', async () => {
    const result = await client.callTool({
      name: 'call_graph',
      arguments: { name: 'x', depth: 9 },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects invalid input before running the tool', async () => {
    await expect(
      client.callTool({ name: 'search_code', arguments: { query: '' } }),
    ).resolves.toMatchObject({ isError: true });
    const tooMany = await client.callTool({
      name: 'search_code',
      arguments: { query: 'x', limit: 500 },
    });
    expect(tooMany.isError).toBe(true);
  });

  it('turns unexpected failures into error results without crashing', async () => {
    const runtime = await seededRuntime();
    runtime.store.findChunks = async () => {
      throw new Error('qdrant is down');
    };
    const server = createServer(runtime, '1');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const other = new Client({ name: 'test2', version: '0' });
    await Promise.all([server.connect(b), other.connect(a)]);
    const result = await other.callTool({ name: 'get_symbol', arguments: { name: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('qdrant is down');
    await other.close();
  });
});
