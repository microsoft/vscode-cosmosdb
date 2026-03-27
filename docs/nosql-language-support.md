# NoSQL Language Support

Syntax highlighting and code completion for the CosmosDB NoSQL query language. Works in two environments:

- **VS Code editor** — when opening `.nosql` files
- **Webview Monaco editor** — the Query Editor panel opened from the tree view

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Shared Language Definitions            │
│  src/cosmosdb/language/nosqlLanguageDefinitions   │
│  Keywords, functions, schema helpers              │
│  (no vscode or monaco imports)                    │
└──────────┬───────────────────────┬───────────────┘
           │                       │
 ┌─────────▼──────────┐  ┌────────▼─────────────────────┐
 │  VS Code Editor     │  │  Webview Monaco Editor        │
 │                     │  │                               │
 │  TextMate grammar   │  │  Monarch tokenizer            │
 │  VS Code completion │  │  Monaco completion provider   │
 │  provider           │  │  + schema-driven properties   │
 └─────────────────────┘  └───────────────────────────────┘
```

## Files

### Shared (environment-agnostic)

| File                                                | Purpose                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cosmosdb/language/nosqlLanguageDefinitions.ts` | Single source of truth for all language data: keyword lists (`NOSQL_KEYWORDS`, `NOSQL_KEYWORD_TOKENS`), function definitions with signatures (`NOSQL_FUNCTIONS`), and schema helper utilities (`extractFromAlias`, `resolveSchemaProperties`, `needsBracketNotation`, `getTypeLabel`). Imports neither `vscode` nor `monaco-editor`. |

### VS Code Editor

| File                                               | Purpose                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `syntaxes/nosql.tmLanguage.json`                   | TextMate grammar that provides syntax highlighting in the VS Code editor. Defines token scopes for keywords, built-in functions, comments, strings, numbers, and operators.                                                                                              |
| `language-configuration.json`                      | VS Code language configuration for `.nosql` files: comment toggling (`--` and `/* */`), bracket matching, auto-closing pairs, and surrounding pairs.                                                                                                                     |
| `src/cosmosdb/language/NoSqlCompletionProvider.ts` | VS Code `CompletionItemProvider` registered for the `nosql` language. Provides keyword and function completions with snippet-style cursor placement. Does **not** provide schema-driven property suggestions since standalone `.nosql` files have no connection context. |
| `src/extension.ts`                                 | Registers the VS Code completion provider at extension activation via `vscode.languages.registerCompletionItemProvider`.                                                                                                                                                 |

### Webview Monaco Editor

| File                                                     | Purpose                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/webviews/.../QueryPanel/nosqlLanguage.ts`           | Registers the `nosql` language with Monaco: Monarch tokenizer for syntax highlighting and language configuration. Imports keyword/function lists from the shared module.                                                                                                 |
| `src/webviews/.../QueryPanel/nosqlCompletionProvider.ts` | Monaco `CompletionItemProvider`. Provides keyword completions, function completions with snippets, **and** schema-driven property suggestions after dot notation (e.g. `c.address.city`). Uses `extractFromAlias` for lightweight alias tracking from the `FROM` clause. |
| `src/webviews/.../QueryPanel/QueryMonaco.tsx`            | Registers both the language and the completion provider when Monaco becomes available. Keeps a ref to the latest container schema so the provider always reads fresh data.                                                                                               |

### Schema Pipeline (extension host → webview)

| File                                                    | Purpose                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/webviews/.../state/QueryEditorState.tsx`           | Contains the `containerSchema` field in the React state.                                                                                                       |
| `src/webviews/.../state/QueryEditorContextProvider.tsx` | Listens for the `schemaUpdated` channel event and dispatches it into state.                                                                                    |
| `src/panels/QueryEditorTab.ts`                          | Sends the schema to the webview via `sendSchemaToWebview()` — called on ready, after schema generation, after query-based schema merge, and after schema wipe. |

### Configuration

| File                    | Purpose                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | Declares the `nosql` language (`contributes.languages`) with file extension, language configuration, and file icon. Declares the TextMate grammar (`contributes.grammars`). Adds `onLanguage:nosql` activation event. |
| `webpack.config.ext.js` | Copies `syntaxes/` and `language-configuration.json` into `dist/` for the packaged extension.                                                                                                                         |

## How It Works

### Syntax Highlighting

- **VS Code editor**: The TextMate grammar (`syntaxes/nosql.tmLanguage.json`) is loaded declaratively by VS Code from `package.json` — no extension activation needed. It tokenizes keywords, functions, comments, strings, numbers, and operators using regex patterns.
- **Webview Monaco**: The Monarch tokenizer (`nosqlLanguage.ts`) is registered programmatically when the Query Editor mounts. It uses the same keyword/function lists from the shared module.

### Code Completion

- **VS Code editor**: The `NoSqlCompletionProvider` is registered at activation. It provides keyword and function completions for any `.nosql` file. Schema-based property suggestions are not available because standalone files have no database connection.
- **Webview Monaco**: The Monaco completion provider receives the container schema through React state (piped from the extension host). When the user types `c.`, it resolves the alias from the `FROM` clause, walks the schema tree, and suggests matching properties with type labels. Properties requiring bracket notation (e.g. names with dashes) are automatically suggested as `c["property-name"]`.

### Schema Flow

```
StorageService (schema stored per container)
    ↓
QueryEditorTab.sendSchemaToWebview()
    ↓  channel.postMessage({ name: 'schemaUpdated', params: [schema] })
QueryEditorContextProvider (event listener)
    ↓  dispatch({ type: 'setContainerSchema', containerSchema })
QueryEditorState.containerSchema
    ↓  (React ref in QueryMonaco.tsx)
Monaco CompletionItemProvider.provideCompletionItems()
```
