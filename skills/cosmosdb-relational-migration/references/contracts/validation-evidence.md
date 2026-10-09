# Portable Validation Evidence

The model owns DDL interpretation. Node helpers validate JSON/Markdown structure,
source hashes, and cross-artifact consistency; they do not parse or execute SQL.
The Skill supplies no DDL parsing script, including for model-only interpretation.

Follow [DDL interpretation](../workflow/ddl-interpretation.md) for parser choice and
interpretation procedures, and the [freshness contract](./freshness.md) for recording
and checking whether analytical inputs and outputs remain current.

## Assurance Contract

Keep these meanings distinct in the preflight summary and checkpoint report:

- `evidence-validated`: portable validators confirmed the selected paths and exact
  hashes, the recorded inventory shape, and internal identity/key consistency.
- `sqlglot-assisted`: the agent inspected SQLGlot AST output and diagnostics for the
  declared dialect in addition to evidence validation.
- `model-reviewed`: the model interpreted the DDL directly, optionally consulting
  authoritative vendor documentation, in addition to evidence validation.
- `source-engine-validated`: an optional real source-compatible engine independently
  accepted or validated the DDL. Use this term only when that check actually ran.

SQLGlot describes itself as intentionally lenient and not a source-engine validator.
Model review is also not deterministic syntax validation. The completion checker does
not discover arbitrary malformed SQL; it verifies that the chosen procedure recorded
no unresolved correctness failures and that its evidence still matches the
current source bytes. Never convert `sqlglot-assisted` or `model-reviewed` into a claim
of source-engine validity.

## Issue Classification

The version-1 `blockingIssues` field is an array of classified issue objects, or
`[]` when there are none. Each entry has a non-empty `message` and one `kind`:

| Kind | Meaning | Completion effect |
| --- | --- | --- |
| `design-decision` | A design choice, assumption, open alternative, or advisory follow-up | Non-blocking; retain in the summary |
| `invalid-model` | A concrete model or source-contract violation | Blocks until repaired |
| `data-loss` | Demonstrated omission, truncation, or lossy transformation | Blocks until repaired |
| `unsupported-behavior` | A required behavior the selected implementation demonstrably cannot support | Blocks until repaired |
| `failed-validation` | An applicable check for the current scope actually failed | Blocks until repaired |

Correctness failures also require a non-empty `evidence` array of source locations,
report sections, or validation-result references supporting the finding. A missing
measurement, theoretical risk, pending approval, or unperformed later-phase check
is not a correctness failure. Issue classification does not independently prove a
finding; model, source-coverage, freshness, and execution validators still apply.

For example, `{ "kind": "design-decision", "message": "Review index tuning before deployment." }`
does not prevent completion. Do not relabel a concrete failure merely to pass a gate.
On rerun, review and reclassify existing string entries using their evidence; the
reader reports unclassified entries as a manifest-format error rather than guessing
their severity from prose. Preserve the finding and rationale in the existing summary.

## Inventory in the Preflight Manifest

Record `sourceInventory` in `preflight-manifest.json`, not in a
separate inventory file. It contains `version: 1`, `dialect`, `parser`, `files`,
`tables`, and `errors`. `parser.method` must match the saved decision; SQLGlot mode
also records `name: "sqlglot"` and the version actually used. Each selected file has
its workspace-relative `path` and SHA-256 of exact bytes. Each table has its qualified
`name`, ordered `identity` parts (`name` and `quoted`), typed `columns`, `primaryKey`
column names, and `foreignKeys`. Retain source locations, constraints, and other
constructs as evidence in this same result; every selected statement is accounted for.

Preserve column nullability, length, precision/scale, resolved alias types, and
declared checks with source locations in this inventory. Explicitly distinguish
`unknown` from `not applicable`; missing evidence never means unrestricted input.

Each `foreignKeys` entry records ordered `columns`, `referencedTable`, and ordered
`referencedColumns`. Both column arrays are non-empty, have equal lengths, and preserve
composite-key order. Source and referenced tables and columns must resolve in the same
inventory. A model relationship's `sourceFK.table` and `sourceFK.column` identify
exactly one recorded foreign key; ambiguous or missing matches block conversion.

