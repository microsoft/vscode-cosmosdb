---
title: Disable Local Authentication (Keys)
impact: CRITICAL
impactDescription: eliminates credential leakage risk
tags: security, authentication, keys, entra-id
---

## Disable Local Authentication (Keys)

**Impact: CRITICAL (eliminates credential leakage risk)**

Disable local authentication (shared keys and connection strings) on your Cosmos DB account. Keys are bearer tokens — anyone who has one can read, modify, or delete all data. If a key leaks, the only option is to regenerate it and update every dependent system. Disabling keys forces all access through Entra ID, eliminating this entire class of risk.

**Incorrect (using connection string with keys):**

```csharp
// WRONG: Connection string contains a master key
// If this leaks via source control, logs, or config, all data is exposed
var connectionString = "AccountEndpoint=https://myaccount.documents.azure.com:443/;AccountKey=abc123...==;";
var client = new CosmosClient(connectionString);

// Risks:
// - Key in source control (even in .env files that get committed)
// - Key in CI/CD logs or screenshots
// - Key shared across teams with no audit trail
// - No way to attribute access to a specific identity
// - Rotation requires updating every system simultaneously
```

**Correct (disable keys, use Entra ID exclusively):**

```bash
# Disable local authentication on the account
az cosmosdb update \
  --name <your-account> \
  --resource-group <your-rg> \
  --disable-local-auth true
```

```csharp
// Connect using Entra ID — no keys or connection strings needed
using Azure.Identity;
using Microsoft.Azure.Cosmos;

var client = new CosmosClient(
    accountEndpoint: "https://myaccount.documents.azure.com:443/",
    tokenCredential: new DefaultAzureCredential()
);

// Benefits:
// - No secrets to leak
// - Access is auditable per identity
// - Revocation is instant and targeted
// - Works in dev (az login), Azure (managed identity), and CI/CD (service principal)
```

If you cannot disable keys immediately, at minimum: never store connection strings in source control, use Azure Key Vault for secret storage, and enable secret scanning in your repository.

Reference: [Disable local authentication in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/how-to-setup-rbac#disable-local-auth)
