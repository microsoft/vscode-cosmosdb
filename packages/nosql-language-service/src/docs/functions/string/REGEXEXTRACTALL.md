# REGEXEXTRACTALL

**Category:** String
**Syntax:** `REGEXEXTRACTALL(string, pattern [, modifiers [, groups]])`

Returns all matches for a regular expression from a source string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `string` | string | The string to search. |
| `pattern` | string | The regex pattern. |
| `modifiers` | string | Optional regex modifiers. |
| `groups` | array | Optional array of capture group IDs. |

## Return Value
Returns an array of match arrays, or `undefined`.

---

📖 **Documentation:** [REGEXEXTRACTALL](https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch)
