# EXISTS

Tests if a subquery returns any results.

## Syntax
```sql
EXISTS (SELECT ...)
```

## Examples
```sql
SELECT * FROM c
WHERE EXISTS (SELECT VALUE t FROM t IN c.tags WHERE t = 'important')
```

---

📖 **Documentation:** [EXISTS](https://learn.microsoft.com/en-us/cosmos-db/query/subquery#exists-expression)
