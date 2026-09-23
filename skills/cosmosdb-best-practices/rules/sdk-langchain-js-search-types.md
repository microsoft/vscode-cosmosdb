---
title: Choose the Correct Search Type for JS/TS LangChain Vector Store
impact: HIGH
impactDescription: selecting wrong search type returns irrelevant results or causes errors
tags: sdk, javascript, typescript, langchain, vector-search, full-text-search, hybrid
---

## Choose the Correct Search Type for JS/TS LangChain Vector Store

**Impact: HIGH (selecting wrong search type returns irrelevant results or causes errors)**

The `@langchain/azure-cosmosdb` package supports multiple search types via `AzureCosmosDBNoSQLVectorStore`. Choose the appropriate type based on your retrieval needs. Using full-text or hybrid search requires pre-configured `fullTextPolicy` and `fullTextIndexes` on the container — otherwise queries will fail at runtime.

| Search Type | Use Case | Requires Full-Text Config |
|---|---|---|
| `Vector` | Pure semantic similarity (default) | No |
| `VectorScoreThreshold` | Semantic with minimum relevance cutoff | No |
| `FullTextSearch` | Keyword/BM25 matching only | Yes |
| `Hybrid` | Vector + full-text combined (RRF fusion) | Yes |
| `HybridScoreThreshold` | Hybrid with minimum score cutoff | Yes |

**Incorrect (using hybrid search without full-text configuration):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",
  containerName: "vectors", // container has NO fullTextPolicy configured
});

// BAD: Will fail — container doesn't have full-text indexes
const results = await store.similaritySearch("query", 10, {
  searchType: "Hybrid",
});
```

**Correct (vector search — no special container config needed):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",
  containerName: "vectors",
});

// Pure vector similarity search
const results = await store.similaritySearch("semantic query", 5);

// With score threshold — only return results above 0.7 similarity
const filtered = await store.similaritySearchWithScore("semantic query", 10, {
  searchType: "VectorScoreThreshold",
  scoreThreshold: 0.7,
});
```

**Correct (hybrid search — container has fullTextPolicy and fullTextIndexes):**

```typescript
// Container must have fullTextPolicy and fullTextIndexes configured FIRST
const results = await store.similaritySearch("keyword and semantic query", 10, {
  searchType: "Hybrid",
});
```

Reference: [LangChain.js Azure Cosmos DB NoSQL Vector Store](https://js.langchain.com/docs/integrations/vectorstores/azure_cosmosdb_nosql/)
