# Plan: Split `dev/dshilov/official-ast-parser` into independent PRs

> Source PRD: [`plans/split-pr-prd.md`](./split-pr-prd.md)

## Architectural decisions

Decisions that are fixed and apply to every phase:

- **Branch strategy**: every PR branch is cut from `main` (or from the immediate blocker branch while waiting). Rebase onto `main` after each merge.
- **Package naming**: `@cosmosdb/nosql-language-service`, `@cosmosdb/schema-analyzer` — names already chosen in the branch.
- **Workspace protocol**: packages reference each other (and the root references them) via `workspace:*`; resolved to real semver on publish.
- **Test runner**: vitest for packages, existing jest/vitest for extension — does not change.
- **Commit convention**: Conventional Commits (`feat:`, `refactor:`, `build:`, `chore:`).
- **CI acceptance**: every PR branch must be green on the GitHub Actions workflow `Node PR Lint, Build and Test` before merge.
- **Localization**: only PRs that touch user-visible strings run `pnpm run l10n`.

---

## Phase 0 — Drop packages into main (zero blast radius)

**PR: `chore: add packages/ directories as-is (excluded from lint)`**

**User stories**: #3 (reviewer reads new files at own pace without integration risk)

### What to build

Cherry-pick or copy `packages/nosql-language-service/` and `packages/schema-analyzer/` from the branch into `main` verbatim. The two directories are entirely new — nothing in `src/` changes, nothing imports from them. Add a lint-ignore glob so ESLint skips `packages/**` and CI stays green. That's it.

This phase exists for one reason: get the heaviest review burden (~265 new files) out of the way under the safest possible conditions. Reviewers can read the packages at leisure, leave comments, and approve before any integration work starts.

### Acceptance criteria

- [ ] `packages/nosql-language-service/` exists in `main` identical to the branch
- [ ] `packages/schema-analyzer/` exists in `main` identical to the branch
- [ ] `eslint.config.mjs` (or equivalent) contains an ignore entry for `packages/**`
- [ ] Root `tsconfig.json` does **not** include `packages/*/src` in its compilation (no compile errors introduced)
- [ ] `pnpm run build` passes — extension output is unchanged
- [ ] `pnpm run lint` passes — no new errors
- [ ] Existing tests pass (`pnpm test`)
- [ ] No changes to anything under `src/`

---

## Phase 1 — npm → pnpm + monorepo wiring

**PR: `chore: npm → pnpm + monorepo workspace setup`**

**User stories**: #6 (monorepo lands after packages are in main, PR is small), #9 (risky infra change isolated)

### What to build

Convert the repo from npm to pnpm and wire the two packages (already in `packages/`) as proper workspace members. Remove the lint-exclusion added in Phase 0 — packages are now first-class workspace packages and linted along with the extension. Update CI to use `pnpm`.

This is the only PR that touches `package.json`, `pnpm-workspace.yaml`, `.npmrc`, and CI workflow files for the package manager migration.

### Acceptance criteria

- [ ] `pnpm-workspace.yaml` lists `packages/*`
- [ ] `.npmrc` is present and contains `shamefully-hoist=false` (strict isolation) or equivalent
- [ ] `packages/nosql-language-service/package.json` and `packages/schema-analyzer/package.json` contain correct `name`, `version`, `main`/`exports` fields
- [ ] Root `package.json` has `"preinstall": "npx only-allow pnpm"` (or equivalent)
- [ ] `pnpm-lock.yaml` is committed; `package-lock.json` is removed
- [ ] Lint-exclusion glob for `packages/**` is **removed** from `eslint.config.mjs`
- [ ] CI workflow uses `pnpm install` and `pnpm run …`
- [ ] `pnpm run lint` passes across the full monorepo (both packages + extension)
- [ ] `pnpm run build` passes
- [ ] `pnpm --filter @cosmosdb/nosql-language-service run test` passes
- [ ] `pnpm --filter @cosmosdb/schema-analyzer run test` passes
- [ ] Extension tests pass (`pnpm test`)

---

## Phase 2a — Integrate packages into the extension

