# Volumetrics

> Fill in the table below with volumetric data for each table or entity in your database.
> This information helps the migration assistant estimate request unit (RU) consumption
> and choose optimal partition keys for Azure Cosmos DB.
>
> Leave cells empty if you don't have estimates. The migration assistant will try to infer missing values.
>
> **TPS** = Transactions Per Second under normal load.

| # | Schema | Table | Est. Row Count | Avg Row Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |
|---:|---|---|---:|---:|---|---:|---:|---|

## Workload Notes (optional)

- **Peak vs. average TPS** — peak-to-average ratio, peak windows, or seasonal spikes.
- **TTL / retention per table** — retention, purge, or archive policies.
- **Document size P95 / P99** — high-percentile size when averages hide outliers.
- **Hot partitions / data skew** — known concentration among keys or tenants.
- **Read mix per table** — point, single-partition, and cross-partition query mix when known.
- **Write mix per table** — inserts, updates, deletes, and batch or initial-load behavior.
- **Account-level intent** — regions, consistency, and capacity-mode preferences.

<!-- Add provenance and other workload context here. Mark inferred values as estimated. -->
