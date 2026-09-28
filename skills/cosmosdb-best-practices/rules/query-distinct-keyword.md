---
title: Use DISTINCT keyword to eliminate duplicate results efficiently
impact: MEDIUM
impactDescription: reduces bandwidth usage and RU consumption by eliminating duplicate results at the query engine level
tags: query, distinct, performance, optimization
---

## Use DISTINCT keyword to eliminate duplicate results efficiently

**Impact: MEDIUM (reduces unnecessary data transfer and RU consumption)**

Azure Cosmos DB supports `SELECT DISTINCT` to eliminate duplicate values during query execution. Prefer using `DISTINCT` rather than retrieving all results and removing duplicates in application code, which increases network bandwidth, client-side processing, and RU consumption.

`DISTINCT` is particularly useful when returning unique property values such as categories, tags, statuses, or identifiers.

**Incorrect (client-side deduplication):**

```csharp
// Query returns duplicate category values
var query = "SELECT c.category FROM c";

var iterator = container.GetItemQueryIterator<dynamic>(query);

var categories = new HashSet<string>();

while (iterator.HasMoreResults)
{
    var response = await iterator.ReadNextAsync();

    foreach (var item in response)
    {
        categories.Add(item.category.ToString());
    }
}

// Duplicate elimination happens after all results
// have already been transferred to the client
```

**Correct (using DISTINCT in Cosmos DB):**

```csharp
// Cosmos DB removes duplicates before returning results
var query = "SELECT DISTINCT c.category FROM c";

var iterator = container.GetItemQueryIterator<dynamic>(query);

while (iterator.HasMoreResults)
{
    var response = await iterator.ReadNextAsync();

    foreach (var item in response)
    {
        Console.WriteLine(item.category);
    }
}
```

**Correct (using DISTINCT VALUE for scalar results):**

```sql
SELECT DISTINCT VALUE c.category
FROM c
```

### Additional considerations

- `DISTINCT` queries rely on indexes for efficient execution; ensure projected fields are indexed.
- `DISTINCT` queries across partitions still perform a fan-out query; prefer partition-scoped queries whenever possible to reduce RU consumption.
- Use `DISTINCT VALUE` when returning a single scalar field to simplify the result shape.

References:
- https://learn.microsoft.com/azure/cosmos-db/nosql/query/keywords#distinct