# VECTORDISTANCE

**Category:** Vector/AI
**Syntax:** `VECTORDISTANCE(vector1, vector2 [, brute_force [, distanceFunction]])`

Returns the similarity score between two vectors.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| `vector1` | array | First vector (array of numbers). |
| `vector2` | array | Second vector (array of numbers). |
| `brute_force` | boolean | Optional. Force brute-force search. |
| `distanceFunction` | string | Optional: `'cosine'`, `'euclidean'`, or `'dotproduct'`. |

## Return Value
Returns a numeric similarity score.

---

📖 **Documentation:** [VECTORDISTANCE](https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance)
