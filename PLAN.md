# repolens plan

Goal: index a codebase into embeddings and a symbol graph so LLMs can search and navigate it fast, shipped as an MCP server.

Decisions behind this plan are in DECISIONS.md. Runs work top to bottom.

## Needs Ardit

### Release workflow cannot open PRs
The Release workflow on main fails with "GitHub Actions is not permitted to create or approve pull requests". I cannot change this repo setting. How do you want to fix it?
- A (recommended): Settings > Actions > General > Workflow permissions, tick "Allow GitHub Actions to create and approve pull requests".
- B: Add a repo secret `RELEASE_PLEASE_TOKEN` (a fine-grained PAT with contents and pull-requests write) and I will switch the workflow to it.
- C: Drop release-please and tag releases by hand.

Answer: _(write here)_

## Milestones

### M0 Engineering foundation
- [x] CI, lint, format, typecheck, coverage, build, `npm pack --dry-run`, `npm run check`, PR template, Dependabot, gitleaks and CodeQL, PR title check, ARCHITECTURE.md
- [ ] Workflow files need pushing (see Needs Ardit if the push is rejected)
- [x] Pre-commit hooks
- [x] Release workflow (release-please); cut v0.1.0 by merging its release PR when M1 is released
- [x] docker-compose.yml for Qdrant
- [ ] Benchmark script (arrives with M7). The MCP contract test exists in src/mcp/server.test.ts and src/mcp/stdio.test.ts; fixture repos exist in test/fixtures

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
- [ ] Benchmark on a real open-source repo (index time, search latency, recall on a small question set), written up in docs/
- [ ] npm publish setup for `@ardit175/repolens` (needs an npm token: ask under Needs Ardit when it's reached)
- [ ] docs/ folder covering configuration, providers, tools and architecture

### M8 More languages (after M7)
- [ ] Java chunking and symbol graph
