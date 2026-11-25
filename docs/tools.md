# MCP tools

`repolens serve` registers eleven read-only tools. All of them return text. A missing symbol or file comes back as an MCP error result (not a protocol error), so the model can read the message and try something else.

| Tool                | Arguments                                                                                                 | Returns                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `search_code`       | `query`; optional `limit` (1-20, default 5), `path`, `language`, `mode`                                   | Closest chunks with location, symbol, score and a code preview                                           |
| `get_symbol`        | `name` (`Class.method` works); optional `path`                                                            | Full code of each matching function, method, class or type                                               |
| `list_files`        | optional `path` prefix, `limit` (default 200, max 1000)                                                   | Indexed files                                                                                            |
| `file_context`      | `path`                                                                                                    | An outline of the file's symbols, then their code                                                        |
| `find_references`   | `name`; optional `limit` (1-200, default 50)                                                              | Every import of and call to the name, with file, line and calling symbol                                 |
| `call_graph`        | `name`; optional `direction` (`callers` or `callees`), `depth` (1-5, default 2)                           | An indented tree of callers or callees, with a cycle guard                                               |
| `file_dependencies` | `path`; optional `direction` (`imports`, `importers` or `both`, default `both`), `depth` (1-5, default 1) | The files it imports and the files that import it, each with line and module; its unresolved imports     |
| `change_impact`     | `path`; optional `symbol`, `depth` (1-5, default 1)                                                       | The files that import it and the files that call its symbols, grouped as direct, transitive or name-only |
| `affected_tests`    | `paths` (1-50); optional `depth` (1-5, default 3)                                                         | The test files to run after changing those files, each with the reasons it was picked                    |
| `unused_symbols`    | optional `path` prefix, `language`, `include_tests`                                                       | Functions and methods that no call and no named import refers to: likely dead code                       |
| `index_status`      | none                                                                                                      | Index name, embedding provider, counts, watcher state and warnings                                       |

## file_dependencies

Takes a `path` relative to the indexed root, for example `src/auth.ts`. It walks the import links between indexed files outward from that file, breadth first: `imports` follows what the file imports, `importers` follows what imports it, and `both` (the default) does both. `depth` sets how many levels to follow in each direction (1 to 5, default 1).

Each file is listed once, at its smallest depth. A file reached more than one level away shows the file it was reached via. Every import line shows the line number and the module specifier as written. The file's own imports that match no indexed file are listed under unresolved imports, with their line numbers. Each level shows at most 100 files; when files are left out, the level is marked truncated.

Links come from the same path-based resolvers as `repolens map`. Packages, C# namespaces and Swift modules are not linked, so their imports appear as unresolved.

```text
src/a.ts
Imports (2):
  src/b.ts  line 1  './b'
  src/c.ts  line 2  './c'  (depth 2 via src/b.ts)
Imported by (1):
  src/main.ts  line 3  './a'
Unresolved imports (1): react (line 4)
Imports resolve by path only; packages, C# namespaces and Swift modules are not linked.
```

An unknown path is an error result. The message suggests indexed paths with the same file name, so the model can retry with the right one.

The same output is available from the terminal with `repolens deps <file> [--direction imports|importers|both] [--depth 1..5] [--json] [--index <name>]`.

## change_impact

Takes a `path` relative to the indexed root, for example `src/db.ts`, and answers what a change to that file can reach. Importers come from the same links as `file_dependencies`, followed up to `depth` levels (1 to 5, default 1). Call sites come from the symbol graph: for each symbol defined in the file, every call to that name in another file. Pass `symbol` (`name` or `Class.method`) to look at one symbol only.

Each affected file is listed once, with its link: `direct import`, `transitive` (with its depth and the file it was reached via) or `name-only caller`. Name-only callers call a symbol of the file by name without importing it. Call targets are stored as names only, so these may be unrelated functions that share a name. Files are ordered direct, transitive, then name-only, then by number of call sites, then by path. At most 100 files are listed and at most 1000 calls are read per symbol; when either limit is hit the output is marked truncated.

```text
src/db.ts
Symbols (1):
  openDatabase (function) lines 1-3  2 call sites
Affected files (2): 1 direct importer, 0 transitive, 1 name-only caller; 2 call sites
  src/auth.ts  direct import
    line 3  openDatabase  in AuthService.login
  scripts/seed.py  name-only caller
    line 2  openDatabase  in seed_database
Links resolve by import path; name-only callers match by symbol name and may be unrelated.
```

An unknown path or a symbol that the file does not define is an error result. The message suggests similar paths, or lists the symbols of the file.

The same output is available from the terminal with `repolens impact <file> [--symbol <name>] [--depth 1..5] [--json] [--index <name>]`.

## affected_tests

Takes `paths`, one to 50 changed files relative to the indexed root, for example `["src/auth.ts"]`, and answers which test files to run. `depth` sets how many import levels to follow (1 to 5, default 3). Every test is listed once with the reasons it was picked:

- **changed**: the test file is one of the changed paths.
- **imports**: the test imports a changed file directly, or through other files up to `depth` levels (the output names the file it was reached via).
- **calls**: the test calls a symbol defined in a changed file. A test that does not import the file is marked as a name-only caller, because call targets are stored as names only and it may be unrelated. When the changed file is itself a test, name-only callers are skipped, because test helpers such as `write` or `run` share names across test files.
- **name**: the test is named after a changed file. Among tests with the same name and language, only those sharing the most leading directories with the changed file are kept, so a common name such as `index` does not match tests all over the repository.

