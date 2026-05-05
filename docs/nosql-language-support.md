# NoSQL Language Support

Syntax highlighting, code completion, hover docs, diagnostics, signature help, and formatting
for the CosmosDB NoSQL query language. Powered by the
[`@cosmosdb/nosql-language-service`](../packages/nosql-language-service/README.md) workspace package.

Works in two environments:

- **VS Code editor** — when opening `.nosql` files
- **Webview Monaco editor** — the Query Editor panel opened from the tree view

## Architecture

```
┌─────────────────────────────────────────────────┐
│  @cosmosdb/nosql-language-service               │
│                                                 │
│  Chevrotain parser → full AST, error recovery   │
│  SqlLanguageService (IDE-agnostic facade)       │
│    • getCompletions   • getDiagnostics          │
│    • getHoverInfo     • getSignatureHelp        │
│    • format           • getFormatEdits          │
├──────────────────────┬──────────────────────────┤
│  /vscode adapter     │  /monaco adapter         │
│  registerCosmosDbSql │  registerCosmosDbSql     │
└─────────┬────────────┴──────────┬───────────────┘
          │                       │
┌─────────▼───────────┐  ┌────────▼───────────────────────┐
│  VS Code Editor     │  │  Webview Monaco Editor         │
│                     │  │                                │
│  TextMate grammar   │  │  Monarch tokenizer             │
│  (syntax highlight) │  │  (syntax highlight)            │
│                     │  │                                │
│  Language service   │  │  Language service providers    │
│  providers (all     │  │  + schema-driven completions   │
│  features)          │  │                                │
└─────────────────────┘  └────────────────────────────────┘
```

## Files

### Language Service Package

| Path                                                             | Purpose                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/nosql-language-service/`                               | Standalone Chevrotain-based parser, AST, completion engine, hover, diagnostics, formatting, and visitors  |
| `packages/nosql-language-service/src/providers/`                 | Ready-made adapters for Monaco, VS Code, and CodeMirror 6                                                 |
| `packages/nosql-language-service/syntaxes/nosql.tmLanguage.json` | TextMate grammar for syntax highlighting in the VS Code editor                                            |
| `packages/nosql-language-service/language-configuration.json`    | VS Code language configuration for `.nosql` files: comment toggling, bracket matching, auto-closing pairs |

### VS Code Editor

| File               | Purpose                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | Creates a `SqlLanguageService` and calls `registerCosmosDbSql(vscode, service, context, { languageId: 'nosql' })` — registers completions, hover, diagnostics, signature help, and formatting |

### Webview Monaco Editor

| File                                          | Purpose                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/webviews/.../QueryPanel/QueryMonaco.tsx` | Creates `SqlLanguageService` with schema access and calls `registerCosmosDbSql(monaco, service)` — provides Monarch tokenizer, completions, hover, diagnostics, signature help, and formatting in a single call |

### Schema Pipeline (extension host → webview)

| File                                                    | Purpose                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/webviews/.../state/QueryEditorState.tsx`           | Contains the `containerSchema` field in the React state                                                                                                       |
| `src/webviews/.../state/QueryEditorContextProvider.tsx` | Listens for the `schemaUpdated` channel event and dispatches it into state                                                                                    |
| `src/panels/QueryEditorTab.ts`                          | Sends the schema to the webview via `sendSchemaToWebview()` — called on ready, after schema generation, after query-based schema merge, and after schema wipe |

### Configuration

| File                    | Purpose                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | Declares the `nosql` language (`contributes.languages`) with file extension, language configuration, and file icon. Declares the TextMate grammar (`contributes.grammars`). Adds `onLanguage:nosql` activation event |
| `vite.config.ext.mjs`   | Aliases `@cosmosdb/nosql-language-service` to TypeScript sources; copies grammar and config from the package into `dist/`                                                                                            |
| `vite.config.views.mjs` | Aliases `@cosmosdb/nosql-language-service/monaco` to TypeScript sources for the webview bundle                                                                                                                       |

## How It Works

### Syntax Highlighting

- **VS Code editor**: The TextMate grammar (`packages/nosql-language-service/syntaxes/nosql.tmLanguage.json`) is loaded declaratively by VS Code from `package.json` — no extension activation needed.
- **Webview Monaco**: The Monarch tokenizer is built into the `@cosmosdb/nosql-language-service/monaco` adapter and registered automatically by `registerCosmosDbSql()`. It uses keyword and function name lists derived from the package's Chevrotain tokens and function signatures.

### Code Completion

Both environments use the `SqlLanguageService.getCompletions()` method from the package, which provides context-aware suggestions for keywords, functions (with snippet-style tab stops), and schema-driven property suggestions after dot notation (e.g., `c.address.city`):

- **VS Code editor**: Registered via the `/vscode` adapter. Schema is not available for standalone `.nosql` files.
- **Webview Monaco**: Registered via the `/monaco` adapter. The container schema is piped through React state from the extension host, enabling property suggestions with type labels.

### Diagnostics, Hover, Signature Help, Formatting

All provided automatically by the language service package through the adapter's `registerCosmosDbSql()` call:

- **Diagnostics**: Parse errors shown as markers/squiggles in real-time
- **Hover**: Function signatures, keyword descriptions, and schema field types
- **Signature help**: Active parameter highlighting inside function calls
- **Formatting**: Parse → AST → pretty-print round-trip

### Schema Flow

```
StorageService (schema stored per container)
    ↓
QueryEditorTab.sendSchemaToWebview()
    ↓  channel.postMessage({ name: 'schemaUpdated', params: [schema] })
QueryEditorContextProvider (event listener)
    ↓  dispatch({ type: 'setContainerSchema', containerSchema })
QueryEditorState.containerSchema
    ↓  (React ref in QueryMonaco.tsx → SqlLanguageService host.getSchema())
SqlLanguageService.getCompletions() / getHoverInfo()
```
