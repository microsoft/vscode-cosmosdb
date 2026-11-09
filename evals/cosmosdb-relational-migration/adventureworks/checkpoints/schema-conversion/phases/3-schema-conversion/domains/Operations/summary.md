# Operations Schema Conversion

## Overview

Proposed design only: `adventureworks-eval` uses account-level serverless capacity, with one `Operations` container
partitioned by `/id`. Both tables are EF-mapped and are preserved even though no controller access was observed.
They have no declared foreign keys. Shared placement is a requested administrative grouping, not evidence that they
form one aggregate, have the same owner or are accessed together. Different retention, sensitivity, index or scaling
needs may warrant separate containers after external consumers and ownership are established.

Evidence: [accepted source inventory](../../../1-discovery/preflight-manifest.json),
[Operations assessment](../../../2-assessment/domains/Operations.md),
[access patterns](../../../1-discovery/access-patterns/access-patterns.md),
[volumetrics](../../../1-discovery/volumetrics/volumetrics.md) and
[synthetic workload](../../../1-discovery/volumetrics/workload.json). The supplied DDL was read without a parser or
source connection. No code, data, account or deployment has been changed.

## Tables to Container Mapping

| Source | Container and docType | Identity | PK source preserved separately |
|---|---|---|---|
| `dbo.BuildVersion` | `Operations`, `buildVersion` | `buildVersion-{SystemInformationID}` | `systemInformationId` |
| `dbo.ErrorLog` | `Operations`, `errorLog` | `errorLog-{ErrorLogID}` | `errorLogId` |

Use the invariant base-10 representation of the source integer, including a minus sign if present, with no leading
zeros or locale formatting. Prefixed IDs are short, ASCII-safe and unique for each source key and entity type. The
partition value equals the full `id`. All writers must derive both from the preserved source key consistently;
otherwise Cosmos does not enforce that equality or source-key uniqueness. Duplicate create at the same `(id, id)`
must conflict, not silently upsert. No additional unique-key policy is needed for the two declared primary keys;
uniqueness depends on the deterministic mapping and writer discipline, not on `docType` alone.

## Container Summary

The two standalone, independent records share one container and index policy but not a logical partition, transaction,
or lifecycle. Each full partition key identifies exactly one document under the mapping invariant. A mixed change feed
would require discriminator filtering; no change-feed use is asserted. Both examples are synthetic; their field names
and IDs are the proposed serialization, not source data or an implemented migration.

```json
{
  "id": "buildVersion-1",
  "docType": "buildVersion",
  "systemInformationId": 1,
  "databaseVersion": "1.0",
  "versionDate": "2024-01-01T10:00:00.000",
  "modifiedDate": "2024-01-02T10:00:00.000"
}
```

```json
{
  "id": "errorLog-42",
  "docType": "errorLog",
  "errorLogId": 42,
  "errorTime": "2024-01-03T11:30:00.000",
  "errorNumber": 50000,
  "errorSeverity": 16,
  "errorState": 1,
  "errorProcedure": "ExampleProcedure",
  "errorLine": 12,
  "errorMessage": "Example error message"
}
```

### Source constraints and representation

| Source columns | SQL semantics and target obligation |
|---|---|
| `BuildVersion.SystemInformationID` | `TINYINT IDENTITY(1,1) NOT NULL`, primary key; preserve the integer and derive `id`. `TINYINT` has 256 possible values, including zero, even though automatic generation begins at 1. |
| `BuildVersion.Database Version` | `NVARCHAR(25) NOT NULL`; map the exact value to `databaseVersion`, enforcing the source length and nullability on future writes. |
| `BuildVersion.VersionDate` | `DATETIME NOT NULL`, no declared default; map to `versionDate`. |
| `BuildVersion.ModifiedDate` | `DATETIME NOT NULL DEFAULT (getdate())`; map to `modifiedDate`, reproducing source default behavior when omitted, not when explicitly supplied. |
| `ErrorLog.ErrorLogID` | `INT IDENTITY(1,1) NOT NULL`, primary key; preserve as `errorLogId` and derive `id`. |
| `ErrorLog.ErrorTime` | `DATETIME NOT NULL DEFAULT (getdate())`; map to `errorTime` with the same omitted-value distinction. |
| `ErrorLog.ErrorNumber`, `ErrorMessage` | `INT NOT NULL` and `NVARCHAR(4000) NOT NULL`, respectively; preserve values and enforce lengths and requiredness. |
| `ErrorSeverity`, `ErrorState`, `ErrorLine` | Nullable `INT`; retain null as null rather than zero. |
| `ErrorProcedure` | Nullable `NVARCHAR(126)`; retain null and enforce source length for non-null values. |

