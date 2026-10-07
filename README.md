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

Start Qdrant for the persistent vector store (used from M3):

```bash
docker compose up -d qdrant
export QDRANT_URL=http://localhost:6333
```

## Status

M1 scaffold is done: `repolens index <path>` summarises a codebase by language.
