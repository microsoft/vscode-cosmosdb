# Test Configuration Documentation

This project uses **a single test framework — Vitest** — for both unit and integration tests.

## 📋 Test Structure Overview

```
vscode-cosmosdb/
├── src/                          # Source code
│   └── **/*.test.ts              # Vitest unit tests (run in Node, vscode is mocked)
├── packages/*/src/
│   └── **/*.test.ts              # Vitest unit tests for workspace packages
├── test/                         # Integration tests
│   ├── index.ts                  # Custom @vitest/runner entry executed inside VS Code
│   └── **/*.test.ts              # Vitest integration tests (real vscode API)
├── scripts/
│   └── run-integration-tests.mjs # Downloads VS Code + launches the integration host
├── tsconfig.json                 # Main TS config (src only)
├── tsconfig.vitest.json          # Type-check unit tests
└── tsconfig.test.json            # Compile integration tests (ESM)
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
