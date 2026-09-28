---
title: Expire Stale Data Before It Hits Storage Limits
impact: MEDIUM
impactDescription: avoids the partition storage wall on growing data
tags: throughput, ttl, storage, growth, archival, partition-limit
---

## Expire Stale Data Before It Hits Storage Limits

Data that only ever grows will eventually hit a wall: a physical partition holds up to ~50 GB and then splits automatically, but a single logical partition key is hard-capped at 20 GB — once a key reaches it, writes to that key fail (see the partitioning overview). The danger case is a physical partition dominated by one oversized logical key: it can't split, so it trends toward that hard 20 GB wall. Time-series, telemetry, event, and audit workloads are especially prone to this. When storage on the busiest partition is trending toward the limit, expire stale records with TTL, archive cold data to cheaper storage, or re-key so growth spreads across partitions — before the wall, not after.

**Incorrect (records accumulate forever):**

```csharp
public class TelemetryEvent
{
    public string Id { get; set; } = default!;
    public string DeviceId { get; set; } = default!;   // Partition key
    public DateTime Timestamp { get; set; }
    public object Payload { get; set; } = default!;
    // No TTL: every event persists indefinitely and the partition only grows.
}

await container.CreateItemAsync(evt, new PartitionKey(evt.DeviceId));
```

**Correct (container TTL plus a per-item override for stale telemetry):**

```csharp
// Default TTL expires items after the retention window.
var props = await container.ReadContainerAsync();
props.Resource.DefaultTimeToLive = 60 * 60 * 24 * 90; // 90 days
await container.ReplaceContainerAsync(props.Resource);

public class TelemetryEvent
{
    public string Id { get; set; } = default!;
    public string DeviceId { get; set; } = default!;
    public DateTime Timestamp { get; set; }

    // Per-item TTL only works if the property serializes to the JSON name "ttl".
    // The .NET SDK's default (Newtonsoft) serializer uses the property name as-is,
    // so map it explicitly:
    [JsonProperty(PropertyName = "ttl")]  // using Newtonsoft.Json;
    public int? Ttl { get; set; } = 60 * 60 * 24 * 7; // 7 days — overrides the 90-day container default for this item
}

await container.UpsertItemAsync(evt, new PartitionKey(evt.DeviceId));
```

Guidance:
- Set `DefaultTimeToLive` at the container level and override per item where retention varies.
- If a *single logical key* dominates growth, TTL alone may not be enough — archive cold history by time bucket or re-key for even distribution (see `partition-high-cardinality`).
- Archival (change feed to blob or another cheaper store) preserves history while keeping the operational container small.

Reference:
- [Time to Live (TTL) in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/time-to-live)
- [Partitioning and horizontal scaling — partition storage limits](https://learn.microsoft.com/azure/cosmos-db/partitioning-overview)
