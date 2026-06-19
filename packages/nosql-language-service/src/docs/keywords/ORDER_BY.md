# ORDER BY

Sorts the result set by one or more expressions.

## Syntax

```sql
ORDER BY expr [ASC|DESC] [, ...]
ORDER BY RANK score_function(...)
```

## Notes

- Default sort order is ascending (ASC).
- `ORDER BY RANK` is used with full-text and vector search scoring functions.
- **Not allowed inside a subquery.** Azure Cosmos DB rejects `ORDER BY` within any
  subquery — `FIRST(…)`, `LAST(…)`, `ARRAY(…)`, `EXISTS(…)`, `(SELECT …)`, and
  `FROM (SELECT …)`. Only the outermost query may sort. (The grammar accepts it, but
  the engine returns HTTP 400.)

---

📖 **Documentation:** [ORDER_BY](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)