A path is a test when its file name follows a convention (`foo.test.ts`, `foo.spec.js`, `test_foo.py`, `foo_test.py`, `foo_test.go`, `foo_spec.rb`, `foo_test.rb`, `test_foo.rb`, `foo_test.rs`, `foo_test.c`, `foo_test.cc`, `foo_test.cpp`, `test_foo.c`, `FooTest.java`, `FooTests.cs`, `FooSpec.scala`, and the same for `.kt`, `.swift` and `.php`) or when it sits in a `__tests__`, `tests`, `test` or `spec` directory. Files under `fixtures`, `__fixtures__`, `testdata` and `__snapshots__` are never tests.

Tests are ordered by their strongest reason: changed, then a direct import or a direct (non-name-only) caller, then a name match, then a transitive import, then a name-only caller. Ties go to the test with more reasons, then to the path. At most 200 tests are listed, and the output says when it is cut or when an impact lookup left links out because of a limit.

```text
Changed (1): src/auth.ts
Tests to run (1):
  src/auth.test.ts
    imports src/auth.ts directly
    makes 1 call into src/auth.ts
Picked by import links, call sites (matched by name) and test file naming conventions.
```

An unknown path, an empty or too long `paths` list and a `depth` outside 1 to 5 are error results. The message for an unknown path suggests indexed paths with the same file name.

The same output is available from the terminal with `repolens tests <files...> [--depth 1..5] [--json] [--index <name>]`. `repolens tests --changed [ref] [--root <path>]` takes the changed files from git instead of the arguments: the working tree (staged, unstaged and untracked files) against `HEAD`, or against the merge base of `ref` and `HEAD`, so a branch's own commits count but newer commits on `ref` do not. Paths are relative to `--root` (default `.`), which should be the indexed root. Changed files that are not indexed are listed under `Skipped` instead of failing; with no changes it prints `No changed files compared to <ref>.` and more than 50 changed files is an error.

Every importer and caller is considered before the list is filtered to tests, so the 100-file cap of `change_impact` never hides a test file.

## unused_symbols

Takes no required arguments and lists the functions and methods that nothing in the index calls or imports by name, as candidates for dead code. `path` (a directory prefix such as `src/`) and `language` (such as `typescript`) limit which symbols are reported; usage is always counted across the whole index, so a function in `src/` called from `scripts/` is not listed. `include_tests` (default false) also reports symbols defined in test files; calls made from test files count as uses either way.

A symbol is used when any call edge or any named import has its name as the target. A call from inside the symbol itself does not count, so a function that only calls itself is listed. Because matching is by name only, a same-named method of another class counts as a use, while dynamic dispatch, reflection, callbacks passed by reference and callers outside the index are invisible. Read the list as candidates and check before deleting.

Names that a framework or the language calls implicitly are never listed: `main`, `constructor`, `init`, `deinit`, `__init__` and other Python dunders, `toString`, `equals`, `hashCode`, `String`, `Error`, `ServeHTTP`, `setUp`, `tearDown`, and Go `TestXxx`, `BenchmarkXxx` and `ExampleXxx` functions. Symbols are ordered by path then line, and at most 200 are listed; the output says when it is cut.

```text
Unused symbols (2) of 14 functions and methods checked:
  scripts/seed.py:1-2  function  seed_database
  src/auth.ts:5-7  method  AuthService.logout
Matched by name: a symbol called only through dynamic dispatch, reflection, callbacks passed by reference or from outside the index shows up here too, so check before deleting.
```

The same output is available from the terminal with `repolens unused [--path <prefix>] [--language <lang>] [--include-tests] [--json] [--index <name>]`.

## index_status

Takes no arguments. It summarises the index the server answers from: the index name, the embedding provider and its dimensions, the vector size stored in Qdrant, file and chunk counts, file and chunk counts per language (`other` when the language is unknown), the number of files in the symbol graph, and whether `serve --watch` keeps the index fresh with its pass count and last pass time. Use it to check that the index is not empty before searching, or to see whether a watcher is running.

Warnings appear when the index is empty, when the stored vector size does not match the current provider, or when the watcher's last pass failed.

```text
Index: web
Embeddings: local (384 dimensions)
Stored vectors: 384 dimensions
Files: 412 (5230 chunks)
Languages: typescript 298 files / 3914 chunks, markdown 22 files / 402 chunks, other 92 files / 914 chunks
Symbol graph: 310 files
Watching: /home/me/code/web, 4 passes, last pass 12s ago (2026-11-18T10:14:02.311Z)
```

The same summary is available from the terminal with `repolens status [--index <name>] [--json]`. The terminal version always prints `Watching: no`, because it cannot see a running watcher. It exits with code 0 even when there are warnings.

## Limits

- `search_code` is hybrid by default: identifiers in the query (camelCase, snake_case, `Class.method`, or a one-word query) are matched against symbol names exactly and ranked first, then the semantic hits follow. Pass `mode: "semantic"` for vector similarity only. A name-only hit has no score and is marked `name match`.

- `find_references` and `call_graph` match by name as written at the call site. repolens does not resolve types or modules, so two unrelated functions with the same name are reported together. The output says so.
- `call_graph` shows at most 25 nodes per level.
- Tools read what was indexed, not the files on disk. Re-run `repolens index` after code changes, or start the server with `repolens serve --watch <path>` to re-index automatically.
