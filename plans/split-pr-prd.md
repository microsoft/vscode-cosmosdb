# PRD: Split `dev/dshilov/official-ast-parser` (418 files, 56 commits) into independent PRs

## Problem Statement

The branch `dev/dshilov/official-ast-parser` has grown into a 418-file, 56-commit PR (+34 672 / -29 617 lines).
Code review is impractical at this scale. Changes span at least 8 unrelated domains (build tooling, monorepo setup, two new packages, extension refactor, language-service features, tRPC communication layer, and tests), making each review context-switch expensive and increasing the blast radius of any mistake.

**Goal:** Split the branch into the smallest set of independently-mergeable PRs that each deliver clear value, are safe to review in isolation, and land in an order that respects hard blockers.

---

## Solution

Deliver the work in **five phases** and **~13 focused PRs**. The sequence starts with the lowest-possible-risk PR0 (pure file additions, excluded from lint), then wires up the monorepo, then integrates, then handles build-system and code quality in parallel, and ends with the headline feature.

---

## User Stories

1. As a **reviewer**, I want each PR to touch a single concern so that I can understand the full change in one reading session.
2. As a **reviewer**, I want every PR to be green on CI before I look at it so that I do not chase build noise caused by unrelated work.
3. As a **reviewer**, I want the largest bulk of new files (the packages) to land as a pure addition so I can read them at my own pace without any integration risk.
4. As a **developer**, I want to be able to merge Phase 3 PRs (ESLint, ExtensionService) without waiting for the nosql package work to be done.
5. As a **developer**, I want the Vite migration split into `additive` and `switch-default` PRs so I can roll back the default if CI is flaky without losing the Vite config.
6. As a **developer**, I want the monorepo / pnpm setup to land after the raw packages are already in `main`, so the workspace wiring PR is small and easy to reason about.
7. As a **team member**, I want each PR to have a descriptive title and a short motivation section so there is no ambiguity about intent.
8. As a **team member**, I want the official-AST-parser feature (the original goal of the branch) to land in its own PR, clearly separated from infrastructure.
9. As an **on-call engineer**, I want risky build-system changes (Webpack → Vite default switch, pnpm migration) isolated from feature code so they can be reverted independently.
10. As a **developer**, I want co-located test files migrated in a dedicated PR so the diff is noise-free and reviewers only look at test file moves, not mixed with logic changes.
11. As a **developer**, I want dependency upgrades isolated in their own PR so security tooling is not confused by co-mingled application changes.

---

## Implementation Decisions

### Merge Order and Blocking Graph

```
PR0 (packages/ as-is, no lint) ──▶ PR1 (pnpm + monorepo wiring) ─┬─▶ PR2 (nosql-language-service integration)
                                                                    │         └─▶ PR10 (co-located tests)
                                                                    │         └─▶ PR9  (tRPC + query editor)
                                                                    │               └─▶ PR11 (official AST parser feature)
                                                                    └─▶ PR3 (schema-analyzer integration)

PR4 (webpack → ESM)  ──▶ PR5 (Vite additive) ──▶ PR6 (Vite default + remove Webpack)

PR7  (ESLint + Oxlint)        ← independent (can merge any time after PR0)
PR8  (ExtensionService class) ← independent (can merge any time after PR0)
PR12 (dep upgrades + lint)    ← independent
```

The build chain (PR4→PR5→PR6) and Phase 3 (code quality) can be reviewed in parallel with Phase 1/2.

---

### PR Descriptions

#### Phase 0 — Safest possible first step

**PR0: `chore: add packages/ directories as-is (no integration, excluded from lint)`** (~265 files, ~0 risk)

This PR puts the two new packages into the repo **exactly as they exist on the branch**, with no monorepo wiring whatsoever. The existing extension continues to compile and run from `src/` unchanged. Reviewers only need to verify that nothing in `main` is broken — they can skim the new folders at their leisure.

- Copy `packages/nosql-language-service/` verbatim from the branch
- Copy `packages/schema-analyzer/` verbatim from the branch
- Add `packages/**` ignore glob to `eslint.config.mjs` (or `.eslintignore`) so CI lint passes
- Add `packages/*/` to `.gitignore` exclusions for any root-level TypeScript project references that would cause compile errors
- **No** `pnpm-workspace.yaml`, **no** workspace protocol imports, **no** changes to `src/`
- CI must still be green: extension builds and tests pass; packages are simply inert directories
- _Blocker for PR1_

> **Rationale:** The largest review burden (230 + 30 = ~260 new files) lands as a pure addition with zero blast radius. Reviewers can read it calmly, leave comments, and it merges as soon as CI is green. Everything else follows.

---

#### Phase 1 — Foundation (depends on PR0)

**PR1: `chore: npm → pnpm + monorepo workspace setup`** (~20 files)
- `pnpm-workspace.yaml`, `.npmrc`, `package.json` pnpm scripts, `pnpm-lock.yaml`
- CI workflows (`.github/workflows/main.yml`, `.azure-pipelines/`) updated to use `pnpm`
- Wire up `packages/nosql-language-service` and `packages/schema-analyzer` as proper workspace members (`workspace:*`)
- Remove the lint-exclusion glob added in PR0 — packages are now in the workspace and linted normally
- Preinstall script that enforces pnpm usage
- _Depends on PR0; hard blocker for PR2, PR3_

