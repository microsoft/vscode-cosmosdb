---
description: Integrate the language service into a desktop VS Code extension and manage provider lifetimes.
---

# VS Code

The VS Code adapter runs **inside an extension host**. It is not a browser widget and there is no embedded VS Code playground on this site.

To use the existing database extension, install [Azure Databases for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb). To build your own integration, follow the steps below.

## Install in an extension project

```sh
npm install @azure/cosmosdb-nosql-language-service@1.0.0
npm install --save-dev @types/vscode
```

Align `@types/vscode` with your extension's supported VS Code engine. The extension host supplies the runtime `vscode` module; do not bundle a replacement. The language-service package is ESM, so configure your extension build to consume ESM dependencies and emit the format your extension entry point expects.

## Contribute a language

Merge this contribution into your extension's `package.json`:

```json
{
  "activationEvents": ["onLanguage:cosmosdb-sql"],
  "contributes": {
    "languages": [
      {
        "id": "cosmosdb-sql",
        "aliases": ["Cosmos DB SQL"],
        "extensions": [".nosql"]
      }
    ]
  }
}
```

This is a contribution fragment, not a complete extension manifest. Your project still needs its normal identity, `engines.vscode`, and compiled entry point. Modern VS Code versions activate contributed languages automatically; the explicit activation event also documents the intended trigger.

The adapter does not contribute a TextMate grammar or language configuration through the manifest. The npm package includes `syntaxes` and `language-configuration.json` assets; if you use them, copy the needed assets into your packaged extension and reference their actual packaged paths in `contributes.grammars` and the language's `configuration` field.

## Activate and register

<<< ./samples/vscode.ts#example

Call `registerSqlExtension(context, documentsJson)` from your extension's `activate(context)` function. This example reuses the docs package's `createSession` helper for JSON inference and service configuration; copy/adapt that helper too, or create a `SqlLanguageService` and supply your own `getSchema` callback. The JSON argument must contain a non-empty array of document objects.

The registration signature is:

```ts
registerCosmosDbSql(vscode, service, context?, options?)
```

| Parameter | Contract                                                                                     |
| --------- | -------------------------------------------------------------------------------------------- |
| `vscode`  | VS Code namespace supplied by the extension host                                             |
| `service` | Your `SqlLanguageService` instance                                                           |
| `context` | Optional object with `subscriptions`; the helper adds its composite disposable automatically |
| `options` | Optional provider configuration; fourth argument, not third                                  |

If you omit `context`, retain and dispose the returned object yourself. To pass options without a context, use `registerCosmosDbSql(vscode, service, undefined, options)`.

### Registration defaults

These values assume the service and registration use their default settings.

| Option                  | Default          |
| ----------------------- | ---------------- |
| `languageId`            | `'cosmosdb-sql'` |
| `completions`           | `true`           |
| `diagnostics`           | `true`           |
| `hover`                 | `true`           |
| `signatureHelp`         | `true`           |
| `formatting`            | `true`           |
| `folding`               | `false`          |
| `multiQueryDecorations` | `false`          |
| `highlightActiveBlock`  | `true`           |
| `diagnosticDelay`       | `300` ms         |
| `decorationDelay`       | `300` ms         |

If you enable multi-query mode on the language service, folding and query decorations are enabled automatically
unless you explicitly disable them in the registration options.
If you change the diagnostic delay, decorations use that same delay unless you specify a separate decoration delay.
Active-block highlighting only takes effect when query decorations are enabled.

The selected language ID must match the manifest. Providers are registered for that language across document schemes. A single host callback supplies schema context; applications editing multiple collections must manage the appropriate context rather than assuming automatic collection discovery.

## Verify the lifecycle

1. Build your extension and launch its configured **Extension Development Host** from VS Code.
2. Open a `.nosql` file and confirm its language mode matches your contribution.
3. Enter `SELECT c. FROM c` with a schema configured; request completion after the dot.
4. Enter `SELECT * FORM c` and inspect Problems, then test hover and Format Document.
5. Enable `multiQuery` and check semicolon-separated statements.
6. Close documents and deactivate/reload the extension; registration, diagnostic listeners, and decorations should be disposed through `context.subscriptions`.

See the [official extension debugging guide](https://code.visualstudio.com/api/get-started/your-first-extension) for configuring the development host.

[vscode.dev](https://vscode.dev) is a web-hosted VS Code experience, but its existence does not establish web support for this extension. These instructions target a desktop extension host; web extensions require a separate compatibility review and browser entry point.
