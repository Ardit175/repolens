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

## 2026-10-21 M5 symbol graph
- Built: import and call extraction for TS/JS, Python and C#; a graph store (in-memory and Qdrant) updated per file only when its edge set changes; `find_references` and `call_graph` MCP tools (callers or callees, depth limit, cycle guard); README and ARCHITECTURE updated. M5 is complete.
- Next: M6 `repolens map` (interactive HTML graph). The Release workflow permission question is still open under Needs Ardit, and the Azure smoke test still needs a run with the key. The real-Qdrant graph test runs first in CI.
- Design decision: graph edges store the name written at the call site and are matched by name, with no type resolution. Real resolution needs a language server per language, while name matching is cheap, works on all three languages and is honest about its limits, so the tool output says matches are by name only.
- LinkedIn: repolens can now answer who calls a function and what a function calls, so an AI assistant can follow code across files instead of only searching it.

## 2026-10-23 M6 map
- Built: `repolens map` writes a self-contained interactive HTML graph of files and their imports (zoom, pan, search, language filter, click a file to see what it imports and what imports it); `buildMapData` resolves imports to indexed files; tested in a real browser with 60 and 1500 nodes. M6 is complete.
- Next: M7 polish (docs folder, benchmark on a real repo, demo GIF, npm publish setup, which needs an NPM_TOKEN). The Release workflow permission question is still open under Needs Ardit, and the Azure smoke test still needs a run with the key.
- Design decision: imports are linked to files by matching paths against the indexed file list only, never by touching disk or guessing at packages. That keeps the map identical whether or not the source checkout is present, and imports it cannot place are counted and shown as unresolved instead of silently drawn wrong.
- LinkedIn: repolens can now draw your codebase as an interactive map of which files import which, in a single HTML file you can open anywhere.

## 2026-10-24 M7 bench and docs
- Built: `repolens bench` (index time, search latency p50/p95, Recall@k, MRR from a JSON question file, in-memory store by default, `--qdrant` to include Qdrant); a docs/ folder with configuration, providers, MCP tools and benchmark method; README and ARCHITECTURE updated.
- Next: run the benchmark on a real repo (blocked on an embedding provider, see Needs Ardit), npm publish setup (needs NPM_TOKEN), demo GIF, then M8 Java. The Release workflow permission question is still open.
- Design decision: the benchmark scores a hit by file path, not by chunk. Chunk boundaries change whenever the chunker improves, so a chunk-level score would make old and new results incomparable, while a file-level score stays meaningful across versions.
- LinkedIn: repolens can now measure how well its own search finds the right file for a set of questions, so changes to the search can be judged by numbers instead of by feel.

## 2026-10-25 M8 Java
- Built: Java chunking (classes, records, interfaces, enums, methods, constructors, nested types, Javadoc and annotations included) and Java imports and calls in the symbol graph, with a fixture and tests. `find_references`, `call_graph` and `search` now work on Java repos.
- Next: still blocked on the Needs Ardit items (Release permission, embedding provider for the real-repo benchmark, NPM_TOKEN for publish, demo GIF). After those, new languages such as Go.
- Design decision: Java reuses the C# adapter's shape instead of a shared generic walker. The two grammars name nodes differently, so a generic walker would need a config table that is harder to read than two short files, and each adapter stays easy to test on its own.
- LinkedIn: repolens now understands Java projects too, so an AI assistant can search them and follow who calls what.

## 2026-10-27 M8 Go
- Built: Go chunking (functions, methods tied to their receiver type, structs, interfaces, aliases and grouped type blocks, doc comments included) and Go imports and calls in the symbol graph, with a fixture and tests. Recorded Ardit's answers and added a new Needs Ardit item: the cloud network policy blocks the Azure host.
- Next: blocked on the Needs Ardit items (allow `*.openai.azure.com` for the smoke test and real-repo benchmark, NPM_TOKEN for publish, demo GIF). After those, another language such as Rust.
- Design decision: Go methods are declared outside their type, so the Go adapter does not shorten the type chunk the way the Java and C# adapters do. Each method becomes its own chunk with the receiver type as parent, which keeps `get_symbol` and `call_graph` lookups working the same as in the other languages.
- LinkedIn: repolens now reads Go projects too, so an AI assistant can search them and follow who calls what.

