# COUNT

**Category:** Aggregate
**Syntax:** `COUNT(expression)`

Returns the count of values in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `expression` | any | Any scalar expression. |

## Return Value
Returns a numeric value.

## Examples
```sql
SELECT COUNT(c.id) FROM c
SELECT COUNT(1) FROM c WHERE c.status = "active"
```

## Notes
- `COUNT(1)` counts all documents including those with
  `undefined` values.
- `COUNT(c.field)` counts only documents where `c.field`
  is defined (not `undefined`).

---

📖 **Documentation:** [COUNT](https://learn.microsoft.com/en-us/cosmos-db/query/count)
