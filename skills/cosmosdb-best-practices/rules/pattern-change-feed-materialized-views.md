---
title: Use Change Feed for cross-partition query optimization with materialized views
impact: HIGH
impactDescription: eliminates cross-partition query overhead for admin/analytics scenarios
tags: pattern, change-feed, materialized-views, cross-partition, query-optimization, idempotency, at-least-once
---

## Use Change Feed for Materialized Views or Global Secondary Index

When your application requires frequent cross-partition queries (e.g., admin dashboards, analytics, frequent lookups by secondary non-PK attributes), you have two main options: use Change Feed to maintain materialized views in a separate container optimized for those query patterns, or use the new Global Secondary Index (GSI).

**Problem: Cross-partition queries are expensive**

```csharp
// This query fans out to ALL partitions - expensive at scale!
// Container partitioned by /customerId
var query = container.GetItemQueryIterator<Order>(
    "SELECT * FROM c WHERE c.status = 'Pending' ORDER BY c.createdAt DESC"
);
// With 100,000 customers = 100,000+ physical partitions queried
```

Cross-partition queries:
- Consume RUs from every partition (high cost)
- Have higher latency (parallel fan-out)
- Don't scale well as data grows

**Solution: Materialized view with Change Feed**

Create a second container optimized for your admin queries:

```
Container 1: "orders" (partitioned by /customerId)
├── Efficient for: customer order history, point reads
└── Pattern: Single-partition queries

Container 2: "orders-by-status" (partitioned by /status)  
├── Efficient for: admin status queries
├── Pattern: Single-partition queries within status
└── Populated by: Change Feed processor
```

**Implementation - .NET:**

```csharp
// Change Feed processor to sync materialized view
Container leaseContainer = database.GetContainer("leases");
Container ordersContainer = database.GetContainer("orders");
Container ordersByStatusContainer = database.GetContainer("orders-by-status");

ChangeFeedProcessor processor = ordersContainer
    .GetChangeFeedProcessorBuilder<Order>("statusViewProcessor", HandleChangesAsync)
    .WithInstanceName("instance-1")
    .WithLeaseContainer(leaseContainer)
    .WithStartFromBeginning()
    .Build();

async Task HandleChangesAsync(
    IReadOnlyCollection<Order> changes, 
    CancellationToken cancellationToken)
{
    foreach (Order order in changes)
    {
        // Create/update the materialized view document
        var statusView = new OrderStatusView
        {
            Id = order.Id,
            CustomerId = order.CustomerId,
            Status = order.Status,  // This becomes the partition key
            CreatedAt = order.CreatedAt,
            Total = order.Total
        };
        
        await ordersByStatusContainer.UpsertItemAsync(
            statusView,
            new PartitionKey(order.Status.ToString()),
            cancellationToken: cancellationToken
        );
    }
}

await processor.StartAsync();
```

**Implementation - Java:**

```java
// Change Feed processor with Spring Boot
@Component
public class OrderStatusViewProcessor {
    
    @Autowired
    private CosmosAsyncContainer ordersByStatusContainer;
    
    public void startProcessor(CosmosAsyncContainer ordersContainer, 
                               CosmosAsyncContainer leaseContainer) {
        
        ChangeFeedProcessor processor = new ChangeFeedProcessorBuilder<Order>()
            .hostName("processor-1")
            .feedContainer(ordersContainer)
            .leaseContainer(leaseContainer)
            .handleChanges(this::handleChanges)
            .buildChangeFeedProcessor();
            
        processor.start().block();
    }
    
    private void handleChanges(List<Order> changes, ChangeFeedProcessorContext context) {
        for (Order order : changes) {
            OrderStatusView view = new OrderStatusView(
                order.getId(),
                order.getCustomerId(), 
                order.getStatus(),
                order.getCreatedAt(),
                order.getTotal()
            );
            
            ordersByStatusContainer.upsertItem(
                view,
                new PartitionKey(order.getStatus().getValue()),
                new CosmosItemRequestOptions()
            ).block();
        }
    }
}
```

**Implementation - Python:**

```python
from azure.cosmos import CosmosClient
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
import asyncio

async def process_change_feed():
    """Process changes and update materialized view"""
    
    async with AsyncCosmosClient(endpoint, credential=key) as client:
        orders_container = client.get_database_client(db).get_container_client("orders")
        status_container = client.get_database_client(db).get_container_client("orders-by-status")
        
        # Read change feed
        async for changes in orders_container.query_items_change_feed():
            for order in changes:
                # Upsert to materialized view
                status_view = {
                    "id": order["id"],
                    "customerId": order["customerId"],
                    "status": order["status"],  # Partition key in target container
                    "createdAt": order["createdAt"],
                    "total": order["total"]
                }
                
                await status_container.upsert_item(
                    body=status_view,
                    partition_key=order["status"]
                )
```

**Query the materialized view (single-partition!):**

```csharp
// Now this is a single-partition query - fast and cheap!
var query = ordersByStatusContainer.GetItemQueryIterator<OrderStatusView>(
    new QueryDefinition("SELECT * FROM c WHERE c.status = @status ORDER BY c.createdAt DESC")
        .WithParameter("@status", "Pending"),
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey("Pending") }
);
```