## 2026-10-28 release pin
- Built: nothing new to build, every open PLAN item is blocked on Needs Ardit (Azure network policy, NPM_TOKEN, demo GIF). The release PR (#13) proposed 1.0.0 from 0.0.0, so I pinned the first release to 0.1.0 with `release-as` in the release-please config. Merging the updated release PR cuts v0.1.0.
- Next: merge the updated release PR, remove `release-as`, then Rust once the blocked items clear.
- Design decision: pin the version with `release-as` instead of editing the manifest by hand. The manifest is release-please's own state, and a config pin is removed in one line once the first release exists.
- LinkedIn: repolens is ready for its first tagged release, with a changelog written from the commit history.

## 2026-10-29
- Built: cut the v0.1.0 release. Merged the release-please PR after running the full check locally (bot-opened PRs get no CI), and fixed the format check so release-please's manifest no longer fails it. Removed the `release-as` pin from the release config.
- Next: the remaining M7 items all need Ardit (Azure network policy for the benchmark and smoke test, an npm token for publishing) or a recorded demo GIF.
- Design decision: PRs opened by the default GITHUB_TOKEN do not trigger workflows, so the release PR shows no checks. Rather than merge it blind, I ran `npm run check` against its branch, which caught a Prettier failure that would have turned main red after the merge, and fixed it first.
- LinkedIn: Shipped v0.1.0 of repolens, an MCP server that gives LLMs search and a symbol graph over a codebase, with chunking for TypeScript, Python, C#, Java and Go.

## 2026-10-31 M8 Rust
- Built: Rust chunking (functions, impl and trait-impl methods, structs, enums, traits, type aliases, doc comments and attributes included) and Rust `use` imports and calls in the symbol graph, with a fixture and tests. Added a Needs Ardit item for the npm token.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test and real-repo benchmark, NPM_TOKEN for publish, demo GIF). After those, another language such as Ruby or PHP.
- Design decision: Rust methods live in `impl` blocks apart from the type, so, like Go, the adapter leaves the struct chunk whole and emits each method with the implemented type as its parent. A trait impl and an inherent impl are treated the same, so `get_symbol` finds `Circle.area` no matter which block defines it.
- LinkedIn: repolens now reads Rust projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-01 M8 Ruby
- Built: merged the open release PR (v0.2.0) after a local full check, then added Ruby chunking (classes, modules, methods, singleton methods, comments included) and Ruby `require` imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as PHP.
- Design decision: a Ruby class chunk stops before its first method or its first nested class, not just the first method. A module that only wraps nested classes would otherwise embed every nested class a second time, which skews search results.
- LinkedIn: repolens now reads Ruby projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-02 M8 PHP
- Built: PHP chunking (classes, interfaces, traits, enums, methods, functions, comments included) and PHP `use`/`require` imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as Kotlin.
- Design decision: PHP built-ins like `count` and `array_map` are filtered out of the call edges. They appear in nearly every file, so keeping them would bury the calls to the project's own functions in `find_references` results.
- LinkedIn: repolens now reads PHP projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-04 M8 Kotlin
- Built: merged the open release PR (v0.3.0), then added Kotlin chunking (classes, enum classes, interfaces, objects, companion objects, functions, methods, KDoc included) and Kotlin imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as Swift or Scala.
- Design decision: the Kotlin grammar attaches a comment to whichever node ends just before it, so a KDoc block can sit inside the previous import. Instead of trusting `previousSibling`, the chunker maps comment end rows to start rows across the whole tree and walks upward from each declaration.
- LinkedIn: repolens now reads Kotlin projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-05 M8 Swift
- Built: Swift chunking (classes, structs, enums, actors, protocols, extensions, functions, methods, init and deinit, doc comments and attributes included) and Swift imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as Scala or C.
- Design decision: Swift uses one grammar node for class, struct, enum, actor and extension, so the chunker tells them apart by the keyword child. An extension is named after the type it extends, which lets `get_symbol` find methods added in an extension next to the ones in the original type.
- LinkedIn: repolens now reads Swift projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-06 M8 C
- Built: merged the open release PR (v0.4.0) after a local full check, then added C chunking (functions, structs, unions, enums, typedef'd types, comments included) and C `#include` imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as Scala or C++.
- Design decision: `typedef struct {...} Name;` has no tag, so the chunker names it after the typedef, the name code actually uses. The `.h` extension maps to C only; guessing C versus C++ from file content would be unreliable, so C++ waits for its own adapter.
- LinkedIn: repolens now reads C projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-08 M8 Scala
- Built: Scala chunking (classes, case classes, traits, objects, package objects, methods, scaladoc included) and Scala imports and calls in the symbol graph, with a fixture and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). After those, another language such as C++.
- Design decision: the bundled Scala grammar cannot parse Scala 3 `enum`, and it turns the broken part into an ERROR node. Guessing line ranges from an ERROR node would produce wrong chunks, so enums are left out and the limit is written down instead of shipping a half version.
- LinkedIn: repolens now reads Scala projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-09 M8 C++
- Built: merged the open release PR (v0.5.0) after a local full check, then added C++ chunking (functions, classes, structs, unions, enums, templates, in-class and out-of-class methods, comments included) and C++ includes and calls in the symbol graph, with fixtures and tests.
- Next: still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN, demo GIF). No unblocked items remain in PLAN.md.
- Design decision: a method defined outside its class (`Box::get`) is chunked as its own method with the class as parent, instead of being merged into the class chunk. C++ splits declaration and definition across files, so this keeps `get_symbol` pointing at the real body and keeps the class chunk small.
- LinkedIn: repolens now reads C++ projects too, so an AI assistant can search them and follow who calls what.

