# Progress

One entry per scheduled run, newest last.

## 2026-10-05 Setup
- Built: plan, working rules and decisions from the setup interview.
- Next: M1 scaffold.
- LinkedIn: Started repolens, a tool that indexes a codebase so AI assistants can search and navigate it like a developer would.

## 2026-10-05 M1 scaffold
- Built: TypeScript project with ESLint, Prettier and Vitest; `repolens index <path>` CLI; a walker that honours nested .gitignore files; language detection by extension and shebang; CI, gitleaks, CodeQL, PR title check and Dependabot config; ARCHITECTURE.md.
- Next: finish M0 leftovers (pre-commit hooks, release workflow), then M2 chunking.
- Design decision: the walker applies each .gitignore only beneath its own directory and lets deeper files override shallower ones, and it never enters an ignored directory. This matches git and avoids reading huge ignored trees like build output.
- LinkedIn: repolens can now walk a repository the way git does, skipping ignored and binary files, and report which languages it contains.

## 2026-10-07 Foundation leftovers
- Built: a pre-commit hook (lint, format check, typecheck) installed by `npm ci`, a release-please workflow for versions and release notes, and docker-compose for Qdrant.
- Next: M2 chunking, starting with the web-tree-sitter parser layer.
- Design decision: the pre-commit hook is a plain script in `.githooks/` rather than husky. It adds no dependency and runs the same fast checks as CI, so it is easy to read and explain.
- LinkedIn: repolens now checks code quality before every commit and prepares versioned releases automatically from commit messages.

## 2026-10-09 M2 chunking, TS/JS
- Built: web-tree-sitter parser layer, TypeScript/TSX/JavaScript/JSX chunker (functions, arrow functions, classes, methods, interfaces, types, enums), chunk metadata with SHA-256 hashes, fallback line-window chunking, fixtures and tests. Found the Release workflow failing on main (Actions may not open PRs); added a Needs Ardit item.
- Next: Python and C# adapters, then M3 embeddings and storage.
- Design decision: a class chunk stops before its first method and each method is its own chunk with a parent name. Embedding the whole class and every method would store the same code twice and blur search results, so each line of code lives in exactly one chunk.
- LinkedIn: repolens can now cut TypeScript and JavaScript files into function and class sized pieces using a real parser, which is what makes search results point at the right code.

## 2026-10-12 M2 chunking, Python and C#
- Built: Python adapter (functions, classes, methods, decorators, comments) and C# adapter (classes, structs, records, interfaces, enums, constructors, methods, nested types, block and file-scoped namespaces), with fixtures and tests. M2 is complete.
- Next: M3 embeddings and storage, starting with the EmbeddingProvider interface and the in-memory vector store. The Release workflow permission question is still open under Needs Ardit.
- Design decision: each language gets its own small adapter that returns the same plain symbol shape, and one shared function turns symbols into chunks. Adding a language then means writing one extraction function, and chunk rules like hashing and line numbers stay in one place.
- LinkedIn: repolens now splits Python and C# code into function and class sized pieces the same way it does for TypeScript, so search works across all three languages.

## 2026-10-14 M3 embeddings and vector store
- Built: `EmbeddingProvider` with Azure OpenAI and local transformers.js providers, auto selection, batching and retry with backoff; `VectorStore` with in-memory and Qdrant backends and a shared contract test; Qdrant service container added to CI.
- Next: `repolens doctor`, incremental re-index by file hash, then `repolens search`. Docker Hub rate-limited the Qdrant pull in this run, so CI is the first real Qdrant run. The Release workflow permission question is still open under Needs Ardit.
- Design decision: both stores are tested by one shared contract function, so the in-memory fake that most tests use is held to exactly the same behaviour as real Qdrant. Azure and Qdrant are called with plain fetch instead of SDKs, which keeps dependencies small and makes the request shapes easy to test with a fake fetch.
- LinkedIn: repolens can now turn code chunks into vectors with either Azure OpenAI or a local model and store them in Qdrant, and the same tests run against a fake store and the real one.

## 2026-10-16 M3 incremental index, search and doctor
- Built: `repolens index` now embeds into Qdrant and re-embeds only changed files (deleted files are removed); `repolens search` with `--path`, `--language` and `-n`; `repolens doctor`; an end-to-end integration test against real Qdrant for CI; `.env.example`. The old language summary moved to `index --dry-run`. Only the opt-in Azure smoke test is left in M3.
- Next: M4 MCP server (`repolens serve`, search_code, get_symbol, list_files, file_context). Docker Hub rate-limited the Qdrant pull again, so the real-Qdrant tests run first in CI. The Release workflow permission question is still open under Needs Ardit.
- Design decision: the store now lists chunk ids per file instead of content hashes. An id is built from path, start line and hash, so a file whose code only moved to other lines is re-indexed and search results never show stale line numbers, while a plain hash comparison would have missed that.
- LinkedIn: repolens can now be re-run on a repository and only re-embeds the files that changed, then answers plain-language searches from the command line.

## 2026-10-19 M4 MCP server
- Built: `repolens serve` on the MCP SDK with `search_code`, `get_symbol`, `list_files` and `file_context`; `VectorStore.findChunks` (in-memory and Qdrant); contract tests through an in-process client and through a real stdio process; README setup for Claude Code and Claude Desktop. M4 is complete.
- Next: M5 symbol graph (imports and call references for TS/JS, Python and C#). The Release workflow permission question is still open under Needs Ardit. The Azure smoke test still needs a run with the key.
- Design decision: the tool logic is plain functions that take a store and an embedder and return text, and the MCP server file only validates input and wraps results. That keeps most tests free of any protocol code, and one small test set talks to the server through a real client to prove the wiring. A missing symbol returns an error result instead of throwing, so the model reads the message and can try search instead.
- LinkedIn: repolens now runs as an MCP server, so an AI assistant can search a codebase by meaning and pull up a function or file by name.
