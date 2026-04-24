# MAKELIST

**Category:** Aggregate
**Syntax:** `MAKELIST(expression)`

Aggregates values into an array. Used within GROUP BY queries.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | any | Any scalar expression. |

## Return Value
Returns an array of all values within the group.

## Examples
```sql
SELECT c.category, MAKELIST(c.name)
FROM c
GROUP BY c.category
```

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.