## 2026-11-12 M9 Map import resolution
- Built: `repolens map` now draws import links for C/C++, Ruby, PHP, Java/Kotlin/Scala, Go and Rust, not just TS/JS and Python. Resolution moved into per-language resolvers (`src/map/resolve.ts`, `src/map/resolve-modules.ts`) with unit tests, plus an end-to-end test that indexes a small multi-language repo and checks every link.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test and real-repo benchmark, NPM_TOKEN for publish). The demo GIF can follow once a real embedding provider is reachable, so it shows real search results.
- Design decision: Go imports are resolved through the module path in `go.mod`, read back from the index, instead of matching the last path segments against folder names. Matching by suffix would link `github.com/x/log` to any local `log` folder by accident; with the module path, standard library and third-party imports simply never match.
- LinkedIn: The repolens dependency map now links files across nine more languages, so a Go, Rust or Java project shows its real structure instead of a cloud of unconnected dots.

## 2026-11-13 M10 Watch mode
- Built: merged the release PR (v0.7.0) after a local full check, then added `repolens watch <path>` and `repolens serve --watch <path>`. A debounced watcher (`src/watch.ts`) reruns the incremental index pass when files change, so `search_code` and the graph tools stay current while you edit. Unit tests drive a fake watcher; one test uses the real `fs.watch` with the real indexer.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). Without those, a useful next slice is hybrid search that boosts exact identifier matches.
- Design decision: the watcher does not try to re-index only the file named in the event. It reruns the whole incremental pass, which already skips files whose chunks did not change. File events are unreliable (editors save through temp files and renames, and some platforms give no filename), so reusing the one tested code path is simpler and always correct, at the cost of re-reading files.
- LinkedIn: repolens can now watch a project while you code and update its index on every save, so an AI assistant always searches the current version of your code.

## 2026-11-14 M10 Hybrid search
- Built: merged the release PR (v0.8.0) after a local full check, then made search hybrid. Identifiers in a query (`parseConfig`, `load_settings`, `AuthService.login`, or a one-word query) are looked up by exact symbol name and ranked ahead of the semantic hits in `repolens search`, the `search_code` MCP tool and `repolens bench`. `--semantic` (CLI), `mode: "semantic"` (MCP) and `bench --mode` switch it off, so both modes can be compared on the same questions.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). With a provider reachable, the first real benchmark can record hybrid and semantic side by side.
- Design decision: name matches are put first by a fixed rule rather than blended with vector scores through reciprocal rank fusion. Fusion would let a strong semantic hit outrank the exact function the caller named, and its scores are hard to explain in the output. The fixed rule keeps the real cosine score where there is one and labels the rest `name match`, so the output says why each result is there.
- LinkedIn: repolens search now finds a function first when you type its name, and still falls back to search by meaning for plain-language questions.

