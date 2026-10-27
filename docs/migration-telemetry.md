# Migration integration telemetry

Telemetry is owned by the VS Code extension, not the portable migration skill. The extension uses the existing
azext-utils pipeline and telemetry settings. No telemetry reporting instructions, SDK, network calls, token counting,
or transcript inspection are added to the skill.

## Operation mapping

| Requested operation                            | Event                                                 |
| ---------------------------------------------- | ----------------------------------------------------- |
| Application details                            | `cosmosDB.migration.phase1.analysis`                  |
| Other focused preflight steps / full preflight | `cosmosDB.migration.phase1.preflight`                 |
| Discovery                                      | `cosmosDB.migration.phase1.discovery`                 |
| Assessment                                     | `cosmosDB.migration.phase2.assessment`                |
| Schema conversion                              | `cosmosDB.migration.phase3.schemaConversion`          |
| Full provisioning                              | `cosmosDB.migration.phase4.provisioning`              |
| Target account                                 | `cosmosDB.migration.phase4.accountProvisioning`       |
| Resources and sample data                      | `cosmosDB.migration.phase4.sampleDataPopulation`      |
| Code migration                                 | `cosmosDB.migration.codeMigration`, with `action=plan | migrate` |
| Review and Fix proposal                        | `cosmosDB.migration.review`                           |

Normal operation events are emitted once at the observed terminal outcome, not at Chat launch. Reviews are the
exception: the read-only proposal does not write activity, so their outcome is `handedOff`, never a completed repair.
Unscoped requests use `cosmosDB.migration.skill.runFinished`; without an explicit scope to validate their completed
activity is `unverified`, not a synthesized set of successful phases.

Two additional events explain integration behavior:

- `cosmosDB.migration.skill.dispatch`: one handoff result, resolved launch model and Chat-session reuse flag.
- `cosmosDB.migration.skill.stateChanged`: deduplicated observed activity, including `acknowledged` on the first
  matching execution record. Successful dispatch alone does not constitute acknowledgment.

The old DDL-extractor and AI-loop events are retired; the extension cannot observe their former internals.
Existing setup, selection and connection-test events remain. Connection tests explicitly distinguish `completed`,
`failed` and `notConfigured`; returning normally is not evidence of a successful connection.

## Outcomes and validation

Operation `outcome` values are `completed`, `blocked`, `failed`, `cancelled`, `unverified`, `unobserved`, or `handedOff`.
The corresponding `result` is `Succeeded` for completed operations and review handoffs, `Failed` for blocked/failed
operations, and `Canceled` for explicit agent cancellation. Unverified/unobserved outcomes omit `result` rather than
inherit the pipeline's default `Succeeded`; unconfigured connection tests do the same. Dashboard
success rates must exclude review handoffs and retain unknown outcomes separately rather than counting them as success.

A completed execution record must match the launched run, phase and step. The observer uses a stable execution
snapshot around the completion check and ignores obsolete refreshes. Full phases require validated completion and
current freshness (code migration uses historical execution evidence instead). Code-migration manifest mode must match
the requested action, so a valid plan cannot count as migrated code.

Focused preflight checks use the completion checker's application-details result, validated schema selection, or
validated template as appropriate; template consistency failures also block template-step success. Target-account
checks require verified target metadata, not containers or sample data. Resources-and-data requires full provisioning
completion. `validationScope=step` does not certify other phase gates. These checks validate the recorded evidence;
they are not independent proof of agent reasoning, source-engine validity, or production cut-over.

Failures to read aggregation evidence or run the completion checker produce `validationResult=unavailable`, not a
successful migration. Error categories are controlled identifiers; raw diagnostics are never emitted.

## Compatibility and measurements

New operation events have `executionEngine=skill` and `telemetrySchemaVersion=2`. Legacy phase identifiers are retained
on reused events, including `discovery` for application analysis and `schemaConversion` for schema conversion.
`migrationMode` retains its historical `plan|start` meaning; `executionMode` is separate.

Preserved measurements include `domainCount`, `accessPatternCount`, `skippedDomainCount`, and `targetContainerCount`.
The latter remains the sum of per-domain container counts, not the unique merged-container count. The incorrect legacy
`sourceTableCount` (which counted files) is retired in favor of `schemaFileCount` and `sourceInventoryTableCount`.
Additional inventory aggregates are `sourceColumnCount` and `sourceForeignKeyCount`.
`verifiedContainerCount` counts verified container metadata; it deliberately does not claim `containersCreated`.

