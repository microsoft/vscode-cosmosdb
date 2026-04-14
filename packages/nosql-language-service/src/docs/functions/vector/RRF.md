# RRF

**Category:** Vector/AI
**Syntax:** `RRF(score1, score2, ...)`

Reciprocal Rank Fusion — combines multiple ranking scores into a single score.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `score1` | numeric | First score expression. |
| `score2` | numeric | Second score expression. |

Additional scores may follow.

## Return Value
Returns a numeric combined score.

## Notes
- Used with `ORDER BY RANK` for hybrid search queries.

---

📖 **Documentation:** [RRF](https://learn.microsoft.com/en-us/cosmos-db/query/rrf)
