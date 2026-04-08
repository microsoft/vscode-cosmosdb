---
title: Composite Index Directions Must Match ORDER BY
impact: HIGH
impactDescription: prevents query failures and rejected sorts
tags: index, composite, orderby, direction, ascending, descending
---

## Composite Index Directions Must Match ORDER BY

Every composite index entry must specify sort directions that **exactly match** the `ORDER BY` clause of the queries it serves. If the directions don't match, Cosmos DB will reject the query or fall back to an expensive scan.

For cross-partition `ORDER BY` queries, this is especially critical — the query **will fail** if no matching composite index exists.

**Incorrect (direction mismatch — query fails):**

```python
# Composite index defined as descending
indexing_policy = {
    "compositeIndexes": [
        [{"path": "/score", "order": "descending"}]
    ]
}

# But query uses ascending order — no matching index!
query = "SELECT * FROM c ORDER BY c.score ASC"
# Fails: "The order by query does not have a corresponding composite index"
```

```csharp
// Index covers (score DESC) only
new Collection<CompositePath>
{
    new CompositePath { Path = "/score", Order = CompositePathSortOrder.Descending }
}

// Query needs ASC — fails!
var query = "SELECT * FROM c ORDER BY c.score ASC";
```

**Correct (directions match exactly, with both orderings):**

```python
# Define BOTH directions to support ASC and DESC queries
indexing_policy = {
    "compositeIndexes": [
        [{"path": "/score", "order": "descending"}],
        [{"path": "/score", "order": "ascending"}]
    ]
}
```

```csharp
// Always provide both sort directions for each composite index pattern
CompositeIndexes =
{
    // For ORDER BY score DESC
    new Collection<CompositePath>
    {
        new CompositePath { Path = "/score", Order = CompositePathSortOrder.Descending }
    },
    // For ORDER BY score ASC
    new Collection<CompositePath>
    {
        new CompositePath { Path = "/score", Order = CompositePathSortOrder.Ascending }
    }
}
```

```python
# Multi-property example: provide paired directions
indexing_policy = {
    "compositeIndexes": [
        # For ORDER BY gameId ASC, score DESC
        [
            {"path": "/gameId", "order": "ascending"},
            {"path": "/score", "order": "descending"}
        ],
        # For ORDER BY gameId DESC, score ASC (reverse pair)
        [
            {"path": "/gameId", "order": "descending"},
            {"path": "/score", "order": "ascending"}
        ]
    ]
}
```

**Best practice: whenever you define a composite index, always include the inverse direction pair** so that both ASC and DESC queries on those paths are served.

Reference: [Composite index sort order](https://learn.microsoft.com/azure/cosmos-db/index-policy#composite-indexes)
