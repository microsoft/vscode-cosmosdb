# Orders Schema Conversion

## Overview

This is a proposed design, not an implemented migration. The authoritative [accepted source inventory](../../../1-discovery/preflight-manifest.json)
and [Orders assessment](../../../2-assessment/domains/Orders.md) identify two EF-mapped tables, but no order-controller
reads or writes were observed in the inspected application. Other consumers and actual workload remain unknown.
The supplied source was model-reviewed, not validated against a running SQL Server.

## Tables to Container Mapping

| Source | Container | Entity / docType | Source key |
|---|---|---|---|
| SalesLT.SalesOrderHeader | Orders | SalesOrderHeader / `salesOrderHeader` | `SalesOrderID` |
| SalesLT.SalesOrderDetail | Orders | SalesOrderDetail / `salesOrderDetail` | (`SalesOrderID`, `SalesOrderDetailID`) |

Both carry the original integer `salesOrderId` as the partition key and retain all source columns. The target model's
`computed expression` source types deliberately follow the inventory where computed SQL metadata is unverified;
their proposed target values are strings. The source SQL expressions and tentative EF types are discussed below.

## Container Summary

One `Orders` container in `adventureworks-eval`, serverless, contains separate header and detail documents. The
following synthetic examples do not assert source data or actual size distributions. No execution is implied.

```json
{
  "id": "salesOrderHeader-42",
  "docType": "salesOrderHeader",
  "salesOrderId": 42,
  "revisionNumber": 0,
  "orderDate": "2024-01-01T10:00:00",
  "dueDate": "2024-01-10T10:00:00",
  "shipDate": "2024-01-03T10:00:00",
  "status": 1,
  "onlineOrderFlag": true,
  "salesOrderNumber": "SO42",
  "purchaseOrderNumber": "PO42",
  "accountNumber": "A42",
  "customerId": 10,
  "shipToAddressId": 20,
  "billToAddressId": 21,
  "shipMethod": "Ground",
  "creditCardApprovalCode": "CODE42",
  "subTotal": "18.0000",
  "taxAmt": "1.0000",
  "freight": "2.0000",
  "totalDue": "21.0000",
  "comment": {
    "blobKey": "orders/42/comment/example",
    "versionId": "example-version",
    "encoding": "utf-16le",
    "byteLength": 0,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "rowguid": "0a000000-0000-4000-8000-000000000001",
  "modifiedDate": "2024-01-01T10:00:00"
}
```

```json
{
  "id": "v1-s53616c65734c542e53616c65734f7264657244657461696c-s53616c65734f7264657244657461696c-n3432-n37",
  "docType": "salesOrderDetail",
  "salesOrderId": 42,
  "salesOrderDetailId": 7,
  "orderQty": 2,
  "productId": 100,
  "unitPrice": "10.0000",
  "unitPriceDiscount": "0.1000",
  "lineTotal": "18.000000",
  "rowguid": "0a000000-0000-4000-8000-000000000002",
  "modifiedDate": "2024-01-01T10:00:00"
}
```

**Identity contract.** Header `idTemplate` is `salesOrderHeader-{SalesOrderID}`, with direct invariant decimal
substitution; the source `INT` remains a separate integer. The detail template is
`salesOrderDetail-{SalesOrderID}-{SalesOrderDetailID}` and preserves both key components as integers. Select the
bundled `typed-hex-v1` identity mapping for detail in the **root** identity manifest after canonical model merge.
The exact resolver emits `v1-<table>-<entity>-<component1>-<component2>`: each string is `s` plus lowercase hex
of UTF-8 bytes, each numeric component is `n` plus lowercase hex of the UTF-8 JSON-compatible decimal form.
Components are in template order and hyphens occur only between encoded components. Table and entity are the exact
case-sensitive strings `SalesLT.SalesOrderDetail` and `SalesOrderDetail`; for integer 42 and 7 the example shows the
complete result. No delimiter substitution or truncation occurs. IDs remain far below the 1,023-byte limit for SQL
INT components. The two namespaces prevent header/detail collisions within the same full partition key.

The physical encoded ID starts with `v1-`, not a literal docType prefix. The encoded source table and entity provide
the type namespace, while the template retains the source-key placeholders. Record the `salesOrderDetail` docType in
the root identity mapping and use it in queries and serializers.

## Partition Key Decisions

