# Benchmarks

`repolens bench` indexes a directory into a throwaway in-memory store, runs a set of questions and prints a markdown table with:

- index time and the number of files and chunks
- search latency (p50 and p95, which includes embedding the query)
- Recall@k: the share of questions with an expected file among the top k hits
- MRR: the mean of 1/rank of the first expected file

```bash
repolens bench ./some-repo --queries queries.json -n 5 --label "some-repo @ <commit>"
```

`queries.json` is a list of questions with the files that answer them:

```json
[
  { "query": "where do we parse the request body?", "expect": ["lib/body-parser.js"] },
  { "query": "how are routes matched?", "expect": ["lib/router/index.js", "lib/router/layer.js"] }
]
```

Without `--qdrant` nothing touches your Qdrant index, and the embedding provider comes from `REPOLENS_EMBEDDINGS` as usual. With `--qdrant` the run uses (and writes to) the configured collection, which also measures Qdrant latency.

Numbers depend on the embedding provider, so always record which one was used.

## Results

No real-repository run is recorded yet. It needs an embedding provider, and the cloud build environment has neither the Azure variables nor access to download the local model. Run the command above on an open-source repository and paste the output here.
