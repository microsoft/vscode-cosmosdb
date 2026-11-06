# Source-Agnostic Migration Skill Plan

Status: implemented. See the pull request's CI checks for current validation status.

Agreed implementation boundaries:

- Work on a separate branch based on the DDL-inference work, not in PR #3528.
- Keep version-1 projects resumable through a validated normalization boundary. Preserve
  source artifacts, selections, provenance, unknown properties, and historical execution records.
- Keep `.cosmosdb-migration`, existing phase paths, and the `schema-ddl` storage folder.
  Neutral terminology does not authorize moving or deleting existing inputs.

The implemented inventory and lineage contract is documented in
[Source Inventory](../skills/cosmosdb-migration/references/contracts/source-inventory.md).
The inventory uses version 2; project checkpoints and target models retain version 1.
Legacy inventories are validated before normalization and are not rewritten as newly reviewed evidence.

Verification scope: portable contract/mapping tests and extension routing/UI tests use local fixtures.
They do not establish live source extraction, source-engine operation parity, or Azure runtime behavior.
Initial repository test runs encountered changing timing failures; focused rechecks were approved during review.

Initial implementation validation results (2026-11-05):

- Localization generation, formatting, complete lint, and all configured TypeScript builds passed.
- Portable skill tests: 497 passed, 2 skipped.
- Changed extension migration tests: 286 passed across 6 files.
- Migration E2E: 32 passed in real VS Code with a mocked agent and emulator startup disabled;
  no retries were needed in the final run.
- Full repository unit runs did not pass cleanly. The last run passed 6,088 tests, skipped 4,
  and failed one deployment-page timing assertion; that entire test file subsequently passed
  all 51 tests in isolation. This is not a clean full-suite result.
- E2E exposed and verified a fix for changed non-code source evidence incorrectly retaining
  code-migration readiness. Application code edits and historical execution records remain supported.
- E2E build freshness now includes packaged Skill files, preventing checks against stale helpers.

