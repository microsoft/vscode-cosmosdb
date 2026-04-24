# FULLTEXT_CONTAINS

**Category:** Full-text search
**Syntax:** `FULLTEXT_CONTAINS(field, term)`

Returns a Boolean indicating whether the field contains the specified term using full-text search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `field` | expression | The field to search. |
| `term` | string | The term to search for. |

## Return Value
Returns `true` or `false`.

## Notes
- Also available as `FULLTEXTCONTAINS`.
- Requires a full-text index on the field.

---

📖 **Documentation:** [FULLTEXT_CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontains)
