---
title: Configure Full-Text Prerequisites Before JS/TS LangChain Hybrid Search
impact: HIGH
impactDescription: full-text and hybrid queries fail at runtime without container-level configuration
tags: sdk, javascript, typescript, langchain, full-text-search, hybrid, container-setup
---

## Configure Full-Text Prerequisites Before JS/TS LangChain Hybrid Search

**Impact: HIGH (full-text and hybrid queries fail at runtime without container-level configuration)**

Before using `FullTextSearch`, `Hybrid`, or `HybridScoreThreshold` search types with `AzureCosmosDBNoSQLVectorStore` in JavaScript/TypeScript, you must configure three things on your Cosmos DB container: (1) enable the full-text search capability on the account, (2) define a `fullTextPolicy` specifying which properties to index and their language, and (3) add `fullTextIndexes` entries to the indexing policy. Without all three, queries will fail with opaque errors.

**Incorrect (attempting hybrid search on unconfigured container):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

// Container created with only vector embedding policy — no full-text config
const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",
  containerName: "docs",
});

// FAILS: "Full-text search is not enabled" or similar runtime error
const results = await store.similaritySearch("query", 10, {
  searchType: "Hybrid",
});
```

**Correct (container configured with full-text policy and indexes):**

First, configure the container (via ARM/Bicep/Terraform or CLI):

```json
{
  "containerProperties": {
    "id": "docs",
    "partitionKey": { "paths": ["/tenantId"], "kind": "Hash" },
    "fullTextPolicy": {
      "defaultLanguage": "en-US",
      "fullTextPaths": [
        { "path": "/content", "language": "en-US" },
        { "path": "/title", "language": "en-US" }
      ]
    },
    "indexingPolicy": {
      "includedPaths": [{ "path": "/*" }],
      "excludedPaths": [{ "path": "/embedding/*" }],
      "fullTextIndexes": [
        { "path": "/content" },
        { "path": "/title" }
      ],
      "vectorIndexes": [
        { "path": "/embedding", "type": "diskANN" }
      ]
    },
    "vectorEmbeddingPolicy": {
      "vectorEmbeddings": [
        {
          "path": "/embedding",
          "dataType": "float32",
          "distanceFunction": "cosine",
          "dimensions": 1536
        }
      ]
    }
  }
}
```

Then use hybrid search in your application:

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { DefaultAzureCredential } from "@azure/identity";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential: new DefaultAzureCredential(),
  databaseName: "mydb",
  containerName: "docs",  // container has fullTextPolicy + fullTextIndexes
});

// Now hybrid search works — combines vector similarity with BM25 keyword matching
const results = await store.similaritySearch("specific keyword plus semantic meaning", 10, {
  searchType: "Hybrid",
});
```

**Checklist before enabling full-text/hybrid search:**
1. Account has full-text search capability enabled (`az cosmosdb update --capabilities EnableNoSQLFullTextSearch`)
2. Container has `fullTextPolicy` with paths and languages defined
3. Container indexing policy has `fullTextIndexes` for the same paths
4. Container has `vectorEmbeddingPolicy` and `vectorIndexes` (for hybrid)

Reference: [Azure Cosmos DB Full-Text Search](https://learn.microsoft.com/azure/cosmos-db/nosql/query/full-text-search)
