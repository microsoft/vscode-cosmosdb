---
title: Distribute Writes to Avoid Hot Partitions
impact: CRITICAL
impactDescription: prevents throughput bottlenecks
tags: partition, hot-partition, write-distribution, performance
---

## Distribute Writes to Avoid Hot Partitions

Ensure writes distribute evenly across partitions. A hot partition limits throughput to that single partition's capacity.

**Incorrect (all writes hit single partition):**

```csharp
// Anti-pattern: time-based partition key with current-time writes
public class Event
{
    public string Id { get; set; }
    
    // All events for "today" go to same partition!
    public string Date { get; set; }  // ❌ "2026-01-21" - HOT!
}

// All current writes bottleneck on today's partition
// Yesterday's partition sits idle
await container.CreateItemAsync(new Event 
{ 
    Id = Guid.NewGuid().ToString(),
    Date = DateTime.UtcNow.ToString("yyyy-MM-dd")  // All writes here!
});
```

```csharp
// Anti-pattern: singleton partition key
public class Config
{
    public string Id { get; set; }
    public string PartitionKey { get; set; } = "config";  // ❌ ONE partition!
}
// Everything in single 10K RU/s max partition
```

**Correct (distributed writes):**

```csharp
// Good: write-sharding for time-series data
public class Event
{
    public string Id { get; set; }
    
    // Combine date with hash suffix for distribution
    public string PartitionKey { get; set; }  // "2026-01-21_shard3"
}

public static string CreateTimeShardedKey(DateTime timestamp, int shardCount = 10)
{
    var dateKey = timestamp.ToString("yyyy-MM-dd");
    var shard = Math.Abs(Guid.NewGuid().GetHashCode()) % shardCount;
    return $"{dateKey}_shard{shard}";
}

// Writes distribute across 10 partitions per day
await container.CreateItemAsync(new Event 
{ 
    Id = Guid.NewGuid().ToString(),
    PartitionKey = CreateTimeShardedKey(DateTime.UtcNow)
});
```

```csharp
// Good: natural distribution with entity IDs
public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }  // ✅ Natural distribution
    public DateTime OrderDate { get; set; }
}

// Each customer's orders in their own partition
// Writes naturally spread across many customers
```

Monitor for hot partitions:
- Check Metrics → Normalized RU Consumption
- Look for partitions consistently at 100%
- Use Azure Monitor alerts for throttling

**Partition Limits (as of current Azure Cosmos DB documentation):**
   - Physical partition throughput limit: **10,000 RU/s** per physical partition  
     See [Azure Cosmos DB partitioning – physical partitions](https://learn.microsoft.com/azure/cosmos-db/partitioning-overview#physical-partitions).
   - Logical partition size limit: **20 GB** per logical partition  
     See [Azure Cosmos DB partitioning – logical partitions](https://learn.microsoft.com/azure/cosmos-db/partitioning-overview#logical-partitions).
   - Physical partition size: **50 GB** per physical partition  
     See [Azure Cosmos DB partitioning – physical partitions](https://learn.microsoft.com/azure/cosmos-db/partitioning-overview#physical-partitions).

   > These limits can evolve over time and may vary by region/offer. Always confirm against the latest Azure Cosmos DB documentation for your account.

**Popularity Skew Warning for Hot Partitions:** Even high-cardinality keys (like `user_id`) can create hot partitions when specific values get dramatically more traffic (e.g., a viral user during peak moments).