# Embedding providers

| Provider | Model                                            | Dimensions | Needs                                         |
| -------- | ------------------------------------------------ | ---------- | --------------------------------------------- |
| `azure`  | Azure OpenAI `text-embedding-3-small` deployment | 1536       | the three `AZURE_OPENAI_*` variables          |
| `local`  | `Xenova/all-MiniLM-L6-v2` via transformers.js    | 384        | nothing; the model is downloaded on first use |

`REPOLENS_EMBEDDINGS=auto` (the default) uses Azure when all three Azure variables are set and the local model otherwise. `azure` fails with the list of missing variables, and `local` never calls the network after the model download.

Both providers send texts in batches and retry rate-limit and server errors with backoff.

**One index, one provider.** A Qdrant collection is created with the provider's dimension count. Switching between Azure (1536) and local (384) against the same collection fails with a dimension mismatch error. Use a fresh Qdrant volume (`docker compose down -v`) when you switch.

Tests never call a paid API. The Azure provider is tested with a fake `fetch`, and there is one opt-in smoke test, `RUN_SMOKE=1 npx vitest run src/embeddings/smoke.test.ts`, that needs the Azure variables.
