# MCP tools

`repolens serve` registers nine read-only tools. All of them return text. A missing symbol or file comes back as an MCP error result (not a protocol error), so the model can read the message and try something else.

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
