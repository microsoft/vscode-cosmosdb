# Test Configuration Documentation

This project uses **two test frameworks**:

- **Vitest** — unit tests (Node, mocked `vscode`) and integration tests
  (real `vscode` API inside the Extension Host).
- **Playwright** — end-to-end tests that drive the React webviews inside a
  real downloaded VS Code instance, against a Cosmos DB emulator in Docker.

## 📋 Test Structure Overview

```
vscode-cosmosdb/
├── src/                          # Source code
│   └── **/*.test.ts              # Vitest unit tests (run in Node, vscode is mocked)
├── packages/*/src/
│   └── **/*.test.ts              # Vitest unit tests for workspace packages
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

- **One framework** — `vitest` everywhere.
- **One API** — `import { describe, it, expect, beforeAll } from 'vitest';`
- **Same speed** for unit tests — they don't pay the Electron launch cost.
- **Real `vscode` module** for integration tests — they run inside Electron.

### Unit tests (`src/**/*.test.ts`, `packages/*/src/**/*.test.ts`)

- Fast, isolated, no VS Code needed.
- `vscode` is aliased to `src/__mocks__/vscode.ts` (provided by `jest-mock-vscode`).
- Run with `npm run vitest`.

### Integration tests (`test/**/*.test.ts`)

- Run inside the real VS Code Extension Host via `@vscode/test-electron`.
- `vscode` is the **real** module — call commands, inspect the workbench, activate the
  extension under test.
- Tests must depend only on the public extension surface (`vscode` API, registered
  commands, contributed configuration, etc.) — they do **not** import from `src/`
  because the source is bundled by Vite into `dist/main.mjs` and lives in a different
  module instance than the compiled test code.
- Run with `npm test`.

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
npm run vitest         # one-shot
npm run vitest:ui      # watch with UI
```

### NL2Query generation and explanation evaluations (Vally)