No source FKs or additional declared constraints for these tables appear in the accepted inventory. SQL Server identity,
defaults, data types, string limits and nullability are not automatically enforced by this model. Future ingestion and
writers must validate them. The version-1 model specifies the non-null JSON type for nullable attributes; it cannot
express a nullable union. Preserve explicit SQL nulls as JSON null, and ensure the eventual serializer and readers
handle both non-null and null values without replacing them.

Represent SQL `DATETIME` as a consistent ISO 8601 local date-time string without an invented offset, preserving the
source's stored value and precision; `DATETIME` itself contains no time zone. Before any actual migration, verify SQL
server clock/time-zone and rounding behavior, default evaluation, and round-trip of all values, including its range.
If consumers require UTC, agree a conversion contract with the owner rather than assuming these values are UTC.
`NVARCHAR` size/Unicode and SQL comparison behavior also need source-compatible validation; workload collation is
an assumption, not a DDL declaration. SQL `INT` and `TINYINT` values are exact in JSON's numeric range.

## Partition Key Decisions

`/id` is the requested choice, derived from the immutable source identity for both types. The source schema does not
establish access frequencies, query windows, hot-key skew or growth. Qualitative comparison is therefore preferable to
invented numeric scores or weights; all four dimensions below are assessed as conditional rather than measured.

| Candidate | Cardinality / skew | Query routing | Peak write distribution | Growth / partition headroom | Decision |
|---|---|---|---|---|---|
| `/id` | One value per record; BuildVersion has at most 256 records; repeated writes to one record can still be hot. | Known source key derives both ID and full key; lists and time filters fan out. | Independent records distribute key values, but physical distribution and peaks are unverified. | One bounded row per key under the invariant; no unbounded log collection in one logical partition. | Selected; no unsupported assumptions about common queries. |
| `/docType` | Only two values; all errors share one value. | Type lists are routed, individual reads also need the key. | All current errors compete on one logical partition. | Indefinite ErrorLog growth is concentrated in one key. | Not selected: likely hot and growth-risky, despite easier type lists. |
| Synthetic type + time bucket, e.g. `/bucket` | Cardinality depends on bucket duration and traffic; no common existing time field is a proven immutable grouping key. | Time-window reads can target known buckets; key-only reads need a bucket lookup. | Current bucket can be hot; sharding may be needed. | Each bucket may grow with volume and retention. | Not selected: derived key and operational assumptions unverified; compare only if time queries are established. |
| Hierarchical `/docType` then `/id` | Two first-level values with one-record full tuples; full tuple remains high-cardinality. | Type prefix scopes reads; point reads need both levels. | First-level skew and split behavior require assessment. | Full tuple bounded, but prefix traffic can still be skewed. | Not selected: additional key construction and feature/SDK compatibility without evidence of type-list demand. |

Changing the partition-key definition requires a new container and migration; mutating an existing item's partition key
requires a delete/recreate rather than an in-place update. Confirm actual access and owner requirements before deployment.
The alternatives do not have a known shared transaction requirement; introducing one would require reassessment.

## Embedding Strategy

Neither table has a source FK to the other or any other table. No shared access or atomic operation was found.
Independent documents avoid inventing parent-child ownership and prevent log growth inside a version item. Separate
containers remain a credible alternative for independently managed logs, retention, access control or indexing, but
would add operational configuration; evidence does not justify overriding the requested one-container design.
There are no source FK references to encode or hydrate in this domain.

