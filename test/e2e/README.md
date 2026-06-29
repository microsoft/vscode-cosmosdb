# Webview e2e tests (Playwright + real VS Code)

End-to-end tests that drive the React webviews under `src/webviews/` **inside
a real, downloaded VS Code instance**. We do _not_ assert against the VS Code
shell (tree view, status bar, settings UI) — that's the job of the
Extension-Host integration tests next door under
[`test/`](../) (run via `npm run test`).

The scaffold borrows heavily from the sibling `vs-code-postgresql` project's
`test/e2e/` setup. We kept the patterns that pay off immediately and skipped
the ones we don't yet need (multi-editor adapter, reusable auth profile,
@tag-based grep filtering, JUnit reporter).

## How it works

```
Playwright
    │  _electron.launch({ executablePath: <downloaded VS Code> })
    ▼
VS Code (real Electron app)
    │  --extensionDevelopmentPath=dist/  → our extension loads
    │  --extensions-dir=.vscode-test/e2e-extensions  → dependent extensions
    │  --user-data-dir=<worker-scoped temp dir, pre-seeded settings>
    │  <worker-scoped workspace dir>
    ▼
Test opens the command palette, runs a Cosmos DB command, finds the
webview iframe by predicate (NOT by aria-label — outer iframe has none),
asserts the React tree mounted, then closes all tabs in afterEach.
```

### Why real VS Code instead of Chromium

The webview runtime VS Code provides is **not just a browser** — it includes
the `acquireVsCodeApi()` global, a custom CSP, `--vscode-*` CSS variables, the
`l10n_bundle` injection, the postMessage transport, and the Electron version
that ships with the editor. Faking all of that in plain Chromium is brittle
and never quite right; launching the real thing avoids the entire class of
"works in tests, breaks in VS Code" bugs.

### Performance: worker-scoped fixtures

`vscodeApp` and `vscodeWindow` are **worker-scoped** (`{ scope: 'worker' }`),
so VS Code is launched **once per worker** and reused across every test in
that worker. With per-test launch (the naive approach), a 10-test file would
pay ~50 s of startup overhead; with worker scope it's ~5 s total.

The consequence: tests **must reset editor state in their own `afterEach`**.
Use `closeAllEditorTabs(vscodeWindow)` from `fixtures/webviewHelpers.ts`.

## Running

```bash
# Run all e2e specs (auto-builds dist/ if stale, starts the emulator,
# seeds the test DB, runs Playwright, then tears the emulator down)
npm run e2e

# Author / debug
npm run e2e:ui         # Playwright's UI mode — step through tests, time-travel
npm run e2e:debug      # Playwright Inspector — pause + step + REPL at each action
```

> **Auto-build:** `globalSetup` compares mtimes of `package.json` + `src/`
> against `dist/main.mjs` and `dist/package.json` and runs `npm run vite-prod`
> automatically when they're out of sync. Set `COSMOSDB_E2E_SKIP_BUILD=1` to
> bypass the check (useful when iterating on test code only).

> **Heads-up on Electron + "headless":** Electron does NOT support a headless
> mode the way Chromium does — every `_electron.launch()` opens a real OS
> window. There is no `e2e:headed` script because there is no headless mode
> to opt out of. On a developer machine you'll see VS Code briefly appear
> on screen while tests run; that's expected. On Linux CI without a display
> server, prefix the invocation with `xvfb-run` (e.g.
> `xvfb-run --auto-servernum npm run e2e`). Windows/macOS CI runners ship
> with a display, so no wrapper is needed there.