---

#### Phase 2 — Integration (depend on PR1)

**PR2: `feat: integrate @cosmosdb/nosql-language-service into the extension`** (~40 files)
- Add `@cosmosdb/nosql-language-service` as a workspace dependency of the root package
- Wire the package into `src/cosmosdb/language/` — replace ad-hoc imports with the package public API
- Remove the duplicate code that now lives in `src/cosmosdb/language/` (lexer, parser, hover, completion stubs)
- Update `tsconfig.json` path aliases so TypeScript resolves `@cosmosdb/nosql-language-service` from `packages/`
- _Depends on PR1; blocker for PR9, PR10, PR11_

**PR3: `feat: integrate @cosmosdb/schema-analyzer into the extension`** (~15 files)
- Add `@cosmosdb/schema-analyzer` as a workspace dependency
- Wire into `src/utils/json/` — replace inline BSON/JSON schema logic with the package public API
- Remove duplicate code from `src/utils/json/`
- _Depends on PR1; independent of PR2_

---

#### Phase 2 (Build) — Webpack → Vite (sequential chain, parallel with packages)

**PR4: `build: migrate webpack configs to ESM (.mjs)`** (~10 files)
- `webpack.config.ext.js → .mjs`, `webpack.config.views.js → .mjs`
- `package.json`: `"type": "module"`, `"main": "./main.mjs"`
- `main.js → main.ts` entry point
- Fix default `vscode` imports → `import * as vscode` (default import returns `undefined` in ESM)
- Add `no-restricted-syntax` ESLint rule to prohibit `import vscode from 'vscode'`
- _Prerequisite for Vite configs that also use ESM_

**PR5: `build: add Vite 8 configs alongside Webpack (zero-risk benchmark)`** (~8 files)
- `vite.config.ext.mjs`, `vite.config.views.mjs`
- `vite-dev/prod/watch` scripts added to `package.json` alongside `webpack-*` scripts
- `createRequire` banner fix for CJS interop in ESM chunks
- Webpack remains the default F5 / CI path — **zero risk**
- _Depends on PR4_

**PR6: `build: switch default dev + CI pipeline to Vite, remove Webpack`** (~8 files)
- `.vscode/tasks.json`, `.vscode/launch.json` point to Vite by default; webpack kept as `(webpack)` variants
- `scripts/package-vsix.mjs` uses `vite-prod`
- Remove `webpack.config.ext.mjs`, `webpack.config.views.mjs`
- Background problem-matcher patterns for F5 launch timing (`building .* for` / `built in`)
- _High risk; isolated so it can be reverted without touching feature code_
- _Depends on PR5_

---

#### Phase 3 — Code Quality (parallel with Phases 1 and 2)

**PR7: `chore: reconfigure ESLint + add Oxlint, fix lint errors`** (~6 files)
- `eslint.config.mjs`, `.oxlintrc.json`, `tsconfig.eslint.json`
- Resolve 68+ Oxlint v1.61.0 errors across the codebase
- `no-restricted-syntax` rule for `import vscode from 'vscode'`
- _Can be opened against `main` as soon as PR0 is merged (packages/ already excluded)_
- _Fully independent_

**PR8: `refactor(ext): replace ext namespace with ExtensionService class`** (~15 files)
- `src/extensionVariables.ts`: `ExtensionService` with `required<T>()` / `optional<T>()` write-once getters/setters
- `isAIFeaturesEnabled` stays mutable (changes at runtime when Copilot state changes)
- `settingsKeys` becomes an `as const` readonly object property
- Update all consumers in `src/extension.ts`, `src/panels/`, `src/commands/`, etc.
- Fixes Oxc compatibility (no `export let` inside TS namespaces)
- _Fully independent_

**PR12: `chore: update dependencies, fix version pins`** (~3 files)
- `package.json` dependency bump to latest versions
- Fix `jest-mock-vscode` specifier (`~` → `^`)
- Align `jest.config.js` specifier with lockfile
- _Trivial; can be reviewed in minutes_

---

#### Phase 4 — Features (depend on PR2)

**PR9: `feat: tRPC communication layer + query editor modernisation`** (~25 files)
- `src/panels/trpc/` — app router, query editor router, schemas, setup
- `src/webviews/api/trpc/` — client, VS Code link/transport
- Query block tracking and multi-block execution in `QueryMonaco.tsx`
- Schema merging from `SELECT *` queries in query editor
- `confirmToolInvocation` handling cleanup
- _Depends on PR2 (nosql-language-service package)_

**PR10: `refactor(tests): migrate to co-located test files in packages`** (~35 files)
- Move test files from top-level `test/` into `packages/*/src/` alongside source
- Update `tsconfig.test.json`, `vitest.config.ts`, `.vscode-test.mjs`
- _Pure file moves — no logic changes; reviewers skim diffs, not logic_
- _Depends on PR1 + PR2_

