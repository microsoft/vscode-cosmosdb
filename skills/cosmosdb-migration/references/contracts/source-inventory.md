# Common source contract, version 2

The destination is **Azure Cosmos DB for NoSQL**, independently of the source engine.
The portable validator checks evidence consistency and executes bounded mapping examples; it
does not extract from live engines, prove deployed completeness, or validate arbitrary application behavior.
No engine registry, connector, plugin, executable hook, or SQL intermediate is required.

## Storage, authority, and compatibility

Keep project `version: 1`, `.cosmosdb-migration`, `schemaInventory`, existing manifests,
and `schema-ddl/` storage. `inspect-migration-state.mjs --inputs source-evidence` enumerates
the entire source selection, including non-SQL files. Existing `schema-ddl` and `schema-evidence`
views remain available. Explicit `files: []` means no selected files; omitted `files` remains
dynamic. Exclusions, workspace boundaries, realpath checks, and managed-output exclusions still apply.

Store `sourceInventory` below in `phases/1-discovery/preflight-manifest.json`, not a new ledger.
The outer manifest remains version 1. Its `sourceSha256` uses
`sourceFilesHash(inventory.source.engine, inventory.files)`: exact selected bytes, not semantic assurance.
Every selected file needs a disposition, current hash, and acquisition provenance. Selection exclusions
are not selected files. Conflicting/unusable selected evidence also needs an unresolved obligation.
Never silently downgrade supplied declarations to inferred evidence or exclude inconvenient facts.

Existing inventory version 1 is read through the **same pipeline**: validate its original parser choice,
selection, original source hash, table identities, columns, PKs and exact ordered FK endpoints first.
Only then attach normalized dataset/field views in memory, retaining original tables, unknown properties,
parser/source provenance, case, quotes, and order. Stable legacy IDs are SHA-256 of the native ordered
identity (`dataset-…`) and of `[datasetID,columnName]` (`field-…`).
Legacy model mappings are resolved exactly, never reinterpreted as new IDs. No read modifies project
state, artifact bytes, selections, or hashes. `normalizeDomains` converts validated legacy ownership to
IDs for shared validation without rewriting persisted metadata.

`phases.discovery.applicationAnalysis.codebaseAvailable: false` explicitly records schema-only scope.
In that scope application type/language/access metadata and an SDK report are not analytical prerequisites,
and application mapping does not filter assessed datasets out of conversion. Existing code-migration execution
records remain historical, but new code-migration planning/execution requires an available codebase and renewed
application discovery. Omitting the flag preserves legacy application-migration behavior.

New semantic analysis writes version 2. That is a real contract change: repeat applicable source,
discovery, assessment, and conversion review, then record freshness. Do not copy hashes onto historical
reports to imply review. Version-2 preflight freshness includes a source-contract version input; output
hashes and inherited phase dependencies invalidate changed inventory/selection/evidence. Code-migration
execution history remains historical. Its accepted-model handoff still validates artifacts and SDK
compatibility without requiring old application files to remain unchanged. This exception applies only
to selected v2 files already accepted as `kind:"code"` and to application files outside the selected
source-evidence set. Selected metadata, samples, DDL, and documentation must still exist with their
accepted bytes; additions/removals from a dynamic evidence selection also require review. The accepted
inventory hash binds the original kinds, so relabeling evidence as code cannot bypass this check.
V1 selected DDL and untyped supplementary evidence remain live-checked; do not infer a code exemption
from an extension or from an inferred DDL's supporting `sourcePaths`. Unselected supporting application
code may still change or disappear. Recorded analytical output
hashes and non-source analytical dependencies must still match; a changed conversion mapping/decision
cannot silently become the accepted handoff merely because the canonical model still parses.

## Exact inventory shape

All arrays below are required, even when empty, unless marked optional. IDs and native names are
non-empty strings, unique within their documented scope. Dataset IDs remain stable across native dataset renames
and reordering. New field IDs are derived from source paths; source-path changes require renewed dependent mappings.
Engine/version are evidence, not feature switches. `errors` is an empty array at readiness.
The example uses a fictional document-oriented database engine.