Compute `sourceSha256` with the exported `sourceFilesHash(dialect, files)` helper,
or the equivalent SHA-256 of compact JSON `{ "dialect": ..., "files": [...] }`
with file entries sorted by path and ordered `path`, `sha256` properties. This is
byte hashing, not DDL parsing. Completion checks the current selection and hashes,
recorded method, and inventory shape. It never reruns SQLGlot, validates SQL syntax, or claims that model
interpretation was independently parsed. Missing or stale inventory requires the
agent to repeat the chosen procedure, not to create another artifact.

## Raw Workload Inputs

The existing `preflight-manifest.json` owns a `workloadInputs` array. It is required
when any raw volumetrics or access-pattern files are selected. With no raw workload
inputs it may be omitted for compatibility, or set to `[]`. Do not create a sidecar.

Record exactly one entry per selected source/path pair:

```json
{
  "source": "volumetrics",
  "path": ".cosmosdb-migration/phases/1-discovery/volumetrics/workload.csv",
  "sha256": "<SHA-256 from the input inspection>",
  "disposition": "used",
  "evidenceKind": "unknown",
  "rationale": "Queries reviewed for access coverage; production provenance is not established."
}
```

- `source`: `volumetrics` or `access-patterns`, matching the resolved selection.
- `path`: the exact application-workspace-relative path returned by input inspection.
- `sha256`: the current exact-byte hash, not a hash of a sample or generated summary.
- `disposition`: `used` or `excluded`. `used` requires actual review and an explanation
  of what the file contributed. `excluded` requires a substantive reason and explicit
  user approval when omission changes scope or material conclusions; retain that decision
  in the preflight summary. Never mark an unexamined file used merely to pass validation.
- `evidenceKind`: `observed`, `synthetic`, or `unknown`. Establish provenance before
  reporting measurements as observed; a log-shaped file alone does not establish it.
- `rationale`: explain use or exclusion, including material review limitations and the
  corresponding summary findings. Empty explanations do not satisfy completion.

Every selected file must be accounted for, including one excluded from analysis after
review. Files excluded by the configured source selection are not selected inputs.
The same physical file selected in both source groups has one entry per group; its
content can be reviewed once. Reject missing, duplicated, unselected, malformed, or
stale entries. Re-enumerate after input changes rather than preserving obsolete claims.

These checks prove inventory coverage and recorded hashes, not that the agent correctly
interpreted every record or truthfully established provenance. The phase summary must
explain actual evidence and limitations. Older completed runs with raw files but no
inventory need review and regeneration; do not retrofit completion by merely adding hashes.

## Early-Phase Reports

