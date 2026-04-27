# JOIN

Joins with a nested array or subquery within the same document. Unlike standard SQL JOINs, Cosmos DB JOINs are intra-document (self-joins on arrays).

## Syntax
```sql
FROM c JOIN child IN c.children
```

## Examples
```sql
SELECT c.id, child.name
FROM c
JOIN child IN c.children
WHERE child.age > 10
```

---

📖 **Documentation:** [JOIN](https://learn.microsoft.com/en-us/cosmos-db/query/join)
