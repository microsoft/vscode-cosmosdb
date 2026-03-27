---
title: Understand Indexing Modes
impact: MEDIUM
impactDescription: balances write speed vs query consistency
tags: index, mode, consistent, lazy
---

## Understand Indexing Modes

Choose the appropriate indexing mode based on your workload. Consistent mode ensures query results are current; None disables indexing entirely.

**Indexing modes explained:**

```csharp
// CONSISTENT MODE (Default - recommended for most cases)
// Indexes are updated synchronously with writes
// Queries always see latest data
var consistentPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,  // Default
    Automatic = true
};

// Benefits:
// - Query results are always up-to-date
// - Strong consistency between writes and reads
// Tradeoffs:
// - Write latency includes index update time
```

```csharp
// NONE MODE (Write-only containers)
// No automatic indexing - fastest writes
// Only point reads work (by id + partition key)
var nonePolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.None,
    Automatic = false
};

// Use cases:
// - Pure key-value store (only point reads)
// - High-volume write ingestion
// - Time-series data queried via external system (Synapse Link)
```

**Correct (choosing mode based on workload):**

```csharp
// Typical transactional workload - use Consistent
var ordersPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    Automatic = true,
    IncludedPaths = { new IncludedPath { Path = "/*" } }
};

var ordersContainer = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    IndexingPolicy = ordersPolicy
};
// Queries immediately see new orders
```

```csharp
// High-volume telemetry ingestion - consider None
var telemetryPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.None,  // Maximum write throughput
    Automatic = false
};

var telemetryContainer = new ContainerProperties
{
    Id = "telemetry",
    PartitionKeyPath = "/deviceId",
    IndexingPolicy = telemetryPolicy,
    
    // Enable analytical store for querying via Synapse
    AnalyticalStorageTimeToLiveInSeconds = -1
};

// Point reads still work
var reading = await container.ReadItemAsync<Telemetry>(
    readingId, new PartitionKey(deviceId));

// Complex queries via Synapse Link (analytical store)
// No indexing overhead on transactional writes
```

```csharp
// Selective indexing - best of both worlds
var hybridPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    Automatic = true,
    
    // Only index fields you query
    IncludedPaths =
    {
        new IncludedPath { Path = "/customerId/?" },
        new IncludedPath { Path = "/orderDate/?" }
    },
    ExcludedPaths =
    {
        new ExcludedPath { Path = "/*" }  // Exclude everything else
    }
};
// Fast writes (minimal indexing) + efficient queries (on indexed paths)
```

Decision guide:
- **Consistent**: Default, transactional workloads, need queries
- **None**: Write-only, pure key-value, using Synapse Link for analytics

Note: Lazy mode was deprecated - use Consistent instead.

Reference: [Indexing modes](https://learn.microsoft.com/azure/cosmos-db/index-policy#indexing-mode)
