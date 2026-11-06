---
description: Executable editor integrations and shared synthetic query scenarios.
---

# Samples

The examples use the **published npm 1.0.0 packages**, not TypeScript source aliases into the repository. They are integration examples, not query runners.

## Integration sources

These pages include their TypeScript source directly with VitePress snippet imports:

| Source in this site's package | Guide                                                          | Environment                               |
| ----------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `samples\schema.ts`           | [Schema analyzer](./schema-analyzer.md#executable-json-sample) | Browser-safe JSON inference               |
| `samples\monaco.ts`           | [Monaco](./monaco.md#integration-sample)                       | Browser editor and registration lifecycle |
| `samples\codemirror.ts`       | [CodeMirror 6](./codemirror.md#integration-sample)             | Browser extension composition             |
| `samples\vscode.ts`           | [VS Code](./vscode.md#activate-and-register)                   | Extension host, not the browser           |

Use the editor sample in a host with the documented peer dependencies and container lifecycle. The VS Code sample requires an extension project and manifest contribution; it cannot run by pasting it into a browser console.

## Shared scenarios

`samples\scenarios.json` contains synthetic documents and query scenarios for the docs and playground. Reading the same fixture makes it easier to compare the two browser adapters without accidentally comparing different schemas.

The playground starts with the first scenario's documents. Selecting another sample loads only its query, preserving
your documents and the currently applied schema.

<<< ./samples/scenarios.json

### What to look for

| Experiment                               | Expected observation                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Request completion after an alias's dot  | Fields from the currently inferred sample schema                                                |
| Hover a built-in function                | Function documentation, without executing the function                                          |
| Type another function argument in Monaco | Signature information at the current cursor; the CodeMirror sample does not wire signature help |
| Introduce a keyword typo                 | A diagnostic; an AST may still exist through recovery                                           |
| Use semicolon-separated queries          | Independent query regions when multi-query support is enabled                                   |
| Infer documents with mixed field types   | Alternative observed types in the schema                                                        |

Editor keybindings and tooltip presentation may differ. Compare the underlying query, cursor offset, schema, and service settings before diagnosing an adapter difference.

## Run locally

From the repository root:

```sh
npm run docs:install
npm run docs:dev
```

Use `npm run docs:build` to validate the production site and `npm run docs:preview` to inspect the generated output. Open the [playground](./playground.md) for interactive experiments.

Keep contributed scenarios small, reproducible, and synthetic. Never include credentials, real customer documents, account identifiers, or private query text. When reporting an issue, include the npm version, adapter, minimal sample, and expected behavior.
