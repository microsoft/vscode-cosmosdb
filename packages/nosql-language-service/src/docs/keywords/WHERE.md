# WHERE

Filters documents by a Boolean condition.

## Syntax
```sql
WHERE <condition>
```

## Examples
```sql
SELECT * FROM c WHERE c.status = 'active'
SELECT * FROM c WHERE c.age > 21 AND c.city = 'Seattle'
```

---

📖 **Documentation:** [WHERE](https://learn.microsoft.com/en-us/cosmos-db/query/where)