**When to use this pattern:**

| Use Materialized Views When | Stick with Cross-Partition When |
|-----------------------------|---------------------------------|
| High-frequency admin queries | Rare/occasional admin queries |
| Large dataset (100K+ docs) | Small dataset (<10K docs) |
| Query latency is critical | Latency is acceptable |
| Consistent query patterns | Ad-hoc query patterns |

**Trade-offs:**

| Benefit | Cost |
|---------|------|
| Fast single-partition queries | Additional storage (duplicated data) |
| Predictable latency | Change Feed processor complexity |
| Better scalability | Eventual consistency (slight delay) |
| Lower RU cost per query | RU cost for writes to both containers |

**⚠️ Change Feed delivers events at-least-once.** Your handler MUST be idempotent — processing the same event twice must produce the same result. Never use `counter += 1` or `get() + 1` patterns in Change Feed handlers, as event replay will silently double-count.

**Incorrect — non-idempotent handler (counter drift on replay):**

```java
// ❌ WRONG — at-least-once replay doubles counts
private void handleChanges(List<JsonNode> changes, ChangeFeedProcessorContext context) {
    for (JsonNode node : changes) {
        GameScore score = objectMapper.treeToValue(node, GameScore.class);
        PlayerProfile profile = playerRepository.findById(score.getPlayerId()).orElseGet(PlayerProfile::new);
        profile.setTotalGamesPlayed(profile.getTotalGamesPlayed() + 1); // NON-IDEMPOTENT
        profile.setTotalScore(profile.getTotalScore() + score.getScore()); // NON-IDEMPOTENT
        playerRepository.save(profile);
    }
}
```

```csharp
// ❌ WRONG — same problem in .NET
async Task HandleChangesAsync(IReadOnlyCollection<GameScore> changes, CancellationToken ct)
{
    foreach (var score in changes)
    {
        var profile = await GetProfileAsync(score.PlayerId);
        profile.TotalGamesPlayed += 1;  // NON-IDEMPOTENT
        profile.TotalScore += score.Score;  // NON-IDEMPOTENT
        await SaveProfileAsync(profile);
    }
}
```

**Correct — idempotent alternatives:**

Use one of these patterns to ensure safe replay:

**1. Replace pattern — write absolute values, not deltas:**

```java
// ✅ CORRECT — replace with absolute value from the event
private void handleChanges(List<JsonNode> changes, ChangeFeedProcessorContext context) {
    for (JsonNode node : changes) {
        GameScore score = objectMapper.treeToValue(node, GameScore.class);
        PlayerProfile profile = playerRepository.findById(score.getPlayerId()).orElseGet(PlayerProfile::new);
        // Idempotent: same event replayed produces same result
        profile.setHighScore(Math.max(profile.getHighScore(), score.getScore()));
        playerRepository.save(profile);
    }
}
```

**2. Conditional write — use ETags to detect duplicate processing:**

```csharp
// ✅ CORRECT — ETag prevents duplicate processing
async Task HandleChangesAsync(IReadOnlyCollection<GameScore> changes, CancellationToken ct)
{
    foreach (var score in changes)
    {
        var response = await container.ReadItemAsync<PlayerProfile>(
            score.PlayerId, new PartitionKey(score.PlayerId));
        var profile = response.Resource;
        profile.HighScore = Math.Max(profile.HighScore, score.Score);
        await container.ReplaceItemAsync(profile, profile.Id,
            new PartitionKey(profile.Id),
            new ItemRequestOptions { IfMatchEtag = response.ETag });
    }
}
```

**3. Mark-and-rebuild — flag affected records and recalculate from source of truth:**

```python
# ✅ CORRECT — mark dirty and rebuild from source data
async def handle_changes(changes):
    for change in changes:
        player_id = change["playerId"]
        # Mark the profile as needing recalculation
        await profiles_container.patch_item(
            item=player_id,
            partition_key=player_id,
            patch_operations=[
                {"op": "set", "path": "/needsRecalc", "value": True}
            ]
        )
    # Separate process recalculates from source of truth
```

| Idempotent Pattern | When to Use | Trade-off |
|--------------------|-------------|-----------|
| Replace (absolute value) | High scores, latest status, max/min values | Only works for non-cumulative data |
| Conditional write (ETag) | Any update where you can detect duplicates | Extra read + possible retry on conflict |
| Mark-and-rebuild | Counters, aggregations, cumulative totals | Higher latency, requires rebuild process |

**Key Points:**
- **Change Feed delivers at-least-once** — handlers MUST be idempotent
- Change Feed provides reliable, ordered event stream of all document changes
- Materialized views trade storage cost for query efficiency
- Updates are eventually consistent (typically <1 second delay)
- Use lease container to track processor progress (enables resume after failures)
- Never use `counter += 1`, `total += value`, or `get() + 1` patterns in Change Feed handlers
- Consider Azure Functions with Cosmos DB trigger for serverless implementation
- Consider Global Secondary Index (GSI) implementation as alternative for automatic sync between containers with different partition keys

Reference(s): 
[Change feed in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/change-feed)
[Change feed design patterns in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/change-feed-design-patterns)
[Global Secondary Indexes (GSI) in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/global-secondary-indexes)
