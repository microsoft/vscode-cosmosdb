---
title: Query "latest" documents with explicit ORDER BY and TOP 1
impact: HIGH
impactDescription: prevents stale or nondeterministic "latest item" results
tags: query, order-by, top, timestamp, latest, correctness
---

## Query "latest" documents with explicit ORDER BY and TOP 1

When returning the latest item for an entity (latest reading, latest status, most recent event), always query with an explicit time field sort and `TOP 1`: `ORDER BY <timestampField> DESC`. Without explicit ordering, Cosmos DB does not guarantee result order and may return an older document.

**Incorrect (no deterministic ordering):**

```java
// ❌ No ORDER BY: can return an older document
String sql = "SELECT TOP 1 * FROM c WHERE c.deviceId = @deviceId";
SqlQuerySpec spec = new SqlQuerySpec(
    sql,
    List.of(new SqlParameter("@deviceId", deviceId))
);
```

```python
# ❌ Client picks "first" item from an unordered query
query = "SELECT * FROM c WHERE c.userId = @uid"
items = list(container.query_items(
    query=query,
    parameters=[{"name": "@uid", "value": user_id}],
    enable_cross_partition_query=True
))
latest = items[0] if items else None
```

**Correct (explicit timestamp sort + TOP 1):**

```java
// ✅ Deterministic latest item by timestamp
String sql = """
    SELECT TOP 1 * FROM c
    WHERE c.deviceId = @deviceId AND IS_DEFINED(c.timestamp)
    ORDER BY c.timestamp DESC
    """;
SqlQuerySpec spec = new SqlQuerySpec(
    sql,
    List.of(new SqlParameter("@deviceId", deviceId))
);
```

```python
# ✅ Deterministic latest item
query = """
SELECT TOP 1 * FROM c
WHERE c.userId = @uid AND IS_DEFINED(c.createdAt)
ORDER BY c.createdAt DESC
"""
items = list(container.query_items(
    query=query,
    parameters=[{"name": "@uid", "value": user_id}],
    enable_cross_partition_query=True
))
latest = items[0] if items else None
```

If the query can span partitions, define the needed index policy for your filter + sort pattern (for example, a composite index when required by your query shape).

Reference: [ORDER BY in Azure Cosmos DB for NoSQL](https://learn.microsoft.com/azure/cosmos-db/nosql/query/order-by) | [TOP keyword](https://learn.microsoft.com/azure/cosmos-db/nosql/query/keywords#top)
