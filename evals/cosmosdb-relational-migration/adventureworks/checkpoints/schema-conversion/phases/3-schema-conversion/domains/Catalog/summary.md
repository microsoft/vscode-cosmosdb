# Catalog Schema Conversion

## Overview

This is a proposed, undeployed design for the five Catalog tables. Its inputs are the accepted
[source inventory](../../../1-discovery/preflight-manifest.json), [Catalog assessment](../../../2-assessment/domains/Catalog.md),
[access patterns](../../../1-discovery/access-patterns/access-patterns.md), and synthetic
[workload](../../../1-discovery/volumetrics/workload.json). SQL collation, source populations, sizes, runtime
behavior, existing clients and production ownership remain unverified. EF mappings alone do not establish access.
Product and ProductCategory controllers read and write; ProductModel is read through the product controller.
No controller access was found for ProductDescription or ProductModelProductDescription; both remain in scope.
No design component, coordinator, blob store or migration has been implemented.

## Tables to Container Mapping

| Source table | Container / docType | Source key |
|---|---|---|
| SalesLT.Product | Catalog / `product` | ProductID |
| SalesLT.ProductCategory | Catalog / `productCategory` | ProductCategoryID |
| SalesLT.ProductDescription | Catalog / `productDescription` | ProductDescriptionID |
| SalesLT.ProductModel | Catalog / `productModel` | ProductModelID |
| SalesLT.ProductModelProductDescription | Catalog / `productModelProductDescription` | ProductModelID, ProductDescriptionID, Culture |

All five are independent authoritative documents. The association retains both FKs and the ordered composite key.
Product points to optional category and model; category points to its optional parent. Orders'
SalesOrderDetail.ProductID points to Product across domains. All of these FKs have SQL `NO ACTION` on delete;
the model records the incoming order constraint as well as each outgoing constraint. No foreign key implies
same-partition atomicity. Related entity names in the model are plain source table names.

## Container Summary

One `Catalog` container holds five discriminated types with `/id` as its partition key. Each document's
partition-key value equals its `id`. Integer IDs use the corresponding docType followed by `-` and the full
decimal integer, including a minus sign if negative. Preserve the integer source key separately.

The association uses the skill's **typed-hex-v1**, not delimiter escaping or substitution. Its `docType` is
`productModelProductDescription`; the encoded source-table/entity prefix in the physical ID provides a distinct
identity namespace and need not equal the docType.
For `SalesLT.ProductModelProductDescription`, entity `ProductModelProductDescription`, and template components
`ProductModelID`, `ProductDescriptionID`, `Culture` in that order, the resolved ID is
`v1-<encoded-table>-<encoded-entity>-<encoded-model-id>-<encoded-description-id>-<encoded-culture>`.
Strings encode as `s` plus lowercase hex of their lossless UTF-8 bytes; numbers encode as `n` plus lowercase hex
of UTF-8 JSON-compatible decimal text; booleans use `b1` or `b0`. The ASCII hyphen separator cannot occur inside
any encoded component. Before invoking typed-hex-v1, represent the source `Culture` value in the document's
`culture` field as lowercase hex of its raw UTF-16LE code-unit bytes, preserving every code unit, including
unpaired surrogates, embedded NULs and trailing spaces. For example, source `en` consists of code units
`0065 006e`, whose UTF-16LE bytes are `65 00 6e 00`; the stored ASCII `culture` is `65006e00`. The skill
then UTF-8-hex-encodes those eight ASCII characters as `s3635303036653030`. Thus source keys `1`, `2`, `en`
produce suffix `-n31-n32-s3635303036653030`. An unpaired high-surrogate code unit `D800` stores as `00d8`
and becomes the typed component `s30306438`. This reversible source-key representation, not the original
Unicode string, is the typed-hex input; never normalize, substitute, truncate or hash it.

Decode by validating an even-length lowercase hex byte string whose byte count is even and no greater than
12, converting each byte pair and interpreting consecutive bytes as little-endian 16-bit code units without
Unicode normalization or surrogate repair. An empty string remains empty; SQL NULL is forbidden by the source
PK. Preserve the decoded source code units for application hydration and SQL collation comparison. Verify
round trips for empty, BMP, supplementary pairs, unpaired high/low surrogates, embedded NULs and trailing
spaces; never compare the hex encoding as if it were the SQL collation key.

