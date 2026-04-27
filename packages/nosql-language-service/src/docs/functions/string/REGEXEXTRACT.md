# REGEXEXTRACT

**Category:** String
**Syntax:** `REGEXEXTRACT(string, pattern [, modifiers [, groupId]])`

Returns the first match for a regular expression from a source string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `string` | string | The string to search. |
| `pattern` | string | The regex pattern. |
| `modifiers` | string | Optional regex modifiers (`'i'`, `'m'`, `'s'`, `'x'`). |
| `groupId` | integer | Optional capture group ID (default: 0). |

## Return Value
Returns the matched string, or `undefined`.

---

📖 **Documentation:** [REGEXEXTRACT](https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch)
