# Assessment Summary

## Overview

The accepted [discovery](../1-discovery/discovery-report.md) and [source inventory](../1-discovery/preflight-manifest.json)
support four provisional business analysis domains with one owner for each of the 12 supplied source tables. These are
not Cosmos DB containers, partition keys or statements of domain-wide transaction scope. All tables have EF DbSet and
mapping evidence; only Customer, Product and ProductCategory have controller writes, and ProductModel has controller
reads. Eight other tables have no controller access found and remain included. `isMapped` records EF mapping, not
runtime use, and is true for every domain, including Operations and Orders.

## Domains

| Domain | Source tables | Representative entry point | Mapping and access | Complexity |
|---|---|---|---|---|
| [Catalog](domains/Catalog.md) | Product, ProductCategory, ProductDescription, ProductModel, ProductModelProductDescription | Product | All EF-mapped; Product and Category read/write, Model read; two lack discovered controller access. | High: self-reference, three-part key, shared references, uniqueness and large/precise values. |
| [Customers](domains/Customers.md) | Address, Customer, CustomerAddress | Customer | All EF-mapped; Customer read/write; Address and association lack discovered controller access. | Medium: shared address ownership, composite key and incoming restrictions. |
| [Operations](domains/Operations.md) | dbo.BuildVersion, dbo.ErrorLog | BuildVersion | Both EF-mapped; neither has discovered controller access; separate operational records. | Low structural coupling; unknown consumers and lifecycle. |
| [Orders](domains/Orders.md) | SalesOrderDetail, SalesOrderHeader | SalesOrderHeader | Both EF-mapped; neither has discovered controller access. | High: cascade, composite detail key, computed values, sequence and four outgoing FKs. |

EF mapping is structural evidence, not proof of production usage. The domain reports state boundary evidence,
counterevidence and alternate groupings. Cross-domain access rates, coordinated writes, ownership and production usage
are not known. No sample data establishing child counts was supplied.

## Cross-Domain Dependencies

| Dependent source | Authoritative reference | Source constraint and consequence |
|---|---|---|
| Orders.SalesOrderHeader.CustomerID | Customers.Customer | Required FK, `NO ACTION`; customer deletion is constrained. |
| Orders.SalesOrderHeader.BillToAddressID | Customers.Address | Optional FK, `NO ACTION`; preserve billing role and address deletion restriction. |
| Orders.SalesOrderHeader.ShipToAddressID | Customers.Address | Optional FK, `NO ACTION`; preserve shipping role independently, same address owner. |
| Orders.SalesOrderDetail.ProductID | Catalog.Product | Required FK, `NO ACTION`; product deletion is constrained. |

The manifest records each edge and exact FK name separately. Source invariants also include Catalog's optional
ProductCategory self-reference, internal Product category/model and model/description FKs, and Customers'
CustomerAddress-to-Customer/Address FKs. Orders.SalesOrderDetail has `(SalesOrderID, SalesOrderDetailID)` and a
header FK with **ON DELETE CASCADE**; preserve this even without an observed application delete. CustomerAddress has
`(CustomerID, AddressID)` and ProductModelProductDescription has `(ProductModelID, ProductDescriptionID, Culture)`.
There is no evidence that one domain equals one transaction or logical partition.

## Recommendations

Keep shared Address, ProductCategory and ProductModel with one source owner each; record consumers without copying
ownership. Before conversion decide how to preserve all source identities, FKs, `NO ACTION` restrictions, uniqueness,
collation and the order cascade under concurrent failure. Reference hydration and bounded read copies are alternatives,
not approved target designs; asynchronous projections require explicit staleness and replay handling and do not enforce
FKs or atomicity. Product/category read-together patterns do not prove a global access ratio; unbounded lists warrant a
future pagination review. Source `MONEY`, computed fields and large binary/XML/text require precision and size evidence.

Applied peer guidance: `rules/model-relationship-references.md` informs shared-reference alternatives;
`rules/model-embed-related.md` and `rules/model-reference-large.md` highlight read coupling versus independent updates
and unbounded data; `rules/model-unique-keys.md` prevents assuming partition-local uniqueness matches SQL;
`rules/partition-query-patterns.md` highlights unknown frequency and lookup scope; `rules/query-pagination.md` flags
unbounded source lists; `rules/pattern-change-feed-materialized-views.md` highlights eventual consistency and idempotent
replay for any future projection; `rules/model-avoid-2mb-limit.md` and `rules/model-numeric-precision.md` identify size
and numeric risks. No target model, partition, capacity, or replication decision is made.

Schema-conversion context estimates use the bundled conservative three-characters-per-token estimator, with the shared
Skill instructions, conversion reference and model schema, peer index and selected rule bodies, source DDL, discovery
and assessment evidence, domain-specific code, and a 16 KiB tool-result allowance. Each domain report and checkpoint
records its estimated input tokens. The model context window and output/safety reserves are unknown, so budget status is
unknown and no split is justified by this estimate alone.

## Warnings

- All workload values are synthetic assumptions, not production metrics. BuildVersion's assumed 1,000 rows cannot
  fit a unique TINYINT key. Peak, size percentiles, per-operation rates, retention and relationship cardinalities are unknown.
- Source interpretation is model-reviewed and structurally evidence-validated, not source-engine validated; actual
  deployed schema, external clients, collation, runtime transactions, SDK/runtime compatibility and data are unverified.
- `OnlineOrderFlag` CLR nullability differs from the EF required configuration and DDL NOT NULL declaration. EF's
  unqualified sequence registration versus `SalesLT` default needs verification. Customer views expose hash/salt fields;
  handling and access controls need separate review.
- The four domain boundaries are provisional analysis groupings. More than one target ownership/partition design may
  be viable and requires a later explicit engineering decision rather than being silently fixed here.
