# Test Configuration Documentation

This project uses the following test runners and evaluation tools:

- **Vitest** — unit tests (Node, mocked `vscode`) and integration tests
  (real `vscode` API inside the Extension Host).
- **Playwright** — end-to-end tests that drive the React webviews inside a
  real downloaded VS Code instance, against a Cosmos DB emulator in Docker.
- **Node's built-in test runner** — portable migration skill tests and offline evaluation tests.
- **Vally** — live migration skill capability and artifact evaluations using GitHub Copilot.

## 📋 Test Structure Overview

```
vscode-cosmosdb/
├── src/                          # Source code
│   └── **/*.test.ts              # Vitest unit tests (run in Node, vscode is mocked)
├── packages/*/src/
│   └── **/*.test.ts              # Vitest unit tests for workspace packages
├── skills/cosmosdb-relational-migration/tests/
│   └── *.test.mjs                # Portable migration helper and contract tests
├── evals/cosmosdb-relational-migration/
│   ├── **/eval.yaml              # Vally capability and artifact evaluation specs
│   └── *.test.mjs                # Offline grader, fixture, and CI gating tests
├── test/                         # Integration tests (Vitest in Extension Host)
│   ├── index.ts                  # Custom @vitest/runner entry executed inside VS Code
│   ├── **/*.test.ts              # Vitest integration tests (real vscode API)
│   └── e2e/                      # Playwright e2e suite (real VS Code + emulator)
│       ├── fixtures/             # Worker-scoped vscodeApp / vscodeWindow / webview helpers
│       ├── setup/                # globalSetup/Teardown, emulator lifecycle, activation handshake
│       ├── specs/                # *.spec.ts — Playwright tests
│       ├── fixtures/workspace/   # Workspace folder copied into each worker temp dir
│       └── README.md             # Detailed e2e architecture notes
├── scripts/
│   ├── eval.mjs                  # Runs Vally specs in isolated trial workspaces
│   ├── run-integration-tests.mjs # Downloads VS Code + launches the integration host
│   ├── test-proxy.mjs            # Isolated proxy-routing matrix launcher
│   ├── test-proxy-host.mjs       # SDK/adapter comparison inside the Extension Host
│   └── import-seed.mjs           # Seeds the Cosmos DB emulator for integration & e2e tests
├── docker-compose.e2e.yml        # Dedicated emulator (ports 8082/1235, project cosmosdb-e2e)
├── playwright.config.ts          # Playwright configuration (single worker, retries on CI)
├── tsconfig.json                 # Main TS config (src only)
├── tsconfig.vitest.json          # Type-check unit tests
├── tsconfig.test.json            # Compile integration tests (ESM)
└── tsconfig.e2e.json             # Type-check e2e specs
```

---

## 🎯 Why a Single Framework (Vitest)?

We used to have Mocha for integration tests because `@vscode/test-cli` is mocha-only.
That meant two runners and two different APIs (`suite/test/assert.ok` vs `describe/it/expect`).

Instead, we drive `@vitest/runner.startTests()` directly from a small entry script in
`test/index.ts` that runs inside the VS Code Extension Host. The result:

- **One framework for extension tests** — `vitest` for unit and integration tests.
- **One API for extension tests** — `import { describe, it, expect, beforeAll } from 'vitest';`
- **Same speed** for unit tests — they don't pay the Electron launch cost.
- **Real `vscode` module** for integration tests — they run inside Electron.

### Unit tests (`src/**/*.test.ts`, `packages/*/src/**/*.test.ts`)

- Fast, isolated, no VS Code needed.
- `vscode` is aliased to `src/__mocks__/vscode.ts` (provided by `jest-mock-vscode`).
- `npm run vitest` runs these tests and the portable migration skill tests in parallel.

### Migration skill tests (`skills/cosmosdb-migration/tests/*.test.mjs`)