| Candidate | Cardinality / routing / writes / growth comparison |
|---|---|
| `/salesOrderId` **selected** | Every header has a unique key; details obtain the same value from their FK. An order lookup and its children route together. Hot large orders and 20-GB logical-partition growth remain unknown. |
| `/customerId` | Customer-order lookups route naturally, but details do not have this source column and need reliable propagation. A customer can become a hot or very large partition; key changes need data migration. |
| Hierarchical `/salesOrderId`, `/salesOrderDetailId` | Distributes detail data within an order, but the header lacks the second source key, and different complete tuples cannot join a Cosmos transactional batch. Reject for the current co-location contract; a redesigned coordinator could revisit it. |
| Synthetic order-plus-shard | Could spread a hot order and increase headroom, but scatters its detail operations, requires a deterministic shard lookup and coordinator, and complicates full-order reads and deletes. No evidence yet justifies the extra cross-partition work. |

Qualitative comparison is appropriate: child-count distribution, order hotspots and real read/write rates are unknown,
so no unsupported scores are assigned. The chosen key is immutable in place; a change means a new container, data
movement and application change. Per-order data plus index, including all retained versions and both docTypes, must
be bounded/monitored against the logical-partition limit; if actual source extremes exceed it, redesign and migrate
before import. High cardinality alone does not prove balanced hot-order writes.

## Embedding Strategy

Separate detail documents avoid an unbounded embedded array and allow independent detail updates and reads; no observed
read-together frequency or child-count bound supports embedding. Co-location saves routing but does not permit joins
between documents. References preserve source IDs, not copied customer, address or product snapshots; proposed
coordinator-driven hydration resolves them through their authoritative domain owners.

`Comment` is nullable `NVARCHAR(MAX)` and is **never** inlined: represent each non-null value by an immutable,
versioned external blob manifest as in the example, containing stable blob key, exact immutable version, encoding,
byte length and SHA-256. Encode losslessly as UTF-16LE code units, including unusual source strings; do not normalize,
truncate or conflate SQL NULL with the empty string. NULL is JSON null; empty is a non-null zero-length blob with its
own manifest. Model v1 expresses the representative non-null type `object`, not nullable unions.

Stage and verify the immutable blob before committing its referring row version. The coordinator commits the reference
only after staging succeeds, retains old versions for active/retained row versions, hydrates and verifies version,
length and hash on read, and fails closed on missing/corrupt blobs. Garbage collection removes staged or old blobs only
after proving no retained or in-flight row-version reference remains, including during crash recovery. Blob retention,
authorization, encryption, durability and cross-store atomic visibility need implementation and verification.

## Access Pattern Mappings

[Access patterns](../../../1-discovery/access-patterns/access-patterns.md) explicitly say no observed application
access for these tables. The following are schema-derived *possible* operations, not observed controller workflows:

| Source evidence / operation | Proposed mapping |
|---|---|
| Header primary key | Coordinator-authorized point read using header ID and numeric `salesOrderId`. |
| Detail composite primary key | Coordinator-authorized point read using the exact typed-hex ID and `salesOrderId`. |
| Header-to-detail FK/cascade | Parameterized `docType` plus `salesOrderId` query routed to the order partition; paginate. Header deletion invokes the coordinator's durable cascade. |
| Header customer and address source indexes | Parameterized `docType` plus customer or the correct address-role query; fan-out unless order key also known. Used for proposed integrity and lookup operations, not a claim of existing UI access. |
| Detail product source index | Parameterized `docType` plus `productId` query, fan-out unless order key is known. |
| Create/update/delete | Coordinator validates FK, unique keys, defaults and computed values, then commits through its fenced protocol; a same-partition batch may implement bounded individual steps, not arbitrary source transactions. |

## Cross-Partition Queries

Customer, product, billing/shipping address, rowguid and sales-order-number lookups lacking `salesOrderId` fan out.
Their frequency and cost are unknown; no RU estimate is claimed. Indexed equality filters, projections and continuation
tokens mitigate payload but not fan-out. A change-feed secondary view or lookup directory may improve future reads,
but eventual consistency cannot enforce SQL foreign keys, global uniqueness or atomic visibility. Do not add a view
without measured workload, repair strategy and an explicit consistency contract. Coordinator-mediated lookup/locking
must remain authoritative for integrity.

## Indexing Policies

