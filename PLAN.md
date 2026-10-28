# repolens plan

Goal: index a codebase into embeddings and a symbol graph so LLMs can search and navigate it fast, shipped as an MCP server.

Decisions behind this plan are in DECISIONS.md. Runs work top to bottom.

## Needs Ardit

### Cloud network policy blocks Azure OpenAI
The Azure variables are now set in the cloud environment, but the policy proxy answers 403 for `zk-lms.openai.azure.com`, so the smoke test and the real-repo benchmark still cannot run (the local model is blocked too). What do you want?
- A (recommended): add `*.openai.azure.com` to the allowed domains in the cloud environment's network policy. A later run then ticks the smoke test and records a benchmark on a small open-source repo.
- B: run `repolens bench` yourself on your machine and paste the table into docs/benchmarks.md.
- C: allow huggingface.co instead so the local model can be used.

Answer:

## Milestones

### M0 Engineering foundation
- [x] CI, lint, format, typecheck, coverage, build, `npm pack --dry-run`, `npm run check`, PR template, Dependabot, gitleaks and CodeQL, PR title check, ARCHITECTURE.md
- [ ] After the v0.1.0 release PR merges, remove `release-as` from release-please-config.json (it pins the first release; without it release-please proposed 1.0.0 from 0.0.0)
- [x] Workflow files pushed (no longer blocked) (see Needs Ardit if the push is rejected)
- [x] Pre-commit hooks
- [x] Release workflow (release-please); cut v0.1.0 by merging its release PR when M1 is released
- [x] docker-compose.yml for Qdrant
- [x] Benchmark script (`repolens bench`, docs/benchmarks.md). The MCP contract test exists in src/mcp/server.test.ts and src/mcp/stdio.test.ts; fixture repos exist in test/fixtures

### M1 Scaffold
- [x] TypeScript project on Node 22 (ESM, strict), package `@ardit175/repolens` with a `repolens` bin, ESLint, Prettier, Vitest with coverage
- [x] `repolens index <path>` CLI command (commander) with `--help` and clear errors
- [x] File walker that respects `.gitignore` (nested files too), skips binaries and large files, has a configurable max size
- [x] Language detection by extension and shebang
- [x] GitHub Actions CI: lint, typecheck and tests on Node 22 and 24
- [x] README with a quick start

### M2 Chunking (TS/JS, Python, C#)
- [x] Parser layer on web-tree-sitter (WASM grammars) with one adapter per language (TS/JS, Python and C# adapters)
- [x] Function-, method- and class-level chunks for TypeScript/JavaScript (TS, TSX, JS, JSX)
- [x] Same for Python
- [x] Same for C#
- [x] Chunk metadata: path, language, symbol name, symbol kind, parent symbol, line range and content hash. Fallback chunking for unsupported files
- [x] Fixture-based tests per language (TS/JS, Python, C#)

### M3 Embeddings and storage
- [x] `EmbeddingProvider` interface with Azure OpenAI (`text-embedding-3-small` deployment) and local transformers.js providers, `auto` selection, and batching with retry/backoff
- [x] `VectorStore` interface with a Qdrant implementation and an in-memory implementation for tests (the Qdrant integration test runs in CI against a service container; Docker Hub rate-limited the image pull in the run that built it, so it has not run locally yet; Docker Hub rate-limited the pull again on 2026-10-16, so the new end-to-end indexer test also waits for CI)
- [x] `docker-compose.yml` for Qdrant plus a `repolens doctor` check
- [x] Incremental re-index by chunk id (path, start line, content hash) (only changed or removed files are touched)
- [x] `repolens search "<query>"` with path/language filters and readable output
- [ ] Opt-in Azure smoke test (`RUN_SMOKE=1`): the test file exists in src/embeddings/smoke.test.ts but has not been run against real Azure; tick it after a run with the key

### M4 MCP server
- [x] `repolens serve` (stdio) on @modelcontextprotocol/sdk
- [x] Tools `search_code`, `get_symbol`, `list_files` and `file_context`, with input schemas and tests through an in-process MCP client (plus a real stdio process test)
- [x] Setup docs for Claude Desktop and Claude Code (README)

### M5 Symbol graph
- [x] Extract imports and call references for TS/JS, Python and C#
- [x] Store the graph (edges, in a second Qdrant collection), updated incrementally with the index (the real-Qdrant graph test runs first in CI)
- [x] MCP tools `find_references` and `call_graph` (with depth limit)

### M6 Map
- [x] `repolens map` writes a self-contained interactive HTML graph of modules and dependencies (filter, search and zoom)

### M7 Polish
- [ ] README demo GIF
- [ ] Run the benchmark on a real open-source repo and record it in docs/benchmarks.md (blocked: needs an embedding provider, see Needs Ardit). The `repolens bench` command and method are done
- [ ] npm publish setup for `@ardit175/repolens` (needs an npm token: ask under Needs Ardit when it's reached)
- [x] docs/ folder covering configuration, providers, tools and architecture

### M8 More languages (after M7)
- [x] Java chunking and symbol graph (classes, records, interfaces, enums, methods, constructors; imports and calls). Methods inside enums and interfaces are not chunked separately, the whole type is one chunk
- [x] Go chunking and symbol graph (functions, methods with the receiver type as parent, structs, interfaces and other types; imports and calls). Go imports are not linked on the map