The [NL2Query evaluation spec](../evals/nl2query/eval.yaml) uses
[Vally](https://aka.ms/vally) and the Copilot SDK executor to evaluate query generation using the shipped
[NoSQL query-generation skill](../skills/cosmosdb-nosql-query-generation/SKILL.md), and query explanation without
requiring that skill.
It runs four prompts against a shared synthetic product schema:

- Return complete products priced strictly above 100, sorted by ascending price.
- Return a scalar count of products whose `inStock` property is `true`.
- Explain the complete-document projection, exclusive price boundary, and ascending ordering of the filter query.
- Explain a selected in-stock count query, including its scalar result and zero-match behavior, without confusing
  it with the unselected price query in the editor.

This is a **headless generation and explanation evaluation**, not an end-to-end test of the editor buttons.
It does not import or execute the extension's NL2Query implementation. It does not cover editor context resolution,
schema sampling, applying queries, or executing queries.
The explain prompts supply synthetic `currentQuery`, `selectedQuery`, and `activeQuery` fields in place of a live
context-tool response, following the Explain Query flow's instruction to explain `activeQuery`.
No Azure credentials, Cosmos DB account, emulator, or real customer data are needed.
Each trial receives the synthetic schema in a temporary workspace. Only generation trials load and require the
query-generation skill. Explanation trials evaluate the answer's semantics and session completion, not skill usage.

Install the repository dependencies with `npm install`. Static validation and grader tests run offline:

```bash
npm run eval:nl2query:lint
npm run eval:nl2query:test
```

The grader tests exercise Vally's actual grading pipeline with passing and failing outputs. They cover plain and
fenced queries, malformed or multiple code blocks, wrong comparison boundaries, sort direction, property casing,
scalar-count shape, comments/prose, multiple statements, and missing skill activation or session completion.
These commands do not call a model or require Copilot authentication.
For explanations, offline tests stub the judge's verdict and verify rubric/evidence delivery and pass/fail
aggregation, including passing explanations with no skill activation. They do not validate the judge's semantic
accuracy; that requires a live evaluation.

For a live evaluation including explanations, use `GITHUB_TOKEN` in the process environment so both the agent
and the LLM judge receive authentication. A fine-grained personal access token needs the **Copilot Requests** account permission;
see [Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).
Never put tokens in the spec or commit them. Vally isolates the Copilot configuration home by default, so do not rely
on an editor sign-in or locally saved CLI settings being inherited. Then run:

```bash
npm run eval:nl2query
npm run eval:nl2query -- --model <model-id> --runs 3
npm run eval:nl2query -- --tag feature=explain --judge-model <judge-model-id>
npm run eval:nl2query -- --tag feature=generate
```

**Vally 0.17 judge authentication:** the agent and judge use separate SDK clients. The judge explicitly forwards
`GITHUB_COPILOT_API_TOKEN` (if set) or `GITHUB_TOKEN`, and its restricted `mode: "empty"` disables credential-store
access. `EVALUATE_USE_HOST_COPILOT_HOME=1` changes the agent's configuration isolation, not the judge's restricted mode.
Consequently, a saved CLI login can work for the agent while the judge still reports
`No GitHub OAuth token or Copilot HMAC key provided`. The agent also supports `COPILOT_GITHUB_TOKEN` and `GH_TOKEN`,
but those are not explicitly forwarded as the judge's SDK token in this version.

You can reuse a GitHub CLI OAuth login instead of creating a separate personal access token. In Git Bash,
authenticate with `gh auth login` if needed, then supply its token only to the evaluation process:

```bash
token="$(gh auth token)" &&
  GITHUB_TOKEN="$token" npm run eval:nl2query -- --tag feature=explain
unset token
```

The signed-in account must have Copilot access. Do not echo the token or run these commands with shell tracing enabled.
If `GITHUB_COPILOT_API_TOKEN` is already set, it takes precedence for the judge; remove it from the process environment
if it is not the credential you intend to use.

The spec pins **GPT-5.6 Luna** (`gpt-5.6-luna`) for agent execution and **GPT-5.6 Terra** (`gpt-5.6-terra`) for
LLM judging in both local and CI runs. These provide a lower-cost GPT executor and a mid-range GPT judge rather
than relying on changing runtime defaults. Both models must be enabled by the account or organization's Copilot policy.
See [GitHub's model pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
for current rates. Use `--model` to override the execution model when comparing results.
Live evaluations consume model requests. Generation uses deterministic graders, without a judge model.
Explanation additionally uses Vally's `prompt` LLM grader, so it makes judge-model requests and is not deterministic.
Use `--judge-model` to override the pinned judge model. Model selection does not make live evaluations deterministic.
Every grader must pass, and all trials must complete successfully. Generation trials must additionally activate
the query-generation skill and pass the query-shape checks, which accept keyword casing, whitespace, dot/bracket
property access, and implicit ascending order, but enforce exact schema property casing. These checks cover the
requested simple query forms, not every semantically equivalent SQL rewrite.
Generation accepts plain SQL or exactly one enclosing triple-backtick code block, either unlabeled or labeled `sql`,
with opening and closing fences on their own lines. Surrounding whitespace and LF/CRLF line endings are accepted;
comments, explanatory text, incomplete fences, other language labels, multiple blocks, and extra statements are rejected.
This deliberately tolerates the code-fence wrapper that the editor removes, rather than enforcing the skill's strict
raw-output formatting contract. It does not execute the editor's sanitization code or change the shipped skill.
The raw response remains in Vally's artifacts, and every grader must still pass.

Explanations are judged against per-prompt rubrics with binary scoring and a 100% threshold. They must explain all
required semantics without contradictory statements, invented results, or claims of executing or changing the query.
Equivalent wording and formatting are accepted; explanations do not inherit the generation skill's SQL-only output
contract. A query alone is not a passing explanation.

The run command includes `--require-pass`, so a failed evaluation returns a nonzero exit code.
An error such as `No GitHub OAuth token or Copilot HMAC key provided` means the failing client did not reach its model.
When the error appears under `prompt` after `completed` passes, the agent produced an answer but the judge could not
evaluate it. This is a grading infrastructure error, not a verdict that the explanation is incorrect.
Timestamped results, trajectories, and Markdown reports are saved under the gitignored
`vally-results/nl2query/` directory. The npm commands opt out of Vally usage telemetry; detailed evaluation artifacts
remain local unless uploaded by CI. Live evaluations are separate from the normal unit tests and build workflow.

After fixing judge authentication, re-grade a saved run instead of paying for agent execution again. Replace
`<timestamp>` with the run directory printed by Vally; the original result file is left unchanged:

```bash
token="$(gh auth token)" &&
  GITHUB_TOKEN="$token" VALLY_TELEMETRY_OPTOUT=1 npx --no-install vally grade \
    --eval-spec evals/nl2query/eval.yaml --require-pass \
    < "vally-results/nl2query/<timestamp>/results.jsonl"
unset token
```

Re-grading explanations still consumes judge-model requests. Add `--judge-model <judge-model-id>` if needed.

#### GitHub Actions

The [Evaluations workflow](../.github/workflows/evals.yml) currently runs NL2Query.
Every pull request starts the workflow so the **Evaluations gate** check always reports a result.
A change-detection job compares the PR merge commit with its base-branch parent and runs validation and live
evaluations only when the PR changes any of these inputs:

- `evals/**`: evaluation prompts, rubrics, schema fixtures, and offline grader tests.
- `skills/**`: shipped skills and their supporting files.
- `package.json` and `package-lock.json`: evaluation commands and dependencies.
- `.nvmrc`: the Node runtime version.
- `.github/workflows/evals.yml`: the workflow itself.

Changes only to extension source code or general documentation produce a passing gate without installing
dependencies or calling a model. Deletions and moves out of the watched paths also trigger evaluation.
Pushes to `main` and `rel/*` keep workflow-level path filters for the same inputs; manual runs always evaluate.
Keep the push filters and PR change-detection patterns in sync. Filtering only on `.md` would miss changes to
the YAML prompts/rubrics, JSON schema, and test harness. When adding a suite such as data-modeler, wire its
commands into the validation and live jobs; the directory filters do not automatically discover suites to execute.

- **Relevant pull requests from this repository:** validate the spec, run offline grader tests, then run live evaluations.
- **Relevant pull requests from forks:** run only offline checks, without Copilot permissions or model requests.
- **Pull requests without relevant changes:** skip both validation and live evaluation; the gate passes.
- **Pushes to `main` or `rel/*`:** run those checks, then evaluate all four prompts using Copilot.
- **Manual runs:** use **Actions > Evaluations > Run workflow** to run validation and live evaluation on a selected trusted branch.

Live evaluation is disabled for fork pull requests: agents execute instructions from the checked-out files, and
requests consume organization credits. Maintainers can manually evaluate a reviewed branch in this repository.
Superseded runs for the same branch or pull request are cancelled. Each live run uses one trial per prompt, one worker,
no automatic execution retries, and a 20-minute job timeout.

The **Evaluations gate** job always checks the upstream outcomes. Relevant same-repository PRs require successful
validation and live evaluation; relevant fork PRs require successful validation and a skipped live job.
Change-detection failures, missing decisions, and failed, cancelled, or skipped required jobs fail the gate.
It has no token permissions and does not check out or execute contribution code.

The gate is **advisory until configured as a required status check**. It reports failures normally, but this
workflow does not change repository rules or block merging by itself. To enforce it later, add
**Evaluations gate** to the target branch's required checks in branch protection or a ruleset. Require this
aggregate check, not the conditional **Run evaluations** job or the reporting job. No workflow change is needed
to switch from advisory to required. Under this policy, fork PRs can merge after offline checks without a live run.

To test a workflow change before merging, push it to a branch in this repository with an open pull request.
This triggers a new run using the changed workflow; re-running an older run does not pick up the new revision.
Manual dispatch is also available once the workflow exists on the default branch; select the branch to evaluate
from the **Run workflow** menu. Live evaluation still requires the offline validation job to pass first.

An organization administrator must enable the Copilot policy **Allow use of Copilot CLI billed to the organization**
for the Microsoft organization. GitHub enables this by default when the existing **Copilot CLI** policy is enabled,
but the workflow cannot configure or verify that organization setting. See
[Using Copilot CLI in GitHub Actions with GITHUB_TOKEN](https://docs.github.com/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions).

Only the live job requests `copilot-requests: write`, alongside `contents: read`. It passes the built-in `${{ github.token }}`
as both `COPILOT_GITHUB_TOKEN` for the agent and `GITHUB_TOKEN` for Vally's separate judge. No personal access token,
repository secret, or interactive login is required in Actions. Model usage is billed to the organization; its
Copilot policies, model availability, and budgets still apply.

The validation and live jobs use the repository's Node version and `npm ci`, including the pinned Vally CLI, rather than a global
installation. Skills remain scoped by the evaluation spec; the workflow does not pass a global `--skill-dir`.
Failed verdicts or authentication/grading errors fail the live job through `--require-pass`. Reports and trajectories
from all suites under `vally-results/` are uploaded even after a failed run as `eval-results-<attempt>` artifacts,
retained for 14 days.

A separate reporting job runs after the gate, including when upstream jobs fail or are skipped.
It writes an Actions job summary with the gate, change-detection, and job statuses, the offline check results,
links to the run and artifact,
and the generated Vally Markdown reports when available. Missing or oversized reports are called out explicitly;
the artifact retains the full reports. Fork skips are distinguished from passing live evaluations.
Above the detailed reports, a **Suite scores** table shows Vally's aggregate score, required threshold, and verdict
from the `run-summary` records in the artifact's `results.jsonl` files. Scores are displayed as percentages;
they are not trial pass rates. The verdict is taken from Vally rather than inferred from the rounded score.
Missing, incomplete, or unreadable summaries are reported as unavailable; ungraded suites show `N/A` instead of
an invented score. This is display-only and does not change grading or make additional model requests.

For same-repository pull requests, the reporting job also creates or updates a compact **Evaluations** comment,
identified by `<!-- ci-summary:evals -->`, with statuses and links to the detailed summary and artifact.
Pull requests without relevant changes never create a new comment. If an earlier run already posted one, it is
updated with the passing gate and skip notice so stale evaluation results are not left behind.
Like the other CI workflows, a cancelled run with no completed checks does not overwrite an existing results comment.
Fork pull requests still receive an Actions summary, but no PR comment is attempted with their read-only token.
Only the reporting job requests `pull-requests: write` and `actions: read`; it does not check out or execute
contribution code, and the live agent does not receive comment-write permission. Comment API errors are reported
as warnings without changing the validation or evaluation verdicts.

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