```json
{
  "version": 2,
  "source": {
    "engine": "ExampleDocumentStore",
    "version": null,
    "namespaces": ["sales"],
    "capabilities": []
  },
  "files": [{
    "path": "evidence/orders.json",
    "sha256": "<exact-byte-sha256>",
    "kind": "sample",
    "disposition": "used",
    "rationale": "Bounded collection sample, not a complete schema.",
    "provenance": { "method": "user-supplied export", "scope": "orders, first 100 documents" }
  }],
  "datasets": [{
    "id": "orders",
    "name": "sales.orders",
    "kind": "document",
    "evidence": ["evidence/orders.json"],
    "coverage": {
      "basis": "observed",
      "scope": "orders collection, selected export only",
      "complete": false,
      "sampling": { "method": "first 100", "size": 100, "limitations": "No guarantee of rare variants or uniqueness." }
    },
    "fields": [{
      "id": "$._id",
      "path": [{ "kind": "property", "name": "_id" }],
      "nativeTypes": ["ObjectId"],
      "presence": "required",
      "nullable": false,
      "evidence": ["evidence/orders.json"]
    }],
    "identities": [{
      "id": "native-id",
      "kind": "native",
      "fields": ["$._id"],
      "scope": "collection",
      "evidence": ["evidence/orders.json"]
    }]
  }],
  "relationships": [],
  "semantics": [],
  "errors": []
}
```

- `source.capabilities[]`: `{name,evidence}`; `source.version` is a string or `null`.
- `files[].kind`: `ddl | metadata | code | sample | documentation`. A selected `.sql`/`.ddl`
  cannot be relabeled. `disposition`: `used | conflicting | unusable | excluded`; every disposition
  has substantive rationale. Exclusion changing scope requires user approval in the phase summary.
- `evidence` arrays contain selected, used, workspace-relative file paths. They are non-empty.
- `datasets[].kind`: `relational | document | other`. `coverage.basis`:
  `declared | observed | code | inferred`. Only declared coverage may say `complete:true`, and only
  within its stated scope. Non-observed coverage records `sampling:null`. Sample size is non-negative;
  observation scope, method, and limitations are mandatory. Never infer absence, uniqueness, or
  database constraints from sampled/code coverage.
- `fields[].id` is unique within its dataset. Paths are ordered arrays of 1–128 segments.
  `{kind:"property",name:"a.b"}` means a literal property; `[{kind:"property",name:"a"},
  {kind:"property",name:"b"}]` means nesting. `{kind:"array"}` traverses every element, preserves order
  and array dimensions, and is distinct from a property named `"[]"`. Repeated traversal supports nested arrays.
  Field paths are unique. Native types are non-empty string arrays (include `"unknown"` explicitly);
  multiple entries describe heterogeneous variants, never an inferred universal type.
  `presence`: `required | optional | unknown`; `nullable`: `true | false | null` (unknown).
- `identities[]`: `{id,kind,fields,scope,evidence}`, where kind is `primary | unique | native | routing`.
  Ordered non-empty field IDs cannot repeat. Scope must explain native uniqueness/routing, not claim
  sample-derived uniqueness. No identity is permitted when genuinely unknown; explain the obligation.
- `relationships[]`: `{id,kind,from:{dataset,fields},to:{dataset,fields},evidence}`.
  Kind is `foreign-key | containment | reference | association`. Non-containment endpoints need
  equal-length, non-empty ordered field IDs. Containment can use empty field arrays, but then only
  embedding is supported by sample validation. `constraintName` optionally identifies the exact native FK.
  Application references/associations are not foreign keys.
- `semantics[]`: `{id,kind,datasets,description,required,status,evidence}`. Kind is
  `atomicity | concurrency | ordering | expiration | deletion | uniqueness | native`;
  status is `known | unresolved`; required is boolean. IDs are inventory-wide.
  Unknown native behavior stays an explicit obligation, not an empty constraints list.

### Readable field identifiers

For new version-2 inventory fields, use `sourceFieldId(path)` from
[`source-contract.mjs`](../../scripts/source-contract.mjs). Construct the typed path once, then use its generated
identifier throughout inventory identities/relationships, target lineage, conversion inputs, and subtree conversions.
The dataset remains a separate reference; do not repeat it in each field ID.

| Typed source location | Canonical field ID |
| --- | --- |
| Root `_id` | `$._id` |
| Nested `eventHeader` then `eventTimestamp` | `$.eventHeader.eventTimestamp` |
| Literal root property `a.b` | `$["a.b"]` |
| Nested `a` then `b` | `$.a.b` |
| Whole `barcodes` array | `$.barcodes` |
| Each element of `barcodes` | `$.barcodes[*]` |
| Each item's `sku` | `$.items[*].sku` |
| Literal `*` property under `items` | `$.items["*"]` |
| Empty property name | `$[""]` |

