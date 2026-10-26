# Relational to Azure Cosmos DB Migration

A portable agent skill for migrating relational applications to Azure Cosmos DB for
NoSQL. It supports source discovery, domain assessment, document-model design,
target provisioning with sample data, and application code migration.

This README is for people installing and using the skill. The agent's entry point
is [SKILL.md](./SKILL.md); its linked references define the workflow. You do not need
to repeat those procedures in your requests.

## Requirements

- An agent host with skill support and tools for reading, searching, editing files,
  and running commands. The workflow does not require VS Code or an MCP server.
- Node.js available to the host for the bundled helper scripts.
- The application workspace you want to migrate.
- The `cosmosdb-best-practices` peer skill, which supplies Cosmos DB design guidance.

SQLGlot is optional. When selected, the agent uses the latest available release and
manages a compatible Python environment through the host's tools and permissions.
Model-only DDL interpretation does not require Python. See
[DDL interpretation](./references/workflow/ddl-interpretation.md) for the available
choices and dependency requirements.

Source analysis and model design do not require access to an Azure account. Applying
provisioning changes requires access to the intended target and explicit authorization.

## Installation

1. Install the entire `cosmosdb-relational-migration` folder through your host's
   supported skill installation or discovery mechanism. Keep its scripts, schemas,
   references, assets, and tests together; copying only [SKILL.md](./SKILL.md) is not enough.
2. Install `cosmosdb-best-practices` as a separate peer skill using the same mechanism.
3. Open the application workspace in your agent host and confirm both skills are available.

The installation should contain two independent skill folders:

```text
<host skill directory>/
|-- cosmosdb-relational-migration/
|   |-- README.md
|   |-- SKILL.md
|   |-- references/
|   |-- scripts/
|   |-- schemas/
|   |-- assets/
|   `-- tests/
`-- cosmosdb-best-practices/
    |-- SKILL.md
    `-- ...
