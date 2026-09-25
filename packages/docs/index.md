---
title: Cosmos DB developer packages
description: Parse Cosmos DB for NoSQL queries, infer document schemas, and integrate language features into editors.
---

# Cosmos DB developer packages

Two TypeScript packages for applications that work with document data and Cosmos DB for NoSQL queries. Use them together or independently.

| Package                                  | What it does                                                                                                                     | Start here                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `@azure/cosmosdb-nosql-language-service` | Parses SQL into an AST; provides diagnostics, completions, hover documentation, signature help, formatting, and editor adapters. | [Language service](./language-service.md) |
| `@azure/cosmosdb-schema-analyzer`        | Infers document structure, observed types, and statistics from JSON or BSON samples.                                             | [Schema analyzer](./schema-analyzer.md)   |

These pages target the **published npm 1.0.0 releases**.

## Try it, then integrate

- [Getting started](./getting-started.md): install the packages and analyze a query.
- [Playground](./playground.md): experiment with synthetic documents and SQL in your browser.
- [Monaco](./monaco.md) and [CodeMirror 6](./codemirror.md): add language support to a web editor.
- [VS Code](./vscode.md): register providers inside an extension.
- [Samples](./samples.md): inspect executable integration snippets and shared scenarios.
- [Limitations](./limitations.md): understand parsing, schema inference, and security boundaries.

::: tip No database required
The browser examples analyze text and JSON locally. They do not execute SQL, connect to Cosmos DB, or require Azure credentials. Use synthetic data, not production documents or secrets.
:::

Looking for the database extension rather than a library? Install [Azure Databases for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb).

[Source repository](https://github.com/microsoft/vscode-cosmosdb) · [Report an issue](https://github.com/microsoft/vscode-cosmosdb/issues)
