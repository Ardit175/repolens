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
```

- `index` re-embeds only files whose chunks changed and removes files that were deleted. `--dry-run` just summarises files by language without Qdrant or embeddings.
- Embeddings use Azure OpenAI when `AZURE_OPENAI_*` is set, otherwise a local model that needs no key (the first run downloads it). Force one with `REPOLENS_EMBEDDINGS=azure|local`.

## Status

M1 to M2 are done (walker, language detection, chunking for TS/JS, Python and C#). M3 is done except the opt-in Azure smoke test: embeddings, Qdrant storage, incremental `index`, `search` and `doctor`. The MCP server is next.
