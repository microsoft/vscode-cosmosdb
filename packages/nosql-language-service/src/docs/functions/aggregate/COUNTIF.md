# COUNTIF

**Category:** Aggregate
**Syntax:** `COUNTIF(condition)`

Returns the count of items that satisfy the Boolean condition.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `condition` | boolean | A Boolean expression to evaluate. |

## Return Value
Returns a numeric value.

## Examples
```sql
SELECT COUNTIF(c.status = "active") FROM c
```

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.