## Access Pattern Mappings

[access patterns] The [static discovery inventory](../../../1-discovery/access-patterns/access-patterns.md)
records **no observed application read or write** for either table; therefore there are no discovered R/W identifiers
to map and the model has an empty `accessPatterns` array. The EF mapping is visible in
[sampledbContext.cs](../../../../../Models/sampledbContext.cs); an EF mapping is not proof of actual controller use.
External producers and consumers may exist.

| Potential operation, not observed | Proposed target handling | Caveat |
|---|---|---|
| Lookup by source PK | Derive the appropriate prefixed `id`; point-read with the same string as `/id`. | Caller must know the table/type and source key. |
| Create, replace or delete one record | Derive `(id, /id)` and use the corresponding single-item operation; use conditional create and ETag concurrency where needed. | Identity allocation, source defaults, validation and conflict behavior still need an implementation design. |
| List versions or filter errors by time | Parameterized `docType`-filtered query, optionally with a time predicate and continuation tokens. | No full `/id` supplied, so fan-out; this is a hypothetical operation, not observed use. |

## Cross-Partition Queries

There are no discovered cross-partition queries to encode; the model's `crossPartitionQueries` array is empty.
Hypothetical type-list or error-time queries across `/id` values fan out across physical partitions even if `docType`
or `errorTime` is indexed. Their frequency, selectivity, physical partition count and request charge are unknown;
no measured RU or reliable low/medium/high estimate is claimed. Use pagination, projections and bounded time filters
where appropriate; if a real, frequent query justifies it, evaluate a time-bucketed materialized view or alternate
container and its consistency, indexing, retention and write amplification. Record any accepted fan-out and estimate
its cost only after access and volume evidence exists.

## Indexing Policies

Use consistent automatic indexing with `/*` included and the system `/_etag` path explicitly excluded. `id` remains
the system identity; do not add a redundant explicit `/id/?` inclusion. This conservative policy indexes `docType`
and other potential filter fields while external query requirements are unknown. It also incurs write/storage cost
and may index sensitive diagnostic text; gather actual queries and data-classification requirements before narrowing
paths. No composite index or TTL is asserted. A future index change must be checked against actual queries and the
container's deployed policy.

## Optimization Recommendations

* Preserve the deterministic IDs, use point reads when keys are known, and avoid query-based existence checks for
  unique creation. Maintain a race-safe identity allocator compatible with SQL `IDENTITY(1,1)`, including import
  high-water/reseed behavior, concurrent writers, exhaustion, permitted explicit identity values and gaps. One
  possible design is a durable per-type atomic counter, coordinated with the import and all writers; verify its
  transaction/failure semantics and cutover before writes. The counter/coordination mechanism is not implemented or
  represented as a source entity here. A `TINYINT` identity can exhaust even when fewer than 256 rows currently exist.
* Apply validation for required fields, source lengths and defaults at every future write boundary. An ETag can guard
  concurrent single-item updates but cannot provide arbitrary SQL multi-record atomicity. Confirm external transactions
  and ownership; if atomicity spans records, `/id` places them in different partitions and needs a separately approved
  preservation design before cutover.
* Classify `ErrorMessage` and `ErrorProcedure`, restrict access appropriately, and agree log retention and deletion
  behavior with the owner before choosing TTL or moving diagnostic records. No retention period is assumed.

### Migration feasibility and clearance

