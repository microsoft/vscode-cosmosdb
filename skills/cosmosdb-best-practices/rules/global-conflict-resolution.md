---
title: Implement Conflict Resolution
impact: MEDIUM
impactDescription: ensures data integrity in multi-region
tags: global, conflicts, resolution, multi-region
---

## Implement Conflict Resolution

Configure appropriate conflict resolution policies for multi-region write scenarios. Without proper handling, data can be lost.

**Understanding conflicts:**

```csharp
// Conflicts occur when same document is written in multiple regions
// before replication completes

// Region A: Update order status to "shipped"
// Region B: Update order status to "cancelled" (same time)
// Both writes succeed locally, then conflict during replication
```

**Incorrect (ignoring conflicts):**

```csharp
// Using default LWW with _ts but not understanding implications
// Later timestamp wins - but "later" may be wrong server

// Server A clock: 10:00:00.100 → "shipped"
// Server B clock: 10:00:00.050 → "cancelled"
// Result: "shipped" wins even though B's write may be logically later
```

**Correct (explicit conflict resolution):**

```csharp
// Option 1: Last Writer Wins with logical clock (recommended)
var containerProperties = new ContainerProperties
{
    Id = "orders",
    PartitionKeyPath = "/customerId",
    ConflictResolutionPolicy = new ConflictResolutionPolicy
    {
        Mode = ConflictResolutionMode.LastWriterWins,
        ResolutionPath = "/version"  // Use application-managed version
    }
};

// Document with version counter
public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }
    public string Status { get; set; }
    public long Version { get; set; }  // Increment on each update
}

// Update with version increment
public async Task UpdateOrderStatus(Order order, string newStatus)
{
    order.Status = newStatus;
    order.Version++;  // Higher version always wins
    await container.UpsertItemAsync(order, new PartitionKey(order.CustomerId));
}
```

```csharp
// Option 2: Stored procedure for custom resolution
var containerWithCustom = new ContainerProperties
{
    Id = "inventory",
    PartitionKeyPath = "/productId",
    ConflictResolutionPolicy = new ConflictResolutionPolicy
    {
        Mode = ConflictResolutionMode.Custom,
        ResolutionProcedure = "dbs/mydb/colls/inventory/sprocs/resolveConflict"
    }
};

// Stored procedure for custom logic
// Example: For inventory, take the LOWER value (conservative)
const string resolveConflictSproc = @"
function resolveConflict(incomingItem, existingItem, isTombstone, conflictingItems) {
    if (isTombstone) {
        // Delete wins
        return existingItem;
    }
    
    // For inventory: lower quantity wins (conservative)
    if (existingItem.quantity < incomingItem.quantity) {
        return existingItem;
    }
    return incomingItem;
}";
```

```csharp
// Option 3: Read and resolve conflicts manually (async)
// Conflicts written to conflicts feed when no automatic resolution

var conflictsFeed = container.Conflicts.GetConflictQueryIterator<dynamic>();

while (conflictsFeed.HasMoreResults)
{
    var conflicts = await conflictsFeed.ReadNextAsync();
    foreach (var conflict in conflicts)
    {
        // Read conflicting versions
        var conflictContent = await container.Conflicts.ReadCurrentAsync<Order>(
            conflict, new PartitionKey(conflict.PartitionKey));
        
        // Apply custom resolution logic
        var resolvedOrder = ResolveOrderConflict(conflictContent.Resource);
        
        // Write resolved version
        await container.UpsertItemAsync(resolvedOrder);
        
        // Delete conflict record
        await container.Conflicts.DeleteAsync(conflict, new PartitionKey(conflict.PartitionKey));
    }
}
```

Best practices:
- Use LWW with application-controlled version for simple cases
- Use stored procedures when business logic determines winner
- Monitor conflicts feed if using Custom mode
- Design to minimize conflicts (partition by user, idempotent operations)

Reference: [Conflict resolution](https://learn.microsoft.com/azure/cosmos-db/conflict-resolution-policies)
