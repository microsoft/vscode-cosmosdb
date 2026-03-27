---
title: Order Filters by Selectivity
impact: MEDIUM
impactDescription: reduces intermediate result sets
tags: query, filters, optimization, performance
---

## Order Filters by Selectivity

Place most selective filters first in WHERE clauses. The query engine processes filters left-to-right, so selective filters early reduce data scanned.

**Incorrect (least selective filter first):**

```csharp
// Status has low selectivity (few unique values)
// Filters 1M items to 300K, then to 100
var query = @"
    SELECT * FROM c 
    WHERE c.status = 'active'        -- 30% of items match
    AND c.type = 'order'             -- 10% of items match
    AND c.customerId = @customerId"; -- 0.01% match (highly selective)

// Processes: 1M → 300K → 100K → 100
// More intermediate processing than necessary
```

**Correct (most selective filter first):**

```csharp
// CustomerId is highly selective (unique per customer)
var query = @"
    SELECT * FROM c 
    WHERE c.customerId = @customerId  -- 0.01% match (filter first!)
    AND c.type = 'order'              -- Then narrow by type
    AND c.status = 'active'";         -- Finally by status

// Processes: 1M → 1K → 100 → 100
// Much less intermediate data
```

```csharp
// Selectivity guidelines (from most to least selective):
// 1. Unique identifiers: id, customerId, orderId (highest)
// 2. Foreign keys with many values: productId, userId
// 3. Timestamps (range queries): createdAt, modifiedAt
// 4. Categories with many values: categoryId, departmentId
// 5. Status fields: status, state (low selectivity)
// 6. Boolean flags: isActive, isDeleted (lowest - only 2 values)

// Example: Combining timestamp with status
var query = @"
    SELECT * FROM c 
    WHERE c.customerId = @customerId
    AND c.orderDate >= @startDate
    AND c.orderDate < @endDate
    AND c.status = 'completed'";

// Even better with composite index
```

```csharp
// Use BETWEEN with high selectivity values
var query = @"
    SELECT * FROM c 
    WHERE c.orderId >= @startId AND c.orderId <= @endId  -- Very selective range
    AND c.status = 'active'";

// For OR clauses, check if rewriting helps
// Less efficient:
var query1 = "SELECT * FROM c WHERE c.status = 'a' OR c.status = 'b' AND c.customerId = @id";
// Better (explicit grouping):
var query2 = "SELECT * FROM c WHERE (c.status = 'a' OR c.status = 'b') AND c.customerId = @id";
// Best (if possible, use IN):
var query3 = "SELECT * FROM c WHERE c.status IN ('a', 'b') AND c.customerId = @id";
```

Reference: [Query optimization tips](https://learn.microsoft.com/azure/cosmos-db/nosql/performance-tips-query-sdk)