```

## Get Started

Open the application source and, at minimum, **strongly consider supplying current
database DDL**. DDL is the most important migration input: it establishes the source
schema and relationships. Inferring it from code is possible, but not recommended
because code may omit database constraints, indexes, or behavior.

Real workload measurements are the next most useful input. You do not need to fill
in templates before starting: the agent can prefill volumetrics from supplied evidence
for human review and automatically prepares access patterns during preflight. See
[Prepare Inputs](#prepare-inputs) for examples and sample prompts.

```text
Run a relational database migration to Azure Cosmos DB.
Use db/schema.sql as the source DDL. Run in interactive mode.
```

The default mode is interactive when the host can pause and receive your answers;
otherwise it is autonomous. You can explicitly choose a mode or limit the work to
a phase. The agent obtains the execution order and prerequisite handling from the
skill, not from the examples below.

### Run a Phase

```text
Run the preflight phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the discovery phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the assessment phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the schema conversion phase of a relational database migration to Azure Cosmos DB.
```

### Regenerate Existing Results

When a phase already has results and you want to replace them:

```text
Regenerate the assessment results for a relational database migration to Azure Cosmos DB.
```

### Set the Scope or Parser

```text
Run a relational database migration to Azure Cosmos DB autonomously through schema conversion.
```

```text
Run a relational database migration to Azure Cosmos DB using model-only DDL interpretation.
```

### Provision or Change Application Code

```text
Run the provisioning phase of a relational database migration to Azure Cosmos DB.
Allow provisioning for this invocation.
```

```text
Create an application code migration plan for moving this relational application to Azure Cosmos DB.
```

```text
Update the application code migration plan for moving this relational application to Azure Cosmos DB.
```

```text
Migrate the application code using the validated migration plan.
```

Planning and applying application changes are separate requests. Resource and data
mutations require explicit permission for the current invocation; a previous run's
authorization does not carry forward.

Code-migration plans include a strategy-specific execution checklist with stable task
IDs, dependencies, completion conditions, and recorded progress. The agent updates
implementation and verification tasks as it works and checks current code and evidence
before resuming. Applicable production rollout, synchronization readiness, and rollback
window tasks remain in a separate operational handoff checklist; code completion does
not mean production cut-over has occurred. See the
[checklist contract](./references/phases/code-migration.md#execution-checklist).

### Review and Fix

Use **Review and Fix** in Migration Assistant, or request a review directly:

```text
Review the assessment migration blockers and propose fixes for approval.
Run in interactive mode. Do not change files or resources before explicit approval.
```

The Skill inspects the selected project and relevant prerequisites, summarizes the
blockers, and asks whether to apply a proposed repair scope. Initial review is read-only,
including activity and memory state. Without an in-run question capability, it stops
after the proposal rather than applying fixes unattended. Resource mutations and
application-code changes still need explicit authorization. See the
[review contract](./references/workflow/interaction-and-checkpoints.md#review-and-fix).

### Remember Findings and Models

The agent reads `.cosmosdb-migration/memory.md` when present and automatically retains
important decisions, research findings, and verified fixes there, reporting additions at
the end of the task. These are concise Markdown notes in the application project, not
user-profile memories. You can ask it not to retain information or explicitly ask:

```text
Remember this decision for future relational database migrations.
```

```text
Memorize the generated Cosmos DB model to be preserved for the next migration.
```

A model-preservation request keeps a JSON copy under `.cosmosdb-migration/memory-models/`
and links it from the notes. To reuse the knowledge in another application, copy the memory
file and its referenced model snapshots into that project's `.cosmosdb-migration` folder,
or ask the agent to bring them from a specific project. Review the contents before sharing.
Do not copy checkpoint state just to transfer knowledge.

The next migration considers alignment with a remembered model, especially for applications
using the same source database, while evaluating its own requirements. Memory is advisory:
it does not force old choices, transfer permissions, or require a pack format or memory
validation. See the [memory workflow](./references/workflow/memory.md).

## Prepare Inputs

Start with the application source, prioritize current DDL, and add real workload
evidence where available. The recommended preparation is:

1. Export the current source schema as DDL.
2. Gather logs or comparable measurements so the agent can prefill volumetrics for review.
3. Optionally add business access requirements; the agent prepares the access-patterns
    template automatically during preflight.

You do not need complete production measurements before starting: missing facts can
remain explicitly unknown, and inferred values must be distinguished from observed data.

### Supply Input Files

Identify the application project root and the files to use in your request. Files
already inside that project can stay where they are; files outside it are copied into
the migration input folders only after approval. For example, with paths relative to
your application project:

```text
Run the preflight phase of a relational database migration to Azure Cosmos DB
in interactive mode for this application. Use db/schema.sql as the source DDL,
docs/workload.csv for volumetrics, and docs/access-patterns.md for access patterns.
```

Alternatively, place raw inputs in the default folders:

```text
.cosmosdb-migration/phases/1-discovery/
|-- schema-ddl/        # Source schema SQL files
|-- volumetrics/       # Row-count reports, monitoring exports, workload logs
`-- access-patterns/   # Query samples, workload descriptions, query logs
```

These folders are discovered recursively unless an explicit file selection is already
configured. When adding files to an existing migration, ask the agent to include them;
an explicit selection does not automatically pick up new files. The curated checkpoints
are `volumetrics/volumetrics.md` and `access-patterns/access-patterns.md`; keep raw
evidence in separate files. You do not need to edit checkpoint JSON yourself.

### DDL

**DDL is the most important input and is highly recommended.** Supply a schema-only
SQL export representing the current source database, and identify
the database engine, version, and SQL dialect when known. Include schema-qualified table
names, columns and types, nullability, primary and foreign keys, constraints, defaults,
and indexes. Include relevant views, stored procedures, triggers, and sequences when
they define behavior the application relies on. Multiple files are supported; identify
the complete set, including referenced definitions. A data dump is not required.

Selected DDL is authoritative and is not rewritten to match application code. Conflicts
with ORM mappings or queries are reported for review. If no DDL is selected, inference
from application models, migrations, and queries is possible, but not recommended:
these sources may not represent the complete deployed database. Inferred DDL records
provenance and uncertainty and needs careful human review. Incomplete or malformed
supplied DDL must be corrected or deselected; it does not silently trigger code-based
inference.

