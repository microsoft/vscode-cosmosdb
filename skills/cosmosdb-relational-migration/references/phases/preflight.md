# Migration Preflight (`preflight`)

`preflight` prepares four inputs before source discovery: application details, schema DDL,
volumetrics, and access patterns. It reuses the existing
discovery fields and folders; it does not add a `preflight` directory.

Run the steps in numbered order: application details, schema acquisition, volumetrics,
then access patterns. Discovery can invoke this preparation itself; completed preflight
is not a prerequisite for launching Discovery. Review existing inputs at each step,
preserve valid supplied values, and fill or repair missing or invalid generated evidence.

When `preflight-step` is supplied, execute only the named input step and preserve the
other input artifacts unchanged. Always reconcile `preflight-summary.md` and `preflight-manifest.json`
against the current contract: remove superseded warnings, decisions, and readiness
claims that are no longer true. Then run the final consistency checks that can be
evaluated from current artifacts and report whether the complete readiness gate
passes. Do not mark `preflight` complete unless every gate already passes.

SDK compatibility is not a preflight step or readiness condition. It belongs to
`discovery`. Never evaluate it during preflight, report it as missing or unevaluated,
or use it to keep `preflightStatus` in progress. A preflight summary from an older
contract may contain such claims; remove them whenever the summary is updated.

## Enumerate Inputs First

Before preparing or regenerating any input, resolve and enumerate all three sources:

```bash
node <skill-root>/scripts/inspect-migration-state.mjs --workspace <workspace> --inputs schema-ddl
node <skill-root>/scripts/inspect-migration-state.mjs --workspace <workspace> --inputs volumetrics
node <skill-root>/scripts/inspect-migration-state.mjs --workspace <workspace> --inputs access-patterns
```

