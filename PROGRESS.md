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
