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
