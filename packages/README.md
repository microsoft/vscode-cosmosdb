# Workspace Packages

This directory contains standalone packages that are part of the monorepo.

## Active Packages

| Package                                  | Description                                                                                 | Status    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `@azure/cosmosdb-nosql-language-service` | NoSQL language service — parser, AST, autocomplete, hover, formatting, and editor providers | ✅ Active |
| `@azure/cosmosdb-schema-analyzer`        | Schema inference from sampled documents                                                     | ✅ Active |

## Planned Packages

| Package                    | Description                                   | Status  |
| -------------------------- | --------------------------------------------- | ------- |
| `@azure/cosmosdb-shared`   | Shared tRPC contracts, Zod schemas, and types | Planned |
| `@azure/cosmosdb-webviews` | React/Fluent UI webview client                | Planned |

## Adding a New Package

1. Create a new directory under `packages/`
2. Add a `package.json` with the package name scoped to `@azure/` (e.g. `@azure/cosmosdb-<name>`)
3. Add a `tsconfig.json` that extends `../../tsconfig.base.json`
4. Add path aliases to `tsconfig.base.json` (`paths`) so `tsc` resolves the package to its `src/`
5. Add matching `resolve.alias` entries to `vite.config.ext.mjs` and/or `vite.config.views.mjs` (subpath aliases must come before the bare-package alias)
6. Add the package directory to the root `package.json` `workspaces` list
7. Run `npm install` from the repo root so npm workspaces creates the `node_modules/@azure/cosmosdb-<name>` junction

## Documentation and Playground

`docs/` is a private, standalone VitePress site for both packages, with Monaco and CodeMirror playgrounds and VS Code
integration examples. It is deliberately excluded from npm workspaces: its own lockfile pins published npm packages,
so the playground exercises the release artifacts rather than local source code.

The site requires Node.js **22.18 or later** and pins **VitePress 2.0.0-alpha.20**, Vue, and TypeScript.
This prerelease uses the current Vite toolchain rather than the unsupported Vite 5 dependency in VitePress 1.6.

From the repository root:

```sh
npm run docs:install
npm run docs:dev
```

Use `npm run docs:build` to type-check the site and examples and generate static files in `docs/.vitepress/dist`.
Use `npm run docs:preview` to serve that build locally. Set `DOCS_BASE` during the build when hosting under a subpath,
for example `/vscode-cosmosdb/` on GitHub Pages. No deployment or Azure account is needed for local use.

Content lives in Markdown, runnable integration examples in `docs/samples/*.ts`, and scenario inputs in
`docs/samples/scenarios.json`.

After building, `npm run docs:test` uses the repository's existing Playwright setup to exercise the static site,
both editor adapters, completion refresh after schema changes, invalid JSON, and navigation. It requires the root
development dependencies and Playwright Chromium (`npx playwright install chromium`).
Run `npx vitest run --config test/docs/vitest.config.ts` for the docs unit tests against the installed npm releases,
without the root test suite's workspace-source aliases. Set the same `DOCS_BASE` for the build and browser tests
when testing a subpath deployment; both default to `/` locally.

### GitHub Pages

The `Documentation` workflow (`.github/workflows/docs.yml`) runs unit tests, type-checks and builds the site, then runs
browser tests for pull requests targeting `main` and pushes to `main`. Changes to `packages/docs/**`, `test/docs/**`,
the root dependency manifests, the workflow, or `.nvmrc` trigger it. It installs root test dependencies and standalone
documentation dependencies, but does not build the extension or start the Cosmos DB emulator.

The browser tests use headless Chromium with system dependencies installed by
`npx playwright install --with-deps chromium`. Unlike the VS Code/Electron tests, they do not need `xvfb-run`.
Failed browser tests upload traces and screenshots for diagnosis.

After a successful build and tests on `main`, a separate deployment job publishes the tested Pages artifact to
`https://microsoft.github.io/vscode-cosmosdb/`. Pull requests only build and test; they cannot deploy. A manual workflow
run on `main` can publish again without a new commit; manual runs on other branches only build and test.

Before the first deployment, select **Settings > Pages > Build and deployment > Source: GitHub Actions** in the
repository. If the `github-pages` environment has deployment branch restrictions or required reviewers, allow `main`
and approve deployments as required.

The workflow builds with `DOCS_BASE=/vscode-cosmosdb/` for the repository's Pages subpath. If hosting moves to a custom
domain or another path, update that build setting as well. Generated files stay in the Pages artifact, not a Git branch.
