---
title: Use Type Discriminators for Polymorphic Data
impact: MEDIUM
impactDescription: enables efficient single-container design
tags: model, polymorphism, type-discriminator, design
---

## Use Type Discriminators for Polymorphic Data

Use a single Cosmos DB container to co-locate related parent/child or different entity types when:
- similar entities are written and read together, share a natural or business partition key, require a simple transactional boundary, and do not exceed Cosmos DB partition key limits.

When storing multiple entity types in the same container, include a type discriminator field for efficient filtering and deserialization.

### Distinguish sharing from transaction scope

| Layout | Benefit and boundary |
| --- | --- |
| Embedded document | Co-reads and single-item atomicity; bound size, growth, and update contention. |
| Separate documents, same container and full partition key | Targeted aggregate reads and eligible transactional batches within operation/payload limits. |
| Same container, different full keys | Shared throughput and policies, not cross-item atomicity from a common container or HPK prefix. |
| Separate containers | Independent policies and optional dedicated throughput; no cross-container batch. |

With HPK `[/ownerId, /type]`, `[owner, "profile"]` and `[owner, "lease"]` are different logical partitions.
To group them transactionally, compare a shared business key with distinct, losslessly type-scoped item IDs.
Preserve original source keys and verify uniqueness, routing, and application compatibility before changing identities.
A discriminator alone does not distinguish equal IDs within one full partition key.

Assess aggregate storage and peak demand for the hottest key. Same-key items share logical-partition limits;
different keys do not guarantee balanced physical placement. Types sharing container throughput cannot independently
reserve it. Compare pooling with dedicated allocations when workload isolation matters. Same-owner atomicity does not
extend across owners or containers. See [embedding](model-embed-related.md) and [uniqueness scope](model-unique-keys.md).

**Incorrect (no type discrimination):**

```csharp
// Multiple types in same container without clear identification
public class Order { public string Id { get; set; } /* ... */ }
public class Customer { public string Id { get; set; } /* ... */ }
public class Product { public string Id { get; set; } /* ... */ }

// How do you query just orders? Full scan!
var allItems = await container.GetItemQueryIterator<dynamic>("SELECT * FROM c").ReadNextAsync();
var orders = allItems.Where(x => x.orderDate != null);  // Brittle, inefficient
```

**Correct (explicit type discriminator):**

```csharp
// Base class with type discriminator
public abstract class BaseEntity
{
    [JsonPropertyName("id")]
    public string Id { get; set; }
    
    [JsonPropertyName("type")]
    public abstract string Type { get; }
    
    [JsonPropertyName("partitionKey")]
    public string PartitionKey { get; set; }
}

public class Order : BaseEntity
{
    public override string Type => "order";
    public DateTime OrderDate { get; set; }
    public List<OrderItem> Items { get; set; }
}

public class Customer : BaseEntity
{
    public override string Type => "customer";
    public string Email { get; set; }
    public string Name { get; set; }
}

public class Product : BaseEntity
{
    public override string Type => "product";
    public string Name { get; set; }
    public decimal Price { get; set; }
}

// Efficient queries by type - uses index!
var ordersQuery = new QueryDefinition(
    "SELECT * FROM c WHERE c.type = @type AND c.partitionKey = @pk")
    .WithParameter("@type", "order")
    .WithParameter("@pk", customerId);

// Polymorphic deserialization
public static BaseEntity DeserializeEntity(JsonDocument doc)
{
    var type = doc.RootElement.GetProperty("type").GetString();
    return type switch
    {
        "order" => doc.Deserialize<Order>(),
        "customer" => doc.Deserialize<Customer>(),
        "product" => doc.Deserialize<Product>(),
        _ => throw new InvalidOperationException($"Unknown type: {type}")
    };
}
```

Benefits:
- Efficient filtering with indexed `type` field
- Clear deserialization logic
- Self-documenting data structure

**When NOT to Use Multi-Entity Containers** :
   - Independent throughput requirements → Use separate containers
   - Different scaling patterns → Use separate containers
   - Different indexing needs → Use separate containers
   - Distinct change feed processing requirements → Use separate containers
   - Low access correlation (<20%) → Use separate containers

**Single-Container Anti-Patterns** :
   - "Everything container" → Complex filtering → Difficult analytics
   - Shared throughput despite a requirement for independent workload capacity
   - One change feed with mixed events requiring filtering
   - Difficult to maintain and onboard new developers

Reference: [Model data in Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data)