These two PRs can be opened and reviewed in parallel but each depends on Phase 1.

---

### PR 2a-1: `feat: integrate @cosmosdb/nosql-language-service into the extension`

**User stories**: #1 (single concern), #2 (CI green), #7 (infrastructure separated from feature)

#### What to build

Add `@cosmosdb/nosql-language-service` as a `workspace:*` dependency of the root extension package. Swap out the ad-hoc language code under `src/cosmosdb/language/` for calls to the package's public API. Delete the now-redundant source files. Update TypeScript path aliases.

Reviewers only verify the API boundary — the package internals were already approved in Phase 0.

#### Acceptance criteria

- [ ] Root `package.json` declares `"@cosmosdb/nosql-language-service": "workspace:*"`
- [ ] `tsconfig.json` (or `tsconfig.base.json`) contains a `paths` alias resolving `@cosmosdb/nosql-language-service` to `packages/nosql-language-service/src/index.ts`
- [ ] All files under `src/cosmosdb/language/` that duplicate package code are deleted
- [ ] No `import … from '../../../packages/nosql-language-service/src/…'` — only `import … from '@cosmosdb/nosql-language-service'`
- [ ] `pnpm run build` passes
- [ ] `pnpm run lint` passes
- [ ] Extension language feature tests pass

---

### PR 2a-2: `feat: integrate @cosmosdb/schema-analyzer into the extension`

**User stories**: #1, #2

#### What to build

Same pattern as PR 2a-1 but for `schema-analyzer`. Add as workspace dependency, replace inline BSON/JSON schema logic in `src/utils/json/` with calls to the package public API, delete duplicates.

#### Acceptance criteria

- [ ] Root `package.json` declares `"@cosmosdb/schema-analyzer": "workspace:*"`
- [ ] `tsconfig.json` contains a `paths` alias for `@cosmosdb/schema-analyzer`
- [ ] Duplicate files under `src/utils/json/` are deleted
- [ ] `pnpm run build` passes
- [ ] `pnpm run lint` passes
- [ ] Existing schema-related tests pass

---

## Phase 2b — Webpack → Vite (sequential, parallel with 2a)

Three sequential PRs. Can be reviewed while Phase 2a is in progress.

---

### PR 2b-1: `build: migrate webpack configs to ESM (.mjs)`

**User stories**: #9 (risky build change isolated), #5 (further Vite split)

#### What to build

Convert both webpack config files from CJS `.js` to ESM `.mjs`. Update `package.json` to `"type": "module"` and `"main": "./main.mjs"`. Rename `main.js → main.ts`. Fix the handful of files that use `import vscode from 'vscode'` (returns `undefined` in ESM) to `import * as vscode`. Add an ESLint rule to catch this class of mistake going forward.

Webpack is still the default build and F5 path — no observable change to DX.

#### Acceptance criteria

- [ ] `webpack.config.ext.mjs` and `webpack.config.views.mjs` exist; `.js` variants deleted
- [ ] `package.json`: `"type": "module"`, `"main": "./main.mjs"` (or `"./out/main.js"` as appropriate)
- [ ] `main.ts` entry point compiles without errors
- [ ] No `import vscode from 'vscode'` default imports remain in `src/`
- [ ] ESLint `no-restricted-syntax` rule fires on `import vscode from 'vscode'`
- [ ] `pnpm run build` (webpack) passes
- [ ] Extension smoke-test (F5 launch) works

---

### PR 2b-2: `build: add Vite 8 configs alongside Webpack (zero-risk benchmark)`

**User stories**: #5 (additive before switch-default), #9

#### What to build

Add `vite.config.ext.mjs` and `vite.config.views.mjs`. Register `vite-dev`, `vite-prod`, `vite-watch` scripts in `package.json` alongside the existing `webpack-*` scripts. Add the `createRequire` banner that makes CJS `require()` calls work inside ESM Rolldown output.

Webpack remains the default **everywhere** — CI, F5 (`Watch` task), `pnpm run package`. This PR is purely additive.

#### Acceptance criteria

