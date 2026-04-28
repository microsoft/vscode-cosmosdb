# LIKE

Pattern matching with wildcards.

## Syntax
```sql
expr LIKE pattern [ESCAPE char]
expr NOT LIKE pattern
```

## Wildcards
- `%` — matches zero or more characters
- `_` — matches exactly one character

## Examples
```sql
SELECT * FROM c WHERE c.name LIKE '%smith%'
```

---

📖 **Documentation:** [LIKE](https://learn.microsoft.com/en-us/cosmos-db/query/like)
