# Application Code Migration (`code-migration`)

Application code migration is an optional workflow after a validated `schema-conversion`
model. It can run after artifact-only `provisioning`; provisioning need not be complete
unless tests require a live target.

## Iterative Handoff

Code migration is a terminal, iterative action, not a continuously fresh analytical
checkpoint. Its plan and execution results record what an iteration used and validated
at that time. Later edits, renames, or deletions of application files do not invalidate
that history or require discovery against the transformed application.

At the start of every planning or migration invocation, run:

```bash
node <skill-root>/scripts/inspect-migration-state.mjs \
   --workspace <workspace> --phase code-migration
```

Use `--regenerate` when requested by the normal rerun policy. This path uses
`checkCodeMigrationPrerequisites`: it requires accepted, structurally valid analytical
artifacts, authoritative DDL evidence, domain ownership, and canonical root/domain
consistency, without recursively checking live application-source freshness. Normal
analytical and provisioning phase checks retain their freshness requirements.

Inspect the current application, SDK/framework compatibility, migration instructions,
and accepted model before each iteration. Reconsider an old plan when its design inputs
or current code differ; never replay stale edits blindly. A historical completion flag
does not authorize application edits or prove the current SDK approach still works.
If the engineer requests new source analysis or model design, run the normal analytical
workflow explicitly. Never refresh upstream hashes merely to match migrated code.

Do not create a source snapshot or a code-migration `freshness` object.
Completion reports `freshness: "not-applicable"`
and a separate `ready` value for accepted-model readiness; `complete` describes the
execution record, not current application validity. An interrupted iteration remains
`in-progress`; inspect its current diff and rerun applicable checks before continuing.

## Expected Output Artifacts

Required for plan mode:

- `.cosmosdb-migration/code-migration-plan.md` and `code-migration-manifest.json`.
- `project.json` with `phases.codeMigration.status: "complete"`, `planPath`, and
   `completedAt`.

At the end of a migrate iteration, application outputs must exist, applicable build
and test results must pass, all active implementation and verification checklist items
must be complete, and no unresolved blocking migration step may remain.
Persist the workspace-relative output list in `phases.codeMigration.outputPaths`.
These are iteration-time checks, not ongoing requirements on the evolving application.
Production handoff items do not gate code completion or establish production readiness.

## Inputs

- Canonical `phases/3-schema-conversion/model.json`.
- Root `schema-conversion` summary and manifest, plus each converted domain's
   `summary.md` and `cosmos-model.json`. Converted domains do not have separate manifests.
- `assessment` domain files and the `discovery` report.
- Application details, target environment, and root `migrationInstructions`, when
   present.
- `sdkCompatibility` in `phases/1-discovery/discovery-manifest.json`.
- `identityMapping` in `phases/3-schema-conversion/manifest.json`, when present.
   Implement its exact source-derived encoding and verify the shared golden vectors
   from [validation-evidence.md](../contracts/validation-evidence.md) before changing identity.
   A `{uuid}` fallback has no schema-conversion mapping; preserve synthetic sample IDs
   during provisioning, and leave production keyless-row identity to the future
   data-migration design rather than inferring it from samples.

Access-pattern mappings and cross-partition recommendations are intentionally
stored in the phase/domain summaries rather than canonical model JSON. Read those summaries;
do not assume the mappings exist in `model.json`.

## Procedure

Derive the action only from the current request prompt. If it asks to create or update
the plan, write and validate the plan without modifying application files. Migrate
application code only when the prompt explicitly asks to migrate, apply, or execute
the plan; otherwise default to planning. Checkpoint metadata never authorizes
application edits or determines the requested action.

1. Read the SDK compatibility artifact. If any application language is unsupported,
   still write a code-migration plan that recommends migration to a supported
   language or a supported-language service boundary, but do not perform final
   application code changes.
2. Never implement a REST-only Cosmos DB data-access layer as an SDK fallback.
3. Scan the application structure and existing data-access layer while excluding
   `.cosmosdb-migration` from source candidates.
4. Resolve best practices for the detected language, framework, SDK, query shapes,
   consistency needs, and target topology.
5. Prefer an established framework integration when it supports the required
   Cosmos DB behavior. Use the native SDK where the framework cannot express an
   essential operation.
6. Plan client configuration and lifecycle, authentication, environment-specific
   settings, serialization, retries, diagnostics, and availability.