`idTemplate` records the ordered source components,
but the root manifest **must** register `typed-hex-v1` for this container/docType; plain template substitution
would yield the wrong ID. The root must hash the canonical merged model when constructing that identityMapping.
Point lookups must perform the same source-code-unit conversion before passing the stored ASCII `culture` to the
identity helper. INT and NVARCHAR(6) bound the components, but verify the complete UTF-8 ID remains within
1,023 bytes, including both layers of encoding. SQL collation-equivalent Culture values can have different IDs;
the serialized coordinator's SQL-equivalent composite-key registry must resolve logical lookups and reject
duplicates even when case, accent or trailing-space equivalent strings encode differently. A Culture key change,
including case-only changes, needs coordinated rekeying.

Illustrative documents are not source observations. The large-value objects are manifest references, not embedded
content; placeholder paths, lengths and hashes below illustrate shape only.

### Product

```json
{
  "id": "product-1",
  "docType": "product",
  "productId": 1,
  "name": "Example product",
  "productNumber": "EX-1",
  "color": "Black",
  "standardCost": "12.3400",
  "listPrice": "20.0000",
  "size": "M",
  "weight": "1.25",
  "productCategoryId": 2,
  "productModelId": 3,
  "sellStartDate": "2020-01-01T00:00:00",
  "sellEndDate": "2021-01-01T00:00:00",
  "discontinuedDate": "2022-01-01T00:00:00",
  "thumbNailPhoto": {
    "contentId": "catalog/product-1/photo",
    "version": "example-version",
    "lengthBytes": 3,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "thumbnailPhotoFileName": "example.png",
  "rowguid": "00000000-0000-4000-8000-000000000001",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### ProductCategory

```json
{
  "id": "productCategory-2",
  "docType": "productCategory",
  "productCategoryId": 2,
  "parentProductCategoryId": 1,
  "name": "Example category",
  "rowguid": "00000000-0000-4000-8000-000000000002",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### ProductDescription

```json
{
  "id": "productDescription-2",
  "docType": "productDescription",
  "productDescriptionId": 2,
  "description": "Example description",
  "rowguid": "00000000-0000-4000-8000-000000000003",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### ProductModel

```json
{
  "id": "productModel-1",
  "docType": "productModel",
  "productModelId": 1,
  "name": "Example model",
  "catalogDescription": {
    "contentId": "catalog/productModel-1/description",
    "version": "example-version",
    "lengthBytes": 11,
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "format": "xml-infoset-serialization-v1"
  },
  "rowguid": "00000000-0000-4000-8000-000000000004",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### ProductModelProductDescription

```json
{
  "id": "v1-s53616c65734c542e50726f647563744d6f64656c50726f647563744465736372697074696f6e-s50726f647563744d6f64656c50726f647563744465736372697074696f6e-n31-n32-s3635303036653030",
  "docType": "productModelProductDescription",
  "productModelId": 1,
  "productDescriptionId": 2,
  "culture": "65006e00",
  "rowguid": "00000000-0000-4000-8000-000000000005",
  "modifiedDate": "2020-01-01T00:00:00"
}
```

### SQL semantics and large values

The exact source declaration is in the inventory. All five tables require their PK components, `rowguid` and
`ModifiedDate`; integer PKs on the first four tables are `IDENTITY(1,1)`. Name is required on Product, Category
and Model; ProductNumber, StandardCost, ListPrice and SellStartDate are required on Product; Description is
required on ProductDescription. The association's two IDs and Culture are required. SQL defaults `newid()` for
rowguid and `getdate()` for ModifiedDate on each table; identity allocation, SQL DATETIME range/rounding and
server-local time behavior require an explicit compatible writer. Defaults apply on omitted input, not on explicit
NULL. No explicit CHECK constraints are recorded. Honor declared lengths, SQL types and all NOT NULL constraints.

Nullable fields are Product Color, Size, Weight, ProductCategoryID, ProductModelID, SellEndDate, DiscontinuedDate,
ThumbNailPhoto and ThumbnailPhotoFileName; ProductCategory ParentProductCategoryID; and ProductModel
CatalogDescription. Model `type` is the representative non-null JSON type because schema v1 cannot express a
nullable union. Persist actual SQL NULL as JSON `null` and never collapse it into missing, empty string, zero or
empty content. Money values use exact scale-four strings and DECIMAL(8,2) uses scale-two strings; validate SQL
range, rounding and arithmetic explicitly rather than comparing strings lexicographically or using binary floats.
DATETIME text has no fabricated timezone; preserve SQL value and verify round trips.
Other source NVARCHAR fields are modeled as JSON strings, but SQL UTF-16 may contain unpaired surrogates.
Before cutover, verify the entire source-to-serializer-to-SDK-to-service-to-reader path round-trips every UTF-16
code unit, including lone surrogates represented as escaped JSON, without replacement or normalization. Verify
SQL length semantics, null versus empty, collation keys and non-BMP pairs on the same path. Escaped JSON syntax
alone does not prove service or SDK acceptance or preservation; if any component cannot preserve a source value,
stop affected writes/import until a separately agreed lossless representation is designed and verified.

`ThumbNailPhoto` and `CatalogDescription` are always external immutable blob content versions, even when small.
The row stores a bounded reference manifest with content ID, immutable version, length and SHA-256; XML adds a
serialization format/version. Stage and verify complete content first, then commit the row pointer with the
coordinator's durable transaction protocol. Readers access only committed row versions, verify version, length
and hash and logically hydrate them. Never expose a staged pointer or silently return missing/corrupt content.
An empty binary value has a real zero-length content version and manifest; SQL NULL has a null reference.
For XML, use a lossless serialization of the SQL XML **logical infoset**, compare logical XML semantics on
round-trip, and hash the chosen stored serialization; SQL XML need not retain original lexical form or source
bytes, so byte-for-byte original XML recovery is not claimed. Define a canonicalization/infoset policy and verify
namespaces, significant whitespace, ordering, values and supported XML constructs against SQL behavior.
Keep old immutable versions through rollback, retention, in-flight readers and recovery; garbage-collect only
after proving no retained row version or reader references them, including after crashes. Reconcile orphan stages
and retry idempotently; restore row pointers and blob versions together. This contract requires a future external
store and lifecycle implementation and is not guaranteed by Cosmos transactions.

### Global constraints and collation

Preserve all SQL unique indexes: `AK_Product_Name`, `AK_Product_ProductNumber`, `AK_Product_rowguid`,
`AK_ProductCategory_Name`, `AK_ProductCategory_rowguid`, `AK_ProductDescription_rowguid`,
`AK_ProductModel_Name`, `AK_ProductModel_rowguid`, and `AK_ProductModelProductDescription_rowguid`, each scoped
to its own source table. Preserve all PK uniqueness, including the association's SQL-equivalent composite key.
The serverless `/id` container cannot enforce these global alternate keys using native unique keys: their scope
is a logical partition, not a table, and mixed docTypes introduce missing/null collisions. No native unique policy
is claimed. Nonunique SQL indexes do not themselves guarantee correctness.

The workload's `SQL_Latin1_General_CP1_CI_AS` is a **synthetic assumption**, not a verified source collation.
For Product Name and ProductNumber, and Category and Model names and composite Culture where comparison matters,
propose exact SQL-compatible collation keys produced by a parity-verified implementation, including SQL equality,
case and accent sensitivity, trailing-space/padding rules, Unicode behavior and source column overrides. Decode
Culture's raw UTF-16LE code units before applying that comparison; its ASCII hex is not the comparison key. Simple
lowercasing, generic Unicode case folding, binary JSON comparison or an unverified sort key is insufficient.
Preserve the original value alongside its comparison key. Verify actual database and column collations, alias
types, SQL equality and unique-index behavior with source-approved tests before cutover, including case, accents,
trailing spaces, composed/decomposed characters, supplementary characters, unpaired surrogates where the source
accepts them, and any representable edge cases.
Validate unique-index collisions across the complete source population. If parity is not proved, do not enable
the affected writes or claim uniqueness.

As proposed in the root cross-domain design, a **single-writer or fenced, durable transactional coordinator**
must serve **all reads and writes** of affected records, including Orders and external clients. It maintains
SQL-equivalent alternate/composite-key registries, reverse FK references and logical committed versions; serializes
inserts, updates, deletes and key changes; checks parent existence and NO ACTION restrictions; and makes each
multi-partition operation atomically visible to readers. This is a proposed system, not implemented Cosmos
functionality. A standalone reservation, ETag, point-read-before-write, eventually consistent change feed, or
cross-partition query followed by a write is not sufficient. The root design must specify fencing, durable
commit/recovery, reader visibility, retries, conflict handling and coordinated external-blob publication; verify
crash, concurrency, retries, stale-writer fencing and bypass prevention before accepting writes. A coordinator
outage must fail closed rather than expose partial commits or admit conflicting writes.

## Partition Key Decisions

The user-selected `/id` is immutable for a stable source key and distributes distinct rows, supports point
reads and makes every logical partition small for bounded row documents. It does **not** make a Product, Category,
Model or their referencing rows co-transactional. Cross-partition coordination is mandatory. Source key changes
require an atomic logical rekey through the coordinator; the association is especially relevant.

| Candidate | Distribution / query routing / peak writes / growth | Disposition |
|---|---|---|
| `/id` | High potential cardinality; key reads route, lists fan out; distinct row writes distribute but hot single rows can still throttle; one bounded row per key. | Selected; no observed skew or peak evidence. |
| `/productCategoryId` | Category list joins can be scoped but null categories, parent categories, descriptions and models lack a universal reliable key; category skew and key changes are risks. | Reject as a shared key: cannot represent all types without fabricated values; still does not satisfy all FK transactions. |
| `/docType` | Routes type lists; only five keys, concentrates writes and growth, and individual key lookups need docType. | Feasible for representation but poor scale and hotspot/headroom compared with `/id`; still no cross-domain atomicity. |
| Synthetic immutable bucket from the row key | Can distribute writes and constrain a known row's bucket, but does not route whole lists without fan-out or unify related rows. | Plausible but no evidenced advantage over `/id`; requires bucket calculation and change migration. |

Qualitative comparison replaces numerical scores: [access patterns] provides no actual frequency, latency or skew;
[volumetrics] is synthetic. Measure representative load, skew and growth before committing a physical design.
The partition key is deployment state and changing it requires migration, not an in-place edit.

## Embedding Strategy

Separate references avoid duplication and independent ProductCategory updates invalidating embedded values; models
and descriptions are shared, association cardinality and size are not bounded by evidence, and XML/binary values
are potentially large. Product list hydration is more expensive than embedding; embedding small snapshots or
maintaining a read projection is an alternative only with explicit staleness and atomic visibility rules. Parent
category, product category/model and model/description FKs retain their original scalar source IDs; derive the
related target ID for hydration rather than embedding a second authoritative entity.

## Access Pattern Mappings

| Pattern | Evidence | Proposed operation |
|---|---|---|
| R003 | [Category controller](../../../../../Controllers/ProductCategoriesController.cs) | Cross-partition category query; point-read each non-null parent via `productCategory-{id}`. |
| R004 | same | Point-read category by derived ID/PK; details/delete preview hydrate parent; edit/delete/existence need only the row. |
| R005 | same | Cross-partition projected category selection. |
| R006 | [Product controller](../../../../../Controllers/ProductsController.cs) | Cross-partition product query; hydrate optional category and model by point reads. |
| R007 | same | Point-read product; hydrate category/model only for includes. |
| R008 | same | Two cross-partition projected queries for category and model selections. |
| W004, W005, W006 | Category controller | Coordinator-mediated category create/update/delete, including unique names, parent existence and dependent NO ACTION. |
| W007, W008, W009 | Product controller | Coordinator-mediated product create/update/delete, including unique keys, category/model existence and Orders NO ACTION. |

Static inspection records one submitted entity per SaveChanges and no explicit multi-entity transaction; it does
not prove absence of database-side behavior or external writers. Read results, including lists and hydrated related
rows, must go through the coordinator's committed-view protocol; individual Cosmos point reads are underlying
operations, not permission to bypass it. ETags help prevent lost updates but do not implement cross-item integrity.
Existing controller lists are unpaged; continuation paging is a future API/UI behavior change requiring approval.

## Cross-Partition Queries

Type-filtered product/category lists and category/model selection queries fan out because `/id` is unknown.
Reverse lookups for NO ACTION (category parents/products, model products/associations, description associations,
and Orders details) also cross partitions or containers. Estimate **medium, unmeasured planning class** for each
list or reverse query, not measured RUs or an upper bound; real cost depends on cardinality, physical partitions,
projection and pages. Route known IDs to point reads and batch known reference reads where SDK-supported; paginate
with continuations, deduplicate parent lookups and project only required fields. Consider caches or maintained read
models only with an explicit freshness/atomicity contract. The coordinator's durable reverse registry, not a
best-effort query, enforces integrity.

## Indexing Policies

Consistent indexing includes `/docType/?` for lists and source FK fields for reconciliation queries, excluding
other paths and system `_etag`. Point reads use `id`; no explicit `/id/?` is needed. Blob manifests and other
unqueried columns are excluded. SQL unique indexes are separately enforced by the proposed coordinator, not
Cosmos range indexes. Revisit index paths for any newly discovered query, and measure write/read cost and index
storage before adoption; equality on money strings must not be confused with numeric range ordering.

## Optimization Recommendations

Follow `rules/model-unique-keys.md` for partition-scoped uniqueness and `rules/model-id-constraints.md` for safe,
bounded IDs; `rules/partition-high-cardinality.md`, `rules/partition-query-patterns.md` and
`rules/partition-immutable-key.md` inform the key comparison. `rules/model-embed-related.md`,
`rules/model-relationship-references.md`, `rules/model-reference-large.md` and `rules/model-avoid-2mb-limit.md`
support references and external content. `rules/model-numeric-precision.md` informs exact financial strings;
`rules/query-point-reads.md`, `rules/query-avoid-cross-partition.md`, `rules/query-pagination.md`,
`rules/index-exclude-unused.md` and `rules/sdk-etag-concurrency.md` inform access, indexing and concurrency.
`rules/throughput-serverless.md` supports the requested dev/test serverless choice, conditional on real eligibility.
These are installed peer guidance, not proof of deployment or runtime behavior.

## Throughput & Storage Recommendations

| Input or estimate | Evidence and limitation |
|---|---|
| Row counts and sizes | [volumetrics] assumes 1,000 Products at 2 KB, 50 Categories at 0.128 KB, 1,500 Descriptions at 0.5 KB, 250 Models at 1 KB, and 2,000 description links at 0.064 KB: 4,800 rows and 3,134.4 decimal KB before target transformation, indexes and content reconciliation. Synthetic only, not measured populations or size tails. |
| Growth | [volumetrics] assumes 1% net monthly growth except zero for Categories. Compounding each table for 12 months with unchanged average size gives about 3,531.1 KB; this is a scenario, not a forecast. |
| JSON payload scenarios | [default assumed] illustrative 1.2x / 1.5x / 2x source proxy yields approximately 3,761 / 4,702 / 6,269 KB current and 4,237 / 5,297 / 7,062 KB at 12 months. KB is 1,000 bytes. Transformation and metadata costs are unknown; external content may be counted in source sizes and requires reconciliation to avoid double counting. |
| Index, metadata and blob retention | Unknown; no honest all-in container GiB total or `estimatedStorageGB` is asserted. External immutable versions, retained versions and restore copies need separate sizing. |
| Operation rate and RUs | [volumetrics] supplies table-specific hypothetical busy-window rates, with Products at 20 read / 0.2 write TPS. They are not continuous averages or additive operations. [access patterns] actual rates, peaks, list pages and latency remain unknown. No measured RUs or serverless throughput guarantee is claimed; benchmark before use. |
| Capacity | Requested serverless has no configured throughput. Confirm current account regional, storage, burst/throughput and feature limits and import/cutover capacity against actual data and load before provisioning. The peer rule's limits may age; network checks were prohibited. |

### Migration feasibility and clearance

| Mapping/operation | Constraint and evidence | Disposition |
|---|---|---|
| Five docTypes and `/id` | Individual items and complete logical partitions must fit service limits; source averages cannot bound tails. | Externally store binary/XML; measure serialized rows and partition growth with representative actual data before import. |
| Typed association key | Full ID must be within 1,023 UTF-8 bytes; raw UTF-16LE hex is valid ASCII even for unpaired surrogates, and SQL Culture equality may differ from byte identity. | Verify code-unit extraction and round trips, complete ID lengths and collation parity; root registers the mapping and coordinator enforces logical equality. |
| Other NVARCHAR values | SQL can retain UTF-16 code units that an SDK or service JSON path may not round-trip. | Verify escaped JSON and exact code-unit preservation end-to-end before importing or writing; use a separately agreed lossless representation if unsupported. |
| Cross-partition unique/FK changes | Cosmos transactions do not span different complete partition keys or containers. | Design and implement the fenced durable coordinator and committed-read protocol; prove all callers use it before writes. |
| Blob content and XML | Blob storage and row updates are not one Cosmos transaction; original XML bytes are not SQL XML semantics. | Verify staged version publication, infoset parity, hashes, crash recovery and retained-version GC before cutover. |
| Initial import and serverless | Synthetic averages do not establish source count, size tails, import parallelism, skew, cutover window or account limits. | Measure inputs and prove import and account eligibility separately; no resource access was performed. |

No tests, validators, network calls, source connections, deployment, application changes or seeding were performed
for this domain. The root agent must integrate and run the authorized bundled checks.
