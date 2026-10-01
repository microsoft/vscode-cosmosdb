# Workspace Packages

This directory contains standalone packages that are part of the monorepo.

## Active Packages

| Package                                  | Description                                                                                           | Status    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| `@azure/cosmosdb-nosql-language-service` | Cosmos DB query language support — parser, AST, autocomplete, hover, formatting, and editor providers | ✅ Active |
| `@azure/cosmosdb-schema-analyzer`        | Schema inference from sampled documents                                                               | ✅ Active |

## Package releases

Packages are versioned independently from the extension using SemVer: patch for compatible fixes, minor for
compatible additions, and major for incompatible public API changes. Compatibility includes behavior and
types, not only exported function names. Each package maintains a `CHANGELOG.md` with upgrade notes.

Peer dependency ranges use an inclusive lower bound and an exclusive next-major upper bound.
Node.js requirements have no upper bound. Package manifests define the supported versions, not an exhaustive
historical-version test matrix; pre-1.0 dependencies such as Monaco can also change incompatibly in minor releases.

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
6. Run `npm install` from the repo root so npm workspaces creates the `node_modules/@azure/cosmosdb-<name>` junction