Predecessor: [DDL inference PR #3528](https://github.com/microsoft/vscode-cosmosdb/pull/3528).
Keep this plan and its eventual implementation out of that PR. The DDL change makes supplied
DDL optional; this proposal removes DDL as the mandatory intermediate representation.

## Direction

Provide one source-agnostic migration Skill, provisionally named `cosmosdb-migration`.
It owns discovery, assessment, target modeling, provisioning, code migration, checkpoints,
approvals, and completion. Source-specific guidance supplements this workflow when relevant;
it is not a required adapter, a separate orchestration Skill, or a supported-engine whitelist.

The destination remains Azure Cosmos DB for NoSQL. Source technology and destination API are
independent choices; a document-oriented or wide-column source does not select a compatible destination API.
Supporting additional destination APIs is outside this proposal.

The central flow becomes:

```text
Source evidence -> typed source inventory -> target model and explicit mappings
```

DDL, CQL definitions, metadata exports, ORM mappings, code, documentation, and samples are
possible evidence formats. None is a universal intermediate format. Even a relational source
can produce an explicit relational inventory directly from metadata or code without first
generating SQL. Optional generated DDL remains a review/export artifact, not a completion gate.

## Constraints

- Accept open-ended source technology names. Do not require a bundled guide or source adapter
  before discovery or conversion can proceed.
- Preserve native semantics instead of translating every source into tables and foreign keys.
- Keep explicit relational schema mapping and its current correctness checks.
- Distinguish declared facts, observed samples, code evidence, and inferred assumptions.
- Missing specialized guidance is not a blocker. Missing essential evidence, demonstrated
  data loss, or unsupported required behavior can be blockers under the existing issue policy.
- Keep the Skill host-neutral, its entry instructions short, and detailed guidance in linked,
  lazily loaded references. The extension passes intent and scope, not a duplicate procedure.
- Reuse existing manifests, summaries, selection/exclusion rules, and checkpoint ownership.
  Do not add a generic plugin framework, arbitrary executable hooks, or another state ledger.
- Preserve source artifacts and user edits. Scope, permissions, and resource/data mutation
  approvals remain independent of inferred migration intent.

## Source Inventory Contract

Continue storing the inventory in the existing preflight manifest. Define a small common
envelope before changing consumers; the following are responsibilities, not a finalized schema.

| Area          | Required meaning                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Source        | Engine name, known version, namespace context, and evidenced capabilities; no closed engine enum            |
| Datasets      | Stable inventory identifiers and native names for collections, tables, streams, or other source units       |
| Structure     | Declared or observed shapes, field paths, native types, variants, optionality, and unknowns                 |
| Identity      | Source record identity, component ordering, uniqueness scope, and partition/routing semantics               |
| Relationships | Declared constraints, document containment, application references, or inferred associations, with evidence |
| Behavior      | Required atomicity, concurrency, ordering, expiration, deletion, and other source guarantees                |
| Evidence      | Selected and consulted inputs, acquisition provenance, coverage limits, conflicts, and assumptions          |

Use a bounded common structure plus typed semantic details where known. Keep unfamiliar
native semantics as explicit evidence and migration obligations; structural acceptance must
not imply those semantics were understood or preserved. Avoid either a catch-all unvalidated
object or a universal schema language that attempts to encode every database feature.

Dataset and field references must be unambiguous. Define field-path escaping and array traversal
before implementation; dotted strings alone cannot distinguish nested paths from literal names.
Native names, quoting, case rules, and composite-key order must survive normalization.

Relational details retain schemas, tables, columns, PK/FK/unique/check/default constraints,
indexes, and behavioral constructs. Document shapes retain missing versus null, nested arrays,
heterogeneous variants, and native value types. Other structures can add relevant semantics
without being forced into either category. A source may exhibit more than one structure.

Coverage is evidence-relative: a complete declared schema and a sampled collection are different
claims. Record sampling scope and method; do not infer absent fields, uniqueness, or constraints
from samples. Every selected artifact needs an explained disposition, including conflicting or
unusable evidence. A valid inventory cannot certify a complete deployed database from code alone.

## Mapping And Validation

Keep the Cosmos DB target constraints independent of the source engine. Generalize lineage from
`sourceTable`, `source.column`, and mandatory `sourceFK` to inventory dataset, field, and
relationship references. Relational mappings still resolve exact tables, columns, and declared
constraints through those references; do not replace them with free-form explanations.

Record transformations and their semantic consequences in the existing conversion evidence.
Support explicit multi-input identity derivation, nested-field mapping, generated values, and
document reshaping without fake source columns or fake foreign keys. Preserve the existing
authoritative/embedded/projection/consolidated ownership distinctions.

Validation has three responsibilities:

1. Common evidence checks: source references, selected-input coverage, provenance, ownership,
   field/shape disposition, current hashes, and coherent root/domain mappings.
2. Applicable source-semantic checks: exact relational PK/FK preservation remains mandatory
   for relational evidence; document and other semantics receive appropriate checks.
3. Target checks: valid IDs, partition routing, item shape, indexing, supported operations,
   and explicit handling of required source behavior on Cosmos DB for NoSQL.

Apply checks from evidenced structure and semantics, not an engine-name whitelist or an
agent-controlled flag that can disable relational checks. Explicit unknowns are not empty
constraints. Existing relational artifacts must not pass by dropping their relational details.

Separate syntax/structure assurance from semantic fidelity. Matching hashes or parsing generated
SQL cannot prove that source behavior was preserved. Maintain executable mapping examples for
identity, type conversion, and required behavior alongside structural validator coverage.

## Technology Guidance

Keep optional source guidance inside the generic Skill initially. Discover and load relevant
references by technology or semantic topic; do not make a guide's presence a readiness condition.
Keep `cosmosdb-best-practices` as the target-guidance peer.

Add focused [MongoDB source guidance](../skills/cosmosdb-migration/references/sources/mongodb.md)
covering collection/document variants, validators, BSON types,
`_id`, nested arrays, missing/null distinctions, indexes and sharding, update operators,
transaction boundaries, and expiration behavior. Preserve exact values when planning conversion
to JSON; do not assume source database operations or TTL behavior map directly to the target.

Cassandra is a useful non-document example: partition and clustering keys, clustering order,
static columns, collection types, per-cell expiration/write timestamps, counters, lightweight
transactions, and consistency guarantees need explicit treatment. Cassandra-specific acquisition
tooling is not a prerequisite for the generic contract.

For unfamiliar technologies, inspect available evidence, consult authoritative documentation
when permitted, and record unresolved semantics. Continue within what the evidence supports;
ask actionable questions when necessary. Do not advertise validated support for every engine.
Extract guidance into a peer only if it becomes independently reusable and has a stable contract.

## Implementation Surfaces

| Surface                                                                                                                                                              | Planned change                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Skill entry](../skills/cosmosdb-migration/SKILL.md) and phase references                                                                                            | Generic discovery and modeling language; conditional DDL interpretation; optional source guidance               |
| [Source evidence validation](../skills/cosmosdb-migration/scripts/validate-source-evidence.mjs)                                                                      | Common inventory/reference checks with preserved relational semantic validation                                 |
| [Completion gates](../skills/cosmosdb-migration/scripts/check-phase-completion.mjs)                                                                                  | Require sufficient source inventory rather than selected DDL; include accepted-model code-migration handoff     |
| [Freshness](../skills/cosmosdb-migration/scripts/freshness.mjs) and [input inspection](../skills/cosmosdb-migration/scripts/inspect-migration-state.mjs)             | Source-neutral input selection and mandatory evidence hashes, without SQLGlot requirements for unrelated inputs |
| [Target schema](../skills/cosmosdb-migration/schemas/cosmos-model.schema.json) and [model validator](../skills/cosmosdb-migration/scripts/validate-cosmos-model.mjs) | Generalized lineage, explicit native identities, canonicalization, and unchanged target constraints             |
| [Conversion evidence](../skills/cosmosdb-migration/scripts/validate-conversion-evidence.mjs)                                                                         | Generic dataset/field coverage, ownership, transformations, and conditional source-semantic checks              |
| [Assessment](../skills/cosmosdb-migration/references/phases/assessment.md), templates, sample generation, and code migration                                         | Replace universal table/FK assumptions while preserving workload and behavior coverage                          |
| [Project service](../src/services/MigrationProjectService.ts) and [dispatcher](../src/panels/migration/helpers/migrationSkillDispatcher.ts)                          | Generic skill name, source inputs, persisted selections, and short source-neutral invocation intent             |
| [Migration UI](../src/webviews/cosmosdb/Migration/MigrationAssistant.tsx) and [host panel](../src/panels/MigrationAssistantTab.ts)                                   | Source-neutral text and input handling; retain compact AI controls and accessibility conventions                |

