# repolens plan

Goal: index a codebase into embeddings and a symbol graph so LLMs can search and navigate it fast, shipped as an MCP server.

Decisions behind this plan are in DECISIONS.md. Runs work top to bottom.

## Needs Ardit

_Nothing waiting._

## Milestones

### M1 Scaffold
- [ ] TypeScript project on Node 22 (ESM, strict), package `@ardit175/repolens` with a `repolens` bin, ESLint, Prettier, Vitest with coverage
- [ ] `repolens index <path>` CLI command (commander) with `--help` and clear errors
- [ ] File walker that respects `.gitignore` (nested files too), skips binaries and large files, has a configurable max size
- [ ] Language detection by extension and shebang
- [ ] GitHub Actions CI: lint, typecheck and tests on Node 22 and 24
- [ ] README with a quick start

### M2 Chunking (TS/JS, Python, C#)
- [ ] Parser layer on web-tree-sitter (WASM grammars) with one adapter per language
- [ ] Function-, method- and class-level chunks for TypeScript/JavaScript (TS, TSX, JS, JSX)
- [ ] Same for Python
- [ ] Same for C#
- [ ] Chunk metadata: path, language, symbol name, symbol kind, parent symbol, line range and content hash. Fallback chunking for unsupported files
- [ ] Fixture-based tests per language

### M3 Embeddings and storage
- [ ] `EmbeddingProvider` interface with Azure OpenAI (`text-embedding-3-small` deployment) and local transformers.js providers, `auto` selection, and batching with retry/backoff
- [ ] `VectorStore` interface with a Qdrant implementation and an in-memory implementation for tests
- [ ] `docker-compose.yml` for Qdrant plus a `repolens doctor` check
- [ ] Incremental re-index by file hash (only changed or removed files are touched)
- [ ] `repolens search "<query>"` with path/language filters and readable output
- [ ] Opt-in Azure smoke test (`RUN_SMOKE=1`)

### M4 MCP server
- [ ] `repolens serve` (stdio) on @modelcontextprotocol/sdk
- [ ] Tools `search_code`, `get_symbol`, `list_files` and `file_context`, with input schemas and tests through an in-process MCP client
- [ ] Setup docs for Claude Desktop and Claude Code

### M5 Symbol graph
- [ ] Extract imports and call references for TS/JS, Python and C#
- [ ] Store the graph (nodes and edges), updated incrementally with the index
- [ ] MCP tools `find_references` and `call_graph` (with depth limit)

### M6 Map
- [ ] `repolens map` writes a self-contained interactive HTML graph of modules and dependencies (filter, search and zoom)

### M7 Polish
- [ ] README demo GIF
- [ ] Benchmark on a real open-source repo (index time, search latency, recall on a small question set), written up in docs/
- [ ] npm publish setup for `@ardit175/repolens` (needs an npm token: ask under Needs Ardit when it's reached)
- [ ] docs/ folder covering configuration, providers, tools and architecture

### M8 More languages (after M7)
- [ ] Java chunking and symbol graph
