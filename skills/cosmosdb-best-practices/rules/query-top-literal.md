---
title: Parameterize TOP Values Safely
impact: HIGH
impactDescription: prevents incorrect query guidance and keeps parameterization secure
tags: query, top, parameter, security
---

## Parameterize TOP Values Safely

Cosmos DB SQL supports both literal and parameterized values for `TOP`. Prefer parameterized `TOP` values for consistency with secure query practices. Ensure the parameter value is an integer.

**Incorrect (string interpolation for TOP):**

```python
# Avoid string interpolation when parameterization works
top = int(top)
query = f"SELECT TOP {top} * FROM c ORDER BY c.score DESC"
items = container.query_items(query, enable_cross_partition_query=True)
```

```csharp
// Avoid interpolating TOP directly when parameters are available
int topN = 10;
var query = new QueryDefinition($"SELECT TOP {topN} * FROM c ORDER BY c.score DESC");
```

**Correct (parameterized TOP):**

```python
# TOP can be parameterized
query = "SELECT TOP @top * FROM c ORDER BY c.score DESC"
params = [{"name": "@top", "value": int(top)}]
items = container.query_items(query, parameters=params, enable_cross_partition_query=True)
```

```csharp
var query = new QueryDefinition("SELECT TOP @top * FROM c ORDER BY c.score DESC")
    .WithParameter("@top", 10);
```

```python
# Keep all query values parameterized, including TOP
query = "SELECT TOP @top * FROM c WHERE c.gameId = @gameId ORDER BY c.score DESC"
params = [
    {"name": "@top", "value": int(top)},
    {"name": "@gameId", "value": game_id},
]
items = container.query_items(query, parameters=params, enable_cross_partition_query=True)
```

Use a literal integer in `TOP` only when it is genuinely constant at authoring time (for example, `TOP 10`).

References:
- [Parameterized queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/parameterized-queries)
- [SQL query TOP keyword](https://learn.microsoft.com/azure/cosmos-db/nosql/query/select#top-keyword)