- [ ] `vite.config.ext.mjs` and `vite.config.views.mjs` exist
- [ ] `pnpm run vite-prod` produces a working extension bundle
- [ ] `pnpm run vite-dev` compiles without errors
- [ ] Default `Watch` task in `.vscode/tasks.json` still points to webpack
- [ ] CI workflow still uses `webpack-prod` (or equivalent default)
- [ ] `pnpm run build` (webpack path) unchanged and passes

---

### PR 2b-3: `build: switch default dev + CI to Vite, remove Webpack`

**User stories**: #9 (isolated so it can be reverted), #8 (risky change alone)

#### What to build

Flip the default: `.vscode/tasks.json` `Watch` → Vite, `.vscode/launch.json` `outFiles` → `*.mjs`, `scripts/package-vsix.mjs` → `vite-prod`, CI workflow → Vite. Add background problem-matcher patterns so F5 waits for Vite's "built in" signal before attaching the debugger. Rename old webpack tasks to `(webpack)` variants (kept for escape hatch). Delete webpack config files.

This is the highest-risk PR in the plan. It is isolated precisely so it can be reverted with a single `git revert` without touching any feature code.

#### Acceptance criteria

- [ ] F5 (`Launch Extension`) uses Vite output (`*.mjs`)
- [ ] Background problem-matcher waits for `built in` before attaching debugger
- [ ] CI `Node PR Lint, Build and Test` uses `pnpm run vite-prod` (or `package` → Vite)
- [ ] `webpack.config.ext.mjs` and `webpack.config.views.mjs` are deleted
- [ ] `webpack-*` npm scripts are removed from `package.json`
- [ ] Extension loads and activates correctly under Vite output
- [ ] `pnpm run build` default is Vite and passes

---

## Phase 3 — Code quality (fully parallel, can start after Phase 0)

Three independent PRs with no ordering dependency on each other or on Phases 2a/2b.

---

### PR 3-1: `chore: reconfigure ESLint + add Oxlint, fix lint errors`

**User stories**: #1, #2

#### What to build

Update `eslint.config.mjs` to reference the new `tsconfig.eslint.json`. Add/update `.oxlintrc.json` for Oxlint v1.61.0. Fix the 68+ lint errors this surfaces in the existing codebase. Add `no-restricted-syntax` rule for `import vscode from 'vscode'`.

#### Acceptance criteria

- [ ] `pnpm run lint` exits 0 with 0 errors and 0 warnings
- [ ] `.oxlintrc.json` is valid and targets the correct rule set
- [ ] `tsconfig.eslint.json` covers all source files (ext + webviews)
- [ ] No new `// eslint-disable` comments added unless explicitly justified

---

### PR 3-2: `refactor(ext): replace ext namespace with ExtensionService class`

**User stories**: #1, #7

#### What to build

Replace the `ext` TypeScript namespace in `extensionVariables.ts` with an `ExtensionService` class. Getters for required values throw on first read if not initialized; setters throw on second write. `isAIFeaturesEnabled` stays an ordinary mutable property. Update every call site in `src/`.

This is pure refactor — no observable behavior changes.

#### Acceptance criteria

- [ ] `extensionVariables.ts` exports `ExtensionService` class (no `namespace ext`)
- [ ] `ext.context`, `ext.outputChannel`, etc. accessed via `ExtensionService.instance.context` (or chosen API shape)
- [ ] `required<T>()` getter throws `Error` if backing field is `undefined`
- [ ] `required<T>()` setter throws `Error` on second call
- [ ] `settingsKeys` is an `as const` object, not a nested namespace
- [ ] `pnpm run build` passes (Oxc / tsc — no `export let` in namespace errors)
- [ ] Extension activates and deactivates cleanly in smoke test

---

### PR 3-3: `chore: update dependencies, fix version pins`

**User stories**: #11

#### What to build

Bump `package.json` dependencies to current versions. Fix `jest-mock-vscode` specifier (`~` → `^`). Align `jest.config.js`/`tsconfig.jest.json` with `pnpm-lock.yaml`.

#### Acceptance criteria

