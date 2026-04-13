# NoSQL Language Support

Syntax highlighting and code completion for the CosmosDB NoSQL query language. Works in two environments:

- **VS Code editor** — when opening `.nosql` files
- **Webview Monaco editor** — the Query Editor panel opened from the tree view

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                  Shared Language Modules                       │
│                                                               │
│  nosqlLanguageDefinitions.ts   nosqlParser.ts                 │
│  Pure data: interfaces,        Logic: alias extraction,       │
│  enriched keywords &           schema resolution,             │
│  functions (no vscode /        snippet generation             │
│  monaco imports)               (no vscode / monaco imports)   │
└───────────────┬───────────────────────────┬───────────────────┘
                │                           │
  ┌─────────────▼──────────┐  ┌────────────▼──────────────────────┐
  │  VS Code Editor         │  │  Webview Monaco Editor             │
  │                         │  │                                    │
  │  TextMate grammar       │  │  Monarch tokenizer                 │
  │  VS Code completion     │  │  Monaco completion provider        │
  │  provider               │  │  + schema-driven properties        │
  └─────────────────────────┘  └────────────────────────────────────┘
```

## Files

### Shared (environment-agnostic)

| File                                                | Purpose                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cosmosdb/language/nosqlLanguageDefinitions.ts` | **Pure data.** Single source of truth for all language constants: `NOSQL_KEYWORDS` (`KeywordInfo[]`), `NOSQL_KEYWORD_TOKENS` (derived), `NOSQL_FUNCTIONS` (`FunctionInfo[]`), `NOSQL_FUNCTION_NAMES`, and `NOSQL_LANGUAGE_ID`. Imports neither `vscode` nor `monaco-editor`. |
| `src/cosmosdb/language/nosqlParser.ts`              | **Logic.** All parser/helper functions: `extractFromAlias`, `extractJoinAliases`, `resolveJoinAliasSchema`, `resolveSchemaProperties`, `needsBracketNotation`, `getTypeLabel`, `getOccurrence`, `signatureToSnippet`. Also exports the `JoinAlias` interface.                |

### VS Code Editor

| File                                               | Purpose                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `syntaxes/nosql.tmLanguage.json`                   | TextMate grammar that provides syntax highlighting in the VS Code editor. Defines token scopes for keywords, built-in functions, comments, strings, numbers, and operators.                                                                                              |
| `language-configuration.json`                      | VS Code language configuration for `.nosql` files: comment toggling (`--` and `/* */`), bracket matching, auto-closing pairs, and surrounding pairs.                                                                                                                     |
| `src/cosmosdb/language/NoSqlCompletionProvider.ts` | VS Code `CompletionItemProvider` registered for the `nosql` language. Provides keyword and function completions with snippet-style cursor placement. Does **not** provide schema-driven property suggestions since standalone `.nosql` files have no connection context. |
| `src/extension.ts`                                 | Registers the VS Code completion provider at extension activation via `vscode.languages.registerCompletionItemProvider`.                                                                                                                                                 |

### Webview Monaco Editor

| File                                                     | Purpose                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/webviews/.../QueryPanel/nosqlLanguage.ts`           | Registers the `nosql` language with Monaco: Monarch tokenizer for syntax highlighting and language configuration. Imports keyword/function lists from the definitions module.                                                                                         |
| `src/webviews/.../QueryPanel/nosqlCompletionProvider.ts` | Monaco `CompletionItemProvider`. Provides keyword completions, function completions (using pre-computed `snippet` field), **and** schema-driven property suggestions after dot notation (e.g. `c.address.city`). Parser functions are imported from `nosqlParser.ts`. |
| `src/webviews/.../QueryPanel/QueryMonaco.tsx`            | Registers both the language and the completion provider when Monaco becomes available. Keeps a ref to the latest container schema so the provider always reads fresh data.                                                                                            |

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

## Data Shapes

### `KeywordInfo`

Each entry in `NOSQL_KEYWORDS` follows this interface:

```ts
export type KeywordCategory = 'clause' | 'keyword' | 'operator' | 'constant';

export interface KeywordInfo {
  name: string; // e.g. "ORDER BY"
  description: string; // human-readable description for hover/completion
  signature: string; // same as name
  link: string; // https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/…
  snippet: string; // same as name (insert text)
  category: KeywordCategory;
}
```

`NOSQL_KEYWORD_TOKENS` is derived from `NOSQL_KEYWORDS` by splitting multi-word names
(e.g. `"ORDER BY"` → `"ORDER"`, `"BY"`) and deduplicating — no hand-maintained list.

### `FunctionInfo`

Each entry in `NOSQL_FUNCTIONS` follows this interface:

```ts
export interface NoSqlArgumentDefinition {
  name: string; // e.g. "str", "ignoreCase"
  type: string; // "string" | "number" | "boolean" | "array" | "object" | "any"
  optional?: boolean; // true when wrapped in [...] in the signature
}

export interface FunctionInfo {
  name: string;
  signature: string; // e.g. "CONTAINS(str, substr [, ignoreCase])"
  description: string;
  link: string; // https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/{slug}
  snippet: string; // pre-computed tab-stop snippet, e.g. "CONTAINS(${1:str}, ${2:substr})$0"
  arguments: NoSqlArgumentDefinition[];
}
```

URL slugs use lowercase with underscores replaced by hyphens:
`IS_ARRAY` → `is-array`, `ST_DISTANCE` → `st-distance`, `INDEX_OF` → `index-of`.

Snippets only include **required** parameters — optional params (`[...]`) are excluded
so the user gets the minimal valid call and can add optional arguments manually.
