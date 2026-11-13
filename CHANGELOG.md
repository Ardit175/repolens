# Changelog

## [0.8.0](https://github.com/Ardit175/repolens/compare/repolens-v0.7.0...repolens-v0.8.0) (2026-11-13)


### Features

* add debounced watcher that reruns incremental indexing ([3668372](https://github.com/Ardit175/repolens/commit/3668372ae747f9d9924bba278aa900394bcf44f4))
* add repolens watch and serve --watch commands ([da17075](https://github.com/Ardit175/repolens/commit/da17075f6f466623d7f3757fda225ca2037521d9))
* add watch mode for indexing and serving ([7b26e1d](https://github.com/Ardit175/repolens/commit/7b26e1d77b8c49a11d5b883370dbc815b601698c))

## [0.7.0](https://github.com/Ardit175/repolens/compare/repolens-v0.6.0...repolens-v0.7.0) (2026-11-12)


### Features

* link imports on the map for C/C++, Ruby, PHP, JVM, Go and Rust files ([b584fbc](https://github.com/Ardit175/repolens/commit/b584fbc981cbf7d3edd50c067e59b9ddab30a84c))
* link imports on the map for nine more languages ([3c82e19](https://github.com/Ardit175/repolens/commit/3c82e199bdeb1f28722acd34b5b79dffbf4c1964))
* resolve C/C++ includes, Ruby requires and PHP imports to indexed files ([fe0298d](https://github.com/Ardit175/repolens/commit/fe0298d295e0ac5cb306d82b033ef73789adf800))
* resolve Java, Kotlin, Scala, Go and Rust imports to indexed files ([c80bd21](https://github.com/Ardit175/repolens/commit/c80bd21e1973f9f7dcee02ad316fabae5af8a01f))

## [0.6.0](https://github.com/Ardit175/repolens/compare/repolens-v0.5.0...repolens-v0.6.0) (2026-11-09)


### Features

* add C++ chunking and symbol graph ([6858d7b](https://github.com/Ardit175/repolens/commit/6858d7b19cb5a933fcbeda9b858ebca8d3384a0f))
* detect C++ files and chunk them by function, class, enum and method ([6de4933](https://github.com/Ardit175/repolens/commit/6de49332670fed61b8e09cadec624716e1d8bdf2))
* extract includes and calls from C++ files into the symbol graph ([823d122](https://github.com/Ardit175/repolens/commit/823d12288cf73e67b56fc5efff40742afe822383))

## [0.5.0](https://github.com/Ardit175/repolens/compare/repolens-v0.4.0...repolens-v0.5.0) (2026-11-08)


### Features

* add C chunking and symbol graph ([fb6e0e7](https://github.com/Ardit175/repolens/commit/fb6e0e75041b1afcf27b5d9323b632f2af2573a0))
* add Scala chunking and symbol graph ([e5e7b67](https://github.com/Ardit175/repolens/commit/e5e7b671b9a540bb917b6045fbf73e62a70e8076))
* detect C files and chunk them by function, struct, union and enum ([ba94c31](https://github.com/Ardit175/repolens/commit/ba94c310dfe189fe07fcb572eaf77a9552602789))
* detect Scala files and chunk them by class, trait, object and method ([ee8ca3e](https://github.com/Ardit175/repolens/commit/ee8ca3ecbd027956e4d961b5f07a5eef0e086db0))
* extract includes and calls from C files into the symbol graph ([d863ff7](https://github.com/Ardit175/repolens/commit/d863ff771e775d1ecfbc6033a4f49acfc5558158))

## [0.4.0](https://github.com/Ardit175/repolens/compare/repolens-v0.3.0...repolens-v0.4.0) (2026-11-05)


### Features

* add Kotlin chunking and symbol graph ([4a815e6](https://github.com/Ardit175/repolens/commit/4a815e6aa631fc9d40e3e7fbf5a2294016e383b9))
* add Swift chunking and symbol graph ([faf4d00](https://github.com/Ardit175/repolens/commit/faf4d002c86177e1444a6c1063a72bde4bca0431))
* chunk Kotlin files by class, interface, object, enum, function and method ([e365cef](https://github.com/Ardit175/repolens/commit/e365cef4aeebeaa06244f84718818c4a637eabc3))
* chunk Swift files and extract their imports and calls into the symbol graph ([d479c3d](https://github.com/Ardit175/repolens/commit/d479c3d8e7b148ca27a9eae02247a43d108f82d2))
* detect Swift files and register the Swift grammar ([1482d2b](https://github.com/Ardit175/repolens/commit/1482d2bb482c08fde1917b1a1d0dd52fa98831e5))
* extract imports and calls from Kotlin files into the symbol graph ([3bbe59f](https://github.com/Ardit175/repolens/commit/3bbe59f23bac91568b0c52dc8657a0fcd432db68))

## [0.3.0](https://github.com/Ardit175/repolens/compare/repolens-v0.2.0...repolens-v0.3.0) (2026-11-02)


### Features

* chunk PHP files by class, interface, trait, enum, method and function ([3677a8c](https://github.com/Ardit175/repolens/commit/3677a8cc23d56e174e0b817e9eb22631f2d4b286))
* chunk Ruby files by method, singleton method, class and module ([e46a15a](https://github.com/Ardit175/repolens/commit/e46a15a2e438111ff1922adad1d77bd46673c619))
* extract imports and calls from PHP files into the symbol graph ([9e0ef81](https://github.com/Ardit175/repolens/commit/9e0ef81b15110d59cc69c37505f601a7a136782b))
* extract require imports and calls from Ruby files into the symbol graph ([8c603dd](https://github.com/Ardit175/repolens/commit/8c603dd8d3fb4b2d6cd9ade1f2bb9a2542e96811))
* PHP chunking and symbol graph ([eae04ea](https://github.com/Ardit175/repolens/commit/eae04ea558b4ac89d8c9f5620501131be8784338))
* Ruby chunking and symbol graph ([5683386](https://github.com/Ardit175/repolens/commit/568338604de1639ff03e71e27d0e2dfcd3da6518))

## [0.2.0](https://github.com/Ardit175/repolens/compare/repolens-v0.1.0...repolens-v0.2.0) (2026-10-31)


### Features

* chunk Rust files by function, impl method, trait, struct, enum and type ([3bbda41](https://github.com/Ardit175/repolens/commit/3bbda41fc260330ee82c8817caedaa31ae3c52ec))
* extract imports and calls from Rust files into the symbol graph ([97fac5f](https://github.com/Ardit175/repolens/commit/97fac5f524b270a11a87f05808e96b8a18198f43))
* Rust chunking and symbol graph ([5cabcdf](https://github.com/Ardit175/repolens/commit/5cabcdf43f1ad4e09b050db3febdc97f3fde22d7))

## 0.1.0 (2026-10-28)


### Features

* add embedding providers for Azure OpenAI and local transformers.js ([972f905](https://github.com/Ardit175/repolens/commit/972f90542a078bea6eb0999eb101ef70d9f75db3))
* add find_references and call_graph MCP tools ([6fb4eb8](https://github.com/Ardit175/repolens/commit/6fb4eb8412fbd24cf3436bb262ba4855926330fc))
* add findChunks lookup by path and name to the vector store ([312e0a6](https://github.com/Ardit175/repolens/commit/312e0a68a7112900cf4fa98ffca8edf61ac9fcfd))
* add gitignore-aware file walker ([2be8e0a](https://github.com/Ardit175/repolens/commit/2be8e0a079e38f061a49ced08415a3c7b52e986a))
* add Go chunking and symbol graph ([0b97c24](https://github.com/Ardit175/repolens/commit/0b97c24ad21593dcffaef41f5fddd68d75da4f80))
* add in-memory and Qdrant graph stores with a shared contract test ([2c5ecf1](https://github.com/Ardit175/repolens/commit/2c5ecf14b229cca10cd5b1debab50370497881e9))
* add incremental indexer that re-embeds only changed files ([ca5d73a](https://github.com/Ardit175/repolens/commit/ca5d73ae78f59b811b506e6bf9fd8f04b9fbe5bf))
* add MCP server (repolens serve) with four code tools ([ecfe194](https://github.com/Ardit175/repolens/commit/ecfe194bb070117f0264235ef2e16489b970641f))
* add MCP server with search_code, get_symbol, list_files and file_context ([c0cc688](https://github.com/Ardit175/repolens/commit/c0cc68865bd1855d29805226b9b15158aef46767))
* add repolens bench and docs folder ([2ee7a74](https://github.com/Ardit175/repolens/commit/2ee7a74d3d7d23e71627862ce6a123f0390740d5))
* add repolens bench for index time, search latency and recall ([9070c7f](https://github.com/Ardit175/repolens/commit/9070c7f21d40823f64352280a3b07dc154ba5f93))
* add repolens index command ([499869b](https://github.com/Ardit175/repolens/commit/499869b2986ac45d733058e0bbd96359f4da7454))
* add repolens map command ([991a4fa](https://github.com/Ardit175/repolens/commit/991a4fa4de1d56f9472b9d801bc571b8fbd0f6ab))
* add repolens map, an interactive HTML dependency graph ([cdc5d06](https://github.com/Ardit175/repolens/commit/cdc5d068c540d9b13a5f366c625ea04ef6eb5f74))
* add repolens serve command and a stdio contract test ([aae9e27](https://github.com/Ardit175/repolens/commit/aae9e27bf75c8a203e92b8a9a5cf6927f14cde24))
* add search, runtime config and doctor checks ([db990da](https://github.com/Ardit175/repolens/commit/db990daacb2466350cd893035797425308df4ef0))
* add symbol graph types and GraphStore interface ([22c9289](https://github.com/Ardit175/repolens/commit/22c9289d00671dfe97d8a3b65da4414d0b10c971))
* add vector store interface with in-memory and Qdrant backends ([0970cc0](https://github.com/Ardit175/repolens/commit/0970cc0452962a1c610cbe244e40f8f2577edff3))
* build a file dependency map from the index and render it as self-contained HTML ([cf01a50](https://github.com/Ardit175/repolens/commit/cf01a50f4bddb3c50e3ee4cfbf183ee957d9bb42))
* chunk Go files by function, method, struct, interface and type ([d2f4546](https://github.com/Ardit175/repolens/commit/d2f4546b751f47e20b0e4f5f5bbd3b4e4cac9fa6))
* chunk Java files by class, interface, enum, record and method ([5c80eb1](https://github.com/Ardit175/repolens/commit/5c80eb1bbb5c8eb70aa9ddeaf683a7cd3f2f04f3))
* chunk Python and C# files by symbol ([97ab7f9](https://github.com/Ardit175/repolens/commit/97ab7f9ebe4982514fffee744937c77cd937381d))
* chunk Python and C# files by symbol ([00b57e6](https://github.com/Ardit175/repolens/commit/00b57e63ff9ee250f0561a55cd76f5c03f12f789))
* chunk TS/JS files by symbol (M2) ([a8acd5a](https://github.com/Ardit175/repolens/commit/a8acd5a6570dec2d710441ccd56400cf6832d9fb))
* chunk TS/JS files by symbol with fallback windows ([85c58e0](https://github.com/Ardit175/repolens/commit/85c58e03643fc3c037a03d6c1dc7ed84ad630c97))
* detect language by extension and shebang ([658dfc0](https://github.com/Ardit175/repolens/commit/658dfc0cd5c709b65fea97cd98e1cb3c33510043))
* embedding providers and vector store (M3 part 1) ([a57dbf3](https://github.com/Ardit175/repolens/commit/a57dbf3e8bade5a3bf8fcc561d9609ef2b982de7))
* extract imports and call references for TS/JS, Python and C# ([ee41a89](https://github.com/Ardit175/repolens/commit/ee41a8989c0bf92edc7cc251aec354e2e1805ff8))
* extract imports and calls from Go files into the symbol graph ([ec9f22d](https://github.com/Ardit175/repolens/commit/ec9f22d4dd72d7dc7113964f166e75d9ce66581b))
* extract imports and calls from Java files into the symbol graph ([eb218c4](https://github.com/Ardit175/repolens/commit/eb218c4819bed8a8feedbdb6483452d029b70836))
* incremental index, search and doctor commands ([27c6494](https://github.com/Ardit175/repolens/commit/27c64948848a9704a0a43dff8d11430d90978b40))
* Java chunking and symbol graph ([c8a593f](https://github.com/Ardit175/repolens/commit/c8a593ffbe0bbc3062584bacd7787e25d088d597))
* keep the symbol graph in step with the index and wire it into the CLI ([b6f2804](https://github.com/Ardit175/repolens/commit/b6f2804b48bbc82cfa73b5700b43543feedfddae))
* M1 scaffold with index command, walker and CI ([e9c2437](https://github.com/Ardit175/repolens/commit/e9c243760d048875b73e51f122024d2bdf354599))
* symbol graph with find_references and call_graph tools ([35d10d9](https://github.com/Ardit175/repolens/commit/35d10d9fa946ae427ac2477e289bf72c927ef9c5))
* wire index, search and doctor commands into the CLI ([9a55432](https://github.com/Ardit175/repolens/commit/9a554327446d4a3f55b4fb8d55b2906f9c98d4d5))


### Bug Fixes

* pass GITHUB_TOKEN to gitleaks so pull requests can be scanned ([be8c3ca](https://github.com/Ardit175/repolens/commit/be8c3ca0d0584621d65694e29a3aeb9a5b6aef03))
* pass GITHUB_TOKEN to the PR title check ([21e1874](https://github.com/Ardit175/repolens/commit/21e1874cbeb284017046cd38e9e269757e5aa078))

## Changelog

## Unreleased
- 2026-10-27: M8: Go chunking (functions, methods with receiver parent, structs, interfaces, types) and Go imports and calls in the symbol graph.
- 2026-10-25: M8 finished: Java chunking (classes, records, interfaces, enums, methods, constructors) and Java imports and calls in the symbol graph.
- 2026-10-24: M7 start: `repolens bench` (index time, search latency, Recall@k, MRR) and a docs/ folder covering configuration, providers, MCP tools and benchmark method.
- 2026-10-23: M6 finished: `repolens map` writes a self-contained interactive HTML graph of files and their imports (zoom, pan, search, language filter, neighbour panel).
- 2026-10-21: M5 finished: import and call extraction for TS/JS, Python and C#, an incrementally updated symbol graph in Qdrant, and the `find_references` and `call_graph` MCP tools.
- 2026-10-19: M4 finished: `repolens serve` MCP server with `search_code`, `get_symbol`, `list_files` and `file_context`, in-process and stdio contract tests, setup docs.
- 2026-10-16: M3 almost finished: incremental `repolens index` (only changed files are re-embedded, deleted files removed), `repolens search` with path and language filters, `repolens doctor`, `.env.example`.
- 2026-10-14: M3 start: `EmbeddingProvider` with Azure OpenAI and local transformers.js (auto selection, batching, retry with backoff), and `VectorStore` with in-memory and Qdrant backends.
- 2026-10-12: M2 finished: Python and C# symbol chunking (classes, structs, records, methods, nested types, namespaces) with fixtures and tests.
- 2026-10-09: M2 start: web-tree-sitter parser layer, TS/TSX/JS/JSX symbol chunking with metadata and hashes, line-window fallback chunking.
- 2026-10-07: Pre-commit hook, release-please workflow and docker-compose for Qdrant.
- 2026-10-05: M1 scaffold: TypeScript tooling, `repolens index`, gitignore-aware walker, language detection, CI and security workflows.
- 2026-10-05: Project plan, working rules and decisions added.
