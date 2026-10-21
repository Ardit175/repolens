import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Runtime } from '../runtime.js';
import {
  callGraph,
  fileContext,
  findReferences,
  getSymbol,
  listFiles,
  MAX_GRAPH_DEPTH,
  MAX_LIST_LIMIT,
  MAX_REFERENCE_LIMIT,
  MAX_SEARCH_RESULTS,
  searchCode,
  ToolError,
} from './tools.js';

/** Runs a tool and turns failures into an MCP error result, so the model sees what went wrong. */
async function respond(run: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await run() }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ToolError)) process.stderr.write(`repolens: tool failed: ${message}\n`);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

export function createServer(runtime: Runtime, version: string): McpServer {
  const server = new McpServer({ name: 'repolens', version });

  server.registerTool(
    'search_code',
    {
      description:
        'Semantic search over the indexed codebase. Returns the closest functions, methods and classes with their code.',
      inputSchema: {
        query: z.string().min(1).describe('What to look for, in plain language'),
        limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional().describe('Result count'),
        path: z.string().optional().describe('Only files under this directory, e.g. "src/"'),
        language: z.string().optional().describe('Only this language, e.g. "typescript"'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => searchCode(runtime, input)),
  );

  server.registerTool(
    'get_symbol',
    {
      description:
        'Returns the code of a function, method, class or type by exact name. Use "Class.method" to be precise.',
      inputSchema: {
        name: z.string().min(1).describe('Symbol name, e.g. "login" or "AuthService.login"'),
        path: z.string().optional().describe('Restrict to one file'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => getSymbol(runtime, input)),
  );

  server.registerTool(
    'list_files',
    {
      description: 'Lists the files in the index, optionally under a directory.',
      inputSchema: {
        path: z.string().optional().describe('Only paths starting with this prefix, e.g. "src/"'),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional().describe('Maximum paths'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => listFiles(runtime, input)),
  );

  server.registerTool(
    'file_context',
    {
      description: 'Shows one indexed file as an outline of its symbols followed by their code.',
      inputSchema: { path: z.string().min(1).describe('Path relative to the indexed root') },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => fileContext(runtime, input)),
  );

  server.registerTool(
    'find_references',
    {
      description:
        'Lists every import of and call to a name, with file, line and the calling symbol. Matches by name only, not by type.',
      inputSchema: {
        name: z.string().min(1).describe('Function, method or class name, e.g. "login"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_REFERENCE_LIMIT)
          .optional()
          .describe('Maximum references, default 50'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => findReferences(runtime, input)),
  );

  server.registerTool(
    'call_graph',
    {
      description:
        'Shows who calls a function (callers) or what it calls (callees) as an indented tree. Matches by name only.',
      inputSchema: {
        name: z.string().min(1).describe('Function or method name, e.g. "login"'),
        direction: z.enum(['callers', 'callees']).optional().describe('Default "callers"'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(MAX_GRAPH_DEPTH)
          .optional()
          .describe('Levels, default 2'),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => respond(() => callGraph(runtime, input)),
  );

  return server;
}

/** Serves over stdio until the client disconnects. Stdout carries protocol messages only. */
export async function serveStdio(runtime: Runtime, version: string): Promise<void> {
  await createServer(runtime, version).connect(new StdioServerTransport());
}
