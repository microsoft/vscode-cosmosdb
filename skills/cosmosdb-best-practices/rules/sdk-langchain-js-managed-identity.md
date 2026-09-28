---
title: Use Managed Identity for JS/TS LangChain Cosmos DB Integration
impact: CRITICAL
impactDescription: zero-secret authentication eliminates credential leakage risk
tags: sdk, javascript, typescript, langchain, security, managed-identity
---

## Use Managed Identity for JS/TS LangChain Cosmos DB Integration

**Impact: CRITICAL (zero-secret authentication eliminates credential leakage risk)**

In production JavaScript/TypeScript applications using `@langchain/azure-cosmosdb`, always authenticate with `DefaultAzureCredential` from `@azure/identity` instead of connection strings. Connection strings contain master keys that grant full access — if leaked, they compromise the entire account. Managed identity provides automatic credential rotation and least-privilege access via RBAC roles.

**Incorrect (connection string in production):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

// BAD: Connection string contains master key — full account access if leaked
const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  connectionString: process.env.COSMOS_CONNECTION_STRING,
  databaseName: "mydb",
  containerName: "vectors",
});
```

**Correct (endpoint + DefaultAzureCredential):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { DefaultAzureCredential } from "@azure/identity";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

// GOOD: No secrets in code or config; works with system/user-assigned managed identity
const credential = new DefaultAzureCredential();
const store = new AzureCosmosDBNoSQLVectorStore(embeddings, {
  endpoint: process.env.COSMOS_ENDPOINT, // e.g., "https://myaccount.documents.azure.com:443/"
  credential,
  databaseName: "mydb",
  containerName: "vectors",
});
```

**Required RBAC setup:** Assign the `Cosmos DB Built-in Data Contributor` role to your app's managed identity:

```bash
az cosmosdb sql role assignment create \
  --account-name myaccount \
  --resource-group myrg \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id <managed-identity-object-id> \
  --scope "/"
```

**Note:** When using RBAC, the database and container must be pre-created (via Bicep, Terraform, or CLI) — the SDK cannot create resources with data-plane-only permissions.

Reference: [Azure Cosmos DB RBAC with Azure Identity](https://learn.microsoft.com/azure/cosmos-db/nosql/security/how-to-grant-data-plane-role-based-access)
