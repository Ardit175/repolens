# repolens

Index a codebase into embeddings and a symbol graph so LLMs can search and navigate it fast. Ships as an MCP server.

## Quick start

**Requirements:** Node 22+

```bash
npm ci
npm run dev -- index <path>
npm run check  # runs everything CI runs: lint, format check, typecheck, coverage, build
```

`npm ci` also installs the git pre-commit hook (lint, format check and typecheck) from `.githooks/`.

## Usage

Start Qdrant, check your setup, index a repository and search it:

```bash
docker compose up -d qdrant
export QDRANT_URL=http://localhost:6333   # see .env.example for all variables
npm run dev -- doctor                     # checks Node, Qdrant and the embedding provider
npm run dev -- index <path>               # embeds changed files only; safe to re-run
npm run dev -- search "where do we open the database?" --language typescript --path src/ -n 5
npm run dev -- map -o repolens-map.html   # interactive dependency map, open it in a browser
```

- `index` re-embeds only files whose chunks changed and removes files that were deleted. `--dry-run` just summarises files by language without Qdrant or embeddings.
- Embeddings use Azure OpenAI when `AZURE_OPENAI_*` is set, otherwise a local model that needs no key (the first run downloads it). Force one with `REPOLENS_EMBEDDINGS=azure|local`.

- `map` writes one self-contained HTML file (no network needed to view it) with a zoomable graph of files and their imports. Search by path, filter by language, click a file to see what it imports and what imports it. `--path src/` limits it to a directory. Relative TS/JS imports and Python modules are linked; packages, Java packages and C# namespaces are counted as unresolved, not drawn.

- `bench <path> --queries <file>` measures index time, search latency and recall on a question set, without touching your index (see docs/benchmarks.md). More detail is in [docs/](docs/README.md).

## Use with an MCP client

`repolens serve` exposes the index over stdio. It needs the same `QDRANT_URL` (and embedding variables) as `search`, and an index built with `repolens index`.

| Tool              | What it does                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `search_code`     | Semantic search; arguments `query`, optional `limit` (1-20), `path`, `language`                                            |
| `get_symbol`      | Code of a function, method, class or type by exact name (`AuthService.login` works); optional `path`                       |
| `list_files`      | Indexed files, optionally under a `path` prefix, with a `limit`                                                            |
| `file_context`    | One file as an outline of its symbols followed by their code                                                               |
| `find_references` | Every import of and call to a name, with file, line and calling symbol; optional `limit` (1-200)                           |
| `call_graph`      | Callers or callees of a function as an indented tree; `direction` (`callers` default, `callees`), `depth` (1-5, default 2) |

`find_references` and `call_graph` match by name only. repolens does not resolve types or modules, so two unrelated functions with the same name are reported together.

Claude Code:

```bash
claude mcp add repolens --env QDRANT_URL=http://localhost:6333 -- npx -y @ardit175/repolens serve
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "repolens": {
      "command": "npx",
      "args": ["-y", "@ardit175/repolens", "serve"],
      "env": { "QDRANT_URL": "http://localhost:6333" }
    }
  }
}
```

The package is not on npm yet (see M7), so until then build it (`npm run build`) and use `"command": "node", "args": ["/path/to/repolens/dist/cli.js", "serve"]`. The server writes only protocol messages to stdout; errors go to stderr.

## Status

M1 to M2 are done (walker, language detection, chunking for TS/JS, Python and C#). M8 adds Java chunking and symbol graph. M3 is done except the opt-in Azure smoke test: embeddings, Qdrant storage, incremental `index`, `search` and `doctor`. M4 adds `repolens serve` with the MCP tools. M5 adds the symbol graph and the `find_references` and `call_graph` tools. M6 adds `repolens map`. M7 (polish) has the docs folder and the `bench` command; the real-repository benchmark, demo GIF and npm publish are still open.
