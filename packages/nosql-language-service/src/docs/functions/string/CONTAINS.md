# CONTAINS

**Category:** String
**Syntax:** `CONTAINS(string, substring [, ignoreCase])`

Returns a Boolean indicating whether the first string expression contains the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `string` | string | The string to search in. |
| `substring` | string | The string to search for. |
| `ignoreCase` | boolean | Optional. Case-insensitive search when `true`. |

## Return Value
Returns `true` or `false`.

## Examples
```sql
SELECT * FROM c WHERE CONTAINS(c.name, 'smith', true)
```

---

📖 **Documentation:** [CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/contains)
