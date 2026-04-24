# MAX

**Category:** Aggregate
**Syntax:** `MAX(expression)`

Returns the maximum value in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | any | Any scalar expression. |

## Return Value
Returns the maximum value, respecting CosmosDB type ordering.

## Examples
```sql
SELECT MAX(c.price) FROM c
```

---

📖 **Documentation:** [MAX](https://learn.microsoft.com/en-us/cosmos-db/query/max)
