---
title: Match Composite Index Paths and Sort Directions
impact: HIGH
impactDescription: prevents query failures and rejected sorts
tags: index, composite, orderby, direction, ascending, descending
---

## Match Composite Index Paths and Sort Directions

A composite index for `ORDER BY` contains two or more property paths in the same sequence as the sort clause. It supports the declared directions and the opposite directions on **all** paths. Reversing only some directions does not match that index.

Queries sorting on two or more properties require a matching composite index, whether or not they cross partitions. A single-property `ORDER BY` can use a range index; crossing partitions alone does not make a composite index necessary.

**Incorrect (only one direction is reversed):**

```python
indexing_policy = {
    "compositeIndexes": [
        [
            {"path": "/gameId", "order": "ascending"},
            {"path": "/score", "order": "descending"}
        ]
    ]
}

query = "SELECT * FROM c ORDER BY c.gameId ASC, c.score ASC"
```

The query reverses only `/score`, so the declared composite index cannot serve it. The query needs another matching composite index; the service does not fall back to a scan for an unsupported multi-property sort.

**Correct (one composite serves the declared order and its full reverse):**

```python
indexing_policy = {
    "compositeIndexes": [
        [
            {"path": "/gameId", "order": "ascending"},
            {"path": "/score", "order": "descending"}
        ]
    ]
}

forward_query = "SELECT * FROM c ORDER BY c.gameId ASC, c.score DESC"
reverse_query = "SELECT * FROM c ORDER BY c.gameId DESC, c.score ASC"
```

```csharp
var indexingPolicy = new IndexingPolicy
{
    CompositeIndexes =
    {
        new Collection<CompositePath>
        {
            new CompositePath { Path = "/gameId", Order = CompositePathSortOrder.Ascending },
            new CompositePath { Path = "/score", Order = CompositePathSortOrder.Descending }
        }
    }
};

var forwardQuery = "SELECT * FROM c ORDER BY c.gameId ASC, c.score DESC";
var reverseQuery = "SELECT * FROM c ORDER BY c.gameId DESC, c.score ASC";
```

Both queries use the same path sequence, with every direction reversed in the second query. A separate inverse-direction composite would be redundant. Add another index only for a different required path sequence or direction combination that the existing index cannot serve.

**Single-property sorting uses range indexing:**

```sql
SELECT * FROM c ORDER BY c.score ASC
```

With an appropriate range index on `/score`, this query does not require a composite index, including when it runs across partitions.

See also: [Composite-index requirements and optional optimizations](index-composite.md).

Reference: [Composite index sort order](https://learn.microsoft.com/azure/cosmos-db/index-policy#composite-indexes)