**PR11: `feat(nosql-language-service): official AST parser + error messages + typo detection`** (remaining files)
- Switch to official AST-based parser replacing ad-hoc implementation
- Human-friendly parser error messages via `SqlErrorMessageProvider`
- Typo / near-miss keyword diagnostics (`typoDetection.ts`)
- Multi-query separator and signature help enhancements for CodeMirror
- _This is the headline feature of the original branch_
- _Depends on PR2 and PR9_

---

### Key Architectural Decisions

- **PR0 is intentionally inert.** Its sole purpose is to get ~260 new files into `main` with zero blast radius. No imports, no workspace plumbing, lint excluded. Reviewers read it once and never look at it again.
- **PR1 re-enables linting for packages/** by removing the exclusion added in PR0. After PR1 merges, `pnpm run lint` covers the full monorepo.
- **Each PR must pass CI independently.** Where a PR introduces a compile dependency on an unmerged blocker, it must include a thin compatibility shim or wait.
- **The nosql-language-service integration (PR2)** replaces `src/cosmosdb/language/` with calls to the package public API — reviewers only need to verify the API boundary, not re-read 230 files they already approved in PR0.
- **Vite is introduced additively (PR5) and switched default separately (PR6)** to ensure the default is reversible without touching feature code.
- **Test migration (PR10)** must contain zero logic changes — only file moves and import path updates.
- **ExtensionService (PR8)** must not be mixed with monorepo or build tooling; reviewers need to verify the correctness of every `ext.*` substitution against the new class API.
- **Branch strategy:** PR0 is cut from `main`. All subsequent branches are cut from `main` (or the immediate blocker branch while waiting). Rebase onto `main` after each merge to keep the graph clean.

---

## Testing Decisions

- A good test exercises the **public API** of a module and makes no assertions about internal implementation details (no spying on private methods, no snapshots of internal state shape).
- **PR0:** No tests to run against packages (they are excluded from CI compilation). CI acceptance criterion: existing `pnpm run build` and `pnpm test` still pass unchanged.
- **nosql-language-service integration (PR2):** `pnpm --filter @cosmosdb/nosql-language-service run test` must pass; existing extension tests that exercise `src/cosmosdb/language/` must still pass after the swap.
- **schema-analyzer integration (PR3):** Same — `pnpm --filter @cosmosdb/schema-analyzer run test` must pass.
- **ExtensionService (PR8):** No new unit tests required, but the existing integration smoke test (`src/__mocks__/`) must still pass.
- **Vite migration (PR5, PR6):** CI build artefact size and the extension host startup serve as tests. No new unit tests needed.
- **tRPC layer (PR9):** Existing `chatUtils.test.ts`, `deployLLMInstructionsFiles.test.ts`, `copilotUtils.test.ts` must still pass.
- **Official AST parser (PR11):** `SqlParser.test.ts`, `SqlErrorMessageProvider.test.ts`, `typoDetection.test.ts` are the primary coverage targets.
- Prior art for test style: `src/utils/survey.*.test.ts`, `packages/nosql-language-service/src/services/SqlLanguageService.test.ts`.

---

## Out of Scope

- Writing new product features beyond what is already on the branch.
- Splitting the nosql-language-service docs (~100 markdown files) into a secondary PR — they move with the package in PR2 for traceability.
- Converting remaining JavaScript utility scripts to TypeScript (separate future chore).
- Monaco editor theme / palette changes beyond what is required for the query editor to function.
- Any work not currently present on `dev/dshilov/official-ast-parser`.

---

## Further Notes

- **Estimated review load per PR:** PR2 is the heaviest (~230 files) but the majority are new additions with no prior state — reviewers read forward, not diff. All other PRs should be under 50 files.
- **Commit messages:** Each PR follows the existing Conventional Commits convention (`feat:`, `refactor:`, `build:`, `chore:`).
- **Localization:** Only PRs that change user-visible strings (PR9, PR11) need to run `pnpm run l10n` and update `package.nls.json`.
- **Summary table:**

| PR | Title | ~Files | Phase | Depends on |
|----|-------|--------|-------|------------|
| PR0  | Add packages/ as-is, exclude from lint | 265 | 0 | — |
| PR1  | npm → pnpm + monorepo wiring | 20 | 1 | PR0 |
| PR2  | Integrate nosql-language-service | 40 | 2 | PR1 |
| PR3  | Integrate schema-analyzer | 15 | 2 | PR1 |
| PR4  | Webpack configs → ESM (.mjs) | 10 | 2 (build) | — |
| PR5  | Vite 8 configs additive | 8 | 2 (build) | PR4 |
| PR6  | Vite switch default + remove Webpack | 8 | 2 (build) | PR5 |
| PR7  | ESLint + Oxlint reconfiguration | 6 | 3 | PR0 |
| PR8  | ExtensionService namespace → class | 15 | 3 | — |
| PR9  | tRPC layer + query editor | 25 | 4 | PR2 |
| PR10 | Co-located test migration | 35 | 4 | PR1, PR2 |
| PR11 | Official AST parser + errors + typos | ~30 | 4 | PR2, PR9 |
| PR12 | Dependency updates + pin fixes | 3 | any | — |