| Mapping/operation | Constraint and evidence | Disposition before use |
|---|---|---|
| Both identities | SQL primary keys and identity metadata in the accepted inventory; Cosmos identity uniqueness is scoped to the full partition. | Deterministic `id = /id`, per-type prefix and source key preservation; verify all importers and writers obey the invariant and handle duplicate create/allocator concurrency. |
| Single item | SQL `NVARCHAR(4000)` bounds ErrorMessage but JSON encoding, system metadata and remaining fields add bytes; source rows and size distribution are unknown. | Check serialized size for all imported and future values against the service item limit; never truncate. Escalate an oversized case to a lossless external-payload design with agreed consistency and access controls. |
| Logical partitions | One source row per `id` when the mapping invariant holds, not an accumulating bucket. | Validate that invariant, actual item sizes and per-key traffic; source workload does not establish a hot-key or size bound. |
| Import and transactions | Export ordering, write concurrency, cutover window and external SQL transaction scope are unknown. | Establish snapshot/change reconciliation, allocator high-water and traffic/cutover plan; preserve any required atomicity before allowing affected writes. |
| Serverless | Development scope and synthetic workload only; real peak, data, region, account feature and import requirements unknown. | Verify current account and service limits, applicable region/feature support, peak and post-import storage before deployment; no eligibility or performance claim. |

## Throughput & Storage Recommendations

| Evidence and calculation | Result and limitations |
|---|---|
| [volumetrics] BuildVersion | Synthetic 1,000 rows is impossible for the `TINYINT` primary key. Actual count is **unknown**; 256 is a domain maximum, not a replacement estimate. The supplied 5% monthly growth cannot be applied indefinitely to that keyspace. |
| [volumetrics] ErrorLog | 1,000 rows, 2 KB average, 5% monthly growth, 1 read TPS and 0.1 write TPS are synthetic scenario assumptions, not measurements or verified operation mix. Actual retention, item-size tail and peak are unknown. |
| [access patterns] and [volumetrics] throughput | No observed Operations accesses; synthetic TPS cannot be attributed to point reads, lists or writes. No credible workload RU/s, peak or measured request charge is available. Serverless carries no provisioned container throughput in the model. |
| [default assumed] partial payload scenario | For ErrorLog only, treating 2 KB as 2 KiB and assuming a 1.5x SQL-row-to-JSON expansion gives 1,000 × 2 KiB × 1.5 ≈ 2.9 MiB (0.0029 GiB) current document payload, before metadata and indexes. This conversion factor is illustrative, not a measured bound. |
| [default assumed] twelve-month payload scenario | If ErrorLog grows 5% monthly with no deletion, `1.05^12` gives approximately 5.3 MiB (0.0051 GiB) of document payload; actual growth and retention are unknown. BuildVersion, metadata and index costs remain unknown, so neither value is a container storage total. |

No container `estimatedRowCount` or `estimatedStorageGB` is asserted: BuildVersion's actual population and combined
metadata/index overhead are unknown. Average size does not establish P95/P99 or maximum item size. Gather actual
row counts, serialized size distribution, index footprint, growth, retention, operation mix, peak and import rate
before sizing. Serverless is appropriate to evaluate for the requested development scenario, but current limits and
single-region/feature compatibility must be checked from current authoritative documentation when network access is
authorized. No service documentation was fetched and no RU, storage or runtime behavior was measured.

### Applied peer guidance

* `rules/model-id-constraints.md`, `rules/model-unique-keys.md`: bounded ASCII IDs and per-partition uniqueness,
  requiring consistent deterministic mapping; source integer keys remain separate.
* `rules/model-type-discriminator.md`, `rules/model-embed-related.md`: explicit types, independent records, and
  comparison with separate containers rather than claiming shared access.
* `rules/partition-high-cardinality.md`, `rules/partition-query-patterns.md`,
  `rules/partition-immutable-key.md`, `rules/partition-avoid-hotspots.md`, `rules/partition-20gb-limit.md`,
  `rules/partition-synthetic-keys.md`, `rules/partition-hierarchical.md`: compare routing, immutable keys,
  skew, growth and bucket/HPK alternatives rather than treating cardinality as sufficient.
* `rules/query-point-reads.md`, `rules/query-avoid-cross-partition.md`: known-key point reads and explicit
  fan-out tradeoffs; no invented observed query.
* `rules/index-exclude-unused.md`, `rules/model-avoid-2mb-limit.md`, `rules/throughput-serverless.md`: defer
  index narrowing until access is known, check size losslessly, and verify serverless constraints before deployment.
