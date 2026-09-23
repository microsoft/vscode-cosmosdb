# OFFSET

Skips a specified number of results (for pagination).

## Syntax

```sql
OFFSET n LIMIT m
```

## Notes

- Must be used together with LIMIT.
- Can use parameters: `OFFSET @skip LIMIT @take`
- RU cost increases with the number of skipped items. For forward paging through large
  result sets, prefer the host or SDK's continuation-token support where available.
- Use OFFSET/LIMIT when bounded skips or random page access are needed, with the cost
  tradeoff in mind; valid syntax does not make it the default pagination strategy.

---

📖 **Documentation:** [OFFSET](https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit)