The generator starts with `$`, uses `.name` only for `[A-Za-z_][A-Za-z0-9_]*`, JSON-quoted brackets for all other
property names (including Unicode, dots, quotes, and backslashes), and `[*]` only for array traversal.
It preserves case and distinguishes repeated traversal, literal wildcard names, and numeric property names.
This is a bounded labeling convention, **not an executable JSONPath expression**: no evaluator, filters,
recursive descent, or inferred numeric array indexes. Typed `path` segments remain authoritative for traversal;
`source.field` is resolved by exact inventory-ID lookup.

```js
import { sourceFieldId } from '<skill-root>/scripts/source-contract.mjs';

const path = [{ kind: 'property', name: '_id' }];
const field = { id: sourceFieldId(path), path, /* native types, presence, evidence, ... */ };
// Corresponding target lineage: { dataset: 'orders', field: '$._id', type: 'string' }
```

Existing version-2 opaque identifiers and the validated version-1 normalization boundary remain accepted unchanged.
Do not silently regenerate IDs while reading or resuming a project. If an engineer requests relabeling, regenerate
the inventory and every dependent reference together, then renew affected analytical evidence/freshness normally.
A target-property rename does not change the source field ID. Renaming a source property does change its canonical
path-derived ID; do not claim that a path label or path hash tracks native source renames automatically.

### Exact relational details

Every relational dataset additionally requires `relational` with exact legacy
`name`, ordered `identity:[{name,quoted}]`, `columns:[{name,type,...nativeDetails}]`,
ordered `primaryKey`, and `foreignKeys:[{name?,columns,referencedTable,referencedColumns,...nativeDetails}]`.
Inventory `dialect` controls unquoted name folding; native quoted spelling and PK/FK order are retained.
Also record `uniqueConstraints:[{name:string|null,columns}]`, `checks:[{name:string|null,expression}]`,
`defaults:[{column,expression}]`, `indexes:[{name,columns:[{name,direction}],unique,...nativeDetails}]`,
and `behaviors:[{kind,definition,semantic}]`. Directions are `ascending | descending`; semantic
references an inventory obligation. Preserve included columns, filters, actions, nullability,
collation, precision/scale, sequences, procedures, computed expressions, and triggers as native evidence.

Every native column has exactly one literal-property field with the same type.
The primary identity matches the exact ordered PK. Every native FK has exactly one
`foreign-key` relationship with exact ordered endpoints and constraint name. Dropping relational
details, native columns, or FK components is invalid. No-DDL relational code inventory uses this same
contract, with code/inferred coverage and no parser requirement. For selected SQL/DDL only, retain
the saved parser choice and `parser` evidence from the DDL interpretation contract.

## Target lineage and ownership

The target schema stays version 1; additions are defined in `schemas/cosmos-model.schema.json`.

- Entity: `sourceDataset` stable ID instead of legacy `sourceTable`.
- Attribute source: `{dataset,field,type}`, `{inputs:[{dataset,field}],type}`, or
  `{generated:"uuid"|"constant",type}`. Legacy `{table,column,type}` remains valid only through exact
  resolution. Multi-input order is meaningful; no fake column is needed.
  These IDs are catalog references, never source record values or target document properties. In summaries and
  identity decisions, show the native dataset name and human-readable field path alongside the internal references.
- Attribute `optional` and `nullable` are optional booleans. Missing and null are different.
  Identity and partition routing remain required/non-null irrespective of optional source fields.
