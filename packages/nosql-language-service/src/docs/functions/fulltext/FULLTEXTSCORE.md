# FULLTEXTSCORE

**Category:** Full-text search
**Syntax:** `FULLTEXTSCORE(field, term)`

Returns the BM25 relevance score for the specified full-text search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `field` | expression | The field to score. |
| `term` | string | The search term. |

## Return Value
Returns a numeric relevance score.

## Notes
- Used with `ORDER BY RANK` for relevance ranking.

---

📖 **Documentation:** [FULLTEXTSCORE](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextscore)
