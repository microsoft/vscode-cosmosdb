---
title: Project Only Needed Fields
impact: HIGH
impactDescription: reduces RU and network by 30-80%
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

// 70% less data transferred, proportionally lower RU
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

Savings multiply with:
- Large documents (MB-sized)
- Large result sets
- High query frequency

Reference: [Project fields in queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/select)