Write each phase's human-readable report and machine evidence to the Markdown and
JSON paths defined in [project-state-and-artifacts.md](./project-state-and-artifacts.md).
Every manifest has `version: 1`, current
`sourceSha256`, and `blockingIssues` following [Issue Classification](#issue-classification).
Completion permits design-decision entries but no unresolved correctness failures.
Keep concrete failures recorded until actually resolved. Required report sections must be populated.

Preflight summary sections: `Summary`, `Warnings`, `Decisions`. The preflight manifest
contains `sourceInventory`, not `sdkCompatibility`.
An optional `comparisons` array in that manifest declares figures known to be comparable: each entry
has `unit: "operations/second"`, an explicit observation `window`, `operator`
(`equal` or `gte`), and nonempty `left`/`right` operand arrays. Each operand is
`{ "kind": "pattern", "id": "R001" }` or
`{ "kind": "volumetrics", "table": "public.orders", "field": "Read TPS" }`
(also `Write TPS`). The checker sums each side from actual template cells and checks
the relationship. Unknown values cannot satisfy a comparison. Record all material
comparable contradictions, but do not invent additivity or shared observation windows.
Template validators require every bundled
column, valid numeric values or explicit `unknown`/`N/A`, optional `(estimated)`
markers, unique row/pattern IDs, and resolvable source tables. Read/write IDs use
`R001`/`W001` style. Every source table requires a volumetric row and an access
pattern or an exact `No observed application access: <inventory table name>` note.

Discovery summary sections: `Source Overview`, `Read Patterns`, `Write Patterns`,
`Relational Semantics`, `Warnings`. Its manifest requires `sdkCompatibility` from
[sdk-compatibility.md](./sdk-compatibility.md) for every declared application language.
The following excerpt illustrates its source and access-pattern fields; add the
validated SDK report to the same manifest before completing discovery:

```json
{
  "version": 1,
  "sourceSha256": "<inventory sha256>",
  "blockingIssues": [],
  "tables": ["public.orders"],
  "patterns": [
    {
      "id": "R001",
      "kind": "read",
      "tables": ["public.orders"],
      "tps": 10,
      "operation": "Look up an order by its source key",
      "evidence": "code",
      "sourcePaths": ["src/orders.ts"]
    }
  ],
  "noObservedAccess": []
}
```

Evidence is `code`, `observed`, `schema-inferred`, or `query-only`. Unknown TPS is
`null`, not zero. Code evidence requires existing workspace-relative source files.
Tables must be covered by patterns or an explicit no-access disposition, never both.
The sample path above is illustrative; use only real source files.

Assessment summary sections: `Overview`, `Domains`, `Cross-Domain Dependencies`,
`Recommendations`, `Warnings`. Its manifest adds the complete
`tables` and `domains` arrays plus `crossDomainEdges`, each with `fromDomain`,
`fromTable`, `toDomain`, `toTable`, and nonempty `strategy`. Use an empty edge array
only when no cross-domain dependencies exist. Domain report sections are `Purpose`,
`Tables`, `Access Patterns`, `Cross-Domain Dependencies`; each
manifest adds `domain` and `tables` matching the checkpoint. Do not claim these
structural checks prove the truth of inferred business behavior.

## Domain References and Root Agreement

Before converting domains, record `referenceRegistry` in the root `manifest.json`,
an array with entries containing
`domain`, `name` (model entity name), and `sourceTable`. Select distinct model entity
names when source domains reuse a name; this avoids ambiguous bare `targetEntity`
values without changing the version 1 model. Do not copy foreign-domain entities
into a domain just to satisfy reference checks.

The batched domain validator described in [schema-conversion.md](../phases/schema-conversion.md)
is the normal validation path. To isolate a model-specific failure reported by that
batch or the final completion checker, run:

```bash
node <skill-root>/scripts/validate-cosmos-model.mjs <domain-cosmos-model.json> \
  --reference-manifest <root-manifest.json> --check
```

This validates local structure and declared external targets. Without the registry,
validation remains strict. The merge rebuilds the registry from actual domain
models, supports cyclic references, and strictly checks every root target. A registry
declaration never substitutes for a missing domain model.

To isolate a summary-specific failure, run:

```bash
node <skill-root>/scripts/validate-schema-conversion-summary.mjs \
  --kind domain --workspace <workspace> --domain <DomainName> \
  --model <domain-cosmos-model.json> <domain-summary.md>
```

Do not run both individual commands after a successful batch.

Use `domains/<DomainName>/{summary.md,cosmos-model.json}` per converted domain. Put the complete
model in `cosmos-model.json` and the domain analysis in `summary.md`.
Record conversion evidence in the root `manifest.json` with:

- `version: 1`, current `sourceSha256`, and classified `blockingIssues` with no unresolved correctness failures.
- Explicit `includeUnmappedDomains` boolean matching the current invocation.
- `domainSha256`: object from selected domain name to SHA-256 of its canonical bytes.
- Selected `databaseName` and `capacityMode`.
- Optional `capacityEvidence`, with the reconciliation contract below.
- Optional `sourceDispositions` for projections or consolidation. Each entry has
  `sourceTable`, owning `domain`, and `targets`. Each target has `domain`, `container`,
  `entity`, and `kind`: `authoritative`, `embedded`, `consolidated`, or `projection`.
  Exactly one target per source is non-projection; every target must have actual
  source lineage in its model mapping. Every model entity needs a disposition.

Without explicit dispositions, the default is exactly one entity per selected
source table in its owning domain. Additional projections are allowed only with
explicit ownership. Summary evidence never permits missing source columns or
unselected source references. Complete source coverage includes source-specific
qualified identities, not lowercased table names.

Every source column must be preserved on its declared non-projection target;
columns present only in a projection do not satisfy authoritative coverage. A
standalone document's derived `id` does not replace a natural source column. Preserve
every entity's source primary-key components separately and include all components
in its source-derived `idTemplate`. Embedded entities need no standalone ID template;
generated UUID fallbacks retain the policy and provisioning requirements below. For
consolidation, check each source table's columns against the same declared target
without requiring subsidiary source keys in the owning entity's ID template.

```bash
node <skill-root>/scripts/validate-conversion-evidence.mjs <workspace>
```

Use this standalone conversion-evidence command only to isolate a failure reported by
the final completion checker. The completion checker already verifies the recorded
inventory and current source hashes, selected domains, hashes, ownership, and
byte-identical canonical root merge. Root-only edits must be reconciled with the
domain and merge inputs before completion.

## Capacity Contributions

Pass `--manifest <root-manifest.json>` to the merge command when reconciling
estimates for shared containers. Read `capacityEvidence` from that manifest. Its
shape is `{ "version": 1, "containers": [...] }`.
Each container entry has `name`, `operations`, `storage`, and optional `sizing`.

Each operation has a stable `id`, contributing `domains`, `ruPerOperation`,
`operationsPerSecond`, `window`, and `source` provenance. Both numeric fields are
non-negative and finite. Identical operation IDs in the same window mean the same
work and must have equal estimates; distinct IDs are additive. Include every
contributing domain. Use the same window for coincident demand, including demand
whose noncoincidence is unknown. Distinct windows assert noncoincident observations;
the reconciliation sizes to the maximum window after summing its distinct operations.
That reconciled demand is passed to the calculator as the peak and receives no extra
buffer, including for high-growth or spiky workloads. Round once after reconciliation,
not per contribution.
Follow peer guidance when deriving operation costs; do not invent observations.

Storage entries have stable `id`, `kind` (`primary`, `embedded`, `projection`),
`rows`, `bytesPerItem`, and `source`. Follow the
[storage sizing and reporting rules](../phases/schema-conversion.md#storage-estimation):

- `rows`: current contribution count; null means unknown. Never pre-apply growth
  or retention. `estimatedRowCount` counts current standalone documents only.
- Embedded entries name a standalone `parent`; exclude their separately counted
  bytes from the parent and their rows from document totals. Count projections
  separately. Do not allocate standalone metadata to embedded entries.
- `bytesPerItem`: base-scenario payload plus uncounted metadata and allocated index
  bytes; null means unknown. Allocate container overhead once across contributions.
  The helper adds no inflation/overhead; do not add it again to the output. Link
  `source` to the summary's breakdown, method, assumptions, and uncertainty.
- `sizing.monthlyGrowthPercent`: one container-wide rate over twelve months with
  constant `bytesPerItem`. Justify this approximation; per-entry growth and changing
  sizes are unsupported. Record an explicit rate (`0` for acknowledged flat growth),
  or omit it/use null when unknown. The helper omits `estimatedStorageGB` when growth
  is unknown, retaining known throughput and current row counts without assuming zero growth.
- Optional `retainedRows`: evidence-backed projected-count cap, consistent between
  parent and embedded contributions. TTL duration alone is insufficient.
- `estimatedStorageGB`: single-region data plus indexes in GiB (`bytes / 1024^3`).
  Keep alternative scenarios, partial estimates, and billing adjustments in summaries,
  not new canonical fields.

Throughput uses the bundled capacity calculator after demand reconciliation.

Equal numeric container estimates are not duplicates. Shared containers with any
numeric estimates require contribution evidence. Unresolved overlap, growth, or
retention choices are advisory uncertainty: retain partial evidence and omit
indeterminate aggregate estimates rather than silently selecting totals. Do not turn
missing optional estimates into `blockingIssues`. Required throughput configuration
and validation of supplied numeric evidence still apply; label estimated demand
explicitly when production measurements are unavailable.

## Identity Mapping

Derive item IDs from the entity's `idTemplate` using the selected encoding. Values that contain template
separators or unsafe characters require an explicit mapping decision, not hyphen
replacement. Never rewrite existing deployed IDs automatically.

When a source-derived ID requires an explicit encoding, store `identityMapping` in
the root manifest. It has `version: 1`,
`modelSha256` matching the canonical model bytes, and `mappings`. Each mapping has
`containerName`, `docType`, `sourceTable`, `idTemplate`, `encoding` (`legacy` or
`typed-hex-v1`), and the applied `rule` path.

Every resolved ID must fit within the fixed 1,023-byte UTF-8 service ceiling, with or
without an explicit mapping. Count the complete final ID, including prefixes and
encoding expansion. This check also applies to native and persisted synthetic UUIDs.
Failures report byte counts and the service limit without including the ID value.

`legacy` is the direct-template encoding: substitute the string form of each
preserved source-key value into its corresponding `{column}` placeholder in
`idTemplate`. For example, `customer-{CustomerID}` with source key `101` produces
`customer-101`. Substitution must be unambiguous and produce a valid ID without
character replacement. This is also the default when no explicit mapping is present.

`typed-hex-v1` encodes source table, entity name, and ordered template components as
`v1-<table>-<entity>-<component>...`. A string is `s` plus lowercase UTF-8 hex; a
number is `n` plus UTF-8 hex of its JSON-compatible decimal representation; a boolean
is `b1` or `b0`. Literal separators cannot occur in encoded components. Preserve
Unicode and case. Unsafe integers must be represented as exact strings. Direct UUID
identities use exactly `{Column}` as their template, retain their source representation
including case, and must not opt into the encoded strategy. An entity-prefixed UUID
template such as `customer-{CustomerID}` is a derived identity and may use either
encoding. Use it when UUIDs are shared across standalone types in the same container
and complete partition-key tuple; the `docType` discriminator does not prevent ID
collisions. With `legacy` encoding, the prefix is added without changing the UUID
value or case. Preserve the UUID separately as a natural-key attribute in either
encoding and record the decision before generation. Do not change deployed identities
without an approved data and application migration.

Composite keys containing UUID components are derived
identities, not native UUID IDs, regardless of which component supplies the `id`
attribute's source mapping. They may use `typed-hex-v1`; select it explicitly when
UUID hyphens make direct-template substitution ambiguous. Each UUID component must
be a UUID string, but the resulting composite ID is not itself a UUID. Include every
source primary-key component in the template and retain its separate natural-key
attribute; encoding does not relax source-coverage requirements.
Over-limit output blocks; it is never truncated or silently replaced by a hash.

Generated UUID fallback does not use a schema-conversion identity mapping. The
`idTemplate: "{uuid}"` model declaration records that no stable source identity is
available; record the reason and future data-migration requirement in the conversion
summary. Provisioning generates a valid UUID once per synthetic document and persists
it directly as `sample-data.json#sampleData[].items[].id`. Validation reads that value
without regenerating it, so ordinary provisioning retries reuse the same item key.
Only explicit sample-data regeneration may replace those synthetic UUIDs.

This synthetic-data behavior is not a production row-identity strategy. A future
data-migration phase must define durable deterministic identity or external assignment
state before importing keyless source rows. Do not put row-level source values or UUID
assignments in the schema-conversion manifest.

Resolve IDs using the same helper used by sample validation:

```bash
node <skill-root>/scripts/identity-mapping.mjs \
  <model.json> <container> <docType> <item.json>
```

It prints the ID without editing the item or manifest. Provisioning artifact and
verification CLIs load identity evidence from the root manifest automatically.
Migrated applications using an explicit source-derived mapping must use the same
mapping and pass the bundled golden vectors. Duplicate `(container, full
partition-key tuple, id)` values are conflicts, not permission to overwrite a
different source row. Changing an encoding requires explicit regeneration/migration
intent and any applicable data-mutation authorization.

## Artifact Budget

Each phase owns one human-readable Markdown artifact and one machine-readable
JSON manifest. Each assessed domain uses `<DomainName>.md` and `<DomainName>.manifest.json`; each converted domain uses
`<DomainName>/{summary.md,cosmos-model.json}`. Do not create
additional inventories, registries, capacity reports, verification reports, or
per-decision analyses as durable outputs.

The approved exceptions are the canonical root `model.json`, the deployable Bicep
and parameter files, sample data, and seed script. These are machine-consumed outputs,
not additional analysis reports. Provisioning observations go under `verification`
in the provisioning manifest; required summary sections are `Summary`,
`Target Verification`, and `Warnings`. Include the endpoint used for reads and returned
sample documents under the [readback evidence contract](../phases/provisioning.md#readback-evidence).
Existing selected DDL and curated preflight
input templates remain inputs, not additional phase reports. Record SDK classification
in `discovery-manifest.json` as `sdkCompatibility` rather than a separate SDK report.

If another durable artifact is genuinely needed, explain its purpose, why it cannot
live in an existing result, ownership and retention, and obtain approval first.
Do not silently delete or overwrite user-managed artifacts. Keep required evidence
in the defined summaries and manifests without depending on additional sidecars. The local
dependency environment is disposable tooling and is not a migration result.