- Standalone entity `identity` is `{kind:"fields",fields:[{dataset,field}],encoding:"typed-hex-v1"|"native-uuid"|"native-string"|"objectid-hex",sourceKey?}`
  or `{kind:"generated-uuid"}`, mutually exclusive with legacy `idTemplate`. Source identity components are preserved
  separately by default. The typed-hex encoding preserves scalar type and component order,
  rejects unsafe integers, never truncates IDs, and retains existing ID byte constraints.
  Prefer `native-string` for a single evidenced string key already compatible with Cosmos item IDs and the
  target uniqueness scope. It retains the exact value and rejects empty, forbidden, oversized, or invalid-Unicode
  values rather than sanitizing them. Shared-container collision risks still require an explicit design.
  For a single homogeneous `ObjectId`/`BSON ObjectId` source, `objectid-hex` yields canonical lowercase
  24-character hex from a canonical `$oid` wrapper or its hexadecimal representation. It does not stringify arbitrary
  BSON values. Direct encodings require one known native type; mixed or unknown types need an explicit type-preserving
  mapping. Whole-document checks compare direct IDs with the original source key, not just a transformed target copy.
  `sourceKey` is `preserve` (also the omitted default) or `rename`. `rename` is limited to direct encodings of a
  required, non-null root field on a standalone document entity. The original property is removed only after its value
  is assigned to `id`; no separate natural-key attribute or field mapping is then required. Whole-document source/output
  examples prove that step. Relational and composite identities retain their separate-key requirements.
  A source field named `id` is handled the same way; an unrelated existing `id` must be explicitly remapped, not overwritten.
- Relationship `sourceRelationship` replaces `sourceFK`, never alongside it. Native relational
  constraints still resolve exactly; target endpoints must match.
- Ownership/reference-registry entries use `sourceDataset` instead of `sourceTable`. Existing
  authoritative/embedded/projection/consolidated distinctions and deterministic root merge remain.
- Assessment/discovery/domain/pattern lists use `datasets` stable IDs instead of legacy `tables`.
  Cross-domain edges use `fromDataset`/`toDataset`. Report headings are `Source Semantics` and `Datasets`.
  Volumetrics uses Namespace/Dataset/Est. Record Count/Avg Record Size; access patterns uses Datasets.
  Legacy headers remain readable. Namespace is display context; Dataset contains the stable ID.

## Executable conversion evidence

Keep these arrays in the existing conversion manifest, with current `domainSha256`, `sourceSha256`,
selection policy, ownership, and merge evidence. They are required for version-2 inventories.

### Document preservation

Document-oriented sources preserve field names, object nesting, arrays, order, and additional properties by default.
Do not flatten every inventoried path or duplicate a subtree and all its descendants merely to satisfy coverage.
A unary `copy` mapping of an object/array accounts for its descendant field paths, including literal names and
array traversal. Relational column coverage remains exact and does not receive this subtree exemption.
Identity/routing metadata and explicit source-property collisions are narrow exceptions to name preservation.

Record one `documentMappings[]` entry per document-sourced target entity:

```json
{
  "domain": "Sales",
  "container": "orders",
  "entity": "Order",
  "mode": "preserve",
  "examples": [{ "source": { "_id": "order-1", "details": { "notes": [] } },
                 "output": { "id": "order-1", "docType": "order", "_id": "order-1", "details": { "notes": [] } } }]
}
```

Examples must be complete documents matching the actual entity mappings, not isolated field samples.
`executeDocumentMapping` in `mapping-examples.mjs` replays the field mappings, preserves unaccounted root properties,
checks metadata collisions, and resolves identity. It takes the inventory, entity, that entity's field mappings,
document decision, source object, and optional `{partitionKeys, generatedId}`. A generated UUID example supplies
its already assigned ID; the helper does not generate production assignments. Source objects are not mutated.
Copied subtrees preserve unlisted nested properties. A source `id`, `docType`, or Cosmos system-property collision
must be inventoried and explicitly remapped; never silently overwrite or drop it.
Fixed routing metadata may be supplied by a generated constant mapping (including a matching `docType` discriminator).
This can preserve collection namespaces in a composite partition key without re-encoding otherwise compatible IDs.
Examples from distinct target entities that collide on the same container, full partition tuple, and ID are rejected.
Passing finite examples is not proof of population-wide uniqueness or application enforcement.

Splitting, flattening, denormalization, or ordinary field renaming requires `mode:"reshape"` and
`justification:{benefit,rationale,evidence,tradeoffs}`. Benefit is `performance`, `reliability`, `cost`, or
`service-limit`. Explain the specific target advantage and additional migration/application complexity.
Evidence references selected used source files or the reviewed access-pattern/volumetrics templates
(workspace-relative paths, optionally with a fragment). Do not manufacture measurements. If evidence is missing,
ask focused workload questions or retain the simpler source-shaped design.
Reshaping still needs complete executable examples and full source coverage; justification is not permission
to discard data. Splits requiring unrepresented joins or multi-item execution need an explicit supported mapping
extension, not fabricated successful examples.

