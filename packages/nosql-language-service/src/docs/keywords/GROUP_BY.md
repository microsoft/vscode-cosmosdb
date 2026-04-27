# GROUP BY

Groups results by one or more expressions. Used with aggregate functions.

## Syntax
```sql
GROUP BY expr [, ...]
```

## Examples
```sql
SELECT c.category, COUNT(1) as count
FROM c
GROUP BY c.category
```

---

📖 **Documentation:** [GROUP_BY](https://learn.microsoft.com/en-us/cosmos-db/query/group-by)