Sample prompt:

```text
Run the preflight phase of a relational database migration to Azure Cosmos DB
for this application in interactive mode. Use db/schema.sql as the source DDL
for our PostgreSQL 16 database.
```

### Volumetrics

**Prefer real logs or comparable measured data over manually guessed values.** Ask the
agent to use that evidence to prefill the
[volumetrics template](./assets/volumetrics-template.md), then have someone familiar
with the workload review the result. Useful evidence includes:

- Database query or audit logs with timestamps, operation types, and durations.
- PostgreSQL `pg_stat_statements` snapshots or SQL Server Query Store exports with
    their collection intervals and execution counts.
- Monitoring exports showing average and peak read/write rates over representative periods.
- Table statistics or sizing reports with row counts, average row sizes, and historical growth.
- Application telemetry or load-test reports from a comparable workload, clearly labeled
    with their environment and differences from production.

Volumetrics are important because a good Cosmos DB model must fit the workload, not
just reproduce the relational schema. Data volume, growth, and key distribution help
evaluate partition keys and avoid hot partitions. Read/write rates, item sizes, and
peaks inform throughput and cost estimates. Relationship sizes and retention help
decide when to embed data or keep it separate, avoiding unbounded documents and
expensive updates. Missing or unrepresentative measurements make those decisions
less reliable; measurements inform estimates, not a guarantee of target RU consumption.

The template captures, per schema-qualified table or entity:

- Current or estimated row count and average row size in KB.
- Monthly growth, with units such as rows/month or percent/month.
- Average read and write TPS (transactions per second).
- Peak rates and time windows, batch or initial-load behavior, and retention policies.
- Known size outliers, key or tenant skew, and regional or consistency requirements.

You may also fill in the template yourself. State the source, collection period, units,
and whether the data is production,
test, or synthetic. For logs, explain what each event counts so rates can be interpreted
correctly; returned query row counts are not table cardinality.

Mark estimates as `(estimated)`. Leave unknown numeric cells empty and explain the gap
in Notes rather than entering zero. The agent preserves valid supplied values and uses
direct evidence before estimating missing values from schema or code.

Sample prompt, with evidence paths relative to the application project:

```text
Prepare volumetrics for this relational database migration to Azure Cosmos DB.
Use docs/workload/query-log.csv, docs/workload/table-sizes.csv, and
docs/workload/monitoring.json to prefill the volumetrics template for human review.
Run only the volumetrics preflight step in interactive mode.
```

### Access Patterns

**Providing a completed access-patterns template is optional.** The agent automatically
creates and fills the [access-patterns template](./assets/access-patterns-template.md)
during preflight by inspecting application code, repositories, API handlers, queries,
and available workload evidence. Review the result for business requirements or
operations that are not visible in the code, such as planned reports or background jobs.

If you supply patterns yourself, describe reads and writes separately. For each operation,
provide its name, tables or entities,
frequency in TPS when known, and latency requirement with units. For reads, list filter
and lookup fields; for writes, distinguish single-item operations from batches.

For example, describe "List a customer's recent orders" with its customer filter,
date range, sort order, page size, frequency, and latency target. Describe "Create an
order and its lines" with the affected tables, typical batch size, and whether all
writes must succeed atomically. Include joins, result sizes, pagination, reporting,
search requirements, and transaction boundaries in the notes where relevant.

Link patterns to repository methods, API handlers, SQL examples, stored procedures,
or query logs. Distinguish observed behavior from code-evidenced patterns and business
requirements; label estimated frequencies. Where access is unknown, say so instead of
inventing a pattern. The agent can inspect code and queries to fill gaps and records
tables with no observed application access explicitly.

Sample prompt:

```text
Run the access-patterns preflight step for this relational database migration
to Azure Cosmos DB in interactive mode. I have not filled in an access-patterns
template. Our requirements also include a nightly sales report and customer
order-history searches with a 200 ms latency target.
```

