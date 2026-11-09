# AdventureWorks schema conversion

## Database Overview

This is a conditional development design for database `adventureworks-eval`, not a deployed system. All four assessed
domains were selected with `include-unmapped-domains: true`; no domains or tables were skipped. Every source table has
one authoritative owner. All 12 have EF mappings, but only Customer, Product and ProductCategory have discovered
controller writes, and ProductModel has discovered controller reads. No observed application access is not a deletion
decision. Source interpretation is model-reviewed and evidence-validated, not source-engine-validated.

The canonical model covers the **source-table current-row shapes and data containers only**. The coordinator,
version/journal store and immutable content store described below are essential supporting infrastructure, not
entities or deployable infrastructure represented in `model.json`. Provisioning the canonical model alone cannot
preserve the required SQL behavior. Do not cut over or permit migration/application writes until the supporting
infrastructure and every clearance condition below exist and are independently verified.

## Container Inventory

| Container | Source-table owner and document types | Full partition key | Capacity |
|---|---|---|---|
| Catalog | Product, ProductCategory, ProductDescription, ProductModel, ProductModelProductDescription | `/id` | serverless |
| Customers | Address, Customer, CustomerAddress | `/id` | serverless |
| Orders | SalesOrderHeader, SalesOrderDetail | `/salesOrderId` | serverless |
| Operations | BuildVersion, ErrorLog | `/id` | serverless |

These are separately scalable logical designs, not claims about observed traffic. Distinct docTypes share a container;
`/id` routes each individual item and does **not** co-locate related rows. Orders share a full key per order, but that
does not make arbitrarily large operations atomic. The source keys remain separate fields; item IDs are deterministic.
Composite keys use the manifest's `typed-hex-v1` rules. Encoded identifiers must be checked against the 1,023-byte limit
for the complete source domain, not only against examples. See domain summaries for candidates, access paths and
item-level feasibility.

## Container Mappings

Catalog owns the five `SalesLT.Product*` tables, including the model/description association. Customers owns
`SalesLT.Customer`, `SalesLT.Address`, and `SalesLT.CustomerAddress`; Address is a single shared source of truth.
Orders owns both `SalesLT.SalesOrder*` tables. Operations owns `dbo.BuildVersion` and `dbo.ErrorLog`. Relationships use
source FK fields rather than duplicated authoritative rows. No unbounded relationship is embedded merely because a
foreign key exists. Hydration and queries across documents require application logic; Cosmos does not provide SQL joins.

Nullable source columns retain null, distinct from missing and empty, even though version 1 of the model declares the
representative non-null JSON type only. Imported values must be losslessly serialized, preserving source lengths and
code units, SQL `DATETIME` semantics, GUID values, nullability, constraints and defaults. Unpaired UTF-16 code units,
SQL VARCHAR code-page behavior, and special XML serialization must be covered by round-trip tests rather than assumed
to survive a serializer. Culture's identity-safe reversible encoding is explained in the Catalog summary.

## Cross-Domain Relationships

Order header CustomerID is required; BillToAddressID and ShipToAddressID are distinct optional references to the single
Customers Address owner. Order detail ProductID is required and references Catalog Product. Their four foreign keys
are `NO ACTION`. The category parent self-reference is optional and `NO ACTION`; all other source foreign keys are
also `NO ACTION` except the detail-to-header FK, which is `ON DELETE CASCADE`. FK checks apply to inserts and updates;
`NO ACTION` applies to parent deletes and key changes as specified by source constraints. No asynchronous projection,
partition-local unique policy, query-then-write, or independent reservation constitutes equivalent enforcement.

### Concrete atomicity and constraint design

Implement a mandatory integrity service used by **all** readers, writers, importers and administrative paths; direct
data-container access bypassing it must be denied. Its durable, recoverable serial commit coordinator has one active
fenced writer per migration database. A strongly consistent control partition contains a lease/epoch and commit
watermark. A new leader atomically changes the epoch using conditional writes; publication of a commit must atomically
check the currently held control-record ETag/epoch and update the decision/watermark in that same partition. A stale
leader can stage work but cannot publish it. Recovery must replay the durable decision log before accepting work.
Control-log growth, leader lease/time behavior, availability, consistency and throughput must be bounded and verified;
compaction is safe only after durable checkpoints and all active readers no longer need earlier decisions.

The coordinator serializes source-equivalent transactions and keeps durable, versioned reverse-reference and
uniqueness indexes with the row versions. Before publishing, it checks all source PKs, unique indexes, source type
constraints, source FKs, and incoming `NO ACTION` references against the preceding committed snapshot. It stages
immutable row versions, reverse-index changes, constraint-index changes, and content manifests under a transaction ID
in a separate, durable version/journal store; only a single durable commit decision makes them visible. The auxiliary
store holds version envelopes of the canonical source-row shapes, not a second independently writable business owner.
The current-row containers materialize committed canonical documents at their model-defined IDs and partition keys;
this is an asynchronously repairable representation, not permission for direct or stale reads. The service uses the
committed version store whenever the materialized row cannot be proven to match the requested snapshot. Materialization
is monotonic per source row and ETag-conditional so a delayed older writer cannot overwrite a newer committed version.
An abort or a crash before the commit decision exposes none.
After a committed decision, retry/recovery finishes idempotently and returns the original outcome; stale or abandoned
stages are invisible and later collected. Failed unique/FK checks do not publish partial work. A crash between an
external staged write and the decision is explicitly covered, not treated as an atomic distributed batch.

