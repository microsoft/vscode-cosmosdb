# Schema Conversion (`schema-conversion`)

`schema-conversion` converts each assessed domain into a Cosmos DB for NoSQL design,
then produces the canonical deployment model. This is the strict deterministic
output boundary.

## Expected Output Artifacts

Required:

- `phases/3-schema-conversion/model.json`, valid and canonical.
- `phases/3-schema-conversion/summary.md`, containing cross-domain analysis,
  decisions, and links to domain summaries.
- `phases/3-schema-conversion/manifest.json`, containing conversion, capacity,
  ownership, identity, and reference-registry evidence.
- A `domains/<DomainName>/cosmos-model.json` and `summary.md` for every domain in
  `phases.schemaConversion.domains`. The JSON file contains the complete validated
  domain model; the Markdown file contains its analysis, rationale, and examples.
- `project.json` with a non-empty domain list and
  `phases.schemaConversion.status: "complete"`.

Do not copy complete domain models into summaries or create separate registry,
capacity, identity, or per-decision analysis files. Keep machine-readable evidence in
the existing manifest and human-readable analysis in the existing summaries. Explain
the need and obtain approval before adding any other durable artifact.

## Adaptive Execution Contract

The Skill has one schema-conversion workflow. It must satisfy the same design,
evidence, validation, and canonical model contract on every run. The host agent
may use multiple passes, tools, or domain subagents when
complexity requires them; call count and decomposition are implementation details.

## Prerequisites

- `phases.assessment.status` is `complete`.
- Assessment domain files and authoritative DDL are available.
- The `cosmosdb-best-practices` peer Skill is loaded.
- `phases.schemaConversion.schemaConversionInstructions`, when present.
- The bundled model validator is available. If it is not yet installed with the
  Skill, stop rather than persisting an unvalidated canonical model.

## Domain Selection

Use `phases.assessment.domains[].isMapped` as the authoritative application-mapping
signal.

- When `include-unmapped-domains` is omitted or false, convert only domains whose
  `isMapped` value is `true`.
- When it is true, convert every assessed domain.
- If no domain qualifies, stop with an option to rerun with
  `include-unmapped-domains: true`; never silently widen scope.
- Record every skipped domain and its source tables in the root summary.
- Persist only converted domain names in `phases.schemaConversion.domains`.

The requirement that every source table maps exactly once applies across the
selected domain set. Tables in intentionally skipped domains remain explicit
migration exclusions; they are not silently dropped or reassigned.

Resolve that set before creating artifacts:

```bash
node <skill-root>/scripts/select-schema-conversion-domains.mjs \
  <workspace>/.cosmosdb-migration/project.json \
  [--include-unmapped-domains]
```

Use `selectedDomains` as the complete work list and carry `skippedDomains` into
the root summary.

## Per-Domain Procedure

First assemble the selected-domain reference registry described in
[validation-evidence.md](../contracts/validation-evidence.md). Assign distinct model entity
names to disambiguate repeated source names without renaming authoritative tables.
Store it in the root manifest and pass `--reference-manifest <root-manifest.json>`
for domain validation. The merge resolves every declared target against the actual
domain models and strictly validates the root.

Process domains in stable name order. For each domain:

1. Resolve guidance for container and identity design.
2. Apply the multi-`docType` strategy below to design containers and map every
  domain table to exactly one entity.
3. Require `version: 1`, domain, source type, stable derived `id`, preserved
   natural source keys, and `idTemplate` for each standalone entity.
4. Resolve partition-key guidance and evaluate cardinality, skew, query routing,
   write distribution, growth, hierarchical keys, and synthetic alternatives.
5. Resolve embedding/reference guidance and evaluate cardinality, bounded size,
   update independence, consistency, and hydration.
6. Map all source access patterns to point reads, parameterized queries,
   transactional batches, change feed, or accepted cross-partition operations.
7. Analyze fan-out and alternatives.
8. Pass the access-pattern and cross-partition analyses into index-policy design.
9. Resolve capacity guidance and produce evidence-linked throughput and storage
   estimates without fabricating missing volumetrics.
10. Write the complete model to the domain's `cosmos-model.json`, validate and repair
  it, then write rationale, evidence, and example documents to its `summary.md`.

