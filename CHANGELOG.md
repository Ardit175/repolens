# Changelog

## Unreleased
- 2026-10-21: M5 finished: import and call extraction for TS/JS, Python and C#, an incrementally updated symbol graph in Qdrant, and the `find_references` and `call_graph` MCP tools.
- 2026-10-19: M4 finished: `repolens serve` MCP server with `search_code`, `get_symbol`, `list_files` and `file_context`, in-process and stdio contract tests, setup docs.
- 2026-10-16: M3 almost finished: incremental `repolens index` (only changed files are re-embedded, deleted files removed), `repolens search` with path and language filters, `repolens doctor`, `.env.example`.
- 2026-10-14: M3 start: `EmbeddingProvider` with Azure OpenAI and local transformers.js (auto selection, batching, retry with backoff), and `VectorStore` with in-memory and Qdrant backends.
- 2026-10-12: M2 finished: Python and C# symbol chunking (classes, structs, records, methods, nested types, namespaces) with fixtures and tests.
- 2026-10-09: M2 start: web-tree-sitter parser layer, TS/TSX/JS/JSX symbol chunking with metadata and hashes, line-window fallback chunking.
- 2026-10-07: Pre-commit hook, release-please workflow and docker-compose for Qdrant.
- 2026-10-05: M1 scaffold: TypeScript tooling, `repolens index`, gitignore-aware walker, language detection, CI and security workflows.
- 2026-10-05: Project plan, working rules and decisions added.
