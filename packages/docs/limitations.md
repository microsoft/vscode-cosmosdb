---
description: Understand parser, schema inference, editor integration, and safe embedding boundaries.
---

# Limitations and safe use

## Parsing is not execution

The language service analyzes Cosmos DB for NoSQL SQL. It is not a database SDK, SQL execution engine, query planner, or general-purpose SQL dialect parser.

- Syntax acceptance does not verify account capabilities, indexes, permissions, parameter values, UDF availability, or runtime semantics.
- Error recovery can produce an AST for invalid input. Check the error list rather than testing only whether `ast` exists.
- Diagnostics cover parser errors and selected additional checks, not comprehensive server validation.
- Multi-query support is an editor document model. It does not submit a batch, implement a transaction, or share runtime variables between statements.

Test production queries with the appropriate Cosmos DB SDK and service configuration separately.

## Schema inference observes a sample

The analyzer sees only supplied documents. Rare fields, unobserved types, and future changes remain unknown. Missing a field from a sample does not prove that it is invalid.

- Empty JSON document arrays are rejected by `getSchemaFromDocuments`.
- Statistics describe observations; they do not enforce `required`, uniqueness, or accepted value ranges.
- Mixed types are represented as alternatives. A dominant type is a summary, not an exclusive constraint.
- Use bounded, acyclic document data. The browser examples are not designed for arbitrarily large, deeply nested, or cyclic JavaScript objects.
- JSON input does not retain MongoDB driver's BSON identity. Use the BSON entry point and its `mongodb` peer in an appropriate Node.js application, not this browser bundle.
- Preserve unsimplified accumulators for incremental analysis; simplify a detached copy for presentation.

**Version 1.0.0 input restriction:** the playground rejects object keys that collide with `Object.prototype`
(including `__proto__`, `constructor`, and `toString`) and the key `prototype`, at every nesting level.
The published analyzer uses plain-object property maps and can corrupt prototype state for these inputs.
The guard is in the runnable JSON sample and runs before inference; this site does not modify the npm package.

## Editor behavior is not identical

Monaco and VS Code have registration helpers; CodeMirror uses manually composed extensions. Providers translate shared results, but keybindings, Markdown rendering, snippet behavior, and tooltip timing depend on the editor and host.

The CodeMirror sample includes an explicit compatibility wrapper for 1.0.0 function snippet placeholders.
See the [CodeMirror integration](./codemirror.md#integration-sample) before copying only the raw completion factory.

Formatting reconstructs SQL from the AST. It may remove comments and original spacing, and formatting edits may replace the whole document. Always preserve undo and avoid automatic formatting as a source-preservation mechanism.

Language services run synchronously. Large inputs or repeated parsing on every keystroke can block the UI; bound input size and use debounce or your own worker integration where appropriate. A registration helper is not a worker architecture.

Dispose editor instances, owned models, and registrations according to their host lifecycle. Do not repeatedly register global providers whenever a component renders.

## Published release versus repository source

This site targets the **1.0.0 npm artifacts**. Source links point to the repository's development branch and may describe newer behavior. When an example disagrees with source documentation, inspect the installed package version and declarations first.

The private docs package is installed independently and is not published with the libraries. Building a library locally does not automatically replace the docs package's npm dependency.

The site pins VitePress **2.0.0-alpha.20**, a prerelease, to use its current Vite toolchain rather than the older
dev-server dependencies in VitePress 1.6. Review framework upgrades explicitly instead of following an unpinned
prerelease tag. Browser editor code is loaded client-side; do not evaluate Monaco or DOM-dependent CodeMirror setup
during static server rendering.

## Local processing and safe rendering

The playground analyzes JSON and SQL in the browser without submitting them to a database. Loading static assets and following external links still use the network. Local processing is not permission to paste sensitive content into a demo.

- Use fabricated documents and queries. Avoid credentials, personal data, customer schema names, and private identifiers.
- Treat document values, property names, queries, and diagnostics as untrusted text.
- Prefer Vue text interpolation or DOM `textContent` for custom output. Never concatenate user content into `innerHTML` or pass it directly to `v-html`.
- If you render Markdown hover content yourself, sanitize it and keep raw HTML and command links disabled unless explicitly reviewed.
- Do not put connection strings or service credentials in client bundles.

This site does not embed VS Code. The [desktop extension guide](./vscode.md) does not claim that the Azure Databases extension supports [vscode.dev](https://vscode.dev).

For a reproducible issue, include the package version, editor, a minimal synthetic query/document sample, and the observed result in the [issue tracker](https://github.com/microsoft/vscode-cosmosdb/issues).
