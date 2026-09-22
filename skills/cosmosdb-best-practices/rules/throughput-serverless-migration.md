---
title: Migrate a Low-Traffic Provisioned Account to Serverless
impact: MEDIUM
impactDescription: pay-per-request pricing for sporadic workloads
tags: throughput, serverless, migration, cost, irreversible
---

## Migrate a Low-Traffic Provisioned Account to Serverless

An account with low, sporadic consumption often costs less on serverless (pay-per-RU) than on always-on provisioned throughput, which bills its floor 24/7. Serverless is an account-level capacity mode, so switching a *provisioned* account to serverless is not an in-place toggle — you provision a new serverless account and copy the data, gated by hard feasibility constraints. Importantly, this is not a dead end: if the workload later outgrows serverless, the reverse direction (serverless → provisioned) **is** supported in-place.

**Incorrect (leaving a low-traffic workload on always-on provisioned throughput):**

```csharp
// Provisioned account pays the 400 RU/s floor continuously even though the workload
// is idle most of the day and never approaches that throughput.
await database.CreateContainerIfNotExistsAsync(
    new ContainerProperties("events", "/tenantId"),
    throughput: 400);
```

**Correct (create a new serverless account, then migrate data into it):**

```json
// Serverless is an account-level capability set at creation (single region).
{
  "type": "Microsoft.DocumentDB/databaseAccounts",
  "apiVersion": "2021-10-15",
  "name": "events-serverless",
  "properties": {
    "databaseAccountOfferType": "Standard",
    "capabilities": [ { "name": "EnableServerless" } ],
    "locations": [ { "locationName": "West US 2", "failoverPriority": 0 } ]
  }
}
```

```csharp
// Then copy data into the new account (change feed or bulk), cut over reads/writes,
// and retire the old account. Container creation in serverless takes no throughput:
await database.CreateContainerIfNotExistsAsync(
    new ContainerProperties("events", "/tenantId"));
```

Verify these feasibility gates BEFORE migrating:
- Single region only (serverless does not support multi-region distribution).
- No database-level (shared) throughput — serverless is per-container consumption.
- Sustained demand stays well under ~5,000 RU/s per physical partition.
- A supported API (e.g., NoSQL).

**If serverless is later outgrown:** you can change a serverless account to provisioned capacity **in-place** from the Azure portal (**Change capacity mode to provisioned throughput**). It converts every container to *manual* provisioned throughput (`RU/s = number of partitions × 5,000`), after which you can switch to autoscale. Note that this capacity-mode change is itself one-way — a provisioned account can't be changed back to serverless — so you would again need a new-account migration to return to serverless. For choosing serverless on a new (greenfield) project, see `throughput-serverless`.

References:
- [Serverless in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/serverless)
- [Change from serverless to provisioned throughput](https://learn.microsoft.com/azure/cosmos-db/how-to-change-capacity-mode)