Use consistent exclude-all indexing with explicit `docType`, `salesOrderId`, customer/product/address references,
`salesOrderNumber` and `rowguid` indexed for the schema-derived operations; exclude `_etag` and the blob manifest.
No composite index is proposed without demonstrated multi-property ordering. Source unique indexes do not become
Cosmos unique constraints: they apply only within a logical partition and sparse/multi-docType behavior is different.
String decimal comparison and order are not numeric, so range/order/aggregate queries on amounts require a separately
verified exact numeric query design; this model does not promise native decimal range ordering.

## Optimization Recommendations

### Integrity and visibility

The detail-to-header FK `FK_SalesOrderDetail_SalesOrderHeader_SalesOrderID` cascades on header delete. Customer,
product, and both separate address-role FKs are `NO ACTION`: required customer/product references and non-null
address references must exist; referenced deletes or key updates must be rejected when references exist. This also
requires coordinating inbound deletes in Customers and Catalog, not just order writes.

Proposed, **not implemented**: a single-writer or equivalently fenced durable transactional coordinator, shared
across domains and serving **all reads and writes**, serializes referential checks, conflicting creates/deletes,
global unique reservations and affected row versions. A durable commit decision and recoverable transaction journal
must make readers see one committed state, using committed-version indirection/MVCC or equivalent; no direct Cosmos
or blob bypass may expose partially applied work. On failure it resumes idempotently or aborts without exposing
partial results, and stale writers are fenced; unavailable coordinator means fail closed. Every participant must
honor the protocol, including parent-key updates and external clients. The root design must specify recovery,
linearization, read consistency and ownership in detail and validate it before writes are enabled.

For >100 details, the cascade may need multiple bounded operations and retries; a single Cosmos batch has operation,
payload and execution limits and is atomic only inside one full partition key, not across domains or arbitrarily
many details. A tombstone or eventual background delete alone is not SQL-equivalent if readers can observe partial
deletion. Capture an isolated consistent source snapshot/cutover and test races, failures and visibility before use.

The two `rowguid` unique indexes are separately global per source table; `SalesOrderNumber` is also globally unique.
Preserve them with coordinator-controlled durable uniqueness reservations/transactional state, not partition-scoped
native unique keys or check-then-write. Reconcile collisions and enforce SQL comparison semantics, including actual
collation and trailing-space behavior, before importing; the workload's `SQL_Latin1_General_CP1_CI_AS` is only a
synthetic assumption. The computed order number is `isnull(N'SO'+CONVERT(nvarchar(23),SalesOrderID,0),N'*** ERROR ***')`;
retain SQL behavior rather than client-supplied values, and validate uniqueness and conversion parity.

### Allocation, arithmetic and constraints

DDL declares `SalesLT.SalesOrderNumber` INT sequence starting at 1, increment 1. Before enabling writes, reconcile
the actual source sequence next value, configured increment, bounds, cycling, caching, explicit inserts and any
concurrent source consumers; the EF model declares an unqualified sequence, while the DDL default explicitly uses
`SalesLT`. This is an unresolved validation discrepancy, not evidence that EF changes the DDL. Initialize a durable,
atomic high-water allocator at least `max(max(imported SalesOrderID), reconciled actual source next value)`;
allocate the next safe value at or above the source next value and strictly above all imported/previously reserved IDs.
Using this conservative high-water may skip a source-next value; gaps are acceptable only if compatible with verified
sequence behavior. Never reuse consumed/reserved values after crashes or rollbacks; fence concurrent allocators and
reject INT overflow or exhausted ranges. Coordinate cutover to prevent further source allocation, or reserve
non-overlapping ranges before any target writes. A matching policy is also needed for globally generated
`SalesOrderDetailID` `IDENTITY(1,1)` (not merely per order), including explicit inserts, gaps and overflow.

`MONEY` inputs are fixed-scale exact decimal strings; calculate without binary floating point. `LineTotal` is
`isnull(([UnitPrice]*((1.0)-[UnitPriceDiscount]))*[OrderQty],(0.0))`; `TotalDue` is
`isnull(([SubTotal]+[TaxAmt])+[Freight],(0))`. Do not replace these with arbitrary-precision algebra that changes
SQL intermediate conversion, rounding or overflow behavior: implement exact SQL Server type precedence,
intermediate precision/scale and rounding at each expression node; reject overflow as SQL does. EF records
`numeric(38,6)` for LineTotal and `money` for TotalDue, but computed SQL metadata and rounding have not been verified.
Before writes, compare SQL Server result types and values, including negative values, boundaries, midway rounding,
overflow and zero cases, against the implementation. Source-compatible verification is pending, not performed here.