Never reduce design depth because fewer model calls are preferred. Continue
iteratively, making and documenting defensible choices within the requested scope
while retaining assumptions and verification obligations.

Design decisions are never terminal blockers. Distinguish
missing evidence, design alternatives, required approval, and verified tooling limits.
Develop concrete, evidence-supported preservation designs within the requested scope;
do not ask permission merely to investigate or propose them. Resolve comparison
semantics, integrity enforcement, and large-value handling as separate decisions,
not one all-or-nothing conversion contract. For each, recommend a supported design,
identify the exact evidence or approval needed, and continue unaffected mappings and
domains while it is pending. A read-only snapshot or weaker guarantees must not be
the only alternative to supplying every missing input or stopping.

Record conditional designs and their clearance criteria in existing summaries.
Choose and document a supported recommendation within the authorized scope rather
than withholding the model until every alternative or advisory concern is settled.
Keep accepted partial results and continue after each decision. Publish a canonical
model when its validators pass and no evidenced correctness failure remains;
`design-decision` entries do not veto publication or phase completion. Follow
[Issue Classification](../contracts/validation-evidence.md#issue-classification).
End early only when the user stops or no authorized work can proceed; identify any
concrete correctness failure or authorization boundary. Never invent source facts,
silently weaken explicit requirements, or claim unperformed checks have passed.

Apply the Migration Feasibility checkpoint before ranking key candidates and before
finalizing each domain; recheck shared-container impacts when merging domains.

After any mapping change, recheck every access-pattern query and example against
the final property names, identity mappings, and partition keys. Structural
validation alone does not prove that queries reference the correct fields.

After writing or repairing the selected domains, validate all domain models and
summaries in one process. Resolve `<skill-root>` to this Skill's installed directory
and include every selected domain in the same invocation:

```bash
node <skill-root>/scripts/validate-schema-conversion-domains.mjs \
  --workspace <workspace> \
  --reference-manifest <root-manifest.json> \
  --domain <DomainName>=<domain-directory> \
  [--domain <DomainName>=<domain-directory>]...
```

The command validates each fixed `cosmos-model.json` and `summary.md` pair, including
cross-domain references and required example documents, then returns paged errors
and warnings, with errors first. Warnings do not block validation; retain them in
the summaries. Repair the reported domains and rerun one batch for the repair round, not
one command per domain. Use the individual model or summary validator only to isolate
an unresolved diagnostic; do not routinely invoke both before or after a successful
batch. Use `--offset <nextOffset>` and `--limit <number>` only when more failure
diagnostics are needed, including warnings on later pages. The merge command produces the canonical root only after
domain validation succeeds.

Keep each complete model only in `cosmos-model.json`. Keep review evidence and
human-readable design analysis in `summary.md`; example document blocks illustrate
the design but are not another copy of the model.

## Model Requirements

- Every selected source table has exactly one authoritative domain owner and target
  disposition. Explicitly declare consolidated mappings and projections in conversion
  evidence; duplicate authoritative owners and unaccounted source tables are errors.
- Every standalone entity has one string `id` attribute deterministically derived
  from its source primary key and a matching `idTemplate`.
- Default IDs prefix the entity name and include every primary-key component. A
  single-column GUID/UUID primary key may use its source value directly when it is
  unique across all standalone entity types sharing the same container and complete
  partition-key tuple. Otherwise prefix it with the stable entity name, for example
  `customer-{CustomerID}` and `customerProfile-{CustomerID}` for shared source UUIDs.
  `docType` does not distinguish item identity. Record the uniqueness evidence and
  chosen templates in the domain summary; never rewrite deployed IDs without an
  approved data and application migration. Composite
  keys are derived identities even when one or all components are GUIDs/UUIDs; include
  every component in `idTemplate` and preserve each separately. For example,
  `membership-{GroupId}-{UserId}` requires an explicit mapping such as `typed-hex-v1`
  when the UUID values contain the template's hyphen separator. Use `{uuid}` only when
  no stable source key or stable string projection exists, and record the reason in
  the summary. `{uuid}` declares a fallback policy only; do not create or persist
  row-level assignments during schema conversion. A future source-data migration must
  resolve production identity separately before importing those rows.
- Never sanitize IDs using lossy character replacement. Select the shared identity
  mapping in [validation-evidence.md](../contracts/validation-evidence.md) for unsafe or ambiguous
  source keys, and use the same helper for sample generation and validation. Preserve
  every source primary-key column losslessly even when it also contributes to `id`.
- Every standalone entity in a container carries every ordered partition-key path.
- Embedded-only entities are represented but do not become standalone documents.
- Relationships reference existing entities and use explicit embed/reference
  strategies. Every `sourceFK` table and column must resolve to the authoritative
  selected source inventory and identify exactly one complete foreign-key mapping
  whose endpoints match the relationship entities. Embedded relationships also
  declare the target document property. Unresolved, ambiguous, or unselected source
  references are errors.
- Index policy paths and capabilities are supported by provisioning.
- Capacity mode and per-container throughput are internally consistent.
- Free-form rationale remains in summaries, not canonical JSON.

### Target Attribute Types

`attributes[].type` describes the serialized target value, not the source database
or application-language type. Use exactly one lowercase value: `string`, `number`,
`integer`, `boolean`, `object`, `array`, or `null`. Preserve the original database
type in `attributes[].source.type`, for example `bigint`, `decimal(38,18)`, or
`datetime2`; source type names are not limited to this target vocabulary.

`number` requires a finite JSON number; `integer` additionally requires an integral
value. `object` excludes arrays and null. `null` means only the JSON null value,
not a nullable modifier for another type. Missing attributes do not satisfy any type,
including `null`. Version 1 does not express nullable unions or optional attributes;
do not use labels such as `string?` or arrays such as `["string", "null"]`. For nullable
source columns, use representative non-null samples of the selected target type and
record application null handling in the summary. Do not replace real source nulls
or declare a field null-only just to pass validation.

Choose a lossless representation explicitly. Dates and UUIDs serialized as text use
`string`; large integers and exact decimals may also require strings, following current
peer guidance. Keep exact digits and scale in string-valued samples. The validators do
not coerce values or infer conversions from `source.type`. An unknown target label fails
model validation before merge or provisioning; repair the mapping deliberately rather
than silently relabeling or converting existing data. These are migration-model contract
rules, not a claim that Cosmos DB prohibits mixed-type properties.

### Unique-Key Policies

Resolve native uniqueness guidance by concept from the current `cosmosdb-best-practices`
index, following [best-practices integration](../workflow/best-practices-integration.md).
When selected, represent the policy at container level as
`uniqueKeyPolicy: { "uniqueKeys": [{ "paths": ["/email"] }] }`.

Every domain sharing a container must declare the same complete policy; the merger
does not union policies. Record the chosen uniqueness scope and supporting evidence
in the conversion summary.

## Multi-DocType Container Strategy

- Prefer co-locating related entity types, including parent-child entities, when
  they are read or written together and share a suitable business partition key.
  Do not default to one container per source table or one container for the entire
  domain. A foreign key alone does not establish that co-location is appropriate.
- Separate entities with materially different access patterns, lifecycle,
  throughput, scaling, indexing, or change-feed processing requirements. Use
  workload evidence and current peer guidance to compare the alternatives.
- Give each entity type a distinct, stable `docType` value within its container.
  Every standalone document carries that value for filtering and deserialization.
  Type-specific queries filter by `docType` and use the appropriate partition-key
  routing; include the discriminator in indexing decisions when queried.
- Sharing a container does not mean embedding: related entities may remain
  separate documents. Transactions across those documents require the same
  container and full partition-key value tuple, including every hierarchical
  level. Co-location does not enable SQL JOINs across documents.
- Every standalone entity must carry all of the container's ordered partition-key
  paths, with matching attribute names and `isPartitionKey: true`. Explain how
  each type obtains its key values; related documents intended for one transaction
  must resolve to the same complete tuple, not merely use the same field names.

If a secondary entity cannot carry reliable values for every shared partition-key
component, either embed it in its owning document and set `isEmbeddedOnly: true`,
or place it in a separate container with its own suitable key. Embedding is valid
only when relationship ownership, bounded size, growth, and update patterns support
it; do not mark an entity embedded-only just to satisfy validation. Embedded-only
entities remain represented in the model but are not generated or seeded as
standalone documents. Never invent constant or placeholder key values to force
co-location, and never emit standalone documents missing the shared key fields.

Record the grouping rationale, alternatives, discriminator values, per-type key
sources, and embed-versus-standalone decisions in the existing domain summary.
Include examples showing how the document types fit the shared container design.

## Naming Conventions

- Use PascalCase for new container names, such as `Orders` and `ProductCatalog`.
- Use camelCase for document property names, including `attributes[].target`,
  preserved natural-key fields, and embedded object properties. For example,
  source column `CustomerID` maps to `customerId`. Keep `id` and the discriminator
  property `docType` spelled exactly as shown.
- Prefer camelCase for newly chosen `docType` values, such as `salesOrder` and
  `salesOrderDetail`. Reuse each entity's exact value in every example and sample.
- Keep partition-key and indexing paths aligned with the exact serialized property
  names, including case. Source-language property names may differ only when the
  application's serializer explicitly maps them to the canonical document names.
- Preserve authoritative identifiers in `sourceTable`, `source`, `sourceFK`, and
  `idTemplate` placeholders. Naming conventions change target names, not source
  identifiers, source-key values, or the selected identity encoding.
- Resolve naming collisions before finalizing the model; never collapse distinct
  source columns or entities into one target merely because their normalized names
  match. Record the chosen mappings in the existing model and summary.

These are migration conventions, not Cosmos DB service constraints. Preserve
engineer-specified or already deployed names and discriminator values unless an
explicitly approved change includes the required data and application migration.
Document exceptions in the domain summary. Provisioning artifacts, sample data,
queries, and migrated application serialization must reuse the canonical model's
names verbatim, without independently recasing, pluralizing, or regenerating them.
Do not apply container naming conventions to Azure account or database names.

## Migration Feasibility

Apply dynamically selected peer guidance and
[reconciled service constraints](../workflow/best-practices-integration.md#reconcile-service-constraints)
to source evidence and the proposed transformation, not target observations:

- **Scope:** Distinguish business domains, containers, HPK prefixes, and complete
  key tuples. Aggregate transformed data across source tables and `docType`s sharing
  each tuple, including skew and growth; container averages do not prove key-level fit.
- **Transactions:** Map required source transactions to target documents, full keys,
  operation counts, payload sizes, and execution constraints. Recheck after adding key
  levels or splitting documents/batches. Do not replace atomicity with partial success
  without an explicit engineer-approved application design change.
- **Initial load:** Assess import volume, export ordering, key concentration,
  concurrency, and cutover window separately from steady-state demand. A populated
  container's potential capacity does not establish empty-container ingestion capacity;
  do not assume partition splits or scaling finish within the migration window.
- **Transformed extremes:** Bound encoded/composite keys, UTF-8 lengths, large source
  values, embedded fan-out, and future growth. Average sizes and synthetic samples do
  not establish whole-population compatibility. Record a lossless disposition for
  unsupported cases; never silently truncate or omit source data.
- **Capacity consequences:** Check the selected account mode and post-import storage
  against applicable throughput constraints. Assess how temporary import scaling can
  affect later minimum throughput and cost; demand-based calculator output alone does
  not establish service eligibility or that throughput can be reduced afterward.

Record `Mapping/operation | Constraint and source | Evidence/bound | Disposition`
in existing domain summaries, consolidating shared impacts in the root summary.
Distinguish supported designs, conditional assumptions, and blocking incompatibilities.
An unbounded source type or unknown future workload is a risk to address, not proof
of a limit violation. Propose a lossless representation or enforcement design and
resolve any consequential choice separately. Do not require a bounded snapshot or
relaxed semantics merely because the source permits larger values.

Concrete incompatibilities block the affected final selection until repaired; the
choice of repair is design work, not a terminal failure. Pending implementation,
source-data validation, or runtime verification are downstream
clearance conditions, not schema-conversion blockers. If a pending check could change
the model, record the assumption and required follow-up rather than assert a failure.
Record the required check and clearance condition before the affected operation;
do not claim those checks have passed. This checkpoint reviews
evidence and semantics; it adds no heuristic numeric validation gates or artifacts.

## Partition-Key and Query Requirements

- Compare two to four plausible key configurations per container, including ordered
  hierarchical or synthetic alternatives when relevant. Use source evidence and
  projected workload, not target metrics; label estimates and missing evidence.
- Reject configurations that violate current service limits, required transaction
  scope, or the model's per-type key alignment before ranking. Apply the feasibility
  dispositions above; scores cannot compensate for blocking incompatibilities.
- Use advisory scores from 0-100 to compare feasible candidates on four dimensions:
  cardinality/distribution skew, query routing, peak write distribution, and
  growth/logical-partition headroom. Scores are comparison aids, not acceptance thresholds.
  Higher is better: 0 means poor fit, 50 substantial tradeoffs, 100 strong alignment.
  Default to the four-score mean; justify workload-specific weights before ranking
  and apply them consistently. Cite evidence and rationale for each score. Mark
  unevaluated dimensions unknown and omit their total rather than inventing precision.
- Recommend the best-supported feasible candidate within the requested scope. Use
  qualitative comparison when evidence cannot support numerical scores; missing or
  low scores do not require additional approval or block conversion. Explain tradeoffs,
  uncertainty, and mitigations, and justify any departure from the numerical ranking.
  Record candidates, available scores, weights, rejections, and the selected design
  in the domain summary, not canonical JSON.
- Use at most three hierarchical levels. Routing is prefix-based: filtering on all
  levels or a leading prefix is targeted; skipping the first level fans out. For
  write-heavy workloads, assess a low-cardinality first level as a hotspot risk
  against expected demand; reject demonstrated capacity or limit violations, not
  cardinality alone.
- Treat partition-key configuration as immutable deployment state. A changed key
  requires a new container, data migration, and application update.
- Map every discovered read and write pattern to a point read, parameterized query,
  transactional batch, patch, change-feed/materialized-view flow, stored procedure,
  or explicitly accepted cross-partition operation.
- Classify cross-partition estimates as low (about 5-20 RU), medium (about 20-100
  RU), or high (100+ RU). Record why the partition key is not routed and evaluate
  materialized views, change feed, synthetic or hierarchical keys, caching, or
  accepting infrequent cost.

Pass the access-pattern mapping and cross-partition analysis directly into index
policy design. Do not assume those analyses exist in canonical model fields.
Resolve current indexing guidance from the required `cosmosdb-best-practices` peer
Skill, apply it to this analysis, and validate that the model and provisioner
support the chosen policy.

With indexing enabled, the validator rejects explicit root `id` entries such as
`/id/?` in `includedPaths`, including quoted equivalents. Omit these redundant
system-range entries; this does not prohibit `/id` partition keys, composite-index
paths, or nested application properties.

For consistent indexing, prefer an explicit `{"path": "/\"_etag\"/?"}` entry in
each container's `indexingPolicy.excludedPaths`. The model validator warns when it
is missing, but omission is not a service-validity error: Cosmos DB excludes `_etag`
by default. Equivalent quoted/unquoted exclusions, exclude-all policies, and
`indexingMode: "none"` do not warn. With indexing enabled, explicitly including the
system `_etag` in range, composite, or full-text indexes is a migration-policy error,
even when an exclusion is also present. Nested application properties named `_etag`
are not the system field. Index exclusion does not affect ETag-based optimistic concurrency.

## Capacity and Storage Requirements

Use access patterns for operation shape, volumetrics for magnitude, and workload
notes for refinements; explicit workload notes win conflicts. Tag summary inputs as
`[access patterns]`, `[volumetrics]`, `[workload notes]`, or `[default assumed]`.

- Estimate point reads near 1 RU per KB, writes near 5-10 RU per KB plus indexing
  overhead, single-partition queries from about 2.5 RU upward, and cross-partition
  queries from their recorded bucket and rate.
- Use a supplied peak or derive it from average demand and the peak-to-average
  ratio, with no extra buffer
  (`bufferMultiplier: 1`), even for high-growth or spiky/seasonal workloads. Only
  when no peak is available, apply a 2x buffer to average demand, or 3x for growth
  above 10% per month or explicitly spiky/seasonal workloads. Round provisioned
  autoscale maxima up to the nearest 1000 RU/s with a 1000 RU/s minimum.
- Estimate storage using the evidence hierarchy below, accounting separately for
  document payload, metadata, indexes, twelve-month growth, and retention.
  Record P95/P99 item-size risk near the 2 MB item limit separately from average size.
- Do not invent row counts or storage when volumetrics are absent. Defaults may
  support an advisory throughput estimate but must be labeled `[default assumed]`.

After deriving evidence-backed inputs, retain them in summary capacity evidence and
use the exported capacity calculator or the merge command without a new input file.
The input may contain `estimatedAverageRuPerSecond`, `estimatedPeakRuPerSecond`,
`peakToAverageRatio`, `monthlyGrowthPercent`, and `spikyOrSeasonal`. The calculator
only derives peak demand, selects the documented buffer, and rounds a provisioned
autoscale maximum. It does not determine service eligibility or enforce Azure
service limits.

The root model must set a stable `databaseName` and one account-wide `capacityMode`.
For provisioned mode, every container has `maxThroughput`; for serverless mode it is
omitted. Before selecting serverless, resolve the current serverless throughput,
storage, partitioning, regional, and feature constraints from the
`cosmosdb-best-practices` peer Skill. Compare them with the evidence-backed workload
and record the applied rule identifiers, findings, and unresolved evidence in the
domain and root summaries. Do not encode changing service limits in the calculator
or canonical model validator.

### Storage Estimation

Schema conversion precedes provisioning. Estimate offline from source volumetrics
and the proposed model/indexing policy; do not request target metrics or deploy pilots
for sizing. Record source evidence, method, assumptions, and uncertainty in the
existing domain summary.

Unknown index overhead or future growth does not justify omitting an available
current-payload estimate. Keep partial estimates and unknown components separate
in the summary; omit totals with material unknowns.

1. **Modeled payload:** When source values or size distributions support representative
  examples, measure compact UTF-8 JSON locally using planned serialization, target
  names, IDs, preserved keys, discriminators, embedded data, and duplication. Weight
  sizes by source populations and child multiplicities. These are modeled payload
  sizes, not observed target or billable storage; 3-5 synthetic correctness samples
  are not statistical evidence.
2. **Source-size fallback:** With only source counts and average sizes, justify a
   JSON multiplier against target shape and size definition: logical row payload,
  compressed allocation, and source indexes differ. Factors such as 1.2x, 1.5x,
  or 2-2.5x are illustrative, not defaults or bounds; tag them `[default assumed]`.
  Never reinflate already serialized payloads.

- **Indexes:** Estimate separately for the selected policy, including specialized
  indexes, using explicit low/base/high assumptions grounded in document shape and
  indexed paths. Indexes can exceed data size; 10-20% overhead/15% default is not
  universal. Unsupported estimates stay unknown, not zero; scenarios are not
  guaranteed bounds.
- **Metadata and duplication:** Add metadata only if absent from size evidence,
  once per standalone document, never per embedded child. Do not assume a fixed
  overhead (such as 100 bytes); justify and label any fallback. Count embedded payload
  in the parent or separately, never both; count projections/snapshots at every
  persisted location.
- **Projection:** Use evidence-backed twelve-month growth and retention; label
  assumed flat growth. TTL alone is not a row cap: consider ingestion, updates
  extending lifetime, and deletion. Embedded data follows parent lifetime unless
  application pruning is documented. Keep tail-size risk separate from averages.
- **Reporting:** Estimate target storage for the current source population and at
  twelve months, with low/base/high scenarios when uncertainty is material.
  Identify the base scenario used by `estimatedStorageGB`
  and manifest inputs. Keep alternatives, partial totals, and missing evidence in
  existing summaries, not new artifacts/model fields; omit totals with material unknowns.
  Heuristic ranges are not validation gates. Round summary values to at most two
  significant figures; retain machine-readable precision.
- **Scope/units:** `estimatedStorageGB` means per-container, single-region data plus
  indexes in GiB (`bytes / 1024^3`); preserve its numeric convention and label summaries
  accordingly. Exclude backup/additional-region costs; convert billing units explicitly
  and account for regional copies separately, never internal replica multipliers.

Use current [index-size guidance](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy#index-size),
and [billing scope](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-your-bill)
alongside selected peer rules.

## Summary Requirements

Each domain summary includes table-to-container mappings, partition-key rationale,
embedding/reference tradeoffs, realistic example documents for every `docType`,
access-pattern mappings with verified source links, cross-partition queries, indexing
decisions, optimization recommendations, and evidence-tagged throughput/storage
tables. The root summary includes the database/container inventory, cross-domain
relationships, capacity totals, serverless checks, unresolved evidence, and links to
domain summaries.

Write each example document in its own fenced `json` block. Serialize it like
`JSON.stringify(document, null, 2)`: one property per line, two-space indentation,
and nested objects and arrays expanded across lines. Never emit minified or single-line
sample documents.

## Cross-Domain Merge

Load only validated per-domain `cosmos-model.json` files. Merge in stable domain order
using deterministic rules for disjoint containers and entities. Never silently choose
between incompatible partition keys, ownership, duplicate entity definitions, or
capacity semantics. Stop for an engineer decision and record the conflict.

Run the bundled merge command with one input per domain:

```bash
node <skill-root>/scripts/merge-cosmos-models.mjs \
  --database <database-name> \
  --capacity <serverless|provisioned> \
  --manifest <root-manifest.json> \
  --output <workspace>/.cosmosdb-migration/phases/3-schema-conversion/model.json \
  --input <DomainName>=<domain-cosmos-model.json>
```

The command validates every domain, merges in stable domain order, detects
partition-key, entity ownership, source-table, indexing, capacity, and source-type
conflicts, validates the root, and atomically writes canonical output. It never
replaces the destination after a conflict or validation failure.

When shared containers carry estimates, include `capacityEvidence` in the root
manifest using [validation-evidence.md](../contracts/validation-evidence.md).
Reconcile distinct operations and peak windows before buffering, and physical storage
before totaling rows/bytes. Retain unknown contributions as unknown. Do not drop equal
numeric estimates or blindly sum already-buffered maxima.

Write the root `manifest.json` with the source hash, explicit selection policy,
domain hashes, selected database/capacity settings, and any contribution and ownership
evidence. The final completion checker validates conversion evidence, root and domain
summaries, every model, predecessor completion, and freshness in one invocation. Do
not rerun the successful batch or standalone validators before that gate. It requires
the root to match the canonical deterministic merge; reconcile root-only edits with
the owning domain or merge inputs before promotion.

For full-text search, use container-level `fullTextPolicy` with `defaultLanguage`
and `fullTextPaths: [{ path, language? }]`, plus `indexingPolicy.fullTextIndexes`
with `{ path }` entries. Omitted path languages inherit the default. Do not nest
`fullTextPolicy` under `indexingPolicy` or replace `fullTextPaths` with `paths`. Bicep emits both
settings with SQL container API version `2025-10-15`; follow the full-text execution
contract in [provisioning.md](./provisioning.md).

After conflicts are resolved, the merge produces `domain: "all"`, a stable database
name, all containers, and account capacity mode. Only validated canonical output may
replace `phases/3-schema-conversion/model.json`.

Write `phases/3-schema-conversion/summary.md` with mappings, design rationale,
cross-domain behavior, capacity estimates, conflicts, unresolved evidence, applied
rule identifiers, validator version, and input artifact hashes. After finalizing all
phase artifacts and semantic project fields, record `project.json#freshness["schema-conversion"]`
through the freshness helper, including consulted workspace evidence files but excluding
peer guidance. Applied peer-rule paths and decision rationale remain in the summary.

## Completion

Set `phases.schemaConversion.domains`, `completedAt`, and status `complete` only
when every listed domain model and the root model pass validation and all required
summaries exist. Never mark `schema-conversion` complete from model file existence
alone.

After finalizing artifacts, freshness, and project fields, run exactly one
`check-phase-completion.mjs --phase schema-conversion` command as the authoritative
completion gate. Use its `--artifact` option or the standalone validators only when
that gate identifies a failure requiring narrower diagnostics.

On resume, validate root and per-domain models and verify all expected paths. Any
missing or invalid required artifact makes `schema-conversion` incomplete. In
interactive mode, ask before repeating a completed conversion only when the request
does not already say regenerate or validate. Autonomous or explicit regeneration
replaces generated domain and root designs without another prompt.
