---
title: Use AzureCosmosDBNoSQLSemanticCache for LLM Cost Reduction in JS/TS
impact: MEDIUM
impactDescription: reduces LLM API costs and latency by caching semantically similar queries
tags: sdk, javascript, typescript, langchain, caching, vector-search, cost-optimization
---

## Use AzureCosmosDBNoSQLSemanticCache for LLM Cost Reduction in JS/TS

**Impact: MEDIUM (reduces LLM API costs and latency by caching semantically similar queries)**

When building LLM-powered applications with LangChain.js, use `AzureCosmosDBNoSQLSemanticCache` to cache LLM responses in Cosmos DB. Unlike exact-match caches, semantic cache uses vector similarity to return cached responses for queries that are semantically similar (not just identical). This reduces LLM API costs for repeated or paraphrased queries and cuts response latency from seconds to milliseconds.

**Incorrect (no caching — every request hits the LLM):**

```typescript
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  azureOpenAIApiDeploymentName: "gpt-4o",
});

// BAD: Every call pays full LLM cost, even for repeated/similar questions
const response1 = await model.invoke("What is Azure Cosmos DB?");
const response2 = await model.invoke("Tell me about Azure Cosmos DB"); // Pays again
```

**Incorrect (exact-match cache misses paraphrased queries):**

```typescript
import { InMemoryCache } from "langchain/cache";

const model = new ChatOpenAI({
  azureOpenAIApiDeploymentName: "gpt-4o",
  cache: new InMemoryCache(), // Only matches exact string — misses paraphrases
});
```

**Correct (semantic cache with Cosmos DB):**

```typescript
import { AzureCosmosDBNoSQLSemanticCache } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
  azureOpenAIApiVersion: "2024-06-01",
});

const cache = new AzureCosmosDBNoSQLSemanticCache(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",
  containerName: "semantic-cache",
  similarityScoreThreshold: 0.8, // Only return cache hits above 80% similarity
});

const model = new ChatOpenAI({
  azureOpenAIApiDeploymentName: "gpt-4o",
  cache, // Semantically similar queries return cached responses
});

// Second call with paraphrased question hits cache — no LLM API call
const response1 = await model.invoke("What is Azure Cosmos DB?");
const response2 = await model.invoke("Tell me about Azure Cosmos DB"); // Cache hit!
```

**Container requirements:** The cache container needs a vector embedding policy configured for the embedding dimension (e.g., 1536 for text-embedding-3-small). Use TTL on the container to auto-expire stale cache entries.

Reference: [LangChain.js Azure Cosmos DB Semantic Cache](https://js.langchain.com/docs/integrations/llm_caching/azure_cosmosdb_nosql/)
