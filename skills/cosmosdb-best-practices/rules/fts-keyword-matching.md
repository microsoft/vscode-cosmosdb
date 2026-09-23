---
title: Use FullTextContains for keyword matching on indexed text fields
impact: HIGH
impactDescription: replaces expensive CONTAINS(LOWER(...)) string scans with O(log n) inverted index lookup
tags:
  - fts
  - full-text-search
  - query
  - performance
  - java
---

## Use FullTextContains for Keyword Matching

**Impact: HIGH (replaces expensive CONTAINS(LOWER(...)) string scans with O(log n) inverted index lookup)**

`FullTextContains(path, term)` performs a single-keyword lookup against the inverted index and is case-insensitive by design. It is dramatically faster than `CONTAINS(LOWER(c.field), @q)` on large containers because it does an `O(log n)` index lookup instead of a full document scan.

**Incorrect (scan-based — avoid for long text fields with FTS index):**

```sql
-- Full document scan, case folding at query time
SELECT * FROM c
WHERE CONTAINS(LOWER(c.description), @q)
```

```java
String sql = "SELECT * FROM c WHERE CONTAINS(LOWER(c.description), @q)";
```

**Correct:**

```sql
-- Inverted index lookup — no LOWER() needed, FTS tokenizer handles casing
SELECT * FROM c
WHERE FullTextContains(c.description, @q)
```

```java
// Java SDK — parameterized query with FullTextContains
String sql = "SELECT * FROM c WHERE c.type = 'video' " +
    "AND (CONTAINS(LOWER(c.name), @q) " +          // short field — range index OK
    "OR FullTextContains(c.description, @q) " +    // long text — FTS index
    "OR EXISTS(SELECT VALUE t FROM t IN c.tags WHERE CONTAINS(LOWER(t), @q)))";

SqlQuerySpec querySpec = new SqlQuerySpec(sql,
    new SqlParameter("@q", query.trim().toLowerCase()));

return container.queryItems(querySpec, opts, Video.class)
    .byPage(continuationToken, pageSize)
    .next()
    .map(page -> new ResultListPage<>(page.getResults(), page.getContinuationToken()))
    .toFuture();
```

**Variants:**
- `FullTextContains(path, term)` — document contains the term
- `FullTextContainsAll(path, term1, term2, ...)` — document contains ALL terms (AND)
- `FullTextContainsAny(path, term1, term2, ...)` — document contains ANY term (OR)

Reference: [FullTextContains function](https://learn.microsoft.com/azure/cosmos-db/nosql/query/fulltextcontains)
