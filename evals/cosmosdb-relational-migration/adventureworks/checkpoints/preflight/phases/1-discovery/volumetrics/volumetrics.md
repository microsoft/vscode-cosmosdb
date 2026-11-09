# Volumetrics

The following are synthetic planning assumptions from [workload.json](workload.json), not observed traffic or guarantees.

| # | Schema | Table | Est. Row Count | Avg Row Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |
|---:|---|---|---:|---:|---|---:|---:|---|
| 1 | dbo | BuildVersion | unknown | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic 1000 rows is infeasible for the TINYINT primary key; not accepted as a feasible count. |
| 2 | dbo | ErrorLog | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 3 | SalesLT | Address | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 4 | SalesLT | Customer | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; actual access mix unknown. |
| 5 | SalesLT | CustomerAddress | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 6 | SalesLT | Product | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic average does not bound binary photo size. |
| 7 | SalesLT | ProductCategory | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; actual access mix unknown. |
| 8 | SalesLT | ProductDescription | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 9 | SalesLT | ProductModel | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic average does not bound XML size. |
| 10 | SalesLT | ProductModelProductDescription | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 11 | SalesLT | SalesOrderDetail | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic only; no application access found. |
| 12 | SalesLT | SalesOrderHeader | 1000 (estimated) | 2 (estimated) | 5% (estimated) | 1 (estimated) | 0.1 (estimated) | Synthetic average does not bound comment size. |

## Workload Notes

The repeated per-table figures are scenario inputs, not evidence that each table is read or written, and cannot be allocated
to individual controller patterns. There is no observation window or evidence that per-table operations are additive.
Peak load, growth basis, retention, skew, item-size percentiles, latency, regional intent, and consistency are unknown.
Collation in workload.json is an assumption, not a DDL declaration or a verified server setting.
