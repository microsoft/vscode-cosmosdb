---
title: Choose Immutable Properties as Partition Keys
impact: HIGH
impactDescription: prevents data integrity issues from non-atomic key changes
tags: partition, immutability, design, data-integrity
---

## Choose Immutable Properties as Partition Keys

Cosmos DB partition keys are immutable — you cannot update a document's partition key value in place. Changing it requires deleting the original document and reinserting with the new key, a non-atomic operation that risks data loss. Prefer creation-time values that never change.

**Incorrect (mutable field as partition key):**

```csharp
// Anti-pattern: status changes throughout the document lifecycle
public class Order
{
    public string Id { get; set; }
    public string Status { get; set; }  // ❌ Partition key — but it changes!
}

// "Updating" the partition key does NOT move the document between partitions
order.Status = "shipped";
await container.ReplaceItemAsync(order, order.Id, new PartitionKey("shipped"));
```

**Correct (immutable field as partition key):**

```csharp
public class Order
{
    public string Id { get; set; }
    public string CustomerId { get; set; }  // ✅ Set at creation, never changes
    public string Status { get; set; }       // Mutable — but NOT the partition key
}

order.Status = "shipped";
await container.ReplaceItemAsync(order, order.Id, new PartitionKey(order.CustomerId));
```

**Never use as partition keys:** status fields, workflow stages, ownership/assignment fields, or any property updated during the document lifecycle.

**Safe choices:** entity identifiers (userId, tenantId, deviceId), creation-time values, or synthetic keys derived from immutable fields.

Reference: [Change partition key value](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-change-partition-key-value)
