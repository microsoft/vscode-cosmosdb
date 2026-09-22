---
title: Project Only Needed Fields
impact: HIGH
impactDescription: reduces payload size, network bandwidth, and client memory; RU savings scale with document size (negligible on small flat docs, substantial on multi-KB/MB documents and large result sets)
tags: query, projection, performance, bandwidth
---

## Project Only Needed Fields

Select only the fields you need rather than returning entire documents. Reduces both RU consumption and network bandwidth.

**Incorrect (selecting entire document):**

```csharp
// Selecting everything when you only need a few fields
var query = "SELECT * FROM c WHERE c.customerId = @customerId";

// Returns all fields including:
// - Large text content
// - Arrays with hundreds of items
// - Fields you'll never use
var orders = await container.GetItemQueryIterator<Order>(
    new QueryDefinition(query).WithParameter("@customerId", customerId),
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(customerId) }
).ReadNextAsync();

// UI only shows: orderId, orderDate, total
// But you transferred and deserialized everything!
```

**Correct (projecting specific fields):**

```csharp
// Project only what's needed
var query = @"
    SELECT 
        c.id,
        c.orderDate,
        c.total,
        c.status
    FROM c 
    WHERE c.customerId = @customerId";

public class OrderSummary
{
    public string Id { get; set; }
    public DateTime OrderDate { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; }
}

var orders = await container.GetItemQueryIterator<OrderSummary>(
    new QueryDefinition(query).WithParameter("@customerId", customerId),
    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(customerId) }
).ReadNextAsync();

// Substantial payload-size reduction; RU savings depend on document size
// (significant on large/nested docs, negligible on small flat docs)
```

```csharp
// For nested objects, project specific paths
var query = @"
    SELECT 
        c.id,
        c.customer.name AS customerName,
        c.items[0].productName AS firstProduct,
        ARRAY_LENGTH(c.items) AS itemCount
    FROM c";

// Even more efficient: VALUE for single field
var query2 = "SELECT VALUE c.email FROM c WHERE c.type = 'customer'";
var emails = await container.GetItemQueryIterator<string>(query2).ReadNextAsync();
```

```csharp
// LINQ projection
var orderSummaries = container.GetItemLinqQueryable<Order>(
    requestOptions: new QueryRequestOptions 
    { 
        PartitionKey = new PartitionKey(customerId) 
    })
    .Where(o => o.CustomerId == customerId)
    .Select(o => new OrderSummary
    {
        Id = o.Id,
        OrderDate = o.OrderDate,
        Total = o.Total,
        Status = o.Status
    })
    .ToFeedIterator();
```

### Prefer dedicated result types for projections

When projecting fields, prefer deserializing into a dedicated DTO or record whose properties match the projected fields rather than reusing the full document model class. A dedicated result type makes the projection self-documenting, avoids confusion from null/default-valued properties that were not projected, and reduces the chance of developers reverting to `SELECT *` over time.

```csharp
// ✅ Preferred: Dedicated DTO matches projected fields exactly
public class OrderSummary
{
    public string Id { get; set; }
    public DateTime OrderDate { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; }
}

var iterator = container.GetItemQueryIterator<OrderSummary>(  // ✅ Matches projection
    new QueryDefinition(query).WithParameter("@cid", customerId));
```

```java
// ✅ Preferred: Dedicated projection record in Java
public record PlayerSummary(String id, String playerName, int score) {}

@Query("SELECT c.id, c.playerName, c.score FROM c WHERE c.leaderboardKey = @key")
List<PlayerSummary> getTopPlayers(@Param("key") String key);
```

⚠️ Deserializing projected results into the full entity type is acceptable when the entity is small, the unprojected fields are not misleading, or the surrounding framework expects that type (e.g., Spring Data repository methods, EF Core entities). In these cases, ensure the intent is clear through comments or naming so that future maintainers do not mistakenly revert to `SELECT *`.

### Node.js / TypeScript (@azure/cosmos v4)

```typescript
// ❌ Anti-pattern: SELECT * pulls every field including future additions
const bad = {
  query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC',
  parameters: [{ name: '@userId', value: userId }],
};

// ✅ Preferred: project only the fields the caller consumes
const good = {
  query: `
    SELECT c.id, c.userId, c.status, c.total, c.createdAt
    FROM c
    WHERE c.userId = @userId
    ORDER BY c.createdAt DESC
  `,
  parameters: [{ name: '@userId', value: userId }],
};

// TypeScript: dedicated result type matches the projected fields
interface OrderSummary {
  id: string;
  userId: string;
  status: string;
  total: number;
  createdAt: string;
}
const { resources } = await container.items
  .query<OrderSummary>(good, { partitionKey: userId })
  .fetchAll();

// Single-column scalar with SELECT VALUE
const { resources: statuses } = await container.items
  .query<string>({
    query: 'SELECT VALUE c.status FROM c WHERE c.userId = @u',
    parameters: [{ name: '@u', value: userId }],
  }, { partitionKey: userId })
  .fetchAll();
```

Savings multiply with:
- Large documents (MB-sized)
- Large result sets
- High query frequency

Reference: [Project fields in queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/select)