`durationMs` measures dispatch to terminal observation, including user waits and any closed-panel interval.
`durationSource=dispatchToObservation` makes that boundary explicit. The pipeline's automatic `duration` still measures
the reporting callback and must not be used as skill execution time. `acknowledgmentMs` measures first observed
acknowledgment. `observedWaitingMs` includes only waits with both boundaries observed; interrupted waits are omitted.
`validationDurationMs` measures the completion-check refresh used for the terminal observation.
`artifactBytes` counts only files read for structural aggregation, not all project artifacts.
Missing/invalid artifact and stale-input counts describe the phase snapshot, even for a focused step.

`runIndex` is zero-based per operation/step/action during the extension session, labeled
`runIndexScope=extensionSession`. It is not reconstructed from historical programmatic counters and does not mutate
the skill checkpoint. `modelId`, `modelFamily` and `modelVendor` describe only launch selection
(`modelSelectionSource=launch`), not subsequent model choices.

## Observation and privacy boundaries

Tracking survives panel recreation within the extension session. Closing the panel marks coverage `interrupted`,
not cancellation. A local "Agent Has Stopped" confirmation ends tracking as `unobserved`; it does not cancel Chat.
Another launch ends unfinished tracking as `unobserved`. Extension shutdown can leave a dispatch without a terminal
event; this is incomplete observation, not proof of abandonment or failure.

Only extension-launched requests are tracked. Opening an already-completed project, replaying checkpoints, or observing
an unrelated direct-Chat run does not emit a new successful operation. There is no cross-restart replay or backfill.

Session and telemetry run IDs are generated in memory by the extension and are never written to checkpoints or prompts.
The separate workflow run ID passed to the skill is used only for local matching and is not forwarded to telemetry.
Database types are normalized through an allowlist. No file contents,
paths, project/domain/table/container names, hashes, prompts, responses, activity detail, or diagnostic text are emitted.
All numeric measurements must be finite and non-negative.

Application Details inputs are free-form even when their labels suggest a category. Project name is never emitted.
The other fields are mapped to fixed allowlisted labels:

| Input           | Property            | Example normalization                                            |
| --------------- | ------------------- | ---------------------------------------------------------------- |
| Project type    | `sourceProjectType` | `rest api` -> `Web API`; `cli` -> `Console`                      |
| Language        | `sourceLanguage`    | `ts` -> `TypeScript`; `csharp` -> `C#`                           |
| Frameworks      | `sourceFramework`   | `EF Core` -> `Entity Framework Core`; `rails` -> `Ruby on Rails` |
| Database type   | `sourceDbType`      | `postgres` -> `PostgreSQL`; `mssql` -> `SQL Server`              |
| Database access | `sourceDbAccess`    | `Entity Framework Core` -> `ORM`; `Dapper` -> `Micro ORM`        |

`sourceLanguage` and `sourceFramework` reuse the legacy property names. Matching is case-insensitive and normalizes
whitespace, underscores, and hyphens. A trailing numeric version may be removed for matching, but is never emitted.
Comma/semicolon-separated categories and framework arrays are normalized individually, deduplicated, sorted, and joined
with `, `. Unknown categories become `other`; missing/blank inputs are omitted. No substring matching against arbitrary
prose is performed, so `Django for private-service` becomes `other`, not a copied or partially sanitized string.
Database access groups recognized technologies into mechanisms such as `ORM`, `Direct SQL`, or `Query builder`.

Database categories cover the 32 named identifiers in the reviewed
[SQLGlot dialect registry](https://github.com/tobymao/sqlglot/blob/main/sqlglot/dialects/dialect.py),
including warehouse, analytics, and non-SQL dialect labels. `spark2` groups with `Spark` and `tsql` maps to `SQL Server`.
Existing `MariaDB` and `DB2` categories remain supported. Common product names are explicit aliases, including
`Microsoft SQL Server`, `Azure SQL Database`, `Azure SQL Managed Instance`, `Google BigQuery`, and `Amazon Redshift`.
Azure SQL aliases group into the SQL Server engine family; Fabric retains its own category.
This is a static telemetry classification list, not a guarantee of source-engine or DDL support. The skill still
checks its installed SQLGlot registry independently. New/custom dialect names are not trusted automatically and
remain `other` until explicitly reviewed and added to the allowlist and coverage tests.

Raw manual updates are registered as error masks on their own RPC action context before dispatch. Saved names,
unrecognized category text, and version-bearing text are also masked on migration action contexts. Exact recognized
category aliases are excluded from those saved-value masks so the safe normalized dimensions remain useful.
