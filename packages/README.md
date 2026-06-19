# Workspace Packages

This directory contains standalone packages that are part of the monorepo.

## Active Packages

| Package                            | Description                                                                                                                                                                                                                                                 | Status    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `@cosmosdb/nosql-language-service` | NoSQL language service — parser, AST, autocomplete, hover, formatting, and editor providers                                                                                                                                                                 | ✅ Active |
| `@cosmosdb/schema-analyzer`        | Schema inference from sampled documents                                                                                                                                                                                                                     | ✅ Active |
| `@cosmosdb/webview-rpc`            | Generic tRPC transport for VS Code webviews: `setupTrpc`, `vscodeLink`, `errorLink`, `TypedEventSink`, pluggable logging/telemetry middleware bodies, and React bindings (`WebviewContext` + `useTrpcClient`). Subpaths: `./server`, `./client`, `./react`. | ✅ Active |

## Planned Packages

| Package              | Description                                   | Status  |
| -------------------- | --------------------------------------------- | ------- |
| `@cosmosdb/shared`   | Shared tRPC contracts, Zod schemas, and types | Planned |
| `@cosmosdb/webviews` | React/Fluent UI webview client                | Planned |

## Adding a New Package

1. Create a new directory under `packages/`
2. Add a `package.json` with the package name scoped to `@cosmosdb/`
3. Add a `tsconfig.json` that extends `../../tsconfig.base.json`
4. Add path aliases to `tsconfig.base.json` (`paths`) so `tsc` resolves the package to its `src/`
5. Add matching `resolve.alias` entries to `vite.config.ext.mjs` and/or `vite.config.views.mjs` (subpath aliases must come before the bare-package alias)
6. Run `npm install` from the repo root so npm workspaces creates the `node_modules/@cosmosdb/<name>` junction
