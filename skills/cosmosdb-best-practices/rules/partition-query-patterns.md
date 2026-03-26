---
title: Align Partition Key with Query Patterns
impact: CRITICAL
impactDescription: enables single-partition queries
tags: partition, query-patterns, design, performance
---

## Align Partition Key with Query Patterns

Choose a partition key that supports your most frequent queries. Single-partition queries are orders of magnitude faster than cross-partition.

**Incorrect (partition key misaligned with queries):**

```csharp
// Document partitioned by category
public class Product
{
    public string Id { get; set; }
    public string Category { get; set; }  // Partition key
    public string SellerId { get; set; }
}

// But most queries are by seller!
// This forces expensive cross-partition scan
var sellerProducts = container.GetItemQueryIterator<Product>(
    new QueryDefinition("SELECT * FROM c WHERE c.sellerId = @seller")
        .WithParameter("@seller", sellerId));
// Scans ALL partitions - high RU, high latency
```

**Correct (partition key matches query patterns):**

```csharp
// Step 1: Analyze your query patterns
// - 80% of queries: "Get all products for seller X"
// - 15% of queries: "Get product by ID"
// - 5% of queries: "Get products by category"

// Step 2: Choose partition key for dominant pattern
public class Product
{
    public string Id { get; set; }
    public string SellerId { get; set; }  // Partition key - matches 80% queries!
    public string Category { get; set; }
}

// Most common query is now single-partition
var sellerProducts = container.GetItemQueryIterator<Product>(
    new QueryDefinition("SELECT * FROM c WHERE c.sellerId = @seller")
        .WithParameter("@seller", sellerId),
    requestOptions: new QueryRequestOptions 
    { 
        PartitionKey = new PartitionKey(sellerId)  // Single partition!
    });
// Fast, low RU

// For less common category queries, accept cross-partition
// Or create a secondary container partitioned by category
```

```csharp
// E-commerce example: Orders partitioned by CustomerId
public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }  // Partition key
    public DateTime OrderDate { get; set; }
    public string Status { get; set; }
}

// "Show my orders" - single partition, fast
// "All orders today" - cross-partition, but rare admin query

// Chat example: Messages partitioned by ConversationId
public class Message
{
    public string Id { get; set; }
    public string ConversationId { get; set; }  // Partition key
    public string SenderId { get; set; }
    public string Content { get; set; }
}

// "Get messages in conversation" - single partition, fast
```

Reference: [Choose a partition key](https://learn.microsoft.com/azure/cosmos-db/partitioning-overview#choose-a-partition-key)