The [source inventory](../../../1-discovery/preflight-manifest.json) records nullable header `ShipDate`,
`PurchaseOrderNumber`, `AccountNumber`, `ShipToAddressID`, `BillToAddressID`, `CreditCardApprovalCode` and `Comment`;
all other non-computed columns are non-null, including every detail column. Computed nullability is unknown pending
SQL metadata verification. Preserve null explicitly and don't substitute empty strings or zero. Header defaults:
sequence, `RevisionNumber=0`, `OrderDate=getdate()`, `Status=1`, `OnlineOrderFlag=1`, `SubTotal=TaxAmt=Freight=0`,
`rowguid=newid()` and `ModifiedDate=getdate()`. Detail defaults: identity, `UnitPriceDiscount=0`,
`rowguid=newid()` and `ModifiedDate=getdate()`. Respect SQL integer ranges, datetime precision and source local-time
semantics, string lengths, VARCHAR encoding, alias types and UUID semantics; no invented timezone or clipping.
`OnlineOrderFlag` is `dbo.Flag`/BIT non-null in DDL and required in EF configuration, although the EF CLR property
is `bool?`; treat it as required and verify the discrepancy before code migration. The inventory reports no explicit
CHECK constraints for these tables; do not invent business checks.

### Feasibility and guidance

| Mapping/operation | Constraint and evidence | Disposition before use |
|---|---|---|
| Individual document / MAX comment | Cosmos item 2 MB; source comment unbounded | External immutable manifest; validate sizes, staging, hydration, retention and failures. |
| One order | Logical partition 20 GB; detail count/size tails unknown | Measure extremes plus projected growth and indexes; re-key/redesign if incompatible, never drop rows. |
| Cascades and cross-domain FKs | Batch bounded to one full key with operation/payload limits | Fenced durable coordinator with atomic read visibility, tested beyond 100 details and across domains. |
| Import | Synthetic averages do not establish peak, skew or target ingestion capacity | Establish order distribution, concurrency, export consistency and cutover window; rate-limit/retry and validate totals. |
| Typed identity | 1,023-byte max; source components are SQL INTs. | Register the root identity mapping and test the exact helper golden vectors before generating data. |

Applied peer guidance: `rules/model-id-constraints.md`, `rules/model-numeric-precision.md`,
`rules/model-reference-large.md`, `rules/model-embed-related.md`, `rules/model-avoid-2mb-limit.md`,
`rules/model-relationship-references.md`, `rules/model-unique-keys.md`, `rules/partition-high-cardinality.md`,
`rules/partition-avoid-hotspots.md`, `rules/partition-query-patterns.md`, `rules/partition-20gb-limit.md`,
`rules/index-exclude-unused.md`, `rules/query-point-reads.md`, and `rules/throughput-serverless.md`.
Their effects are reflected in the decisions and caveats above; no service or source connection was made.

## Throughput & Storage Recommendations

| Evidence | Estimate and qualification |
|---|---|
| [volumetrics] | Synthetic assumptions: 10,000 headers at 1 KB and 40,000 details at 0.128 KB, both with 5% net monthly growth. Hypothetical busy-window rates are 2 read / 0.2 write TPS for headers and 4 read / 0.8 write TPS for details. These are not continuous averages, measurements or proven separate operations. Four details per header is only a population-wide mean, not a bound. |
| [access patterns] | No observed order controller access or operation mix; actual frequency, latency, peak and transaction size unknown. No measured or fabricated RU estimate. |
| [volumetrics] [default assumed] | Source-size fallback: 15,120 decimal KB currently; assuming 1.2x/1.5x/2x JSON payload factors gives 18,144/22,680/30,240 KB target payload, not billable storage or bounds. KB is 1,000 bytes; external comment sizes and source-row allocation/compression remain unknown, so factors are illustrative only. |
| [volumetrics] [default assumed] | With unchanged average payload and 5% net monthly compounded growth, the 12-month source proxy is about 27,153.3 KB; corresponding illustrative payload is about 32,584/40,730/54,307 KB. This is not a forecast or retention policy. Blob payload, index and per-item metadata remain unknown; no total GiB is asserted. |
| [access patterns] | Serverless is requested for this development model and has no provisioned throughput field. Check single-region/feature compatibility, service limits, peak demand, logical-partition tails, and post-import storage against current account rules before deployment; no runtime guarantee follows from synthetic inputs. |

No Azure resources, application files, source database or data were modified. Root integration owns validation,
cross-domain coordination design, identity mapping and all checkpoint updates.
