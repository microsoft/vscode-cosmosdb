---
title: Prevent Filter Injection in JS/TS LangChain Vector Store Queries
impact: CRITICAL
impactDescription: prevents NoSQL injection attacks that can exfiltrate or corrupt data
tags: sdk, javascript, typescript, langchain, security, injection, vector-search
---

## Prevent Filter Injection in JS/TS LangChain Vector Store Queries

**Impact: CRITICAL (prevents NoSQL injection attacks that can exfiltrate or corrupt data)**

When passing filter clauses to `AzureCosmosDBNoSQLVectorStore` similarity searches, **never** concatenate user input directly into the filter string. Cosmos DB NoSQL queries support parameterized queries with `@param` placeholders — always use these to safely inject user-provided values. Concatenated filters allow attackers to manipulate query logic, bypass tenant isolation, or extract unauthorized data.

**Incorrect (string concatenation — SQL injection vulnerability):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

async function searchByCategory(store: AzureCosmosDBNoSQLVectorStore, userInput: string) {
  // CRITICAL VULNERABILITY: User can inject arbitrary SQL predicates
  // e.g., userInput = "electronics' OR c.secret != '"
  const results = await store.similaritySearch("find products", 10, {
    filter: `c.category = '${userInput}'`,
  });
  return results;
}

// Also BAD: Template literals are just string concatenation
async function searchByTenant(store: AzureCosmosDBNoSQLVectorStore, tenantId: string) {
  const results = await store.similaritySearch("query", 10, {
    filter: `c.tenantId = "${tenantId}"`,  // STILL INJECTABLE
  });
  return results;
}
```

**Correct (parameterized queries with @param placeholders):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

async function searchByCategory(store: AzureCosmosDBNoSQLVectorStore, userInput: string) {
  // SAFE: Parameters are escaped by the SDK — no injection possible
  const results = await store.similaritySearch("find products", 10, {
    filter: "c.category = @category",
    filterParams: [{ name: "@category", value: userInput }],
  });
  return results;
}

async function searchByTenant(store: AzureCosmosDBNoSQLVectorStore, tenantId: string) {
  // SAFE: Multi-tenant isolation with parameterized filter
  const results = await store.similaritySearch("query", 10, {
    filter: "c.tenantId = @tenantId AND c.isActive = true",
    filterParams: [{ name: "@tenantId", value: tenantId }],
  });
  return results;
}

// Multiple parameters
async function searchFiltered(
  store: AzureCosmosDBNoSQLVectorStore,
  category: string,
  minPrice: number
) {
  const results = await store.similaritySearch("query", 10, {
    filter: "c.category = @category AND c.price >= @minPrice",
    filterParams: [
      { name: "@category", value: category },
      { name: "@minPrice", value: minPrice },
    ],
  });
  return results;
}
```

**Why this matters:** In multi-tenant RAG applications, filter injection can bypass tenant isolation. An attacker providing `tenantA' OR '1'='1` as a tenant ID would access all tenants' data if the filter is concatenated.

Reference: [Azure Cosmos DB Parameterized Queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/parameterized-queries)
