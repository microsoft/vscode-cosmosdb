# MIN

**Category:** Aggregate
**Syntax:** `MIN(expression)`

Returns the minimum value in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | any | Any scalar expression. |

## Return Value
Returns the minimum value, respecting CosmosDB type ordering.

## Examples
```sql
SELECT MIN(c.price) FROM c
```

---

📖 **Documentation:** [MIN](https://learn.microsoft.com/en-us/cosmos-db/query/min)
