# VECTORDISTANCE

**Category:** Vector/AI
**Syntax:** `VECTORDISTANCE(vector1, vector2 [, brute_force [, options]])`

Returns the similarity score between two vectors.

## Parameters

| Name          | Type    | Description                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `vector1`     | array   | First vector (array of numbers).                                                                 |
| `vector2`     | array   | Second vector (array of numbers).                                                                |
| `brute_force` | boolean | Optional. `true` forces brute-force search; `false` (default) uses a vector index if one exists. |
| `options`     | object  | Optional JSON object with distance and search options.                                           |

The fourth argument is an object, not a distance-function string. Options include
`distanceFunction` (`'Cosine'`, `'Euclidean'`, or `'DotProduct'`), `dataType`,
`searchListSizeMultiplier`, `quantizedVectorListMultiplier`, and `filterPriority`.

## Return Value

Returns a numeric similarity score.

## Usage

Project the score with `SELECT`, or sort with regular `ORDER BY VectorDistance(...)`
or `ORDER BY RANK VectorDistance(...)`. A vector index improves search performance;
it is not required for brute-force evaluation.

```sql
SELECT TOP 10 c.id
FROM c
ORDER BY VectorDistance(c.embedding, @queryVector, false, {distanceFunction: 'Cosine', dataType: 'Float32'})
```

---

📖 **Documentation:** [VECTORDISTANCE](https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance)
