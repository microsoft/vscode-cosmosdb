# Source Discovery (`discovery`)

`discovery` produces a complete, evidence-linked description of the source schema and
application access patterns. It can start before `preflight` is complete and performs
required preflight preparation before source discovery analysis.

## Preflight Preparation

A Discovery request includes the required preparation; do not reject it merely because
preflight is incomplete or ask the user to launch each preflight step separately.
The host must have an available selected model, consent to AI use, and a non-empty
project name. Do not require completed application analysis, selected DDL, or templates
as launch conditions.

1. Inspect current preflight completion. If it is current and complete, reuse it.
2. Otherwise follow [preflight](./preflight.md) in this order: `application-details`,
   `schema-acquisition`, `volumetrics`, `access-patterns`. Evaluate each step, preserve
   valid supplied inputs, and perform the work needed to satisfy its gate. Infer DDL
   only when the resolved selected set is empty. Preserve selected DDL even on regeneration.
3. Record preflight evidence and freshness, finalize its checkpoint, and require a
   successful `check-phase-completion.mjs --phase preflight` before source analysis.
   Missing, stale, or invalid evidence still blocks analysis and downstream completion.
4. Present the preflight checkpoint, then continue into source discovery without a
   separate continue prompt. The Discovery request already includes this preparation.
   Parser consent, material discrepancies, and other consequential decisions still
   require the normal interaction checkpoints. Stop on unresolved blockers.

A validation-only request performs no preparation writes: report incomplete prerequisites
and stop. Regenerating Discovery does not itself invalidate current preflight evidence;
prepare it when required, then regenerate the Discovery-owned outputs. Stop after the
Discovery checkpoint when the request is phase-scoped; do not continue into assessment.

## Expected Output Artifacts

Required:

- `phases/1-discovery/discovery-report.md` and `discovery-manifest.json`.
- `project.json` with `phases.discovery.status: "complete"`.

## Inputs

- Authoritative selected or inferred DDL from `preflight`.
- Validated application details.
- Reviewed `volumetrics.md` and `access-patterns.md`.
- Application source code and database configuration.
- `phases.discovery.discoveryInstructions`, when present.

Treat DDL as authoritative for source structure. Treat supplied project details and
engineer-entered template values as authoritative observations unless interactive
preflight recorded an approved replacement. Use source code to enrich behavior and
evidence, not to rewrite authoritative inputs.

## Procedure

1. After preflight passes, set `phases.discovery.status` to `in-progress` and increment the discovery
   run count.
2. Inventory every DDL schema, table, key, relationship, index, default,
   computed field, sequence, and trigger that affects migration behavior.
3. Read all reviewed access patterns and volumetrics.
4. Systematically search database-access code for each DDL entity that lacks
   confirmed evidence. Exclude `.cosmosdb-migration` and generated/build folders.
5. Trace controller or handler to service, repository, query, and affected tables.
6. Identify read and write operations, joins, filters, ordering, result size,
   pagination, transaction boundaries, batch behavior, latency, frequency, and
   code references.
7. Preserve distinctions among observed, code-evidenced, query-only,
   schema-inferred, and estimated information.
8. Resolve best-practice concepts needed to recognize evidence that later design
   phases require. Do not make the target container or partition design here.
9. Evaluate every language in the authoritative application details using
   [sdk-compatibility.md](../contracts/sdk-compatibility.md) and the bundled compatibility checker.
10. Write the report and verify that every non-excluded DDL entity is covered.

## Report Contract

Use the required headings and separate manifest contract from
[validation-evidence.md](../contracts/validation-evidence.md). Include current source hashes,
all source tables, structured patterns, verified source paths, and explicit
no-observed-access dispositions. After writing the report, record freshness in
`project.json#freshness.discovery`, including every consulted application source file.
The completion checker validates the report and checkpoint freshness separately.

Write `phases/1-discovery/discovery-report.md` and `discovery-manifest.json` with:

- Source application and database overview.
- Source schema or namespace inventory.
- DDL-versus-code discrepancies recorded during `preflight`.
- Read patterns and write patterns with stable IDs.
- Evidence type, TPS, latency, tables, filters or batch scope, source query/code,
  and relative source links for every pattern.
- Volumetric and workload evidence, including provenance and estimates.
- Relational semantics requiring later treatment: column constraints (nullability,
  length, precision/scale, checks), unique constraints, cascades, transactions,
  triggers, defaults, computed values, and sequences.
- Unresolved assumptions and `TODO: verify` items from inferred DDL.
- The deterministic `sdkCompatibility` result and actionable warnings for preview,
  runtime-interoperable, or unsupported classifications.
- Applied best-practice rule identifiers and concept coverage.

In `Relational Semantics`, link each write-pattern ID to applicable inventory
constraints and their current enforcement: database, ORM, application, or unknown.
Flag database-only protections as downstream obligations; do not choose their
replacement implementation during Discovery.

Sort schema groups and source entities deterministically. Within read and write
sections, put code-evidenced patterns before inferred patterns and sort each group
by estimated TPS descending, then stable pattern ID.

## Completion

The phase passes when the report:

- Begins with a top-level heading and is valid Markdown.
- Covers every non-excluded DDL entity exactly by its authoritative name.
- Accounts for applicable source constraints for every write pattern, or explains
   why none apply. This is an agent review, not proof of runtime enforcement.
- Contains no source links that were not verified.
- Retains uncertainty and discrepancy warnings.
- Evaluates every authoritative application language against the current SDK matrix.
- Contains sufficient evidence for domain decomposition.

Then set `phases.discovery.status` to `complete`. Do not mark completion if the
report is partial because of cancellation or exhausted context.

On resume, both the flag and report must pass. If the report is missing or invalid,
treat `discovery` as incomplete and offer to rerun it in interactive mode.
