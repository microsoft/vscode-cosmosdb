# OFFSET

Skips a specified number of results (for pagination).

## Syntax
```sql
OFFSET n LIMIT m
```

## Notes
- Must be used together with LIMIT.
- Can use parameters: `OFFSET @skip LIMIT @take`

---

📖 **Documentation:** [OFFSET](https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit)
