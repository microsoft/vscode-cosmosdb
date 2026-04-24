# AVG

**Category:** Aggregate
**Syntax:** `AVG(expression)`

Returns the average of the values in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | numeric | A numeric expression. |

## Return Value
Returns a numeric value.

## Examples
```sql
SELECT AVG(c.price) FROM c
SELECT AVG(c.score) FROM c WHERE c.active = true
```

## Notes
- Non-numeric values are skipped.
- Returns `undefined` if no numeric values are found.

---

📖 **Documentation:** [AVG](https://learn.microsoft.com/en-us/cosmos-db/query/avg)
