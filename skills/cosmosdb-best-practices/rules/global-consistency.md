---
title: Choose Appropriate Consistency Level
impact: HIGH
impactDescription: balances latency, availability, consistency
tags: global, consistency, tradeoffs, design
---

## Choose Appropriate Consistency Level

Select the consistency level that matches your application's requirements. Each level has different tradeoffs for latency, availability, and consistency.

**Consistency levels (strongest to weakest):**

```csharp
// STRONG - Linearizable reads
// Reads always see most recent committed write
// Highest latency, lowest availability in multi-region
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Strong
});
// Use: Financial transactions, inventory management
// Tradeoff: Higher latency, reduced availability during regional outage

// BOUNDED STALENESS - Reads lag behind writes by bounded amount
// "Reads at least this fresh" guarantee
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.BoundedStaleness
});
// Use: Stock tickers, leaderboards (where slight delay is OK)
// Tradeoff: May read slightly old data, better performance than Strong

// SESSION (DEFAULT) - Monotonic reads within session
// Client always sees its own writes
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Session
});
// Use: Most applications - user sees their changes
// Best balance of consistency and performance

// CONSISTENT PREFIX - Reads never see out-of-order writes
// Guarantees ordering but may lag behind
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.ConsistentPrefix
});
// Use: Event sourcing, activity feeds
// Tradeoff: May read stale data, but always in order

// EVENTUAL - Weakest, highest performance
// No ordering guarantees, eventually converges
var client = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Eventual
});
// Use: View counts, likes, non-critical telemetry
// Best performance, lowest cost
```

**Correct (choosing based on requirements):**

```csharp
// Example: E-commerce platform

// Orders container - Strong or Session
// User must see their order immediately after placing
var ordersClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Session  // Recommended
});

// Product catalog - Eventual or Consistent Prefix
// Slight delay in inventory updates is acceptable
var catalogClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Eventual
});

// Analytics/metrics - Eventual
// Historical data doesn't need immediate consistency
var analyticsClient = new CosmosClient(connectionString, new CosmosClientOptions
{
    ConsistencyLevel = ConsistencyLevel.Eventual
});
```

```csharp
// Session consistency with session token (most common pattern)
// SDK handles session tokens automatically within a client instance

// For scenarios where you need to share session across requests:
var response = await container.CreateItemAsync(order);
var sessionToken = response.Headers["x-ms-session-token"];

// Later request can use same session for read-your-writes
var readOptions = new ItemRequestOptions
{
    SessionToken = sessionToken
};
var order = await container.ReadItemAsync<Order>(id, pk, readOptions);
```

RU cost comparison (relative to Strong):
- Strong: 2x RU for reads (waits for quorum)
- Bounded Staleness: 2x RU for reads
- Session: 1x RU (default)
- Consistent Prefix: 1x RU
- Eventual: 1x RU

Reference: [Consistency levels](https://learn.microsoft.com/azure/cosmos-db/consistency-levels)
