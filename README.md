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
npm run dev -- watch <path>               # index once, then re-index changed files while you edit
npm run dev -- map -o repolens-map.html   # interactive dependency map, open it in a browser
```

- `search` is hybrid by default: code-like words in the query (`parseConfig`, `load_settings`, `AuthService.login`, or a single word such as `login`) are looked up by exact symbol name and those chunks come first, then the closest chunks by meaning. Results found by name say `name match`. `--semantic` turns the name lookup off.
- `index` re-embeds only files whose chunks changed and removes files that were deleted. `--dry-run` just summarises files by language without Qdrant or embeddings.
- `watch` runs the same incremental pass once, then reruns it a short moment after files change (`--debounce <ms>`, default 300). Changes in paths the indexer skips (`.git`, `node_modules` and anything matched by a `.gitignore`) do not start a pass. A failed pass prints an error and keeps watching. If the file watcher itself fails, it is restarted up to three times; after that the command prints the error and exits with code 1, so `serve --watch` never keeps serving a stale index silently. Stop it with Ctrl+C.
- Embeddings use Azure OpenAI when `AZURE_OPENAI_*` is set, otherwise a local model that needs no key (the first run downloads it). Force one with `REPOLENS_EMBEDDINGS=azure|local`.

- `map` writes one self-contained HTML file (no network needed to view it) with a zoomable graph of files and their imports. Search by path, filter by language, click a file to see what it imports and what imports it. `--path src/` limits it to a directory. Imports are linked by path for TS/JS, Python (`from pkg import mod` links to `pkg/mod.py` when that file exists), C/C++ (`#include`), Ruby (`require`), PHP (`use` and `require`), Java/Kotlin/Scala (class paths under any source root), Go (packages of modules declared in an indexed `go.mod`) and Rust (`crate::`, `self::` and `super::` paths). Third-party packages, standard libraries, C# namespaces and Swift modules are counted as unresolved, not drawn.

- `deps <file>` lists the indexed files a file imports and the files that import it, with the line and module of each import (`--direction imports|importers|both`, `--depth 1..5` default 1, `--json`). It uses the same path-based links as `map`, so packages, C# namespaces and Swift modules are not linked.

- `impact <file>` shows what a change to a file, or to one symbol of it (`--symbol <name>`), can reach: the files that import it up to `--depth 1..5` (default 1) and the files that call its symbols, grouped as direct, transitive and name-only callers (`--json`). Name-only callers match by symbol name and may be unrelated.

- `tests <files...>` lists the test files to run after changing files: tests that import a changed file up to `--depth 1..5` (default 3), call its symbols, are named after it (`foo.test.ts`, `test_foo.py`, `FooTest.java`, `foo_test.go`) or are changed themselves, each with the reasons (`--json`). Name-only callers match by symbol name and may be unrelated. With `--changed` the files come from git instead: the working tree against `HEAD`, or with `--changed main` against the merge base with `main`, plus untracked files; `--root <path>` (default `.`) is the indexed root, and changed files that are not indexed (docs, config) are listed as skipped.

- `unused` lists functions and methods that nothing in the index calls or imports by name, as candidates for dead code (`--path <prefix>`, `--language <lang>`, `--include-tests`, `--json`). Usage is counted across the whole index, test files are skipped unless `--include-tests` (their calls still count), and entry points and implicit methods such as `main`, constructors and `__init__` are never listed. Matching is by name only, so check before deleting.

- `orphans` lists source files that no other indexed file imports, as dead-file candidates, with how many imports each makes (`--path <prefix>`, `--language <lang>`, `--include-tests`, `--json`). Test files and entry points such as `main`, `index`, `cli`, `bin/` and `scripts/` files are left out. Imports resolve by path, so files reached through packages, namespaces or framework conventions can show up.
- `cycles` lists groups of files that import each other in a ring, each with one shortest import loop and its lines, largest first, at most 50 (`--path <prefix>` keeps cycles that touch a file under it, `--json`). Imports resolve by path, so packages, C# namespaces and Swift modules are not linked.

- `bench <path> --queries <file>` measures index time, search latency and recall on a question set, without touching your index (see docs/benchmarks.md). More detail is in [docs/](docs/README.md).

### Several repositories

Each index name has its own pair of Qdrant collections, so indexing a second repository does not delete the first one, and a different embedding provider can use its own index. Pick the index with `--index <name>` on `index`, `search`, `watch`, `serve`, `map` and `bench --qdrant`, or with `REPOLENS_INDEX`. Without either, the name is `repolens`.

