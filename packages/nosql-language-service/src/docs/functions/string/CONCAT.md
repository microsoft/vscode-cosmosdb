# CONCAT

**Category:** String
**Syntax:** `CONCAT(string1, string2 [, ...])`

Returns a string that is the result of concatenating two or more string values.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `string1` | string | First string. |
| `string2` | string | Second string. |

Additional strings can follow.

## Return Value
Returns the concatenated string.

## Examples
```sql
SELECT CONCAT(c.firstName, ' ', c.lastName) FROM c
```

---

📖 **Documentation:** [CONCAT](https://learn.microsoft.com/en-us/cosmos-db/query/concat)
