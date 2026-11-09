# Customers Schema Conversion

## Overview

Proposed, not deployed: database `adventureworks-eval`, serverless capacity, one `Customers` container partitioned by
`/id`. Sources are the accepted [inventory](../../../1-discovery/preflight-manifest.json) and
[assessment](../../../2-assessment/domains/Customers.md). EF maps all three tables; only Customer has observed
controller reads and writes. Absence of observed Address or CustomerAddress controller access is not evidence that
their data or other consumers can be deleted.

Address is the single authoritative shared address owner; orders reference it, not another authoritative or embedded
copy. Source keys are retained independently of Cosmos `id`. SQL guarantees described below require a proposed
coordinator and are **not implemented** by this model. Root integration must define the shared coordinator, identity
mapping, and cross-domain consistency contract before migration or use.

## Tables to Container Mapping

| Source | Entity / docType | Source key | Target ownership |
|---|---|---|---|
| SalesLT.Address | Address / `address` | AddressID | One standalone shared Address item. |
| SalesLT.Customer | Customer / `customer` | CustomerID | One standalone Customer item. |
| SalesLT.CustomerAddress | CustomerAddress / `customerAddress` | CustomerID, AddressID | One standalone association item; both keys retained. |

These are references, not cross-document joins. CustomerAddress references Customer and Address by their retained
numeric source keys. Deterministic target IDs are resolved from those keys at hydration. `SalesOrderHeader` holds
the distinct CustomerID, BillToAddressID and ShipToAddressID references; both address references resolve to the same
Address owner. The association has a many-to-one relation to each parent (the model's `one-to-many` denotes the
parent-to-association cardinality). `FK_CustomerAddress_Customer_CustomerID`,
`FK_CustomerAddress_Address_AddressID`, `FK_SalesOrderHeader_Customer_CustomerID`,
`FK_SalesOrderHeader_Address_BillTo_AddressID`, and `FK_SalesOrderHeader_Address_ShipTo_AddressID` are distinct
implicit SQL NO ACTION constraints. The last three are incoming cross-domain references represented explicitly in the
model and must also agree with the Orders design. No document-based reference by itself enforces these constraints.

## Container Summary

All examples are synthetic illustrative fragments, not source records. Customer credentials are intentionally omitted
from the example only; stored records must preserve both non-null credential columns. Examples do not authorize seeding.

