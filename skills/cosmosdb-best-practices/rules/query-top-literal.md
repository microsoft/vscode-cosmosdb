---
title: Use Literal Integers for TOP, Never Parameters
impact: HIGH
impactDescription: prevents query failures at runtime
tags: query, top, parameter, literal
---

## Use Literal Integers for TOP, Never Parameters

The `TOP` keyword in Cosmos DB SQL requires a literal integer — it does **not** support parameterized values. Using `@param` in `SELECT TOP @param` will fail at runtime with a query syntax error.

**Incorrect (parameterized TOP — fails at runtime):**

```python
# This causes a 400 Bad Request or runtime error
query = "SELECT TOP @top * FROM c ORDER BY c.score DESC"
params = [{"name": "@top", "value": 10}]
items = container.query_items(query, parameters=params, enable_cross_partition_query=True)
```

```csharp
// This will also fail
var query = new QueryDefinition("SELECT TOP @top * FROM c ORDER BY c.score DESC")
    .WithParameter("@top", 10);
```

**Correct (literal integer in TOP clause):**

```python
# Use a literal integer for TOP — validate and cast to int to prevent injection
top = int(top)  # Ensures it's a safe integer
query = f"SELECT TOP {top} * FROM c ORDER BY c.score DESC"
items = container.query_items(query, enable_cross_partition_query=True)
```

```csharp
// Interpolate a validated integer for TOP
int topN = 10;
var query = new QueryDefinition($"SELECT TOP {topN} * FROM c ORDER BY c.score DESC");
```

```python
# Keep other values parameterized — only TOP must be literal
top = int(top)
query = f"SELECT TOP {top} * FROM c WHERE c.gameId = @gameId ORDER BY c.score DESC"
params = [{"name": "@gameId", "value": game_id}]
items = container.query_items(query, parameters=params, enable_cross_partition_query=True)
```

Always cast the TOP value to `int` before interpolation to ensure it is a safe integer and prevent injection.

Reference: [SQL query TOP keyword](https://learn.microsoft.com/azure/cosmos-db/nosql/query/select#top-keyword)
