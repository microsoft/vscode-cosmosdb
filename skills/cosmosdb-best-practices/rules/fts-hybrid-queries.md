---
title: Combine FTS predicates with range or equality filters for hybrid queries
impact: MEDIUM
impactDescription: avoids full-container scans when combined with equality/range filters
tags:
  - fts
  - full-text-search
  - query
  - hybrid
  - performance
  - java
---

## Combine FTS with Range Filters for Hybrid Queries

**Impact: MEDIUM (avoids full-container scans when combined with equality/range filters)**

FTS predicates can be combined with standard SQL predicates. Add selective equality or range filters with appropriate indexes to narrow the matching document set, and include a partition-key equality filter when the query should be scoped to that partition. Let the query engine choose predicate evaluation order; do not rely on moving a predicate earlier in `WHERE` to reduce query cost.

**Incorrect (FTS-only query — no range filters, scans all partitions):**

```sql
-- ❌ No equality filter — Cosmos DB must scan every partition before ranking
SELECT * FROM c
WHERE FullTextContains(c.description, @q)
ORDER BY RANK FullTextScore(c.description, @q)
```

**Correct — filter by partition + FTS:**

```sql
SELECT * FROM c
WHERE c.type = 'video'
  AND c.userid = @userid
  AND FullTextContains(c.description, @q)
ORDER BY RANK FullTextScore(c.description, @q)
```

```java
// Hybrid: exact field filters narrow partition, FTS ranks within results
String sql = "SELECT * FROM c " +
    "WHERE c.type = 'video' " +
    "AND FullTextContains(c.description, @q) " +
    "ORDER BY RANK FullTextScore(c.description, @q)";

CosmosQueryRequestOptions opts = new CosmosQueryRequestOptions();
// enableCrossPartitionQuery is true by default for FTS ORDER BY RANK

return container.queryItems(
    new SqlQuerySpec(sql, new SqlParameter("@q", term)),
    opts, Video.class
).byPage(pageSize).next().toFuture();
```

**Fields that should NOT use FTS:**
- Short identifiers (`id`, `userid`) — use point read or range index equality
- Numeric fields — use range index with `=`, `>`, `<`
- Array elements already indexed with `[]/?` — `CONTAINS(LOWER(t), @q)` via EXISTS is fine

References: [Full-text search queries](https://learn.microsoft.com/azure/cosmos-db/gen-ai/full-text-search), [index usage and filter-clause ordering](https://learn.microsoft.com/azure/cosmos-db/index-overview#composite-indexes)
