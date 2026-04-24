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

---

📖 **Documentation:** [ORDER_BY](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)
