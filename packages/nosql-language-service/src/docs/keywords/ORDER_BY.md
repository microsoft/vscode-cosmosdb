# ORDER BY

Sorts the result set by one or more expressions.

## Syntax

```sql
ORDER BY expr [ASC|DESC] [, ...]
ORDER BY RANK score_function(...)
```

## Notes

- For regular property sorting, the default direction is ascending (ASC).
- Multi-property sorting requires a composite index with the same property-path sequence.
  Its directions can match the query or be reversed on every path; reversing only some
  directions is not supported by that index. For example, `(category ASC, price DESC)`
  also supports `(category DESC, price ASC)` without a separate inverse index.
- `ORDER BY RANK` is used with full-text and vector search scoring functions.
- Explicit `ASC` or `DESC` is not allowed with `ORDER BY RANK`. These clauses can parse,
  but the language service reports a semantic error; omit the direction modifier.
- Vector similarity also supports regular `ORDER BY VectorDistance(...)`.
- **Not allowed inside a subquery.** Azure Cosmos DB rejects `ORDER BY` within any
  subquery — `FIRST(…)`, `LAST(…)`, `ARRAY(…)`, `EXISTS(…)`, `(SELECT …)`, and
  `FROM (SELECT …)`. Only the outermost query may sort. (The grammar accepts it, but
  the engine returns HTTP 400.)

---

📖 **Documentation:** [ORDER_BY](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)

- [ORDER BY RANK](https://learn.microsoft.com/en-us/cosmos-db/query/order-by-rank)
- [Composite-index ordering](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy#order-by-queries-on-multiple-properties)
