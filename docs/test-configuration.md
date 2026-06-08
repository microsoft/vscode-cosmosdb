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
