---
title: Correctly Initialize AzureCosmosDBNoSQLVectorStore in JavaScript/TypeScript
impact: HIGH
impactDescription: prevents runtime connection failures and misconfigured vector stores
tags: sdk, javascript, typescript, langchain, vector-search, initialization
---

## Correctly Initialize AzureCosmosDBNoSQLVectorStore in JavaScript/TypeScript

**Impact: HIGH (prevents runtime connection failures and misconfigured vector stores)**

When using `@langchain/azure-cosmosdb` in JavaScript/TypeScript, initialize `AzureCosmosDBNoSQLVectorStore` with either a connection string (development) or endpoint + `DefaultAzureCredential` (production). The target database and container must already exist when using RBAC/managed identity — the SDK will not auto-create them. Always pass the embedding model instance at construction time.

**Incorrect (missing embedding model, relying on auto-create with RBAC):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

// BAD: No embedding model provided — store cannot generate vectors
const store = new AzureCosmosDBNoSQLVectorStore({
  connectionString: process.env.COSMOS_CONNECTION_STRING,
  databaseName: "mydb",
  containerName: "vectors",
});

// BAD: With RBAC, database/container must pre-exist — SDK cannot create them
const store2 = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  databaseName: "nonexistent-db",
  containerName: "nonexistent-container",
});
```

**Correct (connection string for development):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  connectionString: process.env.COSMOS_CONNECTION_STRING,
  databaseName: "mydb",
  containerName: "vectors",
});
```

**Correct (managed identity for production — database/container pre-created):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { DefaultAzureCredential } from "@azure/identity";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

const credential = new DefaultAzureCredential();
const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",       // must already exist
  containerName: "vectors",   // must already exist with vector policy
});
```

Reference: [LangChain.js Azure Cosmos DB Integration](https://js.langchain.com/docs/integrations/vectorstores/azure_cosmosdb_nosql/)