## 2026-11-16 M10 Review fixes
- Built: fixed the three review findings and finished M10. Hybrid search now filters exact-name lookups by path, language and `Class.method` parent inside the store, so a match within `--path` is no longer cut off when a name occurs in more than 20 places. Watch mode skips `node_modules` and gitignored paths using the walker's own rules, and a failed file watcher is restarted with a catch-up pass, up to three times, before `watch` and `serve --watch` exit with code 1. The Qdrant integration tests ran locally against a real Qdrant for the first time.
- Next: cut v0.9.0 for M10. The remaining M3 and M7 items are still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish).
- Design decision: when the file watcher fails for good, `serve --watch` exits instead of logging and carrying on. A server that keeps answering from an index that silently stopped updating gives an AI assistant wrong answers with no sign that anything is wrong, while a stopped server is noticed and restarted. The watcher first retries three times, so a single hiccup does not kill the session.
- LinkedIn: I fixed three bugs a code review found in repolens, including one where watch mode could quietly stop updating the index and keep serving old code.

## 2026-11-17 M10 Named indexes
- Built: named indexes. `--index <name>`, then `REPOLENS_INDEX`, then the default `repolens` picks a pair of Qdrant collections (`<name>` for chunks, `<name>_graph` for the graph) for `index`, `search`, `watch`, `serve`, `map` and `bench --qdrant`. `repolens indexes` lists them with chunk, file and dimension counts, and `repolens drop <name> --yes` deletes one. Before this, indexing a second repository deleted the first one's chunks, and switching embedding provider meant wiping the Qdrant volume.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). Without those, cut the next release and consider an index_status MCP tool so a model can see which index it is talking to.
- Design decision: each index gets its own collection pair instead of a repository field in one shared collection. The indexer's stale-path cleanup and the vector size both work per collection, so separate collections keep repositories and providers apart without changing the store or the indexer.
- LinkedIn: repolens can now keep several projects in one Qdrant instance under separate names, so indexing one project no longer wipes another.

## 2026-11-18 M10 Index status
- Built: merged the release PR (v0.10.0), then added the `index_status` MCP tool and `repolens status [--json]`. Both show which index is in use, the embedding provider and stored vector size, file, chunk and per-language counts and the symbol graph size. They also warn about an empty index, a vector size that no longer matches the provider, or a failed watcher pass. Under `serve --watch` the tool also reports how many passes ran and when the last one finished. A missing graph collection now reads as empty instead of failing.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). Without those, a useful next slice is showing the index name and freshness in `search_code` results when the index looks stale.
- Design decision: the status is computed from the stores every time it is asked for, instead of saving counts and a timestamp as index metadata after each pass. Saved metadata can drift from the real data when a pass fails halfway or someone drops a collection, while counting on request is always right. The only state kept in memory is the watcher's own pass history, because no store knows it.
- LinkedIn: repolens now has an index_status tool, so an AI assistant can check which project it is searching, how big the index is and whether it is up to date before it trusts the answers.

## 2026-11-20 M11 File dependencies
- Built: merged the release PR (v0.11.0) after a local full check, then added the `file_dependencies` MCP tool and `repolens deps <file>`. They list which indexed files a file imports and which files import it, up to five levels, with the line and module of each import, the file each one was reached through, and the file's own unresolved imports. The map's import resolution moved into a shared `loadFileLinks` so both features use the same links. Checked end to end against a real Qdrant on repolens's own source.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). A useful next slice is a `symbol_outline` style view or an impact summary that combines file dependencies with call references.
- Design decision: the dependency tool reuses the exact resolution code behind the map instead of writing a second, simpler lookup. Two resolvers would sooner or later disagree, and a model would then see a link on the map that the tool denies. Moving the shared part into `loadFileLinks` first, as a pure refactor with the map tests unchanged, made the new feature a thin breadth-first walk on top.
- LinkedIn: repolens can now tell an AI assistant which files depend on the one it is about to change, so it can check the impact before editing.

## 2026-11-21 M11 Change impact
- Built: merged the release PR (v0.12.0) after a local full check against a real Qdrant, then added the `change_impact` MCP tool and `repolens impact <file>`. For a file, or one symbol in it with `--symbol`, they list the files that import it (direct or transitive, up to five levels) and every call to its symbols from other files, with line and enclosing function. Callers are grouped as direct importers, transitive importers and name-only callers, ordered by how many calls they make.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). A useful next slice is a `symbol_outline` view or using the impact data to suggest which test files to run after a change.
- Design decision: a caller whose file does not import the changed file is shown as "name-only" instead of being dropped. The graph matches calls by name, so such a caller may be an unrelated function with the same name, but dropping them would hide real callers in Go packages and C# namespaces where no import is ever visible. Labelling the confidence lets the model decide instead of the tool guessing.
- LinkedIn: repolens can now tell an AI assistant which files and call sites a change to a function will touch, and how sure it is about each one.