```bash
npm run dev -- index ~/code/web --index web
npm run dev -- search "where is the cart total computed?" --index web
npm run dev -- indexes                    # every index, with chunk and file counts
npm run dev -- status --index web         # one index: counts, languages, embeddings, warnings (--json for raw output)
npm run dev -- deps src/auth.ts --index web --depth 2   # what src/auth.ts imports and what imports it (--json for raw output)
npm run dev -- impact src/auth.ts --symbol AuthService.login --depth 2   # who is affected by a change (--json for raw output)
npm run dev -- tests src/auth.ts src/db.ts --depth 2   # which tests to run after a change (--json for raw output)
npm run dev -- tests --changed main --index web        # the same for every file changed on this branch
npm run dev -- drop web --yes             # deletes the index and its graph
```

To serve one index to an MCP client, pass the same name to `serve`:

```bash
claude mcp add web --env QDRANT_URL=http://localhost:6333 -- npx -y @ardit175/repolens serve --index web
```

## Use with an MCP client

`repolens serve` exposes the index over stdio. It needs the same `QDRANT_URL` (and embedding variables) as `search`, and an index built with `repolens index`. Add `--watch <path>` (for example `repolens serve --watch .`) to index that directory first and keep the index fresh while the server runs. Progress goes to stderr so the MCP stream on stdout stays clean.

| Tool                | What it does                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_code`       | Hybrid search; arguments `query`, optional `limit` (1-20), `path`, `language`, `mode` (`hybrid` or `semantic`)                                                                                                 |
| `get_symbol`        | Code of a function, method, class or type by exact name (`AuthService.login` works); optional `path`                                                                                                           |
| `list_files`        | Indexed files, optionally under a `path` prefix, with a `limit`                                                                                                                                                |
| `file_context`      | One file as an outline of its symbols followed by their code                                                                                                                                                   |
| `find_references`   | Every import of and call to a name, with file, line and calling symbol; optional `limit` (1-200)                                                                                                               |
| `call_graph`        | Callers or callees of a function as an indented tree; `direction` (`callers` default, `callees`), `depth` (1-5, default 2)                                                                                     |
| `change_impact`     | Files that import a file (up to `depth` levels) and files that call its symbols, grouped as direct, transitive and name-only callers; optional `symbol`, `depth` (1-5, default 1)                              |
| `file_dependencies` | Files a file imports and files that import it, with line and module of each import; `direction` (`imports`, `importers` or `both`, default `both`), `depth` (1-5, default 1)                                   |
| `affected_tests`    | Test files to run after changing `paths` (1-50): tests that import a changed file (up to `depth` levels), call its symbols, are named after it or are changed, with reasons; optional `depth` (1-5, default 3) |
| `unused_symbols`    | Functions and methods no call or named import refers to (likely dead code, matched by name); optional `path` prefix, `language`, `include_tests`                                                               |
| `import_cycles`     | Groups of files that import each other in a ring, each with a shortest import loop; optional `path` prefix                                                                                                     |
| `unimported_files`  | Source files no other indexed file imports (likely dead files, resolved by path); optional `path` prefix, `language`, `include_tests`                                                                          |
| `index_status`      | Index name, embedding provider, file and chunk counts, watcher state and warnings (no arguments)                                                                                                               |

`find_references` and `call_graph` match by name only. repolens does not resolve types or modules, so two unrelated functions with the same name are reported together.

Claude Code:

```bash
claude mcp add repolens --env QDRANT_URL=http://localhost:6333 -- npx -y @ardit175/repolens serve
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "repolens": {
      "command": "npx",
      "args": ["-y", "@ardit175/repolens", "serve"],
      "env": { "QDRANT_URL": "http://localhost:6333" }
    }
  }
}
```

The package is not on npm yet (see M7), so until then build it (`npm run build`) and use `"command": "node", "args": ["/path/to/repolens/dist/cli.js", "serve"]`. The server writes only protocol messages to stdout; errors go to stderr.

## Status

M1 to M2 are done (walker, language detection, chunking for TS/JS, Python and C#). M8 adds Java, Go, Rust, Ruby, PHP, Kotlin, Swift, C, Scala and C++ chunking and symbol graph. M3 is done except the opt-in Azure smoke test: embeddings, Qdrant storage, incremental `index`, `search` and `doctor`. M4 adds `repolens serve` with the MCP tools. M5 adds the symbol graph and the `find_references` and `call_graph` tools. M6 adds `repolens map`. M7 (polish) has the docs folder and the `bench` command; the real-repository benchmark, demo GIF and npm publish are still open.
