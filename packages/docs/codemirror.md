---
description: Compose Cosmos DB for NoSQL language features with CodeMirror 6 extensions.
---

# CodeMirror 6

The CodeMirror adapter exports factories, **not** a `registerCosmosDbSql` helper. Choose features by composing CodeMirror extensions.

```sh
npm install @azure/cosmosdb-nosql-language-service@1.0.0 @codemirror/autocomplete@^6 @codemirror/commands@^6 @codemirror/language@^6 @codemirror/lint@^6 @codemirror/state@^6 @codemirror/view@^6
```

The language-service package declares the autocomplete, language, lint, state, and view modules as optional peers. The executable sample also uses `@codemirror/commands` for editing keymaps and history.

## Integration sample

<<< ./samples/codemirror.ts#example

The sample imports shared editor types from the docs package and uses its theme variables. Adapt those dependencies for another application. It selects a `150` ms lint delay and composes completion, diagnostics, hover, formatting, and folding. Signature-help tooltip state and query separator decorations are additional integrations, not enabled by this sample.

**Compatibility with 1.0.0:** the published completion adapter returns function placeholders such as `COUNT($0)`
as plain insertion text. The sample explicitly converts function completions to CodeMirror's `snippet()` callbacks,
including the `${0}` cursor position. This is host-side compatibility code, not behavior supplied by the 1.0.0 adapter.

Create the `EditorView` after the container mounts, and call `view.destroy()` when the container unmounts. Do not construct DOM-dependent editors while VitePress renders the page on the server.

## Factory API

All imports below come from `@azure/cosmosdb-nosql-language-service/codemirror`.

| Export                               | Arguments                             | Host wiring                                                                       |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `createCompletionSource`             | `service`                             | `autocompletion({ override: [source] })`                                          |
| `createLintSource`                   | `service`                             | `linter(source, { delay: 300 })` for an explicit host-selected delay              |
| `createHoverTooltipSource`           | `service`                             | `hoverTooltip(source)`                                                            |
| `cosmosDbSqlStreamParser`            | Exported parser object                | `StreamLanguage.define(parser)`                                                   |
| `createFormatCommand`                | `service`                             | Bind the returned command in a keymap or invoke it with the view                  |
| `createSignatureHelpSource`          | `service`                             | Returns a function from view to tooltip or `null`; the host manages tooltip state |
| `createMultiQueryFoldService`        | `service`                             | `foldService.of(source)`                                                          |
| `createMultiQuerySeparatorExtension` | `service, { ViewPlugin, Decoration }` | Compose the returned extension with modules supplied by the host                  |

### Defaults are owned by the host

Nothing is registered merely by importing these factories. Unlike Monaco and VS Code, there is no adapter-wide diagnostic delay or set of enabled features. CodeMirror's own extensions determine defaults unless you configure them.

The exported `CodeMirrorOptions` type describes possible host options (`completions`, `diagnostics`, `hover`); the factories do **not** consume that object. Passing it somewhere does not switch features on.

For multiple statements, use `new SqlLanguageService({ multiQuery: true })` and explicitly add folding and separator extensions if wanted. A folding service supplies ranges; add CodeMirror's folding UI separately if you want gutter controls.

## Add a formatting key

```ts
import { keymap } from "@codemirror/view";
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import { createFormatCommand } from "@azure/cosmosdb-nosql-language-service/codemirror";

const service = new SqlLanguageService();
const formatKeymap = keymap.of([
  { key: "Shift-Alt-f", run: createFormatCommand(service) }
]);
```

Add `formatKeymap` to the editor's extensions. Formatting is parse-and-print; see [formatting caveats](./language-service.md#multiple-queries-and-formatting).

For custom tooltip rendering, treat schema names and diagnostic text as untrusted content: use text nodes or a safe Markdown renderer, not raw HTML interpolation. See [limitations and safe embedding](./limitations.md).
