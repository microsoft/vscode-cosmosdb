---
description: Register Cosmos DB for NoSQL language features in Monaco Editor.
---

# Monaco

Use the Monaco adapter in a browser application that already owns its editor, model, and bundler setup.

```sh
npm install @azure/cosmosdb-nosql-language-service@1.0.0 monaco-editor
```

The published adapter declares `monaco-editor >=0.30.0` as an optional peer. Optional means headless consumers do not need it; a Monaco host does.

## Integration sample

This example connects a language service to Monaco, keeps schema-derived suggestions up to date, and releases
providers and editor resources when the editor is closed. Comments explain each integration step:

<<< ./samples/monaco.ts#example

The sample uses Vite's `?worker` import and the docs package's shared `EditorOptions` / `PlaygroundEditor` types. In another host, adapt those imports to your bundler and lifecycle. It deliberately uses a unique language ID, owns tokenizer registration explicitly, disables query decorations, and selects a `150` ms diagnostic delay; these are sample choices, not package defaults.

Create browser-dependent editors only after a DOM container exists. In a server-rendered shell such as VitePress, load the component client-side and mount the editor inside its lifecycle. Monaco worker URLs are a bundler concern; registering SQL providers does not configure workers for other Monaco languages.

## Registration API

```ts
registerCosmosDbSql(monaco, service, options?)
```

The helper connects an existing language service to Monaco. It does not create an editor, model, schema, or worker.