- Use Node's built-in test runner so the standalone skill does not depend on Vitest.
- Run alone with `npm run test:migration-skill`, or as part of the main `npm run vitest` command.
- For live agent behavior and artifact checks, see [Migration skill evaluations (Vally)](#migration-skill-evaluations-vally).
- Relational, document, and unfamiliar-source fixtures exercise inventory, mapping examples, freshness,
  compatibility, and completion contracts. These are not live source extraction or engine-equivalence tests.

### Integration tests (`test/**/*.test.ts`)

- Run inside the real VS Code Extension Host via `@vscode/test-electron`.
- `vscode` is the **real** module — call commands, inspect the workbench, activate the
  extension under test.
- Tests must depend only on the public extension surface (`vscode` API, registered
  commands, contributed configuration, etc.) — they do **not** import from `src/`
  because the source is bundled by Vite into `dist/main.mjs` and lives in a different
  module instance than the compiled test code.
- Run with `npm test`.
- CI retries the extension-host suite up to three times. If it passes only after retrying, the integration
  job summary and PR comment include a warning; the workflow still succeeds.

### End-to-end tests (`test/e2e/specs/**/*.spec.ts`)

- Driven by **Playwright** + `@vscode/test-electron`'s `_electron.launch()`.
- Launch a real downloaded VS Code, load the extension from `dist/`, then drive
  the React webviews under `src/webviews/` by finding the webview iframe and
  asserting against its DOM (no shell assertions — that's the integration tests' job).
- A dedicated Cosmos DB emulator is brought up in Docker (ports `8082`/`1235`,
  compose project `cosmosdb-e2e`) so it does not collide with the developer's
  local emulator on `8081`. The emulator is seeded with deterministic data
  (`scripts/import-seed.mjs`) before tests run.
- The `vscodeApp` / `vscodeWindow` fixtures are **worker-scoped** — VS Code is
  launched once per worker and reused across every test in that worker
  (~5 s total vs ~50 s with per-test launch). Tests **must** close all editor
  tabs in `afterEach` via `closeAllEditorTabs(vscodeWindow)` from
  `fixtures/webviewHelpers.ts`.
- Run with `npm run e2e`. See [`test/e2e/README.md`](../test/e2e/README.md) for
  the full architecture, env-var contract, and per-spec patterns.
- The migration spec uses deterministic agent output with real VS Code routing and artifact validation,
  including native-source resumption and code-planning freshness. Run it without a database service with
  `COSMOSDB_E2E_SKIP_EMULATOR=1 npm run e2e -- test/e2e/specs/migration.spec.ts --project=default`.
  Build freshness includes `skills/` because completion workers load packaged portable helpers at runtime.

---

## 📝 TypeScript Configurations

### `tsconfig.json` (production source)

Compiles only `src/` (no tests). Used by the Vite extension build and IDE.

### `tsconfig.vitest.json` (unit test type-checking)

Type-checks `src/**/*.test.ts` and `packages/*/src/**/*.test.ts` against the unit
environment (uses the mock `vscode`).

### `tsconfig.test.json` (integration test compilation)

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "out",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["test/**/*.ts"]
}
```

- ESM (`NodeNext`) output, written to `out/test/`.
- The `pretest` script also writes `out/package.json` with `{"type":"module"}` so Node
  treats compiled files as ESM.
- Only includes `test/` — integration tests must not depend on `src/`.
- Relative imports inside `test/` must use `.js` extensions (Node ESM requirement),
  e.g. `import { TestUserInput } from './TestUserInput.js';`.

### `tsconfig.e2e.json` (e2e spec type-checking)

Type-checks `test/e2e/**/*.ts` against the Playwright + Node environment. Not
compiled — Playwright loads specs through its own TS loader at runtime.

---

## 🚀 Running Tests

### Unit tests (fast, no VS Code)

```bash
npm run vitest         # one-shot Vitest and migration skill tests
npm run vitest:coverage # one-shot tests with Vitest coverage
npm run vitest:ui      # Vitest watch UI (excludes migration skill tests)
```

### Migration skill evaluations (Vally)

The [Vally suite](../evals/cosmosdb-relational-migration/) follows the live capability-evaluation approach in
[AzureCosmosDB/cosmosdb-agent-kit#277](https://github.com/AzureCosmosDB/cosmosdb-agent-kit/pull/277).
It supplements, rather than replaces, `npm run test:migration-skill` and the extension's unit and UI tests.

Use the Node.js version in `.nvmrc` and install the pinned development dependencies with `npm ci`.

```bash
# No model calls or credentials required.
npm run eval:lint
npm run eval:test