```json
{
  "id": "address-42",
  "docType": "address",
  "addressId": 42,
  "addressLine1": "Example street",
  "city": "Example city",
  "stateProvince": "Example region",
  "countryRegion": "Example country",
  "postalCode": "00000",
  "rowguid": "00000000-0000-0000-0000-000000000001",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

```json
{
  "id": "customer-7",
  "docType": "customer",
  "customerId": 7,
  "nameStyle": false,
  "firstName": "Example",
  "lastName": "Person",
  "rowguid": "00000000-0000-0000-0000-000000000002",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

```json
{
  "id": "v1-s53616c65734c542e437573746f6d657241646472657373-s437573746f6d657241646472657373-n37-n3432",
  "docType": "customerAddress",
  "customerId": 7,
  "addressId": 42,
  "addressType": "Example",
  "rowguid": "00000000-0000-0000-0000-000000000003",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### Identity contract

Address and Customer use legacy substitutions `address-{AddressID}` and `customer-{CustomerID}`. SQL INT values use
their canonical signed decimal representation; the distinct prefixes prevent type collisions and each id is also its
partition key. The composite template `customerAddress-{CustomerID}-{AddressID}` supplies ordered source component
names, **not** the final encoded literal. Root must record `typed-hex-v1` for container `Customers`, docType
`customerAddress`,
sourceTable `SalesLT.CustomerAddress`, and that exact template in the canonical model's
`identityMapping` manifest, with rule `rules/model-id-constraints.md`.

The skill's algorithm emits `v1-<table>-<entity>-<component1>-<component2>`. Each string is `s` plus lowercase hex
of UTF-8 bytes, each numeric component is `n` plus lowercase UTF-8 hex of its JSON-compatible decimal form, and
booleans are `b1` or `b0`. The table and entity are exactly `SalesLT.CustomerAddress` and `CustomerAddress`.
Thus 7 and 42 become `n37` and `n3432` as shown; the encoded table-and-entity prefix supplies the identity
namespace independently of the docType. Hyphens cannot occur inside
any encoded component, so signed keys, values and ordering remain unambiguous and lossless; do not replace delimiters,
truncate or hash. All three source keys are SQL INT, so the encoded pair's largest signed decimal strings are 11
bytes each and the full ID is at most 130 ASCII bytes, below the 1,023-byte ceiling. The two components remain numeric
properties. The template alone does not activate this encoding; root must persist the manifest mapping before any
sample or migration uses it.

## Partition Key Decisions

[access patterns] Keyed Customer lookup is observed; associations and address access are unknown. No peak or skew data
supports numeric scoring; comparisons below are qualitative, all dimensions equally weighted if later quantified.

| Candidate | Cardinality / skew | Routing and writes | Growth / disposition |
|---|---|---|---|
| `/id` | One value per item; high potential cardinality, hot individual item still possible. | Exact-key Customer and Address reads route directly; associations and lists fan out. Separate items do not share transactions. | Selected by request; one item per full key bounds item count but size and actual workload must be checked. |
| `/customerId` | Potentially high but a large customer may concentrate load. | Customer and association can colocate, but an independently shared Address has no authoritative customerId; assigning one would invent ownership. | Reject for this common container unless Address gets a separate owner/container or a justified different model. |
| `/addressId` | May distribute but shared addresses may be hot. | Address and associations route, but Customer has no addressId, may have multiple or none, and customer point reads cannot derive a key. | Reject for this common container without a separate ownership model. |
| Hierarchical `/docType` then `/id` | Full tuple is high cardinality, but only three leading types can concentrate writes. | Known keys route with both values; type-prefix listing targets a prefix but not one full partition; no parent/child atomicity. | Plausible alternative, but no measured listing frequency supports added complexity or changing the requested `/id`. |

`/id` is immutable after creation; changing it requires migration to a new container. Per-item partitions do not
permit atomic Customer plus CustomerAddress or Orders operations merely because types share a container.

## Embedding Strategy

Keep all three standalone. Shared Address has independent identity and can be referenced by multiple customers and
orders; embedding it under one customer or order duplicates ownership and can create stale copies. No evidence proves
a bounded association count, common lifecycle, co-read frequency, or atomic multi-record aggregate. Association keys
support hydration via separately routed reads; cross-partition association scans are necessary when only one endpoint
is known. Reconsider bounded read-only projections only with an explicit staleness contract; never treat them as owners.
Applied `rules/model-embed-related.md` and `rules/model-relationship-references.md`.

## Access Pattern Mappings

| Pattern | Proposed mapping |
|---|---|
| R001 | Query `SELECT * FROM c WHERE c.docType = @docType`, bind `customer`, across partitions with continuation tokens; the current source list is unpaged, so pagination is a future behavior change requiring review. |
| R002 | Derive `customer-{CustomerID}` and point read with that same value for `id` and partition key, including existence checks. |
| W001 | Allocate a source-compatible CustomerID through the coordinated allocator, derive id, validate and create; reject duplicate IDs and rowguid. |
| W002 | Coordinator-mediated replace preserving the posted fields, existing key, validation and uniqueness. Use ETags internally for safe retries; do not introduce a new application-visible lost-update rejection without an approved behavior change. |
| W003 | Coordinated Customer deletion only after atomic NO ACTION checks for all CustomerAddress and SalesOrderHeader references. |

All operations above must pass through the proposed authoritative coordinator, including reads; the Cosmos requests are
the lower-level execution shapes, not an authorization to bypass it. Existing controller evidence is static, not
measured [access patterns]. Address and CustomerAddress have no observed controller pattern; retaining their data and
supporting integrity checks is not an assertion of traffic. The existing `Views/Customers/Index.cshtml` displays
PasswordHash and PasswordSalt. These are sensitive; do not expose them in examples, logs, list views or general APIs.
The R001 `SELECT *` describes existing source-equivalent retrieval, not permission to disclose credentials: introduce
authorized non-sensitive projections and remove that exposure during downstream migration, with explicit behavior/security
review. Cosmos container RBAC is not field-level security; enforce field isolation via a trusted service, not projection
alone. No application changes were made here.

## Cross-Partition Queries

R001 lacks `/id`, so it fans out and has a **high planning bucket** (100+ RU), not a measurement or prediction; actual
cost depends on partition count, result bytes, indexing and pagination. Measure representative volumes before accepting
the cost. Point reads route when the source key is known. Listing links by CustomerID or AddressID, or checking incoming
references, cannot route by `/id` and can fan out as well; these are integrity/possible future operations, not observed
controller requests. Consider a coordinator-maintained durable reverse-reference index or a change-feed read model for
reads; an asynchronously updated projection is not a safe enforcement index. Compare write amplification and freshness
against fan-out after collecting workload evidence. See `rules/query-avoid-cross-partition.md` and
`rules/query-point-reads.md`.

## Indexing Policies

Consistent automatic indexing includes `/*`; excludes `_etag`, `passwordHash`, and `passwordSalt`. This conservative
policy indexes `docType` for R001, association keys for reference lookups, and source search fields while unknown
consumers are investigated. Credentials need not be indexed and exclusion does not prevent reads. SQL indexes
`IX_Address_StateProvince`, `IX_Address_AddressLine1_AddressLine2_City_StateProvince_PostalCode_CountryRegion`,
`IX_Customer_EmailAddress`, and `IX_CustomerAddress_AddressID` are non-unique; Cosmos range indexes are not automatic
equivalents of SQL composite ordering or collation. Benchmark actual queries and explicitly design composite indexes
if needed. Indexing and native unique-key policies do not enforce database-wide uniqueness. Apply
`rules/index-exclude-unused.md` when workload evidence permits narrowing.

## Optimization Recommendations

### Constraints, coordinator and source semantics

The three `AK_Address_rowguid`, `AK_Customer_rowguid`, and `AK_CustomerAddress_rowguid` indexes are independently
unique across each SQL table, not a single combined cross-table unique key. `/id` makes Cosmos native unique-key
checks partition-local and therefore insufficient for these global per-table constraints. Proposed root design:
a durable, transactional coordinator with a single active writer and fenced leadership, serving **all reads and
writes**, including Orders and import paths. Its authoritative transactional store atomically serializes operations,
maintains per-table rowguid uniqueness reservations and source-key identity allocation, parent existence and
reverse-reference state, and records write intent and commit state. On insert/update it checks and reserves the new
rowguid before releasing the old one; on delete it atomically checks incoming references and removes reservations.
It serializes association and order creates/updates with parent deletes to prevent check-then-write races.

Cosmos writes span partitions and containers and cannot join that store's native transaction. The coordinator must
durably stage versioned mutations, fence old leaders and direct clients, publish a committed version only when every
required write is durable, and have reads consult committed state so they never observe partial changes. A durable
write-ahead record, idempotent retry/recovery, reconciliation, fail-closed handling of indeterminate outcomes, and
tested crash/failover behavior are required. A reservation followed by an uncoordinated write or a stale change-feed
index is not equivalent. Exact fencing, storage, read isolation, failover, allocation behavior and rollback protocols
are root design/implementation decisions; this is a conditional preservation proposal, not a deployed system or a
claim that Cosmos supplies distributed transactions. All direct Cosmos reads and writes must be blocked by access
control, including administrative/import paths, or guarantees do not hold. Preserve SQL NO ACTION for all five FKs;
coordinate with the Orders domain's separate order-detail cascade. Verify historical orphans, duplicates and all
consumers before cutover. `rules/model-unique-keys.md` governs the scope distinction.

AddressID and CustomerID are `INT IDENTITY(1,1)`; coordinator allocation must handle existing values, uniqueness,
explicit imports, reseed/overflow and cutover without reusing committed IDs. `rowguid` is non-null UNIQUEIDENTIFIER
with `newid()` default and `ModifiedDate` is non-null DATETIME with `getdate()` default for all three entities.
Customer `NameStyle` is non-null BIT default 0. Defaults apply on omitted inserts, not arbitrary updates; preserve
supplied values and SQL `getdate()` local/time-zone and DATETIME precision semantics rather than assume UTC.
Source nullable fields are Address.AddressLine2 and Customer.Title, MiddleName, Suffix, CompanyName, SalesPerson,
EmailAddress and Phone; all other columns in the three tables are NOT NULL. Version 1 model `type` describes a
representative non-null JSON value, not a nullable union: preserve actual SQL nulls explicitly, without inventing
empty values. Enforce SQL length, alias-type and required-field constraints downstream; `dbo.Name` is NVARCHAR(50),
`dbo.Phone` NVARCHAR(25), `dbo.NameStyle` BIT. Preserve VARCHAR password bytes/encoding semantics, UUID identity
and DATETIME precision on round-trip. Source collation is undeclared; workload collation is an unverified assumption.
Confirm actual SQL collation, comparison and trailing-space semantics before implementing any equivalent string lookup
or constraint; no email uniqueness is claimed. PasswordHash and PasswordSalt are sensitive, never show data, minimize
exposure, and apply downstream least-privilege service access and separate credential handling. ETags protect
individual conditional updates but not cross-item uniqueness or FK checks (`rules/sdk-etag-concurrency.md`).

### Migration feasibility

| Mapping / operation | Constraint and source | Evidence / bound | Disposition |
|---|---|---|---|
| Ids | 1,023 UTF-8 bytes; SQL INT PKs. | Pair typed-hex maximum 130 ASCII bytes; simple IDs shorter. | Safe for declared INT bounds; verify import uses the exact mapping and rejects invalid keys. |
| Item size | 2 MB per item, `rules/model-avoid-2mb-limit.md`. | Each source column is bounded and there are no embedded arrays; JSON/UTF-8 expansion and metadata still count. | Calculate worst-case serialized size and inspect source distributions before load; never truncate. |
| Transactions | Cosmos atomicity is within one full partition tuple. | `/id` gives each item a separate partition; source FKs cross items/domains. | Root coordinator design above; implement, test races/recovery and cutover before writes. |
| Load | Empty-container ingestion and cutover capacity differ from steady state. | Actual volume, window, skew and concurrency unknown. | Plan ordered import and coordinated validation, rate-limit and benchmark before migration; no deployment is implied. |

## Throughput & Storage Recommendations

[volumetrics] Each table has synthetic assumptions of 1,000 rows, 2 KB average row size, 5% monthly growth and
1 read / 0.1 write TPS; none is a measured table workload. The raw three-table payload assumption is about 6,000 KB
initially and 10,775 KB after 12 months at 5% compounded monthly, before JSON expansion, metadata and indexes;
retention, P95/P99 sizes, burst and query result sizes are unknown. Do not equate synthetic SQL row size to Cosmos
item size or add synthetic rates to observed controller patterns.

[access patterns] R001 fan-out and coordinator checks create uncertain additional request volume; point-read and write
costs depend on actual item size, indexes and failure/retry behavior. No RUs were measured and no reliable peak or
monthly RU estimate is claimed. Serverless is the requested account-level mode, with no provisioned container
throughput in this model; validate its regional, throughput, storage, latency and availability fit for the whole
database, including coordinator and initial load, before deployment. Reference `rules/throughput-serverless.md`,
`rules/partition-high-cardinality.md`, `rules/partition-query-patterns.md`, `rules/partition-20gb-limit.md`,
`rules/model-id-constraints.md` and `rules/security-rbac-least-privilege.md`. Record actual load/size evidence and
required design approval in the root handoff; none has been measured or approved here.