### Application Context and Missing Inputs

Provide the project name and type, language, source database, database-access mechanism
(such as an ORM or raw SQL), and frameworks when known. Mention migration constraints
and known discrepancies between the code and database. The agent can infer missing
details from the application, but preserves valid engineer-supplied information.

Remove credentials and sensitive data from supplied logs and query samples while
preserving the structure needed for analysis. Preflight reviews the inputs together,
reports contradictions, and prepares the curated workload documents. Unknown measurements
can remain documented gaps; unresolved table identities or contradictory comparable
evidence may block readiness. See the [preflight reference](./references/phases/preflight.md)
for the full input checks.

## Results

The skill keeps checkpoints and generated artifacts under `.cosmosdb-migration/` in
the application workspace. Results include human-readable reports, a canonical
Cosmos DB model, deployment and sample-data artifacts, and an application migration
plan. Keep that directory with the workspace when continuing in another session or host.

| Phase | Main Result |
| --- | --- |
| [Preflight](./references/phases/preflight.md) | Prepared and validated migration inputs. |
| [Discovery](./references/phases/discovery.md) | Source schema and application access-pattern analysis. |
| [Assessment](./references/phases/assessment.md) | Domain assessments and cross-domain dependencies. |
| [Schema conversion](./references/phases/schema-conversion.md) | Validated Cosmos DB document model. |
| [Provisioning](./references/phases/provisioning.md) | Deployment artifacts and, when authorized, target resources and sample data. |
| [Code migration](./references/phases/code-migration.md) | An application change plan or explicitly requested implementation. |

Discovery can prepare missing preflight inputs as part of the same request; you do
not need to invoke each preparation step separately.

## Scope and Review

This is an agent-guided migration workflow, not a bulk production-data transfer or
cutover tool. Sample-data provisioning does not establish production-data completeness
or application correctness. Review the proposed model, costs, generated code, and
validation evidence before applying changes to a production environment.

Application code migration depends on the language's supported Cosmos DB SDK path.
See [SDK compatibility](./references/contracts/sdk-compatibility.md) for the current matrix.
Deterministic checks validate recorded structure and consistency; they do not prove
the agent's interpretation or replace behavioral application tests.

## Inspect and Test

To inspect a workspace without invoking an agent, replace the placeholders with your
installed skill directory and application workspace:

```bash
node <skill-root>/scripts/inspect-migration-state.mjs --workspace <workspace>
```

The inspector is read-only. For other commands and their side effects, see the
[helper command reference](./references/tooling/helper-commands.md). Each executable
helper supports `--help`.

Run the portable tests from this skill's directory:

```bash
node --test tests/*.test.mjs
```

The default suite does not require a live Cosmos DB target, paid model calls, or a
SQL parser installation. Real-agent evaluations and application behavior tests are
separate from these portable checks.

## Programmatic Integration

### Completion Results

For hosts and tools collecting multiple completion results, import
`checkPhaseCompletions(workspace, phases)` from
[check-phase-completion.mjs](./scripts/check-phase-completion.mjs).
It returns a map keyed by the requested phase identifiers and shares checkpoint,
source-inventory, and phase results only within that call. Freshness-aware completion
and code-migration readiness remain separate checks. Unexpected failures become
incomplete results for the affected phases; other results are still returned.
Each call starts a new cache so later edits are observed. The existing single-phase
`checkPhaseCompletion`, `checkCodeMigrationPrerequisites`, and CLI entry points remain supported.

Results can include `recordedCompletedAt` independently of `complete`. A recorded
completion date never establishes current acceptance. Optional `compatibilityChanges`
lists JSON pointers interpreted through the narrow optional-null compatibility rule;
compact CLI results report `compatibilityChangeCount` instead of the full pointer list.

Full completion results include `freshnessCauses`: the originating phase, input ID,
reason, and file path where available. Causes propagate through prerequisites; repeated
references to the same file retain the earliest upstream cause. `staleInputs` remains
the phase-local check list, with optional file paths. Predecessor artifact diagnostics
also retain the underlying causes for compact CLI inspection. Hosts verify file access
before offering navigation. A successful recorded run and subsequently stale evidence
are separate facts; neither a newer timestamp alone nor elapsed time makes content stale.