# Requires Copilot authentication and access to both configured models.
npm run eval
npm run eval -- --tag category=guidance
npm run eval -- --tag category=artifacts --tag phase=preflight
# Check persisted project identity and artifact regeneration for an approved database switch.
npm run eval -- --tag contract=target-switch --max-retries 0
# Focused regressions for implied readiness cycles and unselected implementation mechanisms.
npm run eval -- --tag regression=planning-quality --max-retries 0
# Parser fallback explanations and the actual first-use permission request.
npm run eval -- --tag contract=parser-consent --max-retries 0
# Independent real-sample phases and inference; fetches the pinned application once.
npm run eval -- --tag category=extended --max-retries 0
# Run one phase from reviewed prerequisites, without rerunning earlier phases.
npm run eval -- --tag category=extended --tag phase=provisioning --max-retries 0
# Explicit opt-in: one conversation chaining discovery through planning.
npm run eval -- --tag category=integration --max-retries 0
# Opt-in handoff: fresh conversion, then a separate planning session using those exact outputs.
npm run eval:handoff
# Run the smaller suite without downloading the external sample.
npm run eval -- --tag category!=extended
# Optional model overrides, without changing the committed specs.
npm run eval -- --model <agent-model> --judge-model <judge-model>
```

The suite includes:

- Guidance scenarios for all six phases, parser consent and fallback, source authority, SDK eligibility,
  domain ownership, peer-skill design guidance, approval gates, reruns, project scope,
  historical code-migration completion, and project-local memory.
  Planning regressions cover implementation-versus-production readiness, activation-versus-observation cycles,
  and unresolved service mechanisms being mislabeled as resolved work.
  Parser coverage includes both fallback explanations and presenting the first-use choice with dependency/license
  disclosure, then stopping without selecting or invoking a parser. The headless scenario tests the permission
  request and pause, not a real user-approval round trip or dependency installation.
- An unrelated PostgreSQL prompt that must activate neither migration nor best-practices skills.
- Three artifact-producing scenarios: preflight from supplied synthetic inputs, assessment from a valid
  discovery checkpoint, and a database target switch from a synthetic completed provisioning checkpoint.
  Each trial gets a separate `app` fixture and local copies of both skills.
  A host-side grader plugin reruns trusted migration completion validators, checks source inventory and ownership,
  and rejects source edits, changed predecessor evidence, lost user metadata, and out-of-phase artifacts.
  The model judge also inspects the generated files, not just the agent's completion claim.
  The target-switch case replaces the prose-only identity-preservation check: it verifies the saved project name,
  accepted root/domain models, upstream state and freshness, account coordinates, and reused sample data.
  It requires the approved database in saved state, exact target-dependent artifact regeneration, and incomplete,
  unverified provisioning. Old readback may be removed or retained unchanged as historical evidence, but must not be
  retargeted or refreshed into new verification. The semantic judge checks the decision summary and execution
  boundaries without requiring the final reply to enumerate every preserved field.
- Seven extended AdventureWorks scenarios: independent preflight, discovery, assessment, schema conversion,
  artifact-only provisioning and code-migration planning, plus discovery that infers DDL from the real
  Entity Framework application without receiving the supplied schema.
- An opt-in integration scenario chaining discovery through planning in one conversation. The runner
  excludes it unless `--tag category=integration` explicitly selects it, including on an unfiltered `npm run eval`.
- An opt-in conversion-to-planning handoff, reusing the isolated phase specifications and their current rubrics.
  It runs fresh conversion first, then passes its exact accepted outputs to a new planning session instead of
  substituting the reviewed conversion fixture. It is not included in an unfiltered `npm run eval`.

Every scenario requires completion, correct skill activation, a nonempty answer, and binary correctness
at threshold `1`. Guidance scenarios also require no workspace edits. Offline fake-judge tests exercise
grading and rejection paths; they do **not** establish model quality. Artifact checks validate recorded
contracts and source hashes, not SQL-engine fidelity or real deployment success. No scenario deploys
resources, executes generated seed scripts, rewrites application code, or builds the sample application.

Live runs consume Copilot requests. Authenticate through the Copilot CLI or set `COPILOT_GITHUB_TOKEN`
in your environment; never put tokens in specs or fixtures. Acceptance evaluations use frontier models
to match the recommended migration workflow:

| Suite                                 | Agent           | Judge         | Agent / judge reasoning effort |
| ------------------------------------- | --------------- | ------------- | ------------------------------ |
| Guidance and small artifact scenarios | `gpt-6.1-terra` | `gpt-6.1-sol` | `high` / `high`                |
| Extended AdventureWorks scenarios     | `gpt-6.1-sol`   | `gpt-6-astra` | `high` / `high`                |

Model IDs and reasoning effort are pinned in each spec. Local model access does not establish access for
the Actions job token: confirm both agent and judge access in CI when changing these defaults. Unavailable
models must fail the run rather than silently falling back to a different model.

Vally telemetry is disabled by the npm commands. Trials prohibit deployment, source
database access and dependency installation, and need no Azure credentials or emulator. Local Vally
workspaces are isolated directories, **not an OS security sandbox**; run only trusted skills and fixtures.
The runner rejects `--in-place`. Do not point workspace overrides at a real application.

Reports, trajectories and optional preserved workspaces belong under the ignored `.vally/` directory.
Use `--workspace .vally/workspaces` to retain trial workspaces for diagnosis. Vally retries executor timeouts
and rate limits at most twice; failed correctness verdicts are not retried or relaxed.
The extended CI job disables executor retries to avoid repeating an expensive full migration after a timeout.

The [evaluation workflow](../.github/workflows/migration-evals.yml) runs offline checks when evaluation inputs
change. Automatic live runs require changes under `skills/cosmosdb-relational-migration/` or its required
`skills/cosmosdb-best-practices/` peer; evaluation-only and unrelated changes skip model calls.
Fork and Dependabot PRs are always offline-only. A manual workflow dispatch runs the default suites;
its `integration` input additionally enables the chained scenario, and its independent `handoff` input enables
the conversion-to-planning handoff.
The small and AdventureWorks suites run in independent matrix jobs after offline validation, with fail-fast
disabled so a failed suite cannot cancel or suppress another. Requested integration and handoff each run in their own matrix job.
Each live job uses a job-scoped token with `copilot-requests: write`, publishes its own report summary and retains
suite-named artifacts for 14 days. The aggregate check requires every requested suite to succeed, reports success
for intentional skips and fails for incomplete required jobs.

When adding scenarios, use synthetic inputs, meaningful behavioral rubrics and category/phase tags.
Keep answer keys and executable artifact checks outside agent-visible fixtures. The artifact grader plugin
loads validators from the repository, not from potentially modified copies in the trial workspace.
Extend the offline tests with a passing case and focused malformed-output cases for each new artifact contract.

#### Bounded evidence for isolated AdventureWorks judges

The isolated phase specs use the [bounded judge](../evals/cosmosdb-relational-migration/adventureworks/judge.mjs),
not a full repository snapshot. A host-side builder selects the requested phase's source evidence,
prerequisites and output artifacts and supplies them **inline** to the configured judge. Conversion uses separate
design and execution-boundary packets; planning uses implementation, dependency-ordering and execution-boundary
packets. Other phases retain one complete packet. Every rubric criterion belongs to exactly one scope, and every
scope must pass; missing or duplicate criterion assignments fail before model invocation. The judge runs in
an empty temporary workspace with no readable evidence files, so it need not spend tool calls searching
the repository. Models, reasoning effort, binary threshold and the 120-second response timeout **per call** are unchanged.
Conversion requires two calls and planning three; these are separate assessments, not retries or a vote.
The opt-in chained integration case and smaller suites retain their existing graders.

Each packet is limited to **384,000 UTF-8 bytes**; it is not permission to clip oversized files.
Splitting separates design/source evidence from the execution audit and isolates dependency reasoning over
the complete plan. Boundary packets retain the complete audit; design/implementation packets explicitly state
that it is assessed separately. Shared contextual files are repeated where necessary, not shortened.
Selected text files are complete, JSON is compactly serialized, and the project-state projection explicitly
lists omitted freshness/activity/history fields. Every selected file carries its path, role, original byte
count and SHA-256. The packet also includes the independent structural-validation result, final agent answer,
assistant messages, full command arguments and tool-result success flags. Repeated skill bodies and migration
artifact patch bodies are represented by names/paths and hashes instead of duplicated text. Executable
patches are retained. The packet lists its exclusions; it is not an exhaustive source or execution audit,
and tool success flags alone do not prove shell exit codes.

Single-packet evidence is retained in `metadata.evidence_packet`; scoped evidence uses `metadata.evidence_packets`,
with each scope's assigned rubric indices, complete packet and byte count. `metadata.group_results` records each
response's timing, token usage and scores; `evidence_bytes` is the sum across packets, not a per-packet limit.
This makes the actual judge input auditable
and avoids the pinned Vally repository snapshot's 32 KB per-file truncation and 64,000-character retrieval
budget. It does not expand the agent's permissions or replace independent artifact validation.

All packets are built and bounded before any judge call. Missing, unreadable, unsafe or oversized evidence fails
**before** a model call with `status: error`.
Judge timeouts, malformed/incomplete score sets and an explicit inability to grade also return errors.
A fully graded incorrect output remains a normal failed verdict, not an infrastructure error. Both fail
the strict CI gate; neither silently passes, retries, drops criteria or substitutes a different model.
Review oversized-packet diagnostics and narrow the scenario/evidence design deliberately rather than
truncating evidence to obtain a verdict.

#### Plan dependencies and implementation feasibility

Planning artifact checks require unchecked, pending `CM-` tasks in `Ordered Changes` and optional `OP-` tasks
in `Operational Handoff`. Each task declares one `Depends on:` field with existing task IDs or `none`, and a
`Done when:` condition. Duplicate IDs, unknown prerequisites, self-dependencies, cycles, and code tasks depending
on production handoff tasks fail deterministically. This is an evaluation contract, not a change to the migration
skill or its portable validators.

The judge additionally checks **implied** dependencies: a task cannot require blocker-clearance evidence produced
only by a later task that itself depends on the first. Isolated test-environment setup and implementation
verification must be distinguished from production inventory, deployment and cutover readiness. An acyclic list
of explicit task IDs does not establish a feasible execution order.

Conversion and planning rubrics also distinguish a concrete implementation mechanism from a named future service.
Mandatory supporting components need identified storage/API primitives, ownership, publication/fencing and recovery
behavior, plus verification obligations. Unresolved technology, supplier or protocol choices remain explicit
conditions/blockers, rather than being marked resolved by a promise to implement them. Prohibited execution is not
required during planning: evidence still to collect is different from a mechanism not yet selected.

#### Opt-in conversion-to-planning handoff

`npm run eval:handoff` runs one conversion trial (45-minute budget) followed by one planning trial (20-minute
budget), in separate sessions and workspaces, with zero executor retries. It uses the same pinned agent/judge
models, phase prompts, strict graders, and separate bounded evidence packets as the default isolated suite.
The normal source fetch/cache behavior is unchanged.

Planning starts only after conversion execution and every required grader succeed. The host captures the accepted
application/artifacts before planning; planning must preserve source files, all analytical artifacts, project identity,
phase state and upstream freshness. The plan manifest must reference the exact generated model hash. The baseline
is captured outside the agent workspace for grading and checked again after planning; this is not an OS sandbox.
No reference snapshots are refreshed or promoted automatically.

Each phase retains its ordinary Vally reports and workspace under a unique `handoff-*` result directory.
`handoff.json` records the source model hash, completed phase trial identities and the overall outcome. Failed,
missing, skipped or ungradeable conversion results stop the handoff, never falling back to checked-in conversion.
Use `-- --output-dir <directory>` to choose another result parent. The handoff does not provision, seed, build,
apply the application plan or prove production feasibility. Packet overflow still fails without truncation.

#### Comparing migration models

Use the same judge and reasoning effort for every candidate, keeping fixtures, prompts, rubrics, validators
and thresholds unchanged:

```bash
npm run eval -- --tag category=extended \
  --model gpt-6.1-terra,gpt-6.1-sol --judge-model gpt-6-astra \
  --reasoning-effort high --judge-reasoning-effort high \
  --runs 1 --max-retries 0