Every read, including lists, hydration, pagination and existence checks, obtains a committed snapshot/watermark from
the service, filters staged versions through commit decisions, and preserves that snapshot across continuation pages.
Point-read descriptions in the domain summaries describe routing after the service has resolved the correct committed
version; they do not authorize bypassing the service or assuming that a current-row materialization is up to date.
For a permitted source primary-key change, stage an old-key tombstone and new-key row and index versions together;
publish both in one decision, even if their target partitions differ. Reject a key update when an incoming source
`NO ACTION` constraint requires it, and do not expose a half-rekeyed row.
Read visibility and point-read freshness must be demonstrated under failover, not inferred from default session
consistency. Indexes used to enforce references cannot be eventual change-feed projections. Before advancing a
watermark, the service must ensure all staged row/index/content versions are durably visible to its readers. If these
requirements cannot be implemented and verified on the chosen account consistency and coordinator store, do not
cut over; select an independently verified linearizable coordinator design instead.

For a header delete, stage the header tombstone and **all** detail tombstones, reverse-index removals and uniqueness
releases before one commit decision. Visibility gating makes the entire cascade appear or disappear together, even
when it exceeds the service's transaction batch operation/size limits; one native batch is only an optimization when
all limits are met. Define bounded transaction-log records, resumable staged pages, timeout/recovery, reader snapshot
retention, and test interruption at each stage. The order partition can grow beyond its capacity in a future workload;
measure worst-case order fan-out and retained versions before cutover, and re-partition or revise the target if the
full logical partition cannot fit. Averages do not prove this bound.

### Global SQL comparison and uniqueness

The coordinator maintains a separate source-wide namespace for every unique index, including Product `Name`,
`ProductNumber`, and `rowguid`; category/model `Name`; all declared rowguid indexes; header `SalesOrderNumber`; and all
primary keys, including the three composites. Never use a single combined Product name/number constraint. SQL GUID
equality must be implemented on GUID values, not spelling differences. The ProductModelProductDescription PK compares
its Culture component using SQL collation, even though the lossless encoded item IDs preserve the original code units.

The selected comparison contract is **conditional on the synthetic workload assumption**
`SQL_Latin1_General_CP1_CI_AS`: implement a versioned comparator/sort-key algorithm that reproduces that SQL Server
collation for the actual SQL types, including case, accent, trailing-space/padding, Unicode and code-page behavior.
Simple lowercase, Unicode normalization, .NET defaults or Cosmos string equality are not accepted as proof. Verify the
actual source collation, any column overrides and parity against SQL Server at a later authorized phase. Compare boundary
and adversarial values, including supplementary and unpaired code units, expansion/equivalence cases, nulls and
trailing spaces. Before enabling writes, check the entire import for collisions, reconcile any collision without
discarding rows, and pass concurrent create/update/delete, same-key rename, crash and replay tests. If exact comparison
cannot be reproduced, migration writes remain blocked.

Index keys may be hashed only for routing; collisions must be disambiguated by comparing the full exact collation key
under the serialized coordinator, never by assuming a hash is unique. Reserve, release, row changes and the commit
decision are one logical transaction under the protocol above. Unique indexes and FKs are source-wide, not scoped to
the Cosmos partition. Service readers must not expose uncommitted reservations or staged data.

### Exact values, generated IDs and large content

MONEY, DECIMAL and computed financial values are stored as exact decimal strings, not IEEE-754 JSON numbers. Implement
SQL-compatible intermediate types, operator ordering, scale, rounding, overflow and `ISNULL` behavior using
arbitrary-precision integer coefficients and explicit decimal scales (for example `System.Numerics.BigInteger`), rather
than assuming .NET `decimal` covers every possible SQL `decimal(38,...)` value; preserve
`LineTotal = ISNULL((UnitPrice * (1.0 - UnitPriceDiscount)) * OrderQty, 0.0)` and
`TotalDue = ISNULL((SubTotal + TaxAmt) + Freight, 0)` and do not replace either with an unrelated aggregate.
Preserve the computed `SalesOrderNumber` expression and its uniqueness. Verify source-derived computed types,
nullability, arithmetic boundary cases and calculation parity against SQL Server before enabling writes; EF's
`numeric(38,6)` mapping alone is not proof of SQL-derived metadata.

Import every source PK and `rowguid` unchanged. The coordinator owns durable, concurrency-safe allocators for every
source `IDENTITY` and `SalesLT.SalesOrderNumber` sequence; detail identity is table-wide, not per order. At cutover,
freeze or otherwise synchronize source writes and reconcile imported maxima, the **actual source generator state**
(including consumed/cached or rolled-back values), increment, bounds and cycle behavior. The order sequence is
declared `INT START WITH 1 INCREMENT BY 1`; future allocation starts beyond both committed imported IDs and the
reconciled source allocation high-water mark, without reusing allocated values. Serialize allocation with commit
recovery; gaps are acceptable, duplicate or wrapped IDs are not. Preserve source-specific identity/explicit-insert
semantics and verify exhaustion and generator parity. The unqualified EF sequence configuration versus DDL `SalesLT`
and the nullable CLR `OnlineOrderFlag` versus required DDL remain separate validation obligations.

