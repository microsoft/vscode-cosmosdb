# SELECT

Specifies the fields or expressions to return from the query.

## Syntax
```sql
SELECT [DISTINCT] [TOP n] <select_spec>
```

## Variants
- `SELECT *` — return all fields
- `SELECT VALUE expr` — return scalar values
- `SELECT expr [AS alias], ...` — return specific fields
- `SELECT DISTINCT` — remove duplicates
- `SELECT TOP n` — limit to first n results

---

📖 **Documentation:** [SELECT](https://learn.microsoft.com/en-us/cosmos-db/query/select)