```

Vally reports each agent model separately. One trial per scenario is a diagnostic comparison, not a
statistically reliable ranking; use repeated trials before drawing reliability conclusions. Preserve failed
outputs and inspect substantive findings manually. A stronger judge does not replace deterministic checks,
and a passing frontier-model run does not erase a demonstrated omission in another model's output.
With the pinned Vally version, omit `--workspace` for multi-model runs to avoid workspace-path collisions;
configured output artifacts are still retained. To preserve complete workspaces, run each model separately
with a distinct workspace root.

#### AdventureWorks inputs and assertions

The [extended specs](../evals/cosmosdb-relational-migration/adventureworks/eval.yaml) use
[Azure-Samples/AdventureWorks.Web](https://github.com/Azure-Samples/AdventureWorks.Web) at commit
`d548c0ddb3e3a464fa34c1fdc39c2333506b42cc`. The repository is MIT-licensed, archived, and targets
.NET Core 2.1. It is intentionally analyzed as legacy source, not restored, built, or started.
Framework modernization belongs in the generated plan, not in evaluation setup.

The runner fetches that exact commit once into `.vally/fixtures/adventureworks-web/` before starting
matching live stimuli, then copies the checkout into each isolated trial without its Git metadata.
Its license is retained. A cached checkout must have the pinned HEAD and no local changes; mismatches
fail explicitly rather than resetting or overwriting files. Offline lint/tests and filtered runs that
exclude the extended scenarios do not download it. Initial preparation requires Git and GitHub access.

[AdventureworksLT.sql](../evals/cosmosdb-relational-migration/adventureworks/AdventureworksLT.sql) is the
supplied EF-aligned AdventureWorksLT schema export, normalized to LF line endings. It is a versioned test
input, not downloaded from the application's branch or regenerated during CI. The supplied-DDL phases and integration scenario receive it; the inference scenario receives application
code and synthetic workload assumptions.
No database backup, production rows, credentials, or live source database are required.

The host-side [schema contract](../evals/cosmosdb-relational-migration/adventureworks/schema-contract.json)
records reviewed table/column inventories, scalar types and nullability, ordered primary keys, foreign-key
endpoints/delete actions, and separate unique/nonunique indexes. Deterministic
graders compare the agent's evidence with those facts, require read/write evidence from all three CRUD
controllers, check inference provenance, and rerun the portable phase validators. Phase-specific checks
require exact table coverage in assessment/conversion, model-consistent Bicep/seed artifacts during
provisioning, or a valid plan-only manifest during code-migration planning. All phases preserve application/DDL
bytes, user metadata and the planned target. They must not fabricate deployment verification or build results.

The [source-contract checker](../evals/cosmosdb-relational-migration/adventureworks/source-contract.mjs)
normalizes case/whitespace, the fixture's six SQL alias base types, `INTEGER`/`INT` and `NUMERIC`/`DECIMAL`,
and length/precision/scale supplied either in the type string or separate fields. Conflicting representations
fail rather than letting one field override another. Known scalar nullability must be explicit (`nullable`
or `isNullable`); it is not guessed from a missing field. Indexes can be recorded globally or per table,
with `keys`, `columns`, or `keyColumns`, and unique entries can use `uniqueConstraints`. Uniqueness is
never inferred from an `AK_` name. Missing, duplicate, reordered, filtered, combined or invented constraints
fail. In particular, Product Name and ProductNumber remain separate constraints.

Optional `length` and `maxLength` facets may be omitted or `null` when not separately specified.
The required length must still come from the type (including resolved fixture aliases) or a concrete facet:
`varbinary(max)` with `maxLength: null` retains its declared `max`, while bare `varbinary` with only null
facets fails. Every concrete facet must agree with the type and other concrete facets. This does not relax
required nullability, precision/scale, key, or uniqueness evidence.

Source mode is selected by the evaluation scenario, not by an agent-controlled `origin` field:

- **Supplied DDL:** require the recorded delete action for every FK and every declared index, including
  nonunique indexes. An explicit update-action claim must match the source's `NO ACTION` behavior.
- **EF inference:** still require known mapped scalar facts and explicitly mapped indexes. Seven nonunique
  FK-convention indexes are optional because they are not explicitly declared in the pinned EF configuration.
  Physical FK actions may be missing or `unknown`; any concrete database-action claim must agree with the
  mapped relationship. ORM `ClientSetNull` descriptions are not treated as database `SET NULL`.
  `includedColumns: null` records unknown physical index metadata and is accepted only in inference mode;
  it is not normalized into an assertion that the deployed index has no included columns. Concrete included
  columns must still match the fixture, and supplied-DDL grading continues to reject explicit unknown values.
- **Computed columns:** retain their computed nature; allow explicit unknown physical type/nullability
  metadata instead of pretending SQL Server ran. Concrete mapped types are checked against the EF mapping,
  including `LineTotal` precision/scale. Nonblank `computedExpression` and `computedSql` strings are equivalent
  evidence of a computed column, alongside the existing `computed` marker/expression or computed type label.
  Recognizing an expression does not bypass type/nullability checks or independently validate its SQL semantics.

These are deterministic checks of recorded source facts, not a SQL parser or source-engine validation.
Mutation tests cover wrong types, narrowed lengths, precision/scale changes, missing or contradictory
nullability, changed FK actions, lost uniqueness and fabricated email uniqueness. The oracle is reviewed
against the versioned DDL and pinned EF source, not generated from the answer under evaluation.
Target-side collation equivalence, global-versus-partition uniqueness and application enforcement designs
remain the bounded judge's responsibility; matching source index metadata does not prove target preservation.

The synthetic workload is table-specific: one BuildVersion row with zero growth, 50 categories, 250 models,
1,000 products, 10,000 order headers and 40,000 details, with different sizes, growth and busy-window rates.
These are illustrative fixture assumptions, **not counts measured from AdventureWorks**. Sizes use decimal KB
(1,000 bytes); TPS is not a continuous duty cycle or a basis for deriving net inserts. The aggregate order ratio
is not a maximum number of children per order. Snapshot volumetrics and domain/root payload examples are reconciled
with the same profile. A separate `workload-contradiction` guidance case keeps the impossible 1,000-row TINYINT-key
example out of the default artifact inputs and checks that the agent flags it without silently inventing a replacement.

The model judge covers semantic details without a fixed container layout: case-insensitive uniqueness,
composite relationships, cascade behavior, self-reference, sequence-generated IDs, exact financial/computed
values, XML/binary preservation, modernization and rollback. Workload numbers and source collation are
explicit synthetic planning assumptions, not facts measured from the sample. Passing these checks does
not prove source-engine validity, production performance, successful deployment or executable migrated code.

Each isolated phase gets a fresh session, separate workspace, timeout, grading verdict and artifact export.
The budget is 20 minutes per trial, except schema conversion at 45 minutes. A failed phase does not prevent
other independent phase trials from running; there is no shared conversation deadline.
The opt-in integration scenario retains its 60-minute shared deadline.
CI runs the independent phases separately from the smaller live suite under the same skill-change/trusted-PR gate.
Each suite has its own 150-minute job limit, including the optional integration suite; there is no shared CI deadline.
Changes to the sample pin, DDL or graders alone still receive offline checks only, so use a manual dispatch to evaluate those changes.
When updating the pin or DDL, review the independent contract and semantic rubrics rather than regenerating
expected answers from the agent's output.

#### Prerequisite fixtures and phase boundaries

The [versioned checkpoint snapshots](../evals/cosmosdb-relational-migration/adventureworks/checkpoints/README.md)
contain reviewed analytical artifacts, project-state projections and integrity metadata. Discovery starts
from preflight; assessment from discovery; conversion from assessment; provisioning and planning from
conversion. Planning does not need a deployed target or provisioning completion. Preflight starts from
the raw supplied inputs; inference discovery still performs its necessary preflight work itself.

Only predecessor snapshots are staged for a trial: conversion never sees the reference converted model,
and provisioning/planning never see reference outputs for their own phase. Setup checks the pinned source
revision, schema/workload hashes and fixture file hashes, reconstructs workspace-local freshness, and
validates every prerequisite before the agent starts. This fixture-only initialization does not permit
the agent to rebaseline stale evidence. Grading rejects changed predecessor files/state, future-phase
completion and artifacts outside the requested phase. Snapshots are never refreshed from current run outputs.

The agent can use installed shell tools to process inputs, including Node.js or Python for bounded JSON/log
aggregation. These scenarios explicitly select model-only DDL interpretation, so Python/SQLGlot or custom
parser scripts must not be used to interpret DDL. They also forbid dependency installation, application
execution and external-resource calls. The workload fixture contains estimates, not generated database rows.
Shell access is a capability, not a sandbox guarantee or permission to ignore those restrictions.

### Integration tests (slow, real VS Code)

```bash
npm test
```

Equivalent to:

```bash
npm run pretest        # rimraf out && tsc -p tsconfig.test.json + write out/package.json
node scripts/run-integration-tests.mjs
```

The script:

1. Downloads VS Code stable into `.vscode-test/`.
2. Installs `ms-azuretools.vscode-azureresourcegroups` into that VS Code copy.
3. Launches the Extension Host with `extensionTestsPath: out/test/index.js`.
4. `out/test/index.js` globs `out/test/**/*.test.js` and runs them via
   `@vitest/runner.startTests()`.
5. Exits with non-zero status if any test fails.

### Shell MCP integration

Prerequisites: npm dependencies and an existing Cosmos DB Shell installation on `PATH`. No Azure account,
database connection, emulator, or VS Code instance is required.

```bash
npm run test:shell-mcp
```

This command never installs or updates the Shell locally. It starts the existing executable on a dynamically
allocated loopback port, waits for a successful MCP identity probe, and stops its process after the tests.
Cleanup sends `exit` through the owned process's stdin pipe; `exit` is restricted to interactive use and
cannot be invoked through MCP. If the process remains alive after two seconds, cleanup logs a warning and
sends `SIGKILL`. The process must exit within five seconds; otherwise cleanup fails. An externally supplied
server is never stopped. This avoids waiting indefinitely for `SIGTERM`, which did not stop the Shell in Linux CI.
The tests cover Streamable HTTP initialization, server identity, ping, tool discovery and input schemas,
a structured `version` tool result reporting MCP enabled on the selected port, and the extension's MCP resolver
reusing the server.
The resolver uses the mocked VS Code API; the Shell process, HTTP transport, and MCP client are real.

To select a particular local installation in PowerShell:

```powershell
$env:COSMOSDB_SHELL_MCP_TEST_PATH = 'C:\tools\cosmosdbshell.exe'
npm run test:shell-mcp
```

Alternatively, set `COSMOSDB_SHELL_MCP_TEST_PORT` to reuse an already running Shell MCP server.
In that mode the tests do not start or stop the server. Each client session is terminated after its test.
For an owned process, client transports are closed after each test and stopping the Shell releases its server sessions.
The live tests are skipped during ordinary unit-test runs unless this port is set.

Older Shell previews may not support tool execution with redirected terminal streams. Such a version fails
the live tool-call test with the Shell's actual error; use `COSMOSDB_SHELL_MCP_TEST_PATH` to select a newer
existing installation. The test never upgrades it automatically.

The **Tests** CI workflow installs .NET 10 and the latest `CosmosDBShell` preview with
`dotnet tool install CosmosDBShell --prerelease --tool-path ...` into the runner's temporary directory,
then runs the same command with `COSMOSDB_SHELL_MCP_TEST_PATH` pointing to that isolated installation.

### Testing proxy routing locally

Prerequisites: the project's npm dependencies and **OpenSSL** on `PATH`. No Azure account or Docker emulator
is required. The VS Code runtime must support Node's `tls.setDefaultCACertificates` API.

```bash
npm run test:proxy
```

The [launcher](../scripts/test-proxy.mjs) downloads stable VS Code through `@vscode/test-electron`.
To use an installed or cached editor instead:

```bash
npm run test:proxy -- "/absolute/path/to/editor-executable"
```

The launcher creates isolated VS Code profiles, local proxy/HTTPS servers, and temporary test certificates,
then removes them afterward. It does not change your normal VS Code settings or install certificates in the
system trust store. The tests exercise the Cosmos SDK and HTTP adapter, not the complete extension UI.

Coverage includes proxy-support modes, settings and environment variables, bypass rules, emulator connections,
and TLS validation. Proxy authentication, PAC, and remote extension hosts are not covered.

These tests also run as part of `npm run e2e` and the **E2E Tests** CI workflow. The
[proxy spec](../test/e2e/specs/proxy.spec.ts) reuses the executable downloaded by E2E setup, keeps its profiles
separate from the webview tests, and attaches launcher output to the Playwright report.

### End-to-end tests (slow, real VS Code + Docker emulator)

Prerequisite: **Docker Desktop running**. The suite brings up its own emulator
container (`docker compose -f docker-compose.e2e.yml -p cosmosdb-e2e up -d`)
on ports `8082` / `1235`, so the developer's local emulator on `8081` is
untouched.

Both `docker-compose.yml` (local development and NoSQL integration CI) and `docker-compose.e2e.yml` pin the emulator
to `vnext-EN20260907` using a multi-architecture manifest digest (Linux amd64 and arm64).
The floating `vnext-preview` image published on 2026-10-08 returns undefined for UDF calls instead of rejecting
an unregistered UDF, breaking the negative integration fixture I-07. The pin keeps that assertion intact.
Update all three image references together, and run the NoSQL integration suite and E2E suite before accepting
a new digest. Changes to `docker-compose.yml` trigger the NoSQL integration workflow.

```bash
npm run e2e            # full suite — globalSetup brings up + seeds the emulator
npm run e2e:ui         # Playwright UI mode (pick & rerun specs interactively)
npm run e2e:debug      # Playwright inspector / step-through debugger
```

Manual emulator control (useful when iterating on a single spec):

```bash
npm run e2e:emulator:up      # docker compose up -d
npm run e2e:emulator:seed    # node scripts/import-seed.mjs against the e2e port
npm run e2e:emulator:down    # docker compose down --volumes --remove-orphans
```

The runner (`test/e2e/setup/globalSetup.ts`) also performs a **build freshness
check**: if `dist/main.mjs` or `dist/package.json` is older than any source
file or `package.json`, it triggers `npm run vite-prod` automatically. Set
`COSMOSDB_E2E_SKIP_BUILD=1` to opt out (CI does this because it builds in a
dedicated step). Set `COSMOSDB_E2E_SKIP_EMULATOR=1` to skip Docker entirely
(useful for pure-webview smoke tests that don't need a live backend).

See [`test/e2e/README.md`](../test/e2e/README.md) for the full architecture
(activation handshake, worker fixtures, env-var contract, webview iframe
matching, CodeQL-clean TLS handling, etc.).

---

## ✍️ Writing Tests

### Unit test (`src/utils/myFeature.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { myFunction } from './myFeature';

