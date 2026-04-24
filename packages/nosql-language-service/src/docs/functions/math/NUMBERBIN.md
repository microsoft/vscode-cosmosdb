# NUMBERBIN

**Category:** Math
**Syntax:** `NUMBERBIN(number, binSize)`

Rounds a numeric value down to a multiple of the specified bin size.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `number` | numeric | The numeric value to bin. |
| `binSize` | numeric | The bin size. |

## Return Value
Returns a numeric value.

## Examples
```sql
SELECT NUMBERBIN(13.5, 5) -- 10
```

---

📖 **Documentation:** [NUMBERBIN](https://learn.microsoft.com/en-us/cosmos-db/query/numberbin)