External tools may inspect individual artifacts independently, but file existence is
not phase completion. Use the completion checker when reporting migration readiness;
it considers persisted status and the required artifact/evidence contracts together.

### Validation APIs

SDK report consumers can call `validateCompatibilityReport(report, expectedLanguages)`
from [check-sdk-compatibility.mjs](./scripts/check-sdk-compatibility.mjs). Discovery
and current-iteration plan validation use this function. Derive `expectedLanguages`
from the comma-separated `phases.discovery.applicationAnalysis.language` field, not
the report's own results. The [SDK evidence contract](./references/contracts/sdk-compatibility.md)
describes coverage, normalization, and permissible documentation overrides.

[validate-code-migration-plan.mjs](./scripts/validate-code-migration-plan.mjs) exports
`validateCodeMigrationPlan` for current-iteration validation and
`validateCodeMigrationRecord` for historical inspection. The latter checks recorded
structure, coverage/results, safe relative paths, and checkpoint metadata without
requiring historical application outputs or design inputs to remain unchanged.
Keep historical completion separate from readiness to start a new migration iteration.

### Checkpoint Writes

`normalizeMigrationProjectCompatibility(value)` in
[validate-migration-project.mjs](./scripts/validate-migration-project.mjs) returns
`{ project, changes }`. It clones version-1 input and omits only explicit nulls in
Assessment access-pattern `filterFields`, `singleOrBatch`, `sqlExample`, and
`codeExample`. It preserves unknown fields and all other values. The raw
`validateMigrationProject` API remains strict; the diagnostic CLI validates the
compatibility view and reports any adjustments without rewriting the file.

The TypeScript declaration companions
[validate-migration-project.d.mts](./scripts/validate-migration-project.d.mts) and
[project-state.d.mts](./scripts/project-state.d.mts) describe the extension-facing
normalization and state-writer APIs. They contain no runtime logic or CLI commands.

`readProjectState` and completion checks use this same normalized view. State-read
revisions still identify the original saved bytes. Opening the extension is read-only;
an intentional save stores canonical fields. `MigrationProjectService` binds revisions
to loaded object snapshots, so a later reload does not permit an older object to overwrite
newer state. These checks protect sequential handoffs, not simultaneous cross-process writers.

[project-state.mjs](./scripts/project-state.mjs) validates updates with
`validateMigrationProject`, writes two-space JSON with a trailing newline to a unique
sibling temporary file, rechecks the expected revision immediately before replacement,
and atomically renames only a valid, non-conflicting candidate. Failed replacements
clean up their temporary file without changing the checkpoint.

Older recorded results remain inspectable but do not bypass current evidence gates.
The UI can offer explicit preparation from the earliest required phase using the normal
Skill launch path; opening a project never launches preparation or invents manifests,
parser decisions, freshness hashes, timestamps, or resource-mutation authorization.

### Import-Only Modules

These modules support the executable helpers and have no command-line entry point:

| Module | Consumers and responsibility |
| --- | --- |
| [phase-names.mjs](./scripts/phase-names.mjs) | Inspection, completion, freshness: normalize phase identifiers |
| [phase-summary.mjs](./scripts/phase-summary.mjs) | Validators: read evidence/model JSON and Markdown sections |
| [reconcile-capacity.mjs](./scripts/reconcile-capacity.mjs) | Model merge: reconcile capacity contributions before sizing |
| [validate-source-evidence.mjs](./scripts/validate-source-evidence.mjs) | Completion and provisioning validators: inventory, hashes, source identity |
| [cli-help.mjs](./scripts/cli-help.mjs) | All executable helpers: side-effect-free help dispatch |
| [cli-arguments.mjs](./scripts/cli-arguments.mjs) | Option-taking helpers: reject missing values before reading inputs or performing work |

Keep these shared modules when distributing the skill, even though they are not
agent-facing commands.
