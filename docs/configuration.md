# Configuration

repolens reads all settings from environment variables (see `.env.example`). Nothing secret is stored in the repo.

| Variable                            | Meaning                                                                                                                            | Default |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `QDRANT_URL`                        | Qdrant REST URL, e.g. `http://localhost:6333`. Required by every command except `index --dry-run` and `bench` (without `--qdrant`) | none    |
| `QDRANT_API_KEY`                    | API key for a secured Qdrant                                                                                                       | none    |
| `REPOLENS_EMBEDDINGS`               | `auto`, `azure` or `local` (see [providers](providers.md))                                                                         | `auto`  |
| `AZURE_OPENAI_ENDPOINT`             | Azure OpenAI resource URL                                                                                                          | none    |
| `AZURE_OPENAI_API_KEY`              | Azure OpenAI key                                                                                                                   | none    |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Deployment name of `text-embedding-3-small`                                                                                        | none    |

The vector index lives in the Qdrant collection `repolens` and the symbol graph in `repolens_graph`. Start Qdrant with `docker compose up -d qdrant`.

## Commands

| Command                                  | What it does                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `repolens doctor`                        | Checks Node, Qdrant and the embedding configuration. Exits 1 if a check fails            |
| `repolens index <path>`                  | Chunks and embeds a directory, re-embedding only changed files and removing deleted ones |
| `repolens index <path> --dry-run`        | Only walks the directory and counts files per language (no Qdrant, no embeddings)        |
| `repolens search "<query>"`              | Semantic search; `-n` result count, `--path` prefix filter, `--language` filter          |
| `repolens serve`                         | Serves the index over MCP on stdio                                                       |
| `repolens map`                           | Writes a self-contained HTML dependency map; `-o` output file, `--path` prefix filter    |
| `repolens bench <path> --queries <file>` | Index time, search latency and recall (see [benchmarks](benchmarks.md))                  |

`index --max-file-size <bytes>` skips larger files (default 1 MiB). The walker respects nested `.gitignore` files and skips binary files.

## Supported languages

TypeScript, TSX, JavaScript and JSX, Python, C#, Java and Go are chunked per function, method and class, and their imports and calls go into the symbol graph. Other text files are split into 60-line windows and are searchable but have no graph edges.