## 2026-11-22 M11 Affected tests
- Built: merged the release PR (v0.13.0) after a local full check against a real Qdrant, then added the `affected_tests` MCP tool and `repolens tests <files...>`. Given the changed files, they list the test files to run and why each was picked: it is changed itself, imports a changed file (directly or through other files), calls its symbols, or is named after it (`foo.test.ts`, `test_foo.py`, `FooTest.java`, `foo_test.go` and more). Checked end to end on repolens's own source in a real Qdrant. Dependency and impact lookups can now reuse file links that are already loaded, so ten changed files cost one load instead of ten.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). A useful next slice is a `symbol_outline` view of a file or directory, or taking the changed files straight from `git diff`.
- Design decision: a name match on a common file name like `index.ts` keeps only the tests closest to the changed file by directory. Without that rule, changing `src/api/index.ts` would pick every `index.test.ts` in the repository, and a long list of wrong tests is worse than a short list, because the model stops trusting it. Import and call links are not limited this way, since they are real references.
- LinkedIn: repolens can now tell an AI assistant which test files to run after a change, and why each one is on the list.

## 2026-11-24 M11 Tests from git
- Built: merged the release PR (v0.14.0) after a local full check against a real Qdrant. Fixed the review finding in affected tests: they now read every importer and caller before filtering to test files, so a widely imported file no longer loses the tests that sort after the first 100 files. Added `repolens tests --changed [ref]`, which takes the changed files from git (against `HEAD`, or against the merge base with a branch such as `main`, plus untracked files) and lists changed files that are not indexed as skipped. Checked end to end on repolens's own source in a real Qdrant.
- Next: still blocked on Ardit (allow `*.openai.azure.com` for the smoke test, real-repo benchmark and demo GIF; NPM_TOKEN for publish). The next item is the new review finding about noisy name-only reasons when a changed file is a test, then a `symbol_outline` view.
- Design decision: with a ref, the changed files are the diff against the merge base of that ref and `HEAD`, not against the ref itself. Diffing against `main` directly would count every commit that landed on `main` since the branch started as a change on this branch. The merge base gives the same file list a pull request shows, which is what a developer expects.
- LinkedIn: repolens can now read the changed files straight from git and tell you which tests to run for your branch.

## 2026-11-25 M11 Unused symbols
- Built: fixed the open review item, so `repolens tests --changed` no longer lists other tests just because they share helper names like `write` with a changed test. Then added the `unused_symbols` MCP tool and `repolens unused`, which list functions and methods that nothing in the index calls or imports by name. Self-calls do not count, test files are skipped unless asked for, and names that frameworks call on their own (`main`, constructors, Python dunders, Go `TestXxx`) are never listed.
- Next: merge the release PR. The M3 smoke test and the M7 items are still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN). Without those, a next navigation step could be listing indexed files that nothing imports.
- Design decision: the unused check looks only at functions and methods, not classes. The symbol graph stores calls and imports but not type references, so a class used only as a type annotation would look unused, and the list would fill with false positives that teach people to ignore it.
- LinkedIn: repolens can now point an AI assistant at functions nothing calls, which is a quick first pass when cleaning up dead code.

## 2026-11-26 M11 Import cycles
- Built: the `import_cycles` MCP tool and `repolens cycles [--path] [--json]`. They find groups of indexed files that import each other in a ring, directly or through other files, and show each group with one shortest import loop and the line and module of every import in it, largest group first. Checked end to end against a real Qdrant: repolens's own source has no cycles, and a small TypeScript and Python repo with planted cycles reports both rings with the right lines.
- Next: merge the release PR (v0.16.0). Then fix the Python resolver gap found during the check (`from pkg import mod` with `pkg/mod.py` only links to `pkg/__init__.py`). The M3 smoke test and the M7 items are still blocked on Ardit (allow `*.openai.azure.com`, NPM_TOKEN).
- Design decision: the tool reports each strongly connected component once, with one shortest loop, instead of listing every cycle. Ten files that all import each other contain a huge number of distinct cycles, and listing them would bury the answer; the component says which files are tangled and the shortest loop gives one concrete import to cut. Tarjan's algorithm runs in linear time and is written with an explicit stack so very long import chains cannot overflow the call stack.
- LinkedIn: repolens can now show an AI assistant which files import each other in a circle, with the exact import lines to look at when untangling them.
