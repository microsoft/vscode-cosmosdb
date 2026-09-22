---
title: Enable Full-Text Search Capability on Account
impact: HIGH
impactDescription: prerequisite — FTS SQL functions fail without it
tags:
  - fts
  - full-text-search
  - configuration
  - account
  - setup
---

## Enable Full-Text Search Capability on Account

**Impact: HIGH (prerequisite — FTS SQL functions fail without it)**

Full-text search is an opt-in account-level capability. The SQL functions `FullTextContains`, `FullTextContainsAll`, `FullTextContainsAny`, and `FullTextScore` all return an error if this capability is not enabled.

**Incorrect (capability absent — FTS queries fail at runtime):**

```sql
-- This query fails with "Function 'FullTextContains' is not supported"
-- when EnableNoSQLFullTextSearch capability is missing on the account
SELECT * FROM c WHERE FullTextContains(c.description, 'cosmos')
```

**Correct — enable via Azure CLI:**

```bash
az cosmosdb update \
  --resource-group <rg> \
  --name <account-name> \
  --capabilities EnableNoSQLFullTextSearch
```

**Correct — enable via Bicep (account resource):**

```bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  properties: {
    // ... other properties ...
    capabilities: [
      { name: 'EnableNoSQLFullTextSearch' }
    ]
  }
}
```

> **Note:** As of Bicep type library v0.41, `fullTextIndexes` and `fullTextPolicy` may emit `BCP037` warnings. Suppress with `#disable-next-line BCP037` — the properties are valid at the ARM REST API level.

Reference: [Full-text search in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/gen-ai/full-text-search)
