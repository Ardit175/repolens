import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../cli.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

describe('repolens serve over stdio', () => {
  it('starts as a real process and answers MCP requests on stdout', async () => {
    const transport = new StdioClientTransport({
      command: tsx,
      args: [cli, 'serve'],
      // Nothing listens on port 1, so tools that reach the store must fail cleanly.
      env: { PATH: process.env.PATH ?? '', QDRANT_URL: 'http://127.0.0.1:1' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(4);
      const result = await client.callTool({ name: 'list_files', arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);
});
