# repolens

Index a codebase into embeddings and a symbol graph so LLMs can search and navigate it fast. Ships as an MCP server.

## Quick start

**Requirements:** Node 22+

```bash
npm ci
npm run dev -- index <path>
npm run check  # runs everything CI runs: lint, format check, typecheck, coverage, build
```

## Status

M1 scaffold is done: `repolens index <path>` summarises a codebase by language.
