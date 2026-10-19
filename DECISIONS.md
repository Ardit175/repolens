# Decisions

Answers from Ardit's setup interview (2026-10-05). Later runs follow these without asking again. Add a dated line here whenever a run makes a new decision, such as adding a library.

## Shared across all three projects
- **Tests:** unit tests for logic and integration tests for every API route (here: the CLI commands and MCP tools). CI must be green. New or changed code needs at least 70% line coverage; there is no global target.
- **Paid APIs:** mocked in tests. One opt-in smoke test per provider (`RUN_SMOKE=1` with the key present), at most once per run.
- **Never:** rewrite history on main (no force-push, rebase or amend of pushed commits).
- **Commits:** conventional commits, pushed to main, no Claude attribution trailers.
- **Contact:** only through "Needs Ardit" in PLAN.md.

## repolens
- **Runtime:** Node 22 LTS (Node 20 is end-of-life). CI tests Node 22 and 24. `engines: >=22`.
- **Package:** `@ardit175/repolens` on npm (the unscoped `repolens` is taken). The CLI binary is still `repolens`.
- **Embeddings:** Ardit has Azure student credits. The default is Azure OpenAI `text-embedding-3-small` when the Azure env vars are set. Otherwise it falls back to a local transformers.js model, so it works with no key and in tests. Selection: `REPOLENS_EMBEDDINGS=auto|azure|local` (default `auto`).
- **Vector store:** Qdrant through Docker, as planned, is the persistent store. An in-memory store is used for tests. Integration tests against real Qdrant run in CI as a service container and are skipped locally when `QDRANT_URL` is unset.
- **Languages:** M2 covers TypeScript/JavaScript, Python and C#. Java moves to M8.
- **Parsing:** web-tree-sitter (WASM grammars) rather than native node-tree-sitter, so `npx` installs don't need a C++ toolchain. (Choice made during setup.)
- **CLI framework:** commander. (Choice made during setup: small, well known.)
- **Git hooks (2026-10-07):** plain `.githooks/pre-commit` enabled by a `prepare` script, instead of husky and lint-staged. No new dependency, and the hook just runs the fast CI checks.
- **Releases (2026-10-07):** release-please (GitHub Action, no npm dependency) opens release PRs from conventional commits. Merging one tags the version and writes notes. `bump-minor-pre-major` keeps 0.x bumps as minors.
- **Qdrant image (2026-10-07):** `qdrant/qdrant` pinned to a version in docker-compose.yml, so local and CI behave the same.
- **Tree-sitter grammars (2026-10-09):** `web-tree-sitter` (runtime) and `tree-sitter-wasms` (prebuilt WASM grammars for TS, TSX, JS, Python and C#). Prebuilt grammars avoid building or hosting WASM files ourselves; GitHub release downloads are blocked in cloud runs, so a downloader was not an option.
- **Chunk shape (2026-10-09):** a class chunk holds the leading comment, header and fields up to the first method; each method is its own chunk with `parent` set. Nothing is embedded twice. Nested functions stay inside their enclosing chunk.
- **Nested types (2026-10-12):** in C#, a nested type is its own chunk whose `parent` is the outer type; methods take the nearest type as parent. Python only chunks direct methods of top-level classes.
- **Local embeddings (2026-10-14):** `@huggingface/transformers` (transformers.js) runs the local fallback model `Xenova/all-MiniLM-L6-v2` (384 dimensions) with no API key. Azure OpenAI and Qdrant are called through plain `fetch`, so no SDK or client library is added for them.
- **MCP server (2026-10-19):** `@modelcontextprotocol/sdk` (the official SDK, the point of the project) and `zod` (the SDK's tool input schemas are zod; it was already a transitive dependency, now declared). Tools are read-only and return text; a missing symbol or file is an MCP error result, not a protocol error, so the model can read the message and retry. The stdout stream is reserved for protocol messages.
- **Symbol lookup (2026-10-19):** `get_symbol` and `file_context` read from the vector store (`findChunks`, exact match on payload fields) rather than parsing files again, so they answer exactly what was indexed and work without the source checkout.

## Environment variables
| Name | Used for | Required |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource URL | for Azure embeddings |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | for Azure embeddings |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | deployment name of text-embedding-3-small | for Azure embeddings |
| `QDRANT_URL` | e.g. `http://localhost:6333` | for the persistent store |
| `NPM_TOKEN` | publishing (GitHub Actions secret) | M7 only |

Ardit adds these as environment variables in the cloud environment settings and as GitHub repo secrets. They never go in chat or in the repo.