This document-evidence requirement is a conversion-contract change. Existing version-2 document models lacking
it need renewed conversion review; do not infer preservation or manufacture examples from old outputs.
Freshness records the document-mapping contract version. Version-1 relational evidence is unchanged.

`fieldMappings[]` has `{domain,container,entity,target,inputs,operation,examples,constant?}`.
Inputs exactly match ordered attribute source references. Cover every non-id target attribute once.
Supported bounded operations are `copy`, `tuple` (ordered present values), `constant`,
`extended-json-string` (canonical BSON wrappers, exact digits), `json-string` (lossless JSON text),
and `array-envelope` (typed traversal to JSON arrays with `{present:false}`, `{present:true,value}`,
or nested `{items:[...]}` envelopes, preserving missing versus null and dimensions).
`date-iso8601` explicitly converts a canonical Extended JSON date (UTC milliseconds string or exact
`$numberLong` epoch milliseconds) to an ISO UTC string. Out-of-range or noncanonical values fail rather than
losing precision. The existing `extended-json-string` operation retains its previous behavior for old evidence.
Prefer the explicit date operation to storing JSON text inside a string when time queries require ISO dates.
No scripts or arbitrary expressions execute. Example cases use
`{inputs:[{state:"value",value:...}],output:{state:"value",value:...}}`; missing is `{state:"missing"}`.
Typed path traversal produces `{state:"array",items:[...states]}`, preserving nested dimensions.
Traversal states are evidence, not target JSON; map whole source arrays with `copy` or use an explicit
`array-envelope` when projecting a field through arrays. Do not silently turn absent elements into null.
Optional/unknown and nullable/unknown inputs require missing and null examples respectively.
For heterogeneous native types, each example records `nativeTypes` aligned with its inputs;
cover every declared variant with a present-value example. Mixed native variants cannot use
untyped scalar extraction that would collapse BSON identity into an ordinary string.
For example:

```json
{
  "domain": "Sales", "container": "orders", "entity": "Order", "target": "sourceId",
  "inputs": [{ "dataset": "orders", "field": "$._id" }],
  "operation": "extended-json-string",
  "examples": [{
    "inputs": [{ "state": "value", "value": { "$oid": "507f1f77bcf86cd799439011" } }],
    "output": { "state": "value", "value": "507f1f77bcf86cd799439011" }
  }]
}
```

A subtree `copy` may declare `conversions:[{field,operation}]`, referencing descendant field IDs in the same
source dataset. Operations are bounded `date-iso8601` or `extended-json-string`; paths must not overlap.
`executeFieldMapping` applies them recursively through the inventory's typed array/property paths while retaining
names, array dimensions, order, missing/null distinctions, and unknown properties. Field examples show the complete
subtree before and after conversion. Apply the same native-value policy consistently instead of keeping a raw copy
and a separately converted projection of the same value.

`identityExamples[]` has `{domain,container,entity,cases:[{item,id}]}`. Cover every standalone entity.
The helper actually resolves each supplied item's identity and compares the expected ID.

`behaviorDecisions[]` has `{semantic,action,rationale,implementation,approval?,examples?}`.
Cover every selected dataset's semantic obligation. Action is `preserve | replace | waive`.
Replacement, waiver, or an unresolved native obligation requires `{by,at}` approval (ISO timestamp).
Required preservation must include a supported bounded executable check:
`{operation:"partition-batch",input:{partitionKeys:[[...],...],payloadBytes:100},expected:{supported:true}}` or
`{operation:"ttl-relative",input:{lastModifiedSeconds,ttl,sourceExpiresAtSeconds},
expected:{expiresAtSeconds,equivalent:true}}`.
These demonstrate target scope/arithmetic only, not live transactions or asynchronous deletion timing.
Other required behaviors need an explicit approved replacement/waiver design with verification obligations;
do not label unexecuted application behavior proven. Missing guidance alone is not a blocker.

Arbitrary reshaping can be represented by explicit field lineage and JSON envelopes; if the bounded
example vocabulary cannot demonstrate a required transform, retain the evidence and propose a reviewed
extension to the portable contract instead of executing a plugin or fabricating a passing example.
Production data transfer, CDC, reconciliation, cutover, and rollback remain separate execution work.
