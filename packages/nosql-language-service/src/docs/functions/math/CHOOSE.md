# CHOOSE

**Category:** Math
**Syntax:** `CHOOSE(index, value1, value2, ...)`

Returns the item at the specified 1-based index from a list of values. Returns `undefined` if index is out of bounds.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `index` | integer | 1-based index (positive integer). |
| `value1` | any | First value in the list. |
| `value2` | any | Second value (and more optional). |

## Return Value
Returns the value at the specified index position.

## Examples
```sql
SELECT CHOOSE(2, "a", "b", "c") -- "b"
```

---

📖 **Documentation:** [CHOOSE](https://learn.microsoft.com/en-us/cosmos-db/query/choose)
