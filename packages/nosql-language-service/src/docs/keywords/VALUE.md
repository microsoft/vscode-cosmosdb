# VALUE

Returns scalar values instead of JSON objects.

## Syntax
```sql
SELECT VALUE <expression>
```

## Examples
```sql
SELECT VALUE c.name FROM c
-- Returns: ['Alice', 'Bob'] instead of [{name:'Alice'}, ...]
```

---

📖 **Documentation:** [VALUE](https://learn.microsoft.com/en-us/cosmos-db/query/select#select-value)