- [ ] No `~` specifiers for packages that publish breaking patches
- [ ] `pnpm install` produces no warnings about mismatched specifiers
- [ ] All tests pass after the bump
- [ ] `pnpm audit` reports no high/critical CVEs introduced by the bump

---

## Phase 4 — Feature PRs (depend on Phase 2a PR1)

---

### PR 4-1: `feat: tRPC communication layer + query editor modernisation`

**User stories**: #1, #2, #8

#### What to build

Wire up `tRPC` as the RPC layer between the extension host (`src/panels/trpc/`) and the webview (`src/webviews/api/trpc/`). Implement query block tracking in `QueryMonaco` (each separated query block can be run independently). Add schema merging from `SELECT *` result sets. Clean up `confirmToolInvocation` handling.

Depends on `@cosmosdb/nosql-language-service` being available as a workspace package (Phase 2a PR1).

#### Acceptance criteria

- [ ] `src/panels/trpc/appRouter.ts` defines the typed tRPC router
- [ ] `src/webviews/api/trpc/useTrpcClient.ts` connects to the VS Code message transport
- [ ] Multi-query blocks in the Monaco editor are correctly detected and individually executable
- [ ] Schema from `SELECT *` is merged into completion context
- [ ] `chatUtils.test.ts`, `deployLLMInstructionsFiles.test.ts`, `copilotUtils.test.ts` pass
- [ ] `pnpm run build` passes; `pnpm run lint` passes

---

### PR 4-2: `refactor(tests): migrate to co-located test files in packages`

**User stories**: #10

#### What to build

Move test files that currently live in the top-level `test/` directory into the appropriate `packages/*/src/` directory alongside the source they test. Update `tsconfig.test.json`, `vitest.config.ts`, and `.vscode-test.mjs` to reflect the new locations.

**Zero logic changes** — pure file moves and import path updates only.

#### Acceptance criteria

- [ ] No test files remain in `test/` that belong to a package
- [ ] `pnpm --filter @cosmosdb/nosql-language-service run test` passes with co-located files
- [ ] `pnpm --filter @cosmosdb/schema-analyzer run test` passes
- [ ] Root `pnpm test` still passes (extension-level tests)
- [ ] No test contains changed assertions or logic — diff is moves only
- [ ] `.vscode-test.mjs` glob patterns updated

---

### PR 4-3: `feat(nosql-language-service): official AST parser + error messages + typo detection`

**User stories**: #7, #8 (headline feature, separated from all infrastructure)

#### What to build

This is the original goal of the branch. Replace the ad-hoc parser implementation inside `@cosmosdb/nosql-language-service` with the official AST-based parser. Implement `SqlErrorMessageProvider` for human-friendly error messages. Add typo / near-miss keyword diagnostics. Enhance multi-query separator and signature help for CodeMirror.

Depends on both the integration PR (Phase 2a PR1) and the tRPC PR (Phase 4-1) being merged.

#### Acceptance criteria

- [ ] `SqlParser.test.ts` passes with the new parser for all existing test cases
- [ ] `SqlErrorMessageProvider.test.ts` covers the new human-friendly message cases
- [ ] `typoDetection.test.ts` covers at least: single char substitution, transposition, common alias
- [ ] CodeMirror `separatorExtension` correctly identifies query block boundaries
- [ ] Signature help triggers on correct positions for all documented built-in functions
- [ ] `pnpm --filter @cosmosdb/nosql-language-service run test` passes (100% of existing tests + new)
- [ ] `pnpm run build` passes
- [ ] `pnpm run lint` passes
- [ ] `pnpm run l10n` run if any user-visible error strings were added; `package.nls.json` updated

---

## Execution checklist

Before opening each PR:

```
pnpm run build          # must pass
pnpm run lint           # must pass
pnpm run prettier-fix   # format all changed files
pnpm run l10n           # only if user-facing strings changed
```

Merge order summary:

```
PR0  ──▶  PR1  ──▶  PR2  ──▶  PR9  ──▶  PR11
                └──▶  PR3
                └──▶  PR10

     PR4  ──▶  PR5  ──▶  PR6

     PR7   (anytime after PR0)
     PR8   (anytime)
     PR12  (anytime)
```

