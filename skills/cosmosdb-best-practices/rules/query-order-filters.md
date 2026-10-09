---
title: Let the Query Engine Order Filters
impact: MEDIUM
impactDescription: avoids ineffective predicate-order tuning and incorrect execution assumptions
tags: query, filters, optimization, performance
---

## Let the Query Engine Order Filters

Cosmos DB's query engine chooses how to evaluate filters. For index-backed `AND` conditions, it can reorder filter plans based on estimated cost rather than their textual positions. Do not rely on placing the most selective predicate first in `WHERE` as a performance optimization. Write readable predicates and evaluate performance using index utilization, query metrics, and request charges.

**Incorrect (assuming lower RU cost solely from reordering equivalent predicates):**

```csharp
var originalQuery = @"
    SELECT * FROM c
    WHERE c.status = 'active'
    AND c.type = 'order'
    AND c.customerId = @customerId";

var reorderedQuery = @"
    SELECT * FROM c
    WHERE c.customerId = @customerId
    AND c.type = 'order'
    AND c.status = 'active'";
```

Both queries express the same filters. Putting `customerId` first is not, by itself, evidence that `reorderedQuery` costs fewer RUs. Do not infer execution order or intermediate result counts from predicate positions.

**Correct (use readable predicates and optimize actual index usage):**

```csharp
var query = new QueryDefinition(@"
    SELECT * FROM c
    WHERE c.customerId = @customerId
    AND c.orderDate >= @startDate
    AND c.orderDate < @endDate
    AND c.status = 'completed'")
    .WithParameter("@customerId", customerId)
    .WithParameter("@startDate", startDate)
    .WithParameter("@endDate", endDate);
```

These predicates select completed orders for one customer within a date interval, including the start and excluding the end. For string-valued `orderDate`, use the same canonical UTC ISO 8601 format for stored values and both bounds. Selectivity depends on the data and parameter values; the predicate order is for readability, not an execution hint. To tune performance, inspect index usage and measured request charges/query metrics rather than assuming that swapping the same predicates reduces work.

**ID range with a status filter:**

```csharp
var idRangeQuery = new QueryDefinition(@"
    SELECT * FROM c
    WHERE c.orderId >= @startId
    AND c.orderId <= @endId
    AND c.status = 'active'")
    .WithParameter("@startId", startId)
    .WithParameter("@endId", endId);
```

Both ID bounds are inclusive. A range on an ID is not inherently highly selective: its width and the data distribution determine how many items match. Check index utilization and actual request charges rather than assuming savings from the property name or its position in `WHERE`.

**Preserve Boolean grouping when using `OR` or `IN`:**

```csharp
var groupedQuery = new QueryDefinition(@"
    SELECT * FROM c
    WHERE (c.status = 'a' OR c.status = 'b')
    AND c.customerId = @customerId")
    .WithParameter("@customerId", customerId);

var inQuery = new QueryDefinition(@"
    SELECT * FROM c
    WHERE c.status IN ('a', 'b')
    AND c.customerId = @customerId")
    .WithParameter("@customerId", customerId);
```

These queries select the same documents: either status for the specified customer. `IN` is a concise alternative here, not a claim of lower RU cost.

Removing the parentheses changes the meaning:

```csharp
var ungroupedQuery = new QueryDefinition(@"
    SELECT * FROM c
    WHERE c.status = 'a' OR c.status = 'b'
    AND c.customerId = @customerId")
    .WithParameter("@customerId", customerId);
```

`AND` binds more tightly than `OR`, so this is `status = 'a' OR (status = 'b' AND customerId = @customerId)`. A document with status `'a'` and a different customer matches the ungrouped query but neither of the grouped alternatives. This is a result-set difference, not a performance optimization.

**Key points:**

- Selectivity depends on the data distribution, not just the property name or type.
- Logically equivalent predicate orderings are not a guarantee of identical execution plans or RU charges. Compare performance using representative data and the same indexing policy and request options.
- Add useful filters with appropriate index support; a partition-key equality filter can narrow the query's partition scope regardless of where it appears in the `WHERE` clause.
- Preserve Boolean grouping when rewriting queries. Adding parentheses around `OR` predicates can change which documents match; it is not merely a performance rewrite.

See also: [Avoid cross-partition queries](query-avoid-cross-partition.md), [avoid full scans](query-avoid-scans.md), [combine FTS with indexed filters](fts-hybrid-queries.md).

Reference: [Index usage and filter-clause ordering](https://learn.microsoft.com/azure/cosmos-db/index-overview#composite-indexes)