Also update dependent types, identity helpers, source dispositions, domain/reference registries,
fixtures, packaging/copy rules, and Skill discovery declarations. A name-only rename is insufficient:
remove hidden SQL/table assumptions from all consumers before exposing the generic workflow.

## Delivery Sequence

1. **Agree on the contract.** Define the common inventory, native semantic details, lineage
   references, coverage/assurance meanings, and compatibility boundary. Use relational,
   document-oriented, and unfamiliar non-relational fixtures to challenge the design before expanding it.
2. **Generalize the core with relational parity.** Migrate inventory readers, source references,
   validators, domain ownership, canonical hashes, freshness, and downstream consumers together.
   Preserve current relational failure cases and stop requiring synthetic DDL. Keep a working
   end-to-end relational path throughout this change.
3. **Prove non-relational behavior.** Exercise document and other native structures through
   preflight, discovery, assessment, modeling, provisioning artifacts, and code-migration planning.
   Add source-specific guidance without making the generic path depend on it. Use a technology without
   a bundled guide to prove there is no hidden supported-source registry.
4. **Expose the generic Skill.** Rename the public Skill and update host dispatch, discovery,
   packaging, documentation, and UI once the core works. Do not rename phase directories or
   add controls solely for terminology. Retain the existing Cosmos DB target guidance peer.

These are implementation checkpoints, not additional user-facing phases. Split reviewable
changes only where intermediate contracts remain coherent; do not duplicate orchestration.

## Compatibility Decisions

- Keep `.cosmosdb-migration` and existing phase report/manifest ownership. Choose neutral input
  terminology without moving or deleting existing source files merely to rename a folder.
- Decide explicitly whether persisted version-1 projects must remain resumable. If so, use
  one validated normalization/upgrade boundary that preserves selections, source authority,
  provenance, and unknown fields. Do not carry two permanent pipelines or silently reinterpret
  existing relational mappings. If compatibility is unnecessary for the unpublished feature,
  prefer one coherent contract and clearly require regeneration of affected checkpoints.
- Invalidate affected freshness after real contract changes; never rehash old outputs to claim
  that conversion or semantic review occurred. Preserve historical code-migration execution records.
- Do not change target account selection, capacity decisions, or resource mutation consent as
  part of source generalization.

## Acceptance Criteria

- Relational fixtures retain exact names, composite-key order, field coverage, FK resolution,
  ownership, and source-to-target mapping checks. Invalid mappings still fail.
- A relational inventory inferred from code can complete without generating a DDL file.
- Document-oriented database evidence can complete the applicable workflow without DDL, SQLGlot, fabricated tables,
  or fabricated foreign keys. Tests cover mixed shapes, BSON conversion, missing/null, arrays,
  identity, and a required behavior that cannot be mapped without an explicit decision.
- A non-relational technology without bundled guidance can proceed from sufficient evidence;
  missing guidance alone never produces an unsupported-source error.
- Sampled coverage is never reported as a complete authoritative schema. Unknown native
  behavior is visible, and proven data-loss or correctness failures still block completion.
- Changed or removed source evidence invalidates affected analytical checkpoints. Exclusions,
  workspace boundaries, symlink checks, user edits, and input authority remain protected.
- End-to-end tests exercise shared routing and state, including code-migration readiness and
  a resumed project. Portable Skill tests run without the extension or unnecessary parser tools.
- Every recorded verification states what ran. Mocked routing, structural validation, real
  source extraction, and target behavior tests are not interchangeable assurance levels.
- Run the repository's applicable localization, formatting, lint, build, and test gates on
  the integrated implementation, with focused E2E and real-engine cases for the claimed scope.

## Deferred Scope

Historical data loading, CDC/replay, reconciliation, production cutover, rollback, and
source-database connectors need separate execution contracts. Sample-data provisioning and
application code migration do not establish production data-transfer readiness. Multi-source
federation, additional destination APIs, automatic partial-DDL supplementation, and an external
source-adapter ecosystem are also follow-ups, not requirements for this source-neutral core.
