# MAKESET

**Category:** Aggregate
**Syntax:** `MAKESET(expression)`

Aggregates distinct values into an array. Used within GROUP BY queries.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | any | Any scalar expression. |

## Return Value
Returns an array of distinct values within the group.

## Examples
```sql
SELECT c.category, MAKESET(c.tag)
FROM c
GROUP BY c.category
```

## Notes
- Unlike MAKELIST, MAKESET removes duplicate values.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.