7. Map every source access pattern to target point reads, queries, pagination,
   transactional batches, patches, references, or change-feed workflows.
8. Include partition-key routing, projections, parameterization, scan avoidance,
   optimistic concurrency, and monitoring.
9. Map relational constraints and behaviors that require application ownership,
   including cascades, unique constraints, triggers, computed values, and
   cross-container transactions.
10. Review every candidate execution blocker during planning. Inspect repository
   evidence and migration artifacts, consult applicable best practices, and propose a
   concrete solution. A required framework or SDK update with a known compatible path
   is an ordered plan change, not an unresolved blocker.
11. Resolve deterministic choices in the plan. In interactive mode, ask the user now
   about consequential choices with multiple valid solutions; do not postpone those
   questions until migration. Update the plan from the answer before completing the
   planning checkpoint. Resolve the cut-over strategy and rollback expectations using
   [Cut-over Scope](#cut-over-scope) before finalizing the execution checklist.
12. Defer a blocker only when planning cannot resolve it, such as unavailable external
   access, credentials or permissions that must not be requested through chat, a
   decision the user explicitly postpones, or an outcome knowable only by executing
   the migration. Record the evidence, solutions considered, recommended solution,
   recommendation rationale, reason for deferral, and exact condition that will clear
   it. The rationale must compare material alternatives and explain why the
   recommendation best fits repository evidence and migration constraints.
13. Write `.cosmosdb-migration/code-migration-plan.md` with affected files, ordered
   execution checklists, tests, rollback considerations, applied rules, and unresolved
   choices; add a separate operational handoff checklist when applicable. Write machine
   evidence to `code-migration-manifest.json`.

## Cut-over Scope

Record the selected strategy and its rationale in `Overview`, and its rollback
conditions in `Rollback`. Offer options appropriate to the application rather than
automatically introducing dual writes or migration infrastructure:

- **Direct switch:** Rewrite the application for Cosmos DB and switch reads and writes
  together, optionally with a maintenance or read-only window.
- **Validate alongside the source:** Keep the source authoritative while mirroring
  changes and comparing shadow reads; optionally move reads before write ownership.
- **Reversible cut-over:** Move read and write ownership to Cosmos DB while keeping
  the source updated and compatible for a defined rollback window.
- **Incremental migration:** Move isolated tenants/cohorts or business domains
  separately, applying one of the preceding strategies within each boundary.

For each stage, identify the read target, authoritative writer, routing boundary,
write-acknowledgment and secondary-failure behavior, and promotion/abort conditions.
Include background jobs and other writers, not only request handlers. Resolve
consequential choices through the normal planning decision and blocker rules.

Keep one write authority per entity or domain at each stage. Two independent database
writes are not atomic; when both databases must stay updated, define durable propagation,
retry, idempotency, ordering, delete handling, and lag expectations. Source-to-Cosmos
propagation alone cannot keep the source current after Cosmos takes write ownership.
Rollback must account for committed writes, in-flight operations, writer fencing,
reverse-compatible mappings, acceptable data loss, and recovery time. Switching back
to the old application is not by itself a database rollback.

Historical data transfer and production synchronization execution remain out of scope.
Record their required contracts and external readiness gates in the plan; include
application-side integration and tests in the execution checklist where required.
Do not claim a reversible cut-over when the accepted model or operations cannot map
back to the source. Resolve the incompatibility or record a deferred blocker rather
than silently changing the accepted model.

## Execution Checklist

Every generated plan must express `Ordered Changes` as an execution checklist tailored
to the selected strategy and application. Track meaningful implementation and
verification tasks, not individual edits. A direct switch must not inherit shadow-read
or dual-write tasks unless they are required by the selected design.

For each active task, record:

- A unique, stable `CM-` identifier, concrete action, and affected files or components.
- Explicit dependencies by task identifier, or `none`; do not rely on list order alone.
- A completion condition describing the required behavior or verification.
- A Markdown checkbox and status: `pending`, `in-progress`, `blocked`, or `complete`.
- Evidence when complete; when blocked, the reason, next action, and clearance condition.
  Reference the corresponding `Blocker Review` identifier for deferred blockers.

Group tasks with bold labels inside `Ordered Changes`, not nested headings, so the
existing section validator sees the checklist as section content. This abbreviated
example illustrates the format, not a mandatory task list or application stack:

```markdown
## Ordered Changes

**Application implementation**
- [ ] CM-01 (pending): Configure the Cosmos client.
  - Scope: The application's data-access configuration and client registration.
  - Depends on: none.
  - Done when: Client lifecycle, authentication, and environment configuration match the accepted design and pass focused checks.
  - Evidence: Not yet collected.

**Verification**
- [ ] CM-02 (pending): Verify the migrated application.
  - Scope: All affected application components and their repository checks.
  - Depends on: CM-01.
  - Done when: Applicable build and behavioral checks pass, with coverage and limitations recorded in Validation.
  - Evidence: Not yet collected.

## Operational Handoff

- [ ] OP-01 (pending): Confirm production data and synchronization readiness.
  - Owner: The engineer responsible for production cut-over.
  - Depends on: Code verification and the separately managed data-migration work.
  - Done when: The owner records evidence that the agreed production readiness gates are met.
  - Evidence: Not yet collected; outside code-migration execution.
```

The plan is the source of truth for task status. Reuse the existing manifest for output,
blocker, and validation evidence; do not add a separate task file or new manifest fields.
Reference validation commands/results from checklist evidence instead of maintaining
independent copies of those results. Keep deferred blockers aligned with `Blocker Review`,
`Unresolved Blockers`, and manifest `blockingSteps`.

### Updating and Resuming

- New execution items start unchecked and `pending`. Planning alone never marks an
  execution item complete or records an unexecuted check as passed.
- Mark a task `in-progress` before applying its changes. Use `[x]` only with `complete`
  after its completion condition is verified and evidence is recorded. Implemented
  but unverified work remains unchecked.
- Persist progress after each meaningful task and before a handoff or interruption
  when possible. Report completed, remaining, and blocked work with the next action;
  do not rely on chat history or host-local todos as the durable execution record.
- On resume, inspect the current code, diff, dependencies, and recorded evidence before
  continuing. Do not replay completed edits blindly. Preserve task IDs and valid prior
  progress; reopen affected tasks when changed code or scope invalidates their evidence,
  and rerun affected checks for the current iteration.
- When updating a plan, add new IDs for new work. Remove obsolete tasks from the active
  checklist with a short note retaining their IDs and the reason; do not reuse IDs or
  mark unperformed work complete. Preserve historical validation evidence as historical,
  not proof of current correctness.
- Before completing a migrate iteration, verify every active `CM-` task is complete
  with evidence, applicable checks pass, and no execution blocker remains. Plan-mode
  completion means the plan is ready, not that its implementation tasks have run.

### Operational Handoff

When production rollout is relevant, add a separate top-level `Operational Handoff`
section with `OP-` task IDs, owners, dependencies, completion conditions, and evidence
using the same checkbox/status convention. Include only applicable external readiness
checks, rollout approval, production observation and promotion/abort gates, rollback
window closure, and retirement of temporary compatibility code.

Operational handoff items do not gate code-migration completion and must not be executed
or checked off merely because application edits were authorized. Keep required
application integration and verification in `Ordered Changes`; do not move a missing
implementation, failed check, or required-but-unavailable test into the handoff to
claim completion. Retiring compatibility code requires a later explicit application
change request after the rollback window closes. Report the handoff as outstanding
without claiming that production cut-over, synchronization, or data migration occurred.

## Deterministic Plan Contract

The plan must contain non-empty `Overview`, `Affected Files`, `Ordered Changes`,
`Access Pattern Migration`, `Configuration and Authentication`, `Validation`,
`Rollback`, `Applied Rules`, `Blocker Review`, and `Unresolved Blockers` sections.

`Blocker Review` must inventory all candidate blockers and mark each one `resolved`
or `deferred`. For resolved items, state the evidence and selected solution and place
the resulting work in `Ordered Changes`. For deferred items, include a stable
identifier, evidence, solutions considered, recommendation, recommendation rationale,
why it cannot be resolved during planning, and the exact clearance condition. Every
recommendation rationale must cite evidence or constraints, compare the material
alternatives, and explain why the recommended tradeoffs are preferable. If no
candidates are found, write exactly `No candidate blockers.`

`Unresolved Blockers` and manifest `blockingSteps` contain only deferred items and
must identify the same stable identifiers. Do not list known framework upgrades,
package changes, configuration work, or other actionable migration steps as blockers
when the plan can specify their solution. In interactive planning, unresolved user
choices are asked and resolved before the plan is completed unless the user explicitly
defers them.

Write the following object to `code-migration-manifest.json`. This illustrative record
uses a fictional .NET application; its paths, commands, coverage, and results are not
defaults. Use the application repository's actual toolchain and record only observed
results. See [Execution Validation](#execution-validation) for other stack examples.

```json
{
   "version": 1,
   "mode": "migrate",
   "modelSha256": "64-lowercase-hex-characters",
   "sdkReportSha256": "64-lowercase-hex-characters",
   "bestPractices": {
      "rules": ["rules/sdk-singleton-client.md"],
      "unresolvedConcerns": []
   },
   "outputFiles": [
      {
         "path": "src/Orders/Data/OrdersRepository.cs",
         "sha256": "64-lowercase-hex-characters"
      }
   ],
   "blockingSteps": [],
   "validation": [
      {
         "command": "dotnet build src/Orders/Orders.csproj",
         "checks": ["build"],
         "coverage": "Compiles the application and its Cosmos DB data-access integration.",
         "status": "passed",
         "exitCode": 0
      },
      {
         "command": "dotnet test tests/Orders.Tests/Orders.Tests.csproj",
         "checks": ["behavior"],
         "coverage": "Exercises order identity, partition routing, serialization, and reference hydration; no live-target performance coverage.",
         "status": "passed",
         "exitCode": 0
      }
   ]
}
```

Plan mode uses an empty `outputFiles` array and may retain explicit blocking steps.
Migrate mode requires output files matching `phases.codeMigration.outputPaths`, current
files, no blocking steps, SDK support, and explicit accounting for both `build` and
`behavior` checks. Each validation entry has a non-empty `coverage` description and
a non-empty `checks` array of unique categories: `build`, `behavior`, or `other`.
One actual command may cover both build and behavior; record it once with both categories.
Other repository gates, such as lint, can use `other` without substituting for either category.
A genuinely inapplicable check uses `status: "not-applicable"`, `coverage`, and a
non-empty `reason`, omitting `command` and `exitCode`. Applicable checks must pass;
there is no minimum successful-command count.
Output SHA-256 values are optional provenance. When supplied, they must match current
bytes during iteration-time validation; historical record inspection never compares them.

Validate SDK evidence with the shared report validator described in
[sdk-compatibility.md](../contracts/sdk-compatibility.md). It requires complete expected-language
coverage, matrix-consistent mappings or explicit documentation overrides, and correctly
derived status and permission flags. Never authorize migration solely because a report
contains `codeMigrationAllowed: true`, even when its hash matches. Invalid reports
block current-iteration validation; valid unsupported reports still permit plan mode.
Historical record inspection does not call the SDK validator.

Set `modelSha256` from exact canonical model bytes. For `sdkReportSha256`, read
`phases/1-discovery/discovery-manifest.json#sdkCompatibility` and hash
`JSON.stringify(sdkCompatibility, null, 2) + '\n'`, preserving object-property order.
Hash only that serialized object, not the whole discovery manifest or a preflight
artifact. No separate SDK file is needed.

Record the unique model-selected rule paths and unresolved concerns under `bestPractices`; every
rule path must also appear in `Applied Rules`. `unresolvedConcerns` records advisory
design, tuning, or operational follow-ups and may remain non-empty in plan or migrate
mode. Explain their impact and follow-up in the summary; they do not veto completion.
Concrete correctness failures belong in `blockingSteps` and failed validation results,
not solely in advisory notes. Required execution checks, SDK compatibility, and output
evidence still determine acceptance. Use exactly
`.cosmosdb-migration/code-migration-plan.md` for `planPath`. Persist a UTC ISO 8601
`completedAt`. Output paths must remain in the workspace after symlink resolution.
Passed validation entries contain `checks`, `coverage`, `command`, `status`, and
`exitCode: 0`, without `reason`. Not-applicable entries contain `checks`, `coverage`,
`status`, and `reason`, without a command or exit code. Plan mode may leave `validation`
empty: describe planned checks in the summary, never mark unexecuted checks as passed.

## Execution Validation

Derive validation from the application being migrated: its language, framework,
build configuration, dependency files, CI, and existing tests. The Skill's helpers
run on Node.js, but the application need not use Node.js. Do not copy validation
commands from the extension repository or infer an npm requirement from a helper's
runtime. JavaScript fake applications in the Skill's tests are fixtures, not target
application requirements.

Before applying changes, inspect that application's configuration to select the
applicable build or type-check targets and focused behavioral checks. Use its configured
SDK/runtime versions, package manager, wrappers, and environment. Execute from the
appropriate application or module directory; state that directory in the validation
summary when it is not the workspace root. For polyglot applications, cover every
affected component with its own toolchain rather than selecting one language for all.

These examples illustrate possible checks, not commands to run without inspecting
the application. Project names, test selection, and available targets will differ:

| Application stack | Build or static check example | Behavioral check example |
| --- | --- | --- |
| .NET | `dotnet build src/Orders/Orders.csproj` | `dotnet test tests/Orders.Tests/Orders.Tests.csproj` |
| Java / Maven | `./mvnw compile` using the repository wrapper | `./mvnw verify` using its configured tests; may cover both categories |
| Java / Gradle | `./gradlew classes` using the repository wrapper | `./gradlew test`, plus integration-test tasks if configured |
| Python | Repository-configured type/package checks, if applicable; compilation may be not applicable | `python -m pytest tests/test_orders.py` in the application's environment when it uses pytest |
| Go | `go build ./...` from the affected module | `go test ./...` from that module |
| JavaScript / TypeScript | The repository's build/type-check script, e.g. `npm run build` only when defined and npm is the selected manager | Its configured test runner, e.g. `npm test -- orders` only when that runner accepts this selector |

Do not install a new framework or create a dummy build merely to match an example.
An interpreted application may legitimately have no build step while still requiring
behavioral tests. Missing tooling for an applicable check remains a blocker, not a
reason to declare the check inapplicable. After the changes, execute the selected
checks through the host and verify their actual exit codes.
Assess migrated behavior against the accepted design and source access patterns:
identity and partition routing, serialization and null handling, reference hydration,
query parameters and pagination, client lifecycle, and concurrency or transaction
semantics where affected. Select relevant cases; this is not a fixed checklist or a
requirement to add a new test framework.

In the existing `Validation` summary, describe what each command exercises, the
results, and meaningful limitations. Distinguish mocked/unit behavior from actual SDK
or live-target checks. Identify access patterns or risks not covered and explain why.
Required but unavailable checks remain blockers with a clearance condition; no test
harness, missing credentials, denied network access, a failed check, or a timeout does
not make an applicable check `not-applicable`. Add focused tests using the repository's
tools where feasible, otherwise leave the iteration incomplete and report the gap.

Use non-applicability only for a genuinely absent requirement, such as compilation
in an interpreted application or an iteration that changes documentation only. The
host must judge and justify applicability. A syntax check, lint pass, helper validator,
or `echo ok` is not evidence that migrated application behavior works. Do not relabel
such a result as behavioral coverage to satisfy the record shape.

The script validates declared coverage and result consistency. It does not classify
command names, execute them, or determine whether a test is meaningful. Non-empty
coverage text and category labels are not proof of adequate validation; the host owns
truthful execution and substantive coverage review. This distinction also applies to
non-applicability reasons. No additional evidence sidecar is required.

Validate the current iteration before recording completion:

```bash
node <skill-root>/scripts/validate-code-migration-plan.mjs \
   --workspace <workspace> \
   --project <workspace>/.cosmosdb-migration/project.json \
   --sdk-report <workspace>/.cosmosdb-migration/phases/1-discovery/discovery-manifest.json \
   --manifest <workspace>/.cosmosdb-migration/code-migration-manifest.json \
   <workspace>/.cosmosdb-migration/code-migration-plan.md
```

The host executes repository checks and records truthful results. This command validates
current model/SDK hashes, current output files and optional hashes, safe paths, and
recorded coverage and test results. It cannot prove that arbitrary commands ran or
that declared coverage is adequate. Never place
application outputs under `.cosmosdb-migration`.

In plan mode, stop after validating the plan. In migrate mode, apply changes using
the host repository's editing and testing rules and update the execution checklist
as work progresses. The host verifies checklist status and completion evidence; the
deterministic validator does not parse task status or prove task completion.
Do not overwrite unrelated user
changes, expose secrets, or claim completion without running applicable tests.

Write the code-migration checkpoint after its required outputs validate, preserving
unrelated project fields. Subsequent `check-phase-completion.mjs --phase code-migration`
inspection validates the historical plan's structure,
recorded coverage and result fields, safe relative paths, and checkpoint metadata only. A missing
or malformed plan or recorded failed validation prevents completion, but changed or
missing application outputs and changed design inputs do not.
New invocations use the handoff checks above, not historical completion as readiness.
