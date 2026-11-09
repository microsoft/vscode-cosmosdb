# Volumetrics

The following are synthetic planning assumptions from [workload.json](workload.json), not observed traffic or guarantees.

| # | Schema | Table | Est. Row Count | Avg Row Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |
|---:|---|---|---:|---:|---|---:|---:|---|
| 1 | dbo | BuildVersion | 1 (estimated) | 0.128 (estimated) | 0% (estimated) | 0.001 (estimated) | 0 (estimated) | Synthetic version metadata; bounded by the TINYINT key, not an observed population. |
| 2 | dbo | ErrorLog | 2000 (estimated) | 0.75 (estimated) | 10% (estimated) | 0.05 (estimated) | 0.2 (estimated) | Synthetic only; no application access found. |
| 3 | SalesLT | Address | 1500 (estimated) | 0.5 (estimated) | 2% (estimated) | 0.5 (estimated) | 0.02 (estimated) | Synthetic only; no application access found. |
| 4 | SalesLT | Customer | 1000 (estimated) | 1 (estimated) | 2% (estimated) | 5 (estimated) | 0.1 (estimated) | Synthetic only; actual access mix unknown. |
| 5 | SalesLT | CustomerAddress | 2000 (estimated) | 0.128 (estimated) | 2% (estimated) | 0.2 (estimated) | 0.02 (estimated) | Synthetic only; no application access found. |
| 6 | SalesLT | Product | 1000 (estimated) | 2 (estimated) | 1% (estimated) | 20 (estimated) | 0.2 (estimated) | Synthetic average does not bound binary photo size. |
| 7 | SalesLT | ProductCategory | 50 (estimated) | 0.128 (estimated) | 0% (estimated) | 25 (estimated) | 0.01 (estimated) | Synthetic small hierarchy; actual access mix unknown. |
| 8 | SalesLT | ProductDescription | 1500 (estimated) | 0.5 (estimated) | 1% (estimated) | 1 (estimated) | 0.01 (estimated) | Synthetic only; no application access found. |
| 9 | SalesLT | ProductModel | 250 (estimated) | 1 (estimated) | 1% (estimated) | 25 (estimated) | 0.02 (estimated) | Synthetic average does not bound XML size. |
| 10 | SalesLT | ProductModelProductDescription | 2000 (estimated) | 0.064 (estimated) | 1% (estimated) | 1 (estimated) | 0.01 (estimated) | Synthetic only; no application access found. |
| 11 | SalesLT | SalesOrderDetail | 40000 (estimated) | 0.128 (estimated) | 5% (estimated) | 4 (estimated) | 0.8 (estimated) | Synthetic aggregate counts do not bound details per order. |
| 12 | SalesLT | SalesOrderHeader | 10000 (estimated) | 1 (estimated) | 5% (estimated) | 2 (estimated) | 0.2 (estimated) | Synthetic average does not bound comment size. |

## Workload Notes

Table-specific figures are scenario inputs, not evidence that each table is read or written, and cannot be allocated
to individual controller patterns. TPS represents hypothetical short busy windows, not continuous averages.
There is no observed window or evidence that overlapping per-table operations are additive; writes do not imply net inserts.
Sizes use decimal KB (1,000 bytes). Growth scenarios compound each table's net monthly rate for 12 months with unchanged
average sizes; they are not retention policies or forecasts. Peak load, retention, skew, item-size percentiles, latency,
regional intent, and consistency remain unknown.
Collation in workload.json is an assumption, not a DDL declaration or a verified server setting.
