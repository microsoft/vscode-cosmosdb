---
title: Plan for 20GB Logical Partition Limit
impact: HIGH
impactDescription: prevents partition split failures
tags: partition, limits, capacity-planning, design
---

## Plan for 20GB Logical Partition Limit

Each logical partition has a 20GB storage limit. Design partition keys to ensure no single partition value accumulates more than 20GB.

**Incorrect (unbounded partition growth):**

```csharp
// Anti-pattern: partition key with unbounded data accumulation
public class AuditLog
{
    public string Id { get; set; }
    public string SystemId { get; set; }  // Partition key - only 3 systems!
    public DateTime Timestamp { get; set; }
    public string Action { get; set; }
    public string Details { get; set; }
}

// Problem: Each system accumulates logs forever
// "system-a" partition will eventually hit 20GB
// Writes will fail with: PartitionKeyRangeIsFull
```

**Correct (bounded partition growth):**

```csharp
// Solution 1: Time-bucket the partition key
public class AuditLog
{
    public string Id { get; set; }
    public string SystemId { get; set; }
    public DateTime Timestamp { get; set; }
    
    // Partition by system + month
    public string PartitionKey => $"{SystemId}_{Timestamp:yyyy-MM}";
}

// Each partition holds ~1 month of data per system
// Old partitions naturally stop growing
```

```csharp
// Solution 2: Use hierarchical partition keys
var containerProperties = new ContainerProperties
{
    Id = "audit-logs",
    PartitionKeyPaths = new List<string> 
    { 
        "/systemId",
        "/yearMonth"  // Secondary level prevents 20GB limit
    }
};

public class AuditLog
{
    public string Id { get; set; }
    public string SystemId { get; set; }
    public string YearMonth { get; set; }  // "2026-01"
    public DateTime Timestamp { get; set; }
}
```

```csharp
// Monitor partition sizes
public async Task CheckPartitionSizes()
{
    var partitionKeyRanges = container.GetFeedRanges();
    
    foreach (var range in await partitionKeyRanges)
    {
        var iterator = container.GetItemQueryIterator<dynamic>(
            "SELECT * FROM c",
            requestOptions: new QueryRequestOptions { FeedRange = range });
        
        // Check size via metrics or diagnostic headers
        var response = await iterator.ReadNextAsync();
        _logger.LogInformation(
            "Partition {Range}: {Count} items, {RU} RU", 
            range, response.Count, response.RequestCharge);
    }
}

// Set up alerts before hitting limits
// Azure Monitor: PartitionKeyRangeId with high storage
```

Capacity planning:
- Estimate item count per partition key value
- Calculate average item size × item count
- Target < 10GB per partition value (50% safety margin)
- Consider time-based bucketing for growing data

Reference: [Partition key limits](https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-logical-partition)
