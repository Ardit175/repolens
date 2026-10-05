# Architecture

repolens is a codebase indexing system designed to prepare source code for LLM consumption. It extracts code symbols, embeds them, and serves them through an MCP server.

## Modules

- **cli**: Command-line interface (entry point, built on commander)
- **walker**: Traverses directories and identifies code files (respects .gitignore)
- **language**: Detects language and extracts symbols using tree-sitter
- **chunker**: Breaks code into meaningful chunks (M2)
- **embeddings**: Converts text to vectors via Azure OpenAI or local transformers.js (M2)
- **store**: Vector database interface with Qdrant backend and in-memory implementation (M2)
- **mcp**: MCP server that exposes search and navigation to LLMs (M3)
- **graph**: Symbol graph for fast code navigation (M3)

## Data Flow

```mermaid
graph LR
  Files[Files on disk]
  Walker[Walker]
  Language[Language<br/>Detection & Parse]
  Chunker[Chunker]
  Embeddings[Embeddings<br/>Azure OpenAI /<br/>transformers.js]
  Store[Vector Store<br/>Qdrant]
  MCP[MCP Server]
  LLM[LLM Queries]

  Files -->|Directory traversal| Walker
  Walker -->|Code files| Language
  Language -->|Symbols & AST| Chunker
  Chunker -->|Code chunks| Embeddings
  Embeddings -->|Vectors| Store
  Store -->|Search & lookup| MCP
  MCP -->|Results| LLM
```