For Product `ThumbNailPhoto`, ProductModel `CatalogDescription` and order `Comment`, use an immutable, versioned
external blob store even when the value is small. A non-null field is a bounded manifest containing a content version,
length, integrity digest and encoding/content type; `null` remains distinct from an empty value. Stage the complete
content first, verify its digest and readable durability, then stage the row pointer and publish with the coordinator.
On abort the unreferenced blob is invisible; on commit, readers hydrate the exact committed version and verify
integrity. Never overwrite an existing content version. Garbage collection must account for committed versions, active
snapshots, retries, rollback and backup retention, and reconcile crash-created orphans. Import/export must stream
without truncation and verify byte counts/digests; binary is byte-exact, order text preserves SQL UTF-16 code units,
and XML must round-trip the SQL XML logical infoset and type semantics rather than claim unobservable original lexical
bytes. Blob provisioning, encryption, RBAC, backup, availability, atomic publication and recovery are implementation
and verification obligations, not delivered artifacts.

## Conflict Resolutions

There are no competing definitions of a shared target container: each has one owning domain and one agreed key.
`/id` was selected over a category, customer or status key where no reliable common key or bounded parent aggregate
exists. `/salesOrderId` keeps order rows together but does not assert unlimited same-partition transactions. The SQL
source can require stronger global constraints than these keys provide, so the explicit coordinator protocol above is
mandatory rather than a silent relaxation. Partition keys are immutable after deployment and require migration if
later evidence invalidates them.

## Deployment Notes

**No resources are provisioned.** Serverless is a conditional development recommendation for potentially intermittent
workloads, not a production sizing claim. Check the current service's account-level single-region, feature, per-container
throughput and storage limits, account availability and consistency support before later provisioning; real peak,
skew, import windows and tail sizes are unknown. Serverless is not a throughput guarantee and is not appropriate if
the eventual workload or regional requirements exceed its actual limits. Compare provisioned autoscale with measured
load when available. The old `netcoreapp2.1` runtime's compatibility with the chosen Cosmos .NET SDK is unverified.

| Evidence and offline scenario | Current source payload | At 12 months |
|---|---:|---:|
| Catalog: 4,800 synthetic rows across five tables, table-specific sizes/growth | about 2.99 MiB | about 3.37 MiB |
| Customers: 4,500 synthetic rows across three tables, table-specific sizes/growth | about 1.91 MiB | about 2.43 MiB |
| Orders: 10,000 synthetic headers and 40,000 details | about 14.42 MiB | about 25.90 MiB |
| Operations: one synthetic BuildVersion row and 2,000 ErrorLog rows | about 1.43 MiB | about 4.49 MiB |

These are **synthetic source-payload scenarios**, not measured Cosmos storage, RU consumption, or billing estimates
[volumetrics] [workload notes]. They use the fixture's decimal KB (1,000 bytes) and compound each table's supplied
net growth rate for 12 months with unchanged average size. BuildVersion and ProductCategory have zero assumed growth.
The order counts imply a scenario-wide mean of four details per header, not a maximum per order. Target JSON transformation, metadata,
indexes, coordinator state, content blobs, replication and backup are unknown, so a total target-storage estimate is
not asserted. Busy-window TPS is neither a continuous duty cycle nor a basis for deriving net inserts; overlapping
table accesses must not be summed without evidence. Peak and per-pattern rates remain unknown. For illustration only, a
2-KiB point read is roughly 2 RU and a same-size write roughly 10–20 RU before index/coordinator/blob costs
[default assumed]; list scans and FK checks may cost more. No measured RUs or feasible peak are claimed.

## Per-Domain References

- [Catalog](domains/Catalog/summary.md)
- [Customers](domains/Customers/summary.md)
- [Operations](domains/Operations/summary.md)
- [Orders](domains/Orders/summary.md)

Applied peer rules: `model-id-constraints`, `model-unique-keys`, `model-numeric-precision`, `model-avoid-2mb-limit`,
`model-reference-large`, `model-embed-related`, `model-relationship-references`, `partition-high-cardinality`,
`partition-query-patterns`, `partition-20gb-limit`, `index-exclude-unused`, and `throughput-serverless`. Review
current limits and implementation-specific guidance again before deployment. Validation uses the installed portable
schema-conversion validators from Skill version `0.1.0` and version-1 model/evidence contracts, not the SQL source
engine or Azure. Input evidence: accepted preflight source hash
`51ef1032804f5b78d2d97f3cc08c14c72a10a1630fd0724ddb93e4d6f6438ad1`; supplied SQL file SHA-256
`837602bee5baca4cf026663627007c6e70df5896093f9cf31c0f804cb05d1065`. See project freshness for all consulted inputs.
