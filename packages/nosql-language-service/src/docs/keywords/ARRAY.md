# ARRAY

Creates an array from a subquery expression.

## Syntax
```sql
ARRAY (SELECT ...)
```

## Examples
```sql
SELECT c.id, ARRAY(SELECT t FROM t IN c.tags) AS tags FROM c
```

---

📖 **Documentation:** [ARRAY](https://learn.microsoft.com/en-us/cosmos-db/query/constants)