| Argument  | Type                        | What to pass                                                                                                                                                                       |
| --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monaco`  | `MonacoNamespace`           | The Monaco API namespace used to create your editors, not an editor instance.                                                                                                      |
| `service` | `SqlLanguageService`        | The service that parses queries and supplies language features. Configure schema access through its `getSchema` callback and multi-query behavior through its `multiQuery` option. |
| `options` | `MonacoRegistrationOptions` | Optional registration settings described below. Omit the object, or individual properties, to use their defaults.                                                                  |

The return value is a `Disposable`: call `registration.dispose()` when the registration is no longer needed.
See [Lifetime and multiple editors](#lifetime-and-multiple-editors) for ownership and cleanup details.

### Options at a glance

All properties are optional. Boolean flags control this adapter's providers; setting one to `false` does not disable
another provider registered by your application or Monaco itself. Options are read during registration, not observed
for later changes. The defaults below assume the service and registration use their default settings.

| Option                  | Type      | Default          |
| ----------------------- | --------- | ---------------- |
| `languageId`            | `string`  | `'cosmosdb-sql'` |
| `completions`           | `boolean` | `true`           |
| `diagnostics`           | `boolean` | `true`           |
| `hover`                 | `boolean` | `true`           |
| `signatureHelp`         | `boolean` | `true`           |
| `formatting`            | `boolean` | `true`           |
| `monarchTokenizer`      | `boolean` | `true`           |
| `folding`               | `boolean` | `false`          |
| `multiQueryDecorations` | `boolean` | `false`          |
| `highlightActiveBlock`  | `boolean` | `true`           |
| `diagnosticDelay`       | `number`  | `300` ms         |
| `decorationDelay`       | `number`  | `300` ms         |

Enabling multi-query mode on the service also enables folding and query decorations unless explicitly overridden.
Changing the diagnostic delay also changes the decoration delay unless a separate decoration delay is supplied.
Active-block highlighting only takes effect when query decorations are enabled.

### Language and syntax coloring

**`languageId`** selects the models that receive SQL features. It must match the language passed to
`monaco.editor.createModel(query, languageId)` or assigned with `monaco.editor.setModelLanguage(model, languageId)`.
If the ID does not exist, the helper registers it with the `.nosql` extension and a `CosmosDB NoSQL` alias.
Registration is language-wide, not limited to one editor. Use separate IDs when editors need different service/schema setups.

**`monarchTokenizer`** installs both SQL syntax tokenization and the language configuration: comment syntax, brackets,
and auto-closing pairs. This is separate from completion, diagnostics, and other service-backed features.
Set it to `false` if you install your own tokenizer/configuration, or want to retain their disposable handles yourself,
as the integration sample does. In version `1.0.0`, the registration's disposable does not retain these two handles.

### Suggestions and documentation

**`completions`** registers suggestions for SQL keywords, functions, aliases, and schema fields.
Schema-derived suggestions use the service's `getSchema` callback; registration does not infer a schema itself.
The provider declares `.`, space, `,`, and newline as trigger characters. Monaco's editor settings still control whether
suggestions open automatically. Set this flag to `false` when the host supplies its own completion provider.

**`hover`** registers documentation tooltips for keywords, functions, and schema fields under the pointer.
It does not control Monaco's general hover settings or error-marker tooltips. Disable it if you provide custom
documentation tooltips or do not want this source of hover content.

**`signatureHelp`** registers function parameter hints, such as the arguments expected by `CONTAINS`.
It triggers on `(` and `,`, and identifies the active parameter from the cursor position.
It is independent of completion: a host can show parameter hints without offering function-name suggestions.

### Diagnostics and formatting

**`diagnostics`** creates a controller that observes existing and newly created models with the selected language ID.
It converts the service's parser errors and warnings into Monaco markers, using the marker owner `'cosmosdb-sql'`.
This provides editor feedback, not server-side query validation or execution.
Disable it for a viewer without parser markers, or when managing a separate diagnostics controller yourself.
For a custom marker owner, use `MonacoDiagnosticsProvider` directly.

**`diagnosticDelay`** is the debounce interval in milliseconds after the last text edit.
Every new edit resets the timer. A lower value shows errors sooner; a higher value reduces repeated parsing while typing.
Initial diagnostics run immediately when a matching model is first observed.
Use a non-negative number; `0` schedules diagnostics without an additional debounce interval.
This setting has no effect when `diagnostics` is `false`.

**`formatting`** registers a document-formatting provider that turns the service's formatting edits into Monaco edits.
It makes formatting available to Monaco's Format Document action; registration does not format text automatically,
add a toolbar button, or implement saving. Your host chooses when to invoke formatting.
Set it to `false` if another formatter owns the language or you apply `service.getFormatEdits()` yourself.

### Multiple queries and decorations

**`folding`** registers folding ranges for query blocks. Only regions spanning more than one line produce a folding range.
Monaco supplies the folding controls and still needs folding enabled in the editor's own settings.
By default, registration follows `service.multiQuery`; an explicit `false` disables this provider even for a
multi-query service.

**`multiQueryDecorations`** draws separator lines and extra vertical spacing at query boundaries.
It also enables the active-query indicator unless `highlightActiveBlock` is `false`.
Disable decorations if the host already shows query boundaries or you want a plain editor without these additions.
The decorator injects its own stylesheet and reserves gutter space for the active-query bar.
In version `1.0.0`, each decorator attaches to the first matching editor, not every editor sharing the language ID.

**`highlightActiveBlock`** shows a vertical gutter bar alongside the query containing the cursor.
Set it to `false` to keep separators and spacing without the active-query bar.
It has no effect when `multiQueryDecorations` is disabled, and does not execute or select the highlighted query.

**`decorationDelay`** is the debounce interval, in milliseconds, for redrawing separators and spacing after text edits.
If omitted, it uses the supplied `diagnosticDelay`, or `300` ms when neither delay is supplied.
For example, `diagnosticDelay: 150` also gives decorations a `150` ms delay unless `decorationDelay` overrides it,
even if diagnostics are disabled. Cursor-driven active-block highlighting is not delayed by this setting.
Use a non-negative number; this option has no effect when decorations are disabled.

Enable multi-query parsing on the service with `new SqlLanguageService({ multiQuery: true })`.
This makes folding and decorations default to `true` and lets language features route requests to the appropriate query.
Setting only `folding: true` or `multiQueryDecorations: true` registers the visual feature; it does not enable
multi-query routing on the service. Likewise, disabling a visual feature does not disable multi-query parsing.

### Configuration example

With the Monaco namespace and `registerCosmosDbSql` imported as in the integration sample:

```ts
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";

// Split the document into queries; this is a service option.
const service = new SqlLanguageService({ multiQuery: true });

const registration = registerCosmosDbSql(monaco, service, {
  // Use this same ID when creating or changing the editor's model.
  languageId: "cosmosdb-sql",

  // Keep query folding and separators, but hide the active-query bar.
  folding: true,
  multiQueryDecorations: true,
  highlightActiveBlock: false,

  // Show errors quickly; redraw separators less frequently while typing.
  diagnosticDelay: 150,
  decorationDelay: 300
});

// Keep registration alive until the host tears down this integration.
// registration.dispose();
```

Completion, hover, signatures, formatting, and tokenization remain enabled because their flags were omitted.
Add `getSchema` to the service configuration when you also need schema-derived field suggestions.

## Lifetime and multiple editors

- Register once per shared language/service setup, not on every render.
- Keep the returned disposable until the last editor using that registration is gone.
- On teardown, dispose the registration, editor, and any model your application created. Shared models need shared ownership.
- The helper's composite disposes feature providers and controllers; do not assume it removes the language ID, tokenizer, or all injected styling.

For finer control, the adapter exports individual providers such as `MonacoCompletionProvider` and `MonacoDiagnosticsProvider`. Diagnostics-only integration accepts `{ languageId?, owner?, diagnosticDelay? }`, defaulting to `'cosmosdb-sql'`, `'cosmosdb-sql'`, and `300` ms respectively. A distinct marker owner keeps independent diagnostic sources separate.

Try the [playground](./playground.md), or see the [explicit adapter guide](https://github.com/microsoft/vscode-cosmosdb/blob/main/packages/nosql-language-service/docs/editor-integration.md).
