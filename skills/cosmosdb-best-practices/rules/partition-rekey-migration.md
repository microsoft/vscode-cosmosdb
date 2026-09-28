---
title: Re-Key a Misaligned Container with the Change Partition Key Feature
impact: CRITICAL
impactDescription: replaces cross-partition fan-out with single-partition query cost (major RU/latency reduction)
tags: partition, migration, re-key, change-partition-key, container-copy, cross-partition
---

## Re-Key a Misaligned Container with the Change Partition Key Feature

When the dominant query workload structurally fans out across partitions — or one partition runs hot — the partition key is misaligned with the application's access pattern. Adding a partition-key filter to individual queries helps isolated shapes, but it cannot fix a live container whose primary lookup dimension is not the partition key. The partition key is immutable on a container, so the fix is to move the data to a container with a better key.

Prefer the built-in feature over hand-rolling this migration. Azure Cosmos DB for NoSQL provides a built-in **Change partition key** feature (Azure portal) that performs the re-key for you using service-managed [container copy](https://learn.microsoft.com/azure/cosmos-db/container-copy) jobs, so you don't have to write and operate your own dual-write/backfill pipeline. (A hand-rolled migration is only needed when the container falls outside the feature's supported limits below.)

**Incorrect (hand-rolled migration pipeline you must build, run, and reconcile yourself):**

```csharp
// Bespoke re-key: create a new container, backfill, dual-write, reconcile, cut over.
// Hundreds of lines of code to write, test, and operate — and easy to get wrong
// (missed change-feed events, dual-write drift, throttling the copy).
Container newContainer = await database.CreateContainerAsync(
    new ContainerProperties("orders-by-customer", "/customerId"), throughput: 10000);

await foreach (var doc in ReadAllFromOldContainerAsync())
    await newContainer.UpsertItemAsync(doc, new PartitionKey(doc.CustomerId));
// ...plus change-feed sync, dual-writes during cutover, verification, rollback logic...
```

**Correct (use the built-in Change partition key feature):**

```text
Azure portal → your Cosmos DB account → Data Explorer → select the container
  → Scale & Settings → Partition Keys tab → Change

1. Pick the new partition key path (higher-cardinality, aligned to the dominant
   access pattern; a /synthetic or hierarchical key is fine).
2. Create a new destination container (portal copies all settings except the
   partition key and unique keys) or select an existing one in the same database.
3. Run the copy as OFFLINE (no writes during copy) or ONLINE (writes continue).
   For ONLINE, click "Complete" to finalize once the copy has caught up.
4. After completion, point the app at the new container and, optionally, delete
   the old one.
```

```csharp
// Post-migration, the SDK reads/writes go to the re-keyed container and queries
// filtered by the new key hit a single partition:
var query = new QueryDefinition("SELECT * FROM c WHERE c.customerId = @customerId")
    .WithParameter("@customerId", customerId);
using var iterator = newContainer.GetItemQueryIterator<Order>(
    query,
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(customerId) });
```

Requirements and limitations (verify before starting):
- **API:** Azure Cosmos DB for **NoSQL** API.
- **Size/throughput:** container has **< 4 TB** of data and is provisioned with **< 1,000,000 RU/s**. Above either, contact Microsoft support. ([Change partition key — Limitations](https://learn.microsoft.com/azure/cosmos-db/change-partition-key#limitations))
- **Not supported** on accounts that have the **Merge partition** capability enabled.
- **Regions:** available only in the [regions supported by container copy](https://learn.microsoft.com/azure/cosmos-db/container-copy#supported-regions).
- The copy runs on service-managed compute; for very large containers you can request higher-capacity compute via Microsoft support. Choose a **new key with high cardinality** aligned to your dominant access pattern, and validate queries, stored procedures, and indexing policy on the new container after cutover.

When per-query fixes are enough (an occasional cross-partition shape on an otherwise well-keyed container), prefer `query-avoid-cross-partition` instead of re-keying.

Reference: [Change partition key in Azure Cosmos DB for NoSQL](https://learn.microsoft.com/azure/cosmos-db/change-partition-key)
