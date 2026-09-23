---
title: Avoid Multi-Region Writes Without an Active-Active Need
impact: MEDIUM
impactDescription: removes conflict-resolution complexity and replicated write cost
tags: global, multi-region, write, antipattern, conflict, cost
---

## Avoid Multi-Region Writes Without an Active-Active Need

Multi-region writes (multi-master) are valuable for true active-active write availability and very low RTO, but they add conflict-resolution complexity and can increase replicated write cost. Enabling them where they provide no benefit is an antipattern: non-production accounts that copy a production template, accounts where the workload only ever writes to one region, or a single-region account with the flag enabled as a latent tripwire. In these cases, disabling multi-region writes removes complexity and surprise cost with no loss of capability.

**Incorrect (cloning production multi-write config into a dev account that writes to one region):**

```json
{
  "type": "Microsoft.DocumentDB/databaseAccounts",
  "name": "orders-dev",
  "properties": {
    "enableMultipleWriteLocations": true,
    "locations": [
      { "locationName": "West US 2", "failoverPriority": 0 },
      { "locationName": "East US", "failoverPriority": 1 }
    ]
  }
}
```

**Correct (disable multi-region writes — the key change is `enableMultipleWriteLocations: false`; keep other regions as read replicas if you want them):**

```json
{
  "type": "Microsoft.DocumentDB/databaseAccounts",
  "name": "orders-dev",
  "properties": {
    "enableMultipleWriteLocations": false,
    "locations": [
      { "locationName": "West US 2", "failoverPriority": 0 },
      { "locationName": "East US", "failoverPriority": 1 }
    ]
  }
}
```

The secondary region stays for reads (and, if `enableAutomaticFailover` is enabled on the account, as a failover target); only the *multi-write* capability is turned off. (For a dev account that needs just one region, you can also drop the extra location — but that is a separate decision from disabling multi-region writes.)

When multi-region writes ARE justified (keep them enabled):
- The application genuinely writes from multiple regions concurrently and needs local write latency.
- You require write availability during a regional outage (very low RTO) and have a conflict-resolution policy.

If you enable multi-region writes for those reasons, pair them with a deliberate conflict-resolution strategy (see `global-conflict-resolution`). For the legitimate active-active pattern, see `global-multi-region`.

Reference: [Configure multi-region writes](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-multi-master)
