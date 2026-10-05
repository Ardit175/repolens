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

## Environment variables
| Name | Used for | Required |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource URL | for Azure embeddings |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | for Azure embeddings |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | deployment name of text-embedding-3-small | for Azure embeddings |
| `QDRANT_URL` | e.g. `http://localhost:6333` | for the persistent store |
| `NPM_TOKEN` | publishing (GitHub Actions secret) | M7 only |

Ardit adds these as environment variables in the cloud environment settings and as GitHub repo secrets. They never go in chat or in the repo.
