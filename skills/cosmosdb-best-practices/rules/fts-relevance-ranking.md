---
title: Use FullTextScore with ORDER BY RANK for BM25 relevance ranking
impact: MEDIUM-HIGH
impactDescription: enables BM25-based ranked results instead of arbitrary order
tags:
  - fts
  - full-text-search
  - query
  - ranking
  - relevance
  - java
---

## Use FullTextScore for Relevance Ranking

**Impact: MEDIUM-HIGH (enables BM25-based ranked results instead of arbitrary order)**

`FullTextScore(path, term)` returns a BM25 relevance score. Use it in `ORDER BY` to surface the most relevant documents first. It **requires** `FullTextContains` in the WHERE clause on the same path.

**Incorrect (FullTextScore without FullTextContains — parse error):**

```sql
SELECT * FROM c
ORDER BY FullTextScore(c.description, 'cosmos')  -- ❌ missing WHERE FullTextContains
```

**Correct:**

```sql
SELECT c.name, c.description, c.addedDate
FROM c
WHERE FullTextContains(c.description, @q)
ORDER BY RANK FullTextScore(c.description, @q)
```

```java
String sql = "SELECT c.name, c.description, c.addedDate FROM c " +
    "WHERE FullTextContains(c.description, @q) " +
    "ORDER BY RANK FullTextScore(c.description, @q)";

SqlQuerySpec querySpec = new SqlQuerySpec(sql, new SqlParameter("@q", searchTerm));
```

> `RANK FullTextScore(...)` is cross-partition — Cosmos DB merges and re-ranks results from all partitions before returning the page.

Reference: [FullTextScore function](https://learn.microsoft.com/azure/cosmos-db/nosql/query/fulltextscore)
