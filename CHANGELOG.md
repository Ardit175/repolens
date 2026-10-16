# Changelog

## 1.0.0 (2026-10-16)


### Features

* add embedding providers for Azure OpenAI and local transformers.js ([972f905](https://github.com/Ardit175/repolens/commit/972f90542a078bea6eb0999eb101ef70d9f75db3))
* add gitignore-aware file walker ([2be8e0a](https://github.com/Ardit175/repolens/commit/2be8e0a079e38f061a49ced08415a3c7b52e986a))
* add incremental indexer that re-embeds only changed files ([ca5d73a](https://github.com/Ardit175/repolens/commit/ca5d73ae78f59b811b506e6bf9fd8f04b9fbe5bf))
* add repolens index command ([499869b](https://github.com/Ardit175/repolens/commit/499869b2986ac45d733058e0bbd96359f4da7454))
* add search, runtime config and doctor checks ([db990da](https://github.com/Ardit175/repolens/commit/db990daacb2466350cd893035797425308df4ef0))
* add vector store interface with in-memory and Qdrant backends ([0970cc0](https://github.com/Ardit175/repolens/commit/0970cc0452962a1c610cbe244e40f8f2577edff3))
* chunk Python and C# files by symbol ([97ab7f9](https://github.com/Ardit175/repolens/commit/97ab7f9ebe4982514fffee744937c77cd937381d))
* chunk Python and C# files by symbol ([00b57e6](https://github.com/Ardit175/repolens/commit/00b57e63ff9ee250f0561a55cd76f5c03f12f789))
* chunk TS/JS files by symbol (M2) ([a8acd5a](https://github.com/Ardit175/repolens/commit/a8acd5a6570dec2d710441ccd56400cf6832d9fb))
* chunk TS/JS files by symbol with fallback windows ([85c58e0](https://github.com/Ardit175/repolens/commit/85c58e03643fc3c037a03d6c1dc7ed84ad630c97))
* detect language by extension and shebang ([658dfc0](https://github.com/Ardit175/repolens/commit/658dfc0cd5c709b65fea97cd98e1cb3c33510043))
* embedding providers and vector store (M3 part 1) ([a57dbf3](https://github.com/Ardit175/repolens/commit/a57dbf3e8bade5a3bf8fcc561d9609ef2b982de7))
* incremental index, search and doctor commands ([27c6494](https://github.com/Ardit175/repolens/commit/27c64948848a9704a0a43dff8d11430d90978b40))
* M1 scaffold with index command, walker and CI ([e9c2437](https://github.com/Ardit175/repolens/commit/e9c243760d048875b73e51f122024d2bdf354599))
* wire index, search and doctor commands into the CLI ([9a55432](https://github.com/Ardit175/repolens/commit/9a554327446d4a3f55b4fb8d55b2906f9c98d4d5))


### Bug Fixes

* pass GITHUB_TOKEN to gitleaks so pull requests can be scanned ([be8c3ca](https://github.com/Ardit175/repolens/commit/be8c3ca0d0584621d65694e29a3aeb9a5b6aef03))
* pass GITHUB_TOKEN to the PR title check ([21e1874](https://github.com/Ardit175/repolens/commit/21e1874cbeb284017046cd38e9e269757e5aa078))

## Changelog

## Unreleased
- 2026-10-16: M3 almost finished: incremental `repolens index` (only changed files are re-embedded, deleted files removed), `repolens search` with path and language filters, `repolens doctor`, `.env.example`.
- 2026-10-14: M3 start: `EmbeddingProvider` with Azure OpenAI and local transformers.js (auto selection, batching, retry with backoff), and `VectorStore` with in-memory and Qdrant backends.
- 2026-10-12: M2 finished: Python and C# symbol chunking (classes, structs, records, methods, nested types, namespaces) with fixtures and tests.
- 2026-10-09: M2 start: web-tree-sitter parser layer, TS/TSX/JS/JSX symbol chunking with metadata and hashes, line-window fallback chunking.
- 2026-10-07: Pre-commit hook, release-please workflow and docker-compose for Qdrant.
- 2026-10-05: M1 scaffold: TypeScript tooling, `repolens index`, gitignore-aware walker, language detection, CI and security workflows.
- 2026-10-05: Project plan, working rules and decisions added.