The first run also downloads the `stable` VS Code build into `.vscode-test/`
(via [`@vscode/test-electron`](https://github.com/microsoft/vscode-test)) and
installs `ms-azuretools.vscode-azureresourcegroups` into a dedicated
extensions directory at `.vscode-test/e2e-extensions/`. Both are cached.

## Layout

```
test/e2e/
├── README.md                  — this file
├── setup/
│   ├── globalSetup.ts         — runs once: auto-builds dist/ when stale,
│   │                             downloads VS Code, installs dependent
│   │                             extensions, starts the Cosmos DB emulator +
│   │                             seeds it, writes .vscode-test/e2e-config.json
│   ├── globalTeardown.ts      — stops the emulator, removes the run-scoped
│   │                             temp dir
│   ├── emulator.ts            — docker compose up/down + readiness wait +
│   │                             seed import wrapper
│   └── activation.ts          — pre-test handshake (open Azure sidebar +
│                                wait until the "Cosmos DB Accounts" workspace
│                                tree node appears, proving both extensions
│                                activated). Called once per worker from
│                                fixtures/vscode.ts.
├── helpers/
│   ├── e2eIsolation.ts        — runId + run-scoped temp/results/reports dirs
│   └── workbenchReady.ts      — hardened workbench-readiness wait
├── fixtures/
│   ├── vscode.ts              — worker-scoped vscodeApp + vscodeWindow,
│   │                             seeds settings.json, dismisses native dialogs,
│   │                             copies workspace/ into the worker temp dir,
│   │                             pushes emulator env vars into the launched
│   │                             VS Code process
│   ├── webviewHelpers.ts      — runCommand, getWebviewByPredicate,
│   │                             closeAllEditorTabs
│   └── workspace/             — source-of-truth workspace opened by every
│                                worker (.nosql samples, .vscode/settings.json)
└── specs/
    └── smoke.spec.ts          — opens Migration Assistant, asserts React mount
```

## Cosmos DB emulator

The suite runs against a **dedicated** emulator instance brought up by
`setup/globalSetup.ts` from `docker-compose.e2e.yml`. The compose project is
named `cosmosdb-e2e` and binds to ports **8082 / 1235** instead of the
default 8081 / 1234. This means:

- A developer can keep `npm run docker-up` running on 8081 while iterating;
  the e2e suite won't fight it.
- `docker compose -p cosmosdb-e2e ...` only ever touches our container —
  teardown can't accidentally remove the developer's local data.
- The compose file declares **no volumes** — every test run starts from a
  pristine emulator, and the seed script (`scripts/import-seed.mjs`)
  recreates database + containers + documents on each `up`.

### Coordinates injected into VS Code

`globalSetup` writes the emulator config into `.vscode-test/e2e-config.json`,
which the fixture reads and re-exports as env vars to the launched VS Code:

| Env var                          | Default                  |
| -------------------------------- | ------------------------ |
| `COSMOSDB_E2E_EMULATOR_ENDPOINT` | `https://localhost:8082` |
| `COSMOSDB_E2E_EMULATOR_KEY`      | well-known emulator key  |
| `COSMOSDB_E2E_DATABASE_ID`       | `nosql-test-db`          |
| `COSMOSDB_E2E_CONTAINER_ID`      | `products`               |

The extension trusts the emulator's self-signed certificate via a **scoped**
`https.Agent` (see `src/cosmosdb/getCosmosClient.ts`, gated on
`isEmulator: true`). No process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` is
needed for the test runner or the seed script (both pass a scoped agent
directly to their `CosmosClient`).

The test-only commands registered in `src/commands/e2eTestCommands/` read
these env vars and build a real `NoSqlQueryConnection`:

- **`cosmosDB.e2e.openQueryEditor`** — opens QueryEditor against the seeded
  container.
- **`cosmosDB.e2e.openDocument`** — opens Document tab in `add` mode.
- **`cosmosDB.e2e.attachEmulator`** — pushes an attached-account entry into
  workspace storage so the Cosmos DB Workspaces tree shows the emulator
  without going through the "Attach Database Account" wizard.

Each command also accepts an optional `args: { endpoint, key, databaseId,
containerId }` override so a spec can target other databases without
re-launching VS Code.

### Manual / debug commands

```bash
npm run e2e:emulator:up      # bring the e2e emulator up (no Playwright)
npm run e2e:emulator:seed    # re-seed the test database
npm run e2e:emulator:down    # tear it down
```

### Skip the emulator entirely

Pure-webview smoke specs don't need a live backend. Set
`COSMOSDB_E2E_SKIP_EMULATOR=1` before `npm run e2e` and `globalSetup` will
skip both the docker spawn and the seed import. The fixture also omits the
emulator env vars, so the test-only commands fall back to disconnected
mode (panel mounts, tRPC calls fail through the existing error-toast
pipeline).

## Patterns adopted from `vs-code-postgresql`

1. Import the fixture: `import { expect, test } from '../fixtures/vscode';`
2. Add `test.afterEach(async ({ vscodeWindow }) => closeAllEditorTabs(vscodeWindow))`
   so your test doesn't leak panels into the next.
3. Pick a command from `package.json#contributes.commands` whose label you
   know (look up the `%key%` in `package.nls.json`).
4. `await runCommand(vscodeWindow, 'Cosmos DB: Your Command');`
5. `await getWebviewByPredicate(vscodeWindow, async (frame) => …)` — the
   predicate should assert that something specific to your webview has
   rendered (a button label, a heading). That doubles as a "wait until the
   React app mounted" check.
6. Drive the webview with standard Playwright APIs on the returned `Frame`.

## Controlling window chrome (side bars / panel)

VS Code is reused per worker and the activation handshake opens the Azure side
bar; on a fresh profile the GitHub Copilot Chat secondary side bar can also
auto-pop. Both steal horizontal space and clutter the window screenshots we
attach for webview tests.

Every test gets a **`layout`** option (see `helpers/windowLayout.ts`) that the
auto `windowLayout` fixture enforces before the test body runs. The default
hides the Copilot Chat secondary side bar and the bottom panel; the primary
side bar is left untouched.

```ts
// Default per test (no opt-in needed):
//   { secondarySideBar: false, panel: false }

// Override per file / describe / test. Your object is merged over the
// defaults, so you only restate the parts you want to change — a key you
// pass wins, a key you omit keeps its default (and parts absent from both
// are left untouched):
test.use({ layout: { primarySideBar: false } });           // also hide the tree
test.use({ layout: { secondarySideBar: true } });          // show Copilot Chat
test.use({ layout: { primarySideBar: false, panel: false } });
```

You can also apply a layout inline from within a test (e.g. mid-test):

```ts
import { applyWindowLayout } from '../helpers/windowLayout';

await applyWindowLayout(vscodeWindow, { panel: true });
```

The helper diffs against the live workbench DOM and issues a visibility-toggle
command only when a part isn't already in the desired state, so re-applying the
same layout is a no-op.

## Patterns adopted from `vs-code-postgresql`

| Pattern                                                      | Where                                                          | Why                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker-scoped fixture                                        | `fixtures/vscode.ts`                                           | One VS Code launch per worker → 5–10× faster as the suite grows                                                                             |
| `settings.json` pre-seeding                                  | `seedUserSettings()` in `fixtures/vscode.ts`                   | Disables sticky tree headers, preview tabs, secondary sidebar — kills several classes of flake before they happen                           |
| Per-test window layout (`layout` option)                     | `helpers/windowLayout.ts` + `windowLayout` auto fixture        | Hides Copilot Chat / panel by default for clean screenshots; per-test override of which side bars + panel are visible                       |
| Native dialog auto-dismiss                                   | `disableNativeDialogs()` via `app.evaluate(({ dialog }) => …)` | Save / message dialogs would otherwise block the test forever                                                                               |
| Multi-step workbench-ready wait                              | `helpers/workbenchReady.ts`                                    | Force-shows all Electron windows, dumps diagnostics + screenshot on failure                                                                 |
| `getWebviewByPredicate`                                      | `fixtures/webviewHelpers.ts`                                   | Outer webview iframe has no aria-label/title in current VS Code — iterating frames + predicate matching is more robust than selector chains |
| `closeAllEditorTabs` in `afterEach`                          | `fixtures/webviewHelpers.ts`                                   | Required to make worker-scoped fixtures safe across tests                                                                                   |
| Per-run isolation context (runId, temp/results/reports dirs) | `helpers/e2eIsolation.ts`                                      | Parallel `playwright test` invocations on the same machine don't collide                                                                    |

### Patterns deliberately **not** adopted (yet)

- **Multi-editor adapter** (`editors/vsCodeAdapter.ts` + `cursorAdapter.ts`) —
  we only target VS Code.
- **Reusable user-data-dir** for persisted auth — no Entra-style tests yet.
- **`@smoke` / `@requires-*` tag grep filters** — only one test today.
- **JUnit / GitHub reporters** — wire up when CI exists.

## CI notes

- `forbidOnly: true` is enabled on CI (no `.only` slipping into main).
- `retries: 2` on CI to absorb the occasional VS Code window-creation flake.
- `workers: 1` always — multiple VS Code instances can't share
  `--user-data-dir`. CI can override after the suite grows; every worker
  already gets its own temp subtree via the isolation context.

### Workflow

`.github/workflows/e2e.yml` runs the suite on every PR / push that touches
code that could affect webview behaviour (`src/**`, `test/e2e/**`,
`scripts/import-seed.mjs`, `docker-compose.e2e.yml`, `package.json`,
`playwright.config.ts`). Path-filtered to keep CI cost low on unrelated
commits. Manual `workflow_dispatch` is also available.

On Linux runners the steps are:

1. `npm ci`
2. `npx playwright install-deps chromium` — provides the GTK/NSS shared
   libs the downloaded VS Code Electron build needs.
3. `npm run vite-prod` — explicit build so failures surface separately
   from test failures. `COSMOSDB_E2E_SKIP_BUILD=1` is then set so
   `globalSetup` doesn't re-walk `src/` for the freshness check.
4. `xvfb-run -a npm run e2e` — mandatory wrapper, Electron has no real
   headless mode.

On failure, three artifacts are uploaded for post-mortem:

- `e2e-html-report-<attempt>` — Playwright HTML report (test list, traces,
  screenshots, video links).
- `e2e-results-<attempt>` — raw traces / videos / `error-context.md` files.
- `e2e-emulator-logs-<attempt>` — `docker logs` of the e2e emulator
  container (helps when readiness or seed timed out).
