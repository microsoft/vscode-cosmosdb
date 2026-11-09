# Preflight Summary

## Summary

AdventureWorks.Web is an ASP.NET Core MVC 2.1 C# application using Entity Framework Core and the SQL Server provider
([project](../../../AdventureWorks.Web.csproj), [startup](../../../Startup.cs), [mappings](../../../Models/sampledbContext.cs)).
The supplied [DDL](schema-ddl/AdventureworksLT.sql) is the authoritative source: 12 tables, 12 foreign keys,
27 explicit non-primary indexes, six conditional alias types, and one sequence. All 400 lines were read and checked a
second time against the inventory, including ALTER statements and index key order. Bracketed identifiers preserve names;
GO separates batches; the conditional dynamic SQL contains only the stated schema and alias-type definitions.
No view, trigger, procedure, or CHECK constraint is declared. Column-level line numbers, source types, nullability,
defaults, computed expressions, keys, foreign keys, and index locations are in the manifest.

The synthetic [workload](volumetrics/workload.json) was reviewed in full and is used only as labeled planning
assumptions. [Volumetrics](volumetrics/volumetrics.md) retains all 12 entities; [access patterns](access-patterns/access-patterns.md)
record code evidence and explicitly retain eight tables with no discovered application access.

## Warnings

- **Model-reviewed assurance:** no external parser or source engine was used. Evidence validation checks recorded
  structure and hashes, not SQL syntax, source-engine behavior, completeness of interpretation, or live database state.
  Computed-column metadata nullability and exact SQL-derived types are not independently verified; EF type hints are
  distinguished from DDL declarations. Conditional existing alias types and schema could differ on a live server.
- **Synthetic contradiction:** BuildVersion's assumed 1,000 rows cannot coexist with a unique TINYINT primary key
  (at most 256 distinct values). The assumption is recorded, but the feasible row count is unknown. All other repeated
  row counts, TPS, growth and sizes remain illustrative, not measurements.
- DDL does not declare collation. The workload's collation is a synthetic assumption and must be verified before relying
  on case/accent-sensitive equality and uniqueness. Peak, percentiles, retention, latency, skew, and traffic mix are unknown.
- EF maps `OnlineOrderFlag` as nullable CLR `bool?` but explicitly marks it required; DDL declares NOT NULL. The CLR
  shape alone must not be interpreted as a nullable database column. EF registers `HasSequence<int>("SalesOrderNumber")`
  without schema while the DDL and property default name `SalesLT.SalesOrderNumber`; default-schema resolution and any
  migration impact remain to be verified. No authoritative DDL was changed.
- XML, binary MAX, text MAX, MONEY and computed numeric values need size and precision treatment later. Category and
  product uniqueness, foreign keys, delete restrictions, defaults and order-detail cascade are source-side obligations.

## Decisions

- The user selected model-only interpretation, forbade custom parsers and external calls, and made the supplied DDL
  immutable. All supplied tables remain in scope; absence of application access is not exclusion.
- Pattern TPS is unknown: synthetic per-table figures do not establish individual operation rates or a common observation
  window. The impossible BuildVersion row-count assumption is not substituted with a fabricated number.
- No target container, partition key, deployment, or application-code decision is made during preflight.
