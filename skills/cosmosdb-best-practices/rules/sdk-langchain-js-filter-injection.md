---
title: Prevent Filter Injection in JS/TS LangChain Vector Store Queries
impact: CRITICAL
impactDescription: prevents NoSQL injection attacks that can exfiltrate or corrupt data
tags: sdk, javascript, typescript, langchain, security, injection, vector-search
---

## Prevent Filter Injection in JS/TS LangChain Vector Store Queries

**Impact: CRITICAL (prevents NoSQL injection attacks that can exfiltrate or corrupt data)**

When passing filter clauses to `AzureCosmosDBNoSQLVectorStore` similarity searches, **never** concatenate user input directly into the filter string. Cosmos DB NoSQL queries support parameterized queries with `@param` placeholders — always use these to safely bind user-provided values. Concatenated filters allow attackers to manipulate query logic, bypass tenant isolation, or extract unauthorized data.

Pass a `SqlQuerySpec` through `filterClause`, with a `query` beginning with `WHERE` and a `parameters` array. The examples use the default `metadataKey` (`metadata`), so custom document fields are accessed through `c.metadata`. The API does not accept separate `filter` or `filterParams` options.

**Incorrect (string concatenation — SQL injection vulnerability):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

async function searchByCategory(store: AzureCosmosDBNoSQLVectorStore, userInput: string) {
  // CRITICAL VULNERABILITY: User can inject arbitrary SQL predicates
  // e.g., userInput = "electronics' OR '1'='1"
  const results = await store.similaritySearch("find products", 10, {
    filterClause: `WHERE c.metadata.category = '${userInput}'`,
  });
  return results;
}

// Also BAD: Template literals are just string concatenation
async function searchByTenant(store: AzureCosmosDBNoSQLVectorStore, tenantId: string) {
  const results = await store.similaritySearch("query", 10, {
    filterClause: `WHERE c.metadata.tenantId = "${tenantId}"`,  // STILL INJECTABLE
  });
  return results;
}
```

**Correct (parameterized queries with @param placeholders):**

```typescript
import { AzureCosmosDBNoSQLVectorStore } from "@langchain/azure-cosmosdb";

async function searchByCategory(store: AzureCosmosDBNoSQLVectorStore, userInput: string) {
  // SAFE: User input is bound as a value, not part of the SQL text
  const results = await store.similaritySearch("find products", 10, {
    filterClause: {
      query: "WHERE c.metadata.category = @category",
      parameters: [{ name: "@category", value: userInput }],
    },
  });
  return results;
}

async function searchByTenant(store: AzureCosmosDBNoSQLVectorStore, tenantId: string) {
  // SAFE: Bind the authenticated tenant ID as a value
  const results = await store.similaritySearch("query", 10, {
    filterClause: {
      query: "WHERE c.metadata.tenantId = @tenantId AND c.metadata.isActive = true",
      parameters: [{ name: "@tenantId", value: tenantId }],
    },
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
    filterClause: {
      query: "WHERE c.metadata.category = @category AND c.metadata.price >= @minPrice",
      parameters: [
        { name: "@category", value: category },
        { name: "@minPrice", value: minPrice },
      ],
    },
  });
  return results;
}
```

**Why this matters:** In multi-tenant RAG applications, filter injection can bypass tenant isolation. An attacker providing `tenantA" OR "1"="1` as a tenant ID can turn the concatenated tenant predicate above into an always-true condition. Parameterization keeps that input a literal value. It does not replace authorization: derive the tenant ID from trusted authentication context, not an unchecked caller-supplied value.

Reference: [Azure Cosmos DB Parameterized Queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/parameterized-queries)
