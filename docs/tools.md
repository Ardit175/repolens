# MCP tools

`repolens serve` registers six read-only tools. All of them return text. A missing symbol or file comes back as an MCP error result (not a protocol error), so the model can read the message and try something else.

| Tool              | Arguments                                                                       | Returns                                                                  |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `search_code`     | `query`; optional `limit` (1-20, default 5), `path`, `language`                 | Closest chunks with location, symbol, score and a code preview           |
| `get_symbol`      | `name` (`Class.method` works); optional `path`                                  | Full code of each matching function, method, class or type               |
| `list_files`      | optional `path` prefix, `limit` (default 200, max 1000)                         | Indexed files                                                            |
| `file_context`    | `path`                                                                          | An outline of the file's symbols, then their code                        |
| `find_references` | `name`; optional `limit` (1-200, default 50)                                    | Every import of and call to the name, with file, line and calling symbol |
| `call_graph`      | `name`; optional `direction` (`callers` or `callees`), `depth` (1-5, default 2) | An indented tree of callers or callees, with a cycle guard               |

## Limits

- `find_references` and `call_graph` match by name as written at the call site. repolens does not resolve types or modules, so two unrelated functions with the same name are reported together. The output says so.
- `call_graph` shows at most 25 nodes per level.
- Tools read what was indexed, not the files on disk. Re-run `repolens index` after code changes.
