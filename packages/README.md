# Workspace Packages

This directory contains standalone packages that are part of the monorepo.

## Planned Packages

| Package | Description | Status |
|---|---|---|
| `@cosmosdb/nosql-language-service` | NoSQL language service — parser, AST, autocomplete, hover, formatting, and editor providers | ✅ Active |
| `@cosmosdb/schema-analyzer` | Schema inference from sampled documents | ✅ Active |
| `@cosmosdb/shared` | Shared tRPC contracts, Zod schemas, and types | Planned |
| `@cosmosdb/webviews` | React/Fluent UI webview client | Planned |

## Adding a New Package

1. Create a new directory under `packages/`
2. Add a `package.json` with the package name scoped to `@cosmosdb/`
3. Add a `tsconfig.json` that extends `../../tsconfig.base.json`
4. The package will be automatically discovered by pnpm workspace

