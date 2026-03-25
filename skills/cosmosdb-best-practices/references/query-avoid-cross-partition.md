---
title: Minimize Cross-Partition Queries
impact: HIGH
impactDescription: reduces RU by 5-100x
tags: query, cross-partition, performance, optimization, java, spring-data-cosmos
---

## Minimize Cross-Partition Queries

Always include partition key in queries when possible. Cross-partition queries fan out to all partitions, consuming RU proportional to partition count.

**Incorrect (cross-partition fan-out):**

```csharp
// Missing partition key - scans ALL partitions
var query = new QueryDefinition("SELECT * FROM c WHERE c.status = @status")
    .WithParameter("@status", "active");

var iterator = container.GetItemQueryIterator<Order>(query);
// If you have 100 physical partitions, this runs 100 queries!
// RU cost = single partition cost × number of partitions
```

**Correct (single-partition query):**

```csharp
// Include partition key for single-partition query
var query = new QueryDefinition(
    "SELECT * FROM c WHERE c.customerId = @customerId AND c.status = @status")
    .WithParameter("@customerId", customerId)
    .WithParameter("@status", "active");

var iterator = container.GetItemQueryIterator<Order>(
    query,
    requestOptions: new QueryRequestOptions
    {
        PartitionKey = new PartitionKey(customerId)  // Single partition!
    });
// Runs against ONE partition only
// Dramatically lower RU and latency
```

```csharp
// When cross-partition is unavoidable, optimize parallelism
var query = new QueryDefinition("SELECT * FROM c WHERE c.status = @status")
    .WithParameter("@status", "active");

var options = new QueryRequestOptions
{
    MaxConcurrency = -1,  // Maximum parallelism
    MaxBufferedItemCount = 100,  // Buffer for smoother streaming
    MaxItemCount = 100  // Items per page
};

var iterator = container.GetItemQueryIterator<Order>(query, requestOptions: options);

// Stream results efficiently
await foreach (var item in iterator)
{
    ProcessItem(item);
}
```

```csharp
// Use GetItemLinqQueryable with partition key
var results = container.GetItemLinqQueryable<Order>(
    requestOptions: new QueryRequestOptions 
    { 
        PartitionKey = new PartitionKey(customerId) 
    })
    .Where(o => o.Status == "active")
    .ToFeedIterator();
```

### Spring Data Cosmos — `@Query` methods bypass partition key routing

Spring Data Cosmos **does not** auto-route partition keys for `@Query`-annotated repository methods. Derived query methods (e.g., `findByTypeAndLeaderboardKey()`) are automatically scoped to the partition key, but `@Query` methods are **not** — they silently perform cross-partition scans even when the repository entity has a partition key annotation. The bug is invisible: queries return HTTP 200 with silently incorrect data (results from all partitions mixed together) and inflated RU charges.

For every `@Query` method, you must either:
1. **Add the partition key to the WHERE clause** explicitly, or
2. **Use a derived query method** instead of `@Query`

**Incorrect — `@Query` without partition key filter (silent cross-partition scan):**

```java
// ❌ Missing partition key filter — performs cross-partition scan
// Returns entries from ALL partitions mixed together (wrong data, high RU)
@Query("SELECT * FROM c WHERE c.type = @type")
List<LeaderboardEntry> findByType(@Param("type") String type);
```

**Correct — explicit partition key in `@Query` WHERE clause:**

```java
// ✅ Partition key included in WHERE clause — single-partition query
@Query("SELECT * FROM c WHERE c.type = @type AND c.leaderboardKey = @leaderboardKey")
List<LeaderboardEntry> findByTypeAndLeaderboardKey(
    @Param("type") String type,
    @Param("leaderboardKey") String leaderboardKey);
```

**Correct — derived query method (auto-routes partition key):**

```java
// ✅ Derived query method — Spring Data auto-routes to the correct partition
List<LeaderboardEntry> findByTypeAndLeaderboardKey(String type, String leaderboardKey);
```

Strategies to avoid cross-partition:
1. Include partition key in WHERE clause
2. Denormalize data to colocate in same partition
3. Create secondary containers with different partition keys for different access patterns
4. In Spring Data Cosmos, prefer derived query methods over `@Query` for automatic partition key routing

Reference: [Query patterns](https://learn.microsoft.com/azure/cosmos-db/nosql/query/getting-started)