describe('myFunction', () => {
    it('doubles the input', () => {
        expect(myFunction(42)).toBe(84);
    });
});
```

### Integration test (`test/myIntegration.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

describe('My extension command', () => {
    it('is registered after activation', async () => {
        const cmds = await vscode.commands.getCommands(true);
        expect(cmds).toContain('cosmosDB.newConnection');
    });
});
```

### E2E test (`test/e2e/specs/myFeature.spec.ts`)

```ts
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { attachEmulator, openQueryEditor } from '../fixtures/webviews';

test.describe('Query editor against the e2e emulator', () => {
    test.afterEach(async ({ vscodeWindow }) => {
        await closeAllEditorTabs(vscodeWindow);
    });

    test('runs the default SELECT and returns seeded docs', async ({ vscodeWindow }) => {
        await attachEmulator(vscodeWindow);
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
        await webview.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(webview.getByText('prod-00000')).toBeVisible({ timeout: 30_000 });
    });
});
```

Use the `vscodeWindow` fixture (worker-scoped Playwright `Page` pointing at
the real VS Code window) and the helpers under `test/e2e/fixtures/`. Do
**not** import from `src/` — e2e specs run against the bundled `dist/`.

---

## 🧩 Architectural Notes

### Why a custom `@vitest/runner` entry instead of `startVitest()` ?

The full `startVitest()` (the Vitest Node API) spins up a Vite dev server and a worker
pool — neither is wanted when we're already running inside Electron. `@vitest/runner` is
the headless test-collection/execution core: it accepts a tiny `VitestRunner` object
that only needs an `importFile(filepath)` method, then drives `describe/it/beforeAll/…`
exactly as Vitest does internally. About 80 lines of glue gives us the full Vitest API
inside the extension host with zero extra processes.

### Why drop `@vscode/test-cli` ?

`@vscode/test-cli` is a thin wrapper around `@vscode/test-electron` that bakes in Mocha.
Since we no longer use Mocha, we call `@vscode/test-electron` directly from
`scripts/run-integration-tests.mjs` (~60 LOC). That keeps download/install behaviour
identical to what we had before.

---

## 🔍 Troubleshooting

### "Cannot find name 'describe'" in a test file

- Make sure `import { describe, it, expect } from 'vitest';` is present at the top.
- For integration tests, verify the file is under `test/**/*.test.ts`.
- For unit tests, verify the file is under `src/**/*.test.ts` or
  `packages/*/src/**/*.test.ts`.

### "ERR_MODULE_NOT_FOUND" when running `npm test`

You probably wrote `import { Foo } from './foo';` in a `test/` file. Node ESM
(`NodeNext`) requires explicit `.js` extensions on relative imports — write
`import { Foo } from './foo.js';` instead. TypeScript accepts the `.js` extension and
maps it back to `.ts` during compilation.

### Integration test cannot see something from `src/`

By design — integration tests must use the extension's public API. If you need a
shared helper, put it inside `test/` (and add the `.js` extension on its imports).

### E2E test fails with `Menu item references a command … which is not defined`

`dist/package.json` is stale relative to your source changes. The
`globalSetup.ts` freshness check normally catches this and rebuilds, but if you
set `COSMOSDB_E2E_SKIP_BUILD=1`, run `npm run vite-prod` manually first.

### E2E test cannot reach the emulator (`ECONNREFUSED 127.0.0.1:8081`)

The vnext-preview emulator advertises its writable region as `127.0.0.1:8081`
(the in-container port we do **not** expose on the host). The SDK switches to
it unless `enableEndpointDiscovery: false` is set in the connection policy.
The e2e helpers and the extension's `getCosmosClient.ts` already pin the
endpoint; if you call the SDK directly from a spec, add the same option.

### E2E test fails with `Cosmos DB emulator … did not become ready within …`

Docker Desktop isn't running, or the e2e emulator container hasn't started
yet. Verify with `docker ps --filter name=cosmosdb-e2e` and check the logs
via `docker logs cosmosdb-e2e-cosmosdb-emulator-1`. First cold start of
vnext-preview can take ~90 s — the readiness probe waits up to 3 min.