Follow `nextOffset` with `--offset` until every page has been read. The returned paths,
byte counts, and hashes describe selected raw inputs; generated templates are excluded.
An absent source property means the default folder, not an empty selection. A missing
template means it must be prepared, not that the raw evidence is absent. Resolve
missing, unreadable, or unsafe selected paths before proceeding; never silently skip them.
Follow the [source selection contract](../contracts/project-state-and-artifacts.md#discovery-source-resolution):
omitted `files` keeps discovery dynamic within the default folder; present `files` is
an exact list. Do not persist an implicit folder's enumeration as `files`. Both `files`
and `excludedFiles` paths are relative to `.cosmosdb-migration`, while inspection results
and manifest evidence paths are relative to the application workspace. Preserve current
exclusions and user selections; do not broaden an explicit empty list. Exclusion and
inclusion change metadata only, never the source files.

Review each selected workload file and record its disposition in the existing preflight
manifest's `workloadInputs`, following [validation evidence](../contracts/validation-evidence.md#raw-workload-inputs).
Use query logs from either source group for both volumetrics and access-pattern evidence
where relevant. Do not claim no workload evidence exists without completing this inventory.

For large logs, first inspect the format and fields, then use an appropriate structured
reader to stream or aggregate the selected data without dumping the full file into Chat.
Record the inspected range, filtering, coverage, and limitations in the summary. Sampling
or truncated tool output is not a complete workload review. Determine whether evidence is
observed, synthetic, or of unknown provenance; unknown provenance is not proof of production
measurements. Reconcile logged operations with code, including queries absent from the current
application. Do not interpret returned row counts as table cardinality or derive TPS without
a defensible observation window and event-counting semantics. Unreadable or unsupported
inputs require a blocker or an explicitly approved exclusion, not fabricated unknowns.

## Expected Output Artifacts

Required:

- The resolved schema selection contains at least one processable DDL file.
- `phases/1-discovery/volumetrics/volumetrics.md`.
- `phases/1-discovery/access-patterns/access-patterns.md`.
- `phases/1-discovery/preflight-summary.md`, explaining discrepancies, warnings,
   confirmed decisions, and unresolved assumptions.
- `phases/1-discovery/preflight-manifest.json`, containing authoritative
   `sourceInventory`, source hashes, blocking issues, and any comparable-value evidence.
- `project.json` with complete application details and
   `phases.discovery.preflightStatus: "complete"`.

Apply and preserve `phases.discovery.discoveryInstructions` when the `preflight`
request includes additional discovery or preflight guidance.

Conditional: inferred DDL under `phases/1-discovery/schema-ddl/` is expected only
when no DDL was supplied.

## 1. Application Details

Populate `phases.discovery.applicationAnalysis` from manifests, source code,
configuration, connection setup, ORM usage, and available schema evidence.

Required fields:

- `projectName`
- `projectType`
- `language`
- `databaseType`
- `databaseAccess`

`frameworks` is optional for every language. Record actual data-access or web frameworks
when present, such as Entity Framework Core, Spring Boot, Django, or Flask. When none
applies, omit the property or use an empty array. Do not invent a framework, repeat the
language/runtime as a substitute, or insert `N/A` to satisfy readiness.

Treat non-empty project details supplied with the invocation or already entered by an
engineer as authoritative. In autonomous mode, preserve those values and record conflicting
discovery evidence as warnings without replacing them. In interactive mode, flag each material
discrepancy, propose a resolution with evidence and impact, and ask the engineer whether to keep
the supplied value or adopt the discovered value before completing preflight. Use a deterministic comma-separated
representation for multiple project names, types, languages, or database-access
mechanisms; sort equivalent-priority values and place the dominant mechanism first
when evidence establishes one. Do not use `N/A` for unknown database information.

Set `completedAt` only after all required fields are non-empty and structurally
valid. This classification step does not require Cosmos DB design guidance.

## 2. Schema Acquisition

Follow [DDL interpretation](../workflow/ddl-interpretation.md) to choose SQLGlot or
model-only interpretation and persist permission before using any external parser.
Interpret the complete resolved selection using that choice. In model-only mode,
read and reconcile the DDL yourself; do not write or invoke a parsing script. Record
the inventory in `preflight-manifest.json#sourceInventory` and explain findings in
`preflight-summary.md`. Block only ambiguity that prevents a faithful source inventory,
such as unresolved table, column, or key identities after the allowed interpretation
fallback. Unfamiliar syntax alone is not a failure.

Model-only interpretation must preserve semantics, not just names and counts.
For each index, record its table, ordered key columns, uniqueness, and any
explicit sort directions, included columns, or filter, with source locations.
Never infer uniqueness from naming conventions. On the second completeness
pass, check these details against each declaration and ensure the summary agrees
with the inventory. Record unknown source facts and their locations explicitly.
Missing collation metadata or unresolved target handling of constraints and large
values are downstream design concerns, not preflight blockers, when the source
declarations can be inventoried faithfully. Do not put target-design uncertainty
in `sourceInventory.errors` or classify it as a correctness failure.

Resolve selected schema files using [project-state-and-artifacts.md](../contracts/project-state-and-artifacts.md), then
choose exactly one branch before inspecting source-code schema evidence.

### Supplied DDL Branch

Use this branch when the resolved selection contains one or more DDL files at the
start of `preflight`.

- Treat every selected DDL file as immutable source truth.
- Parse and inventory all structural statements.
- Compare ORM mappings, migration files, entities, repositories, and raw SQL only
  to detect discrepancies.
- Report code-only entities, missing or differently typed fields, nullability,
  key, relationship, index, default, trigger, or sequence differences.
- Do not add, repair, extend, regenerate, or replace supplied definitions.
- Continue using the DDL interpretation in later phases, even when code differs.
- If SQLGlot does not support the dialect, warn and use the model-only procedure.
   If an unattended-default SQLGlot installation is unavailable, warn and use the
   same fallback; abort instead when explicitly selected SQLGlot cannot be installed.
- Block readiness for concrete malformed input or unresolved source identities that
   prevent a faithful inventory after the allowed fallback. Unresolved target behavior
   does not make a valid source declaration unprocessable.
   Ask the engineer to correct, replace, or deselect malformed input; never fall back
   to source-code inference while any supplied DDL remains selected.
- Report the assurance level from [validation-evidence.md](../contracts/validation-evidence.md).
   Portable completion checks validate recorded evidence and source hashes; they do not
   independently parse SQL or prove source-engine validity.

### Inferred DDL Branch

Use this branch only when the resolved selected DDL set is empty.

1. Inspect manifests and configuration to identify language, source database,
   ORM, migration framework, and likely dialect.
2. Inspect entity/model definitions, ORM mappings, migration files, repository
   queries, raw SQL, stored procedure calls, serializers, and validation metadata.
3. Reconstruct supported tables, columns and source types, nullability, primary
   and foreign keys, unique/check/default constraints, indexes, computed fields,
   sequences, triggers, and join tables.
4. Preserve source schema or namespace qualification.
5. Write one consolidated file per inferred business domain to the default
   `schema-ddl/` folder. Use stable PascalCase domain filenames and sort files and
   statements where order has no source semantics.
6. Use the detected source dialect when confident; otherwise use ANSI SQL and
   record the dialect assumption.
7. Add source-file and line provenance above every inferred table or construct.
8. Add `TODO: verify` comments for localized uncertainty. Do not invent missing
   fields merely to make the schema appear complete.
9. Re-read generated output using the selected SQLGlot or model-only procedure
   and compare its inventory with the discovered code evidence.

If DDL appears while inference is running, stop before writing and restart in the
supplied-DDL branch. Existing inferred DDL from an earlier checkpoint is treated
as supplied truth until the engineer explicitly removes it.

## 3. Volumetrics

The managed checkpoint is the default `volumetrics/volumetrics.md`. Create it from
[volumetrics-template.md](../../assets/volumetrics-template.md) when absent.

When already populated, review before editing:

- Verify schema and table names against authoritative DDL.
- Check duplicate IDs and rows, numeric formats, units, non-negative values,
  percentages, and peak/average relationships.
- Compare row counts, read/write TPS, growth, and retention across supplied logs,
  reports, monitoring exports, configuration, and workload notes.
- Preserve valid engineer-entered values. Report material contradictions.

When empty or partial, fill missing values from selected volumetric artifacts.
This includes raw files already copied into the default folder, whether or not that
source has an explicit entry in `project.json`. Review the enumerated files first.
Inference from schema or code is allowed only when direct evidence is unavailable,
and every inferred value must be marked `(estimated)`. Never present inference as
observed production data.

Capture item-size percentiles, key cardinality/skew, peak windows, batch loads,
retention, regional intent, and consistency requirements in Workload Notes when
the table cannot express them.

## 4. Access Patterns

The managed checkpoint is the default `access-patterns/access-patterns.md`. Create
it from [access-patterns-template.md](../../assets/access-patterns-template.md) when
absent.

When already populated, review before editing:

- Verify unique deterministic read/write IDs and table names against DDL.
- Check operation classification, filter fields, single/batch semantics,
  frequency, latency, and source links.
- Preserve valid engineer-entered patterns and report material conflicts with
  code, queries, or volumetrics.

When empty or partial, inspect access-pattern documents, query logs, stored
procedures, ORM/repository code, API handlers, and schema relationships. Fill
missing patterns and fields. Mark code-evidenced, observed, query-only, and
schema-inferred patterns distinctly. Mark estimated frequency values.

Every non-excluded DDL entity must be covered by at least one pattern or explicitly
documented as having no observed application access.

## Final Consistency Gate

Application details and schema acquisition complete before template validation so all
artifacts use authoritative entity and language names. Then verify:

- Every volumetric and access-pattern table resolves to DDL.
- Every DDL entity has volumetric coverage or an explicit unknown entry.
- Every DDL entity has an access pattern or an explicit no-observed-access note.
- TPS, batch behavior, transaction boundaries, and retention do not materially
  contradict one another.
- Application database type and access mechanism agree with the selected DDL and
  code evidence, or the discrepancy is surfaced for review.
- Every selected raw workload file has a current hash, provenance classification,
   and explained used/excluded disposition in `workloadInputs`.

Missing structure, unprocessable DDL, unresolved table identities, duplicate
pattern IDs, impossible values, or contradictory comparable source evidence block
`preflight`. Preserve unknown facts and target-design questions as warnings and
provenance notes without requiring their resolution for readiness. Source discovery analysis starts
only after all four evaluation gates complete; launching Discovery can initiate this preparation.

Write `preflight-summary.md` and `preflight-manifest.json`, then record freshness in `project.json#freshness.preflight`
using [freshness.md](../contracts/freshness.md). Set `preflightStatus` to `complete`,
and set `preflightCompletedAt` only after all required artifacts exist and checks pass. If
any required artifact later disappears, `preflight` is incomplete regardless of the
stored flag and must be repeated or repaired before source discovery analysis.

After any focused step, evaluate all four gates from the current artifacts. If they
pass, record freshness and finalize `preflightStatus` even though the invocation
updated only one input step. Do not leave preflight in progress because a
discovery-owned evaluation has not run.

The completion checker validates the manifest's source inventory and hashes, curated
template structure, application details, and required preflight summary sections.
It does not independently parse SQL. The agent is responsible for interpreting and
cross-checking DDL, and must not present model-only review as deterministic parsing.
