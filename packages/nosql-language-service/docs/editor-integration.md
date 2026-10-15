# Editor Integration

## Feature support matrix

| Feature                        | Monaco  | VS Code  | CodeMirror 6 |
| ------------------------------ | :-----: | :------: | :----------: |
| Autocompletion                 |   ✅    |    ✅    |      ✅      |
| Diagnostics (lint / squiggles) |   ✅    |    ✅    |      ✅      |
| Hover tooltips                 |   ✅    |    ✅    |      ✅      |
| Signature help                 |   ✅    |    ✅    |      ✅      |
| Document formatting            |   ✅    |    ✅    |      ✅      |
| Syntax highlighting            | Monarch | TextMate | StreamParser |
| Folding ranges (multi-query)   |   ✅    |    ✅    |      ✅      |
| Separator decorations          |   ✅    |    ✅    |      ✅      |
| Separator spacing (view zones) |   ✅    |    ✅    |      ✅      |

> **Legend:** ✅ = supported, — = not applicable or not yet implemented

This guide shows how to wire `@azure/cosmosdb-nosql-language-service` into an editor
explicitly, without relying only on the convenience
`registerCosmosDbSql()` helpers.

The architecture is intentionally split into two layers:

- `SqlLanguageService` in `src/services/` is IDE-agnostic
- editor-specific adapters in `src/providers/` translate generic
  results into Monaco, VS Code, or CodeMirror APIs

## Runtime and installation prerequisites

Use the [README installation table and recipes](../README.md#install) for your chosen entry point.
The package is ESM-only. Runtime and peer dependency ranges are declared in [package.json](../package.json).
Root and `/services` imports need no editor peers.

For browser/Electron renderers, bundle npm ESM imports and configure editor workers/assets;
do not treat bare npm imports as directly runnable browser scripts. VS Code examples belong in
an actual extension host, which supplies the `vscode` runtime module. Install `@types/vscode` for
TypeScript, align it with your extension's target, and leave `vscode` external when bundling.
Using type imports inside an adapter does not remove the runtime editor APIs used by the integration.

## Coordinate contract

Parser and language-service offsets are 0-based UTF-16 code-unit offsets. Lines and columns are
1-based; range starts are inclusive and ends exclusive. LF, CRLF and CR each count as one line break.
Tabs count as one unit, not a visual tab width. EOF diagnostics have a zero-width range at the input length.

| Adapter      | Mapping                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Monaco       | Keep the service's 1-based lines and UTF-16 columns; use model offsets for cursor input                   |
| VS Code      | Subtract one from service lines and columns for `Position`; `document.offsetAt()` supplies UTF-16 offsets |
| CodeMirror 6 | Use service offsets directly as `from` / `to` against the same query string                               |

With multi-query support, service diagnostics, hover and edit ranges use full-document coordinates.
`QueryRegion.parseResult` retains region-local coordinates; add `region.startOffset` to a local
offset before mapping it through the editor's document/model API.

## Shared setup

All integrations start the same way:

```typescript
import { SqlLanguageService, type JSONSchema } from '@azure/cosmosdb-nosql-language-service';

const collectionSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    address: { type: 'object', properties: { city: { type: 'string' } } },
  },
};

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
  getAliases: () => ['c'],
  multiQuery: true, // enable multi-query document support (semicolon-separated)
});
```

You can then either:

1. use a one-line registration helper, or
2. wire each feature explicitly

The following snippets are alternatives/continuations, not one script to concatenate. They reuse
`collectionSchema` above; snippets that construct a service replace the shared `service` declaration.
Short feature-only snippets reuse the service and editor API imports from that editor's setup.
Enable `multiQuery: true` on the service used for multi-query examples. See the
[schema projection and ownership contract](../README.md#schema-input-and-ownership) before passing
arbitrary JSON Schema documents.

## What lives where

### IDE-agnostic core

`SqlLanguageService` exposes these feature methods:

- `getDiagnostics(query)` — parse errors (multi-query aware when enabled)
- `getCompletions(query, offset)` — autocomplete suggestions
- `getHoverInfo(query, offset)` — hover documentation
- `getSignatureHelp(query, offset)` — function parameter hints
- `format(query)` — pretty-print the query
- `getFormatEdits(query)` — formatting as text edits
- `parse(query)` — full parse result (AST + errors)
- `parseDocument(query)` — multi-query: returns all regions with independent ASTs
- `getActiveRegion(query, offset)` — multi-query: region at cursor position

### Editor adapters

Each adapter converts the generic results into the editor's native
API:

- `src/providers/monaco/`
- `src/providers/vscode/`
- `src/providers/codemirror/`

Diagnostics are slightly special:

- Monaco uses `setModelMarkers(...)`
- VS Code uses `DiagnosticCollection`
- CodeMirror uses a lint source

So diagnostics are implemented as controller-style adapters rather
than a classic `register*Provider()` interface.

## Monaco

These examples register features; your application must create a Monaco editor/model with language
ID `cosmosdb-sql` in a DOM container. See the [README quick start](../README.md#option-c-use-a-provider-monaco).
Keep the returned `disposable` or `disposables` and dispose them with your editor/model on teardown.

### Easiest option

```typescript
import * as monaco from 'monaco-editor';
import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import { registerCosmosDbSql } from '@azure/cosmosdb-nosql-language-service/monaco';

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

const disposable = registerCosmosDbSql(monaco, service, {
  languageId: 'cosmosdb-sql',
  completions: true,
  diagnostics: true,
  hover: true,
  signatureHelp: true,
  formatting: true,
});
```

### Explicit wiring

```typescript
import * as monaco from 'monaco-editor';
import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import {
  LANGUAGE_ID,
  MonacoCompletionProvider,
  MonacoDiagnosticsProvider,
  MonacoFormattingProvider,
  MonacoHoverProvider,
  MonacoSignatureHelpProvider,
} from '@azure/cosmosdb-nosql-language-service/monaco';

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

monaco.languages.register({ id: LANGUAGE_ID });

const disposables = [
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, new MonacoCompletionProvider(monaco, service)),
  monaco.languages.registerHoverProvider(LANGUAGE_ID, new MonacoHoverProvider(monaco, service)),
  monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, new MonacoSignatureHelpProvider(service)),
  monaco.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, new MonacoFormattingProvider(service)),
  new MonacoDiagnosticsProvider(monaco, service, {
    languageId: LANGUAGE_ID,
    diagnosticDelay: 200,
  }),
];
```

### Monaco diagnostics only

If you only need squiggles / markers:

```typescript
import { MonacoDiagnosticsProvider } from '@azure/cosmosdb-nosql-language-service/monaco';

const diagnostics = new MonacoDiagnosticsProvider(monaco, service, {
  languageId: 'cosmosdb-sql',
  owner: 'cosmosdb-sql',
  diagnosticDelay: 200,
});
```

### Monaco multi-query features

When `multiQuery: true` is set on the service, `registerCosmosDbSql()`
automatically registers:

- **Folding ranges** — each query region is foldable (`MonacoFoldingRangeProvider`)
- **Separator decorations** — thin horizontal lines between regions (`MonacoMultiQueryDecorator`)

For explicit wiring, continue the Monaco explicit setup above (which defines `monaco`, `LANGUAGE_ID`,
`service` and `disposables`), with `multiQuery: true` on that service:

```typescript
import { MonacoFoldingRangeProvider, MonacoMultiQueryDecorator } from '@azure/cosmosdb-nosql-language-service/monaco';

disposables.push(
  monaco.languages.registerFoldingRangeProvider(LANGUAGE_ID, new MonacoFoldingRangeProvider(service)),
  new MonacoMultiQueryDecorator(monaco, service, {
    languageId: LANGUAGE_ID,
  }),
);
```

## VS Code

Configure your extension manifest's entry point, activation and `cosmosdb-sql` language contribution.
The extension host calls `activate(context)`; open a document with that language ID to exercise providers.
The helper adds its registration to `context.subscriptions`. Explicit controllers also need disposal.

### Easiest option

```typescript
import * as vscode from 'vscode';
import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import { registerCosmosDbSql } from '@azure/cosmosdb-nosql-language-service/vscode';

export function activate(context: vscode.ExtensionContext) {
  const service = new SqlLanguageService({
    getSchema: () => collectionSchema,
  });

  registerCosmosDbSql(vscode, service, context, {
    languageId: 'cosmosdb-sql',
    completions: true,
    diagnostics: true,
    hover: true,
    signatureHelp: true,
    formatting: true,
  });
}
```

### Explicit wiring

```typescript
import * as vscode from 'vscode';
import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import {
  VSCodeCompletionProvider,
  VSCodeDiagnosticsProvider,
  VSCodeFormattingProvider,
  VSCodeHoverProvider,
  VSCodeSignatureHelpProvider,
} from '@azure/cosmosdb-nosql-language-service/vscode';

export function activate(context: vscode.ExtensionContext) {
  const service = new SqlLanguageService({
    getSchema: () => collectionSchema,
  });

  const selector = { language: 'cosmosdb-sql', scheme: '*' };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new VSCodeCompletionProvider(vscode, service),
      '.',
      ' ',
      ',',
    ),
    vscode.languages.registerHoverProvider(selector, new VSCodeHoverProvider(vscode, service)),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      new VSCodeSignatureHelpProvider(vscode, service),
      '(',
      ',',
    ),
    vscode.languages.registerDocumentFormattingEditProvider(selector, new VSCodeFormattingProvider(vscode, service)),
    new VSCodeDiagnosticsProvider(vscode, service, {
      languageId: 'cosmosdb-sql',
      diagnosticDelay: 200,
    }),
  );
}
```

### VS Code diagnostics only

Put the import at module scope and the controller creation inside `activate(context)` above,
where `vscode`, `service` and `context` are available:

```typescript
import { VSCodeDiagnosticsProvider } from '@azure/cosmosdb-nosql-language-service/vscode';

const diagnostics = new VSCodeDiagnosticsProvider(vscode, service, {
  languageId: 'cosmosdb-sql',
  collectionName: 'cosmosdb-sql',
  diagnosticDelay: 200,
});
context.subscriptions.push(diagnostics);
```

### VS Code multi-query features

When `multiQuery: true` is set on the service, `registerCosmosDbSql()`
automatically registers:

- **Folding ranges** — each query region is foldable (`VSCodeFoldingRangeProvider`)
- **Separator decorations** — horizontal lines with spacing between regions (`VSCodeMultiQueryDecorator`)

For explicit wiring, put the import at module scope and the registration inside `activate(context)`
from the explicit setup above, where `selector` and `service` exist. Enable `multiQuery: true` on that service:

```typescript
import { VSCodeFoldingRangeProvider, VSCodeMultiQueryDecorator } from '@azure/cosmosdb-nosql-language-service/vscode';

context.subscriptions.push(
  vscode.languages.registerFoldingRangeProvider(selector, new VSCodeFoldingRangeProvider(vscode, service)),
  new VSCodeMultiQueryDecorator(vscode, service, {
    languageId: 'cosmosdb-sql',
  }),
);
```

## CodeMirror 6

CodeMirror already models diagnostics as lint sources, so the
explicit diagnostics integration is `createLintSource(service)`.

These snippets produce extensions for a caller-created `EditorState`/`EditorView` and DOM container;
pass the extensions into your state and destroy the view on teardown. See the
[README quick start](../README.md#option-e-use-a-provider-codemirror-6) for view creation.
Feature-only snippets reuse `service`; add their resulting extensions to your state's configuration.

### Explicit wiring

```typescript
import { autocompletion } from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { hoverTooltip } from '@codemirror/view';
import { SqlLanguageService } from '@azure/cosmosdb-nosql-language-service';
import {
  createCompletionSource,
  createHoverTooltipSource,
  createLintSource,
} from '@azure/cosmosdb-nosql-language-service/codemirror';

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
  multiQuery: true,
});

const extensions = [
  autocompletion({ override: [createCompletionSource(service)] }),
  linter(createLintSource(service)),
  hoverTooltip(createHoverTooltipSource(service)),
];
```

### CodeMirror diagnostics only

```typescript
import { linter } from '@codemirror/lint';
import { createLintSource } from '@azure/cosmosdb-nosql-language-service/codemirror';

const diagnosticsExtension = linter(createLintSource(service));
```

### CodeMirror multi-query folding

```typescript
import { foldService } from '@codemirror/language';
import { createMultiQueryFoldService } from '@azure/cosmosdb-nosql-language-service/codemirror';

const foldExtension = foldService.of(createMultiQueryFoldService(service));
```

### CodeMirror syntax highlighting

```typescript
import { StreamLanguage } from '@codemirror/language';
import { cosmosDbSqlStreamParser } from '@azure/cosmosdb-nosql-language-service/codemirror';

const langExtension = StreamLanguage.define(cosmosDbSqlStreamParser);
// Pass `langExtension` as an extension to EditorState.create({ extensions: [langExtension] })
```

### CodeMirror document formatting

```typescript
import { keymap } from '@codemirror/view';
import { createFormatCommand } from '@azure/cosmosdb-nosql-language-service/codemirror';

const formatCommand = createFormatCommand(service);
const ext = keymap.of([{ key: 'Shift-Alt-f', run: formatCommand }]);
```

### CodeMirror signature help

```typescript
import { createSignatureHelpSource } from '@azure/cosmosdb-nosql-language-service/codemirror';

// Returns a Tooltip | null for the current cursor position.
// Wire it into a StateField + showTooltip, or call it from
// an EditorView.updateListener to show/hide on cursor changes.
const sigSource = createSignatureHelpSource(service);
```

## Writing your own adapter

If your editor is not Monaco, VS Code, or CodeMirror, use the
language service directly.

The examples below reuse the shared `service`. `query` is the current document text and `offset`
is its cursor offset. `myEditor` is a placeholder for your host's API, not an export of this package;
adapt its change/completion registration and marker methods to your editor.

### Diagnostics

```typescript
const diagnostics = service.getDiagnostics(query);
```

Each diagnostic has:

```typescript
interface Diagnostic {
  range: {
    startOffset: number;
    endOffset: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  message: string;
  severity: 1 | 2 | 3 | 4;
  code?: string;
  source?: string;
}
```

### Minimal custom adapter example

```typescript
myEditor.onChange((query: string) => {
  const diagnostics = service.getDiagnostics(query);
  myEditor.setMarkers(
    diagnostics.map((d) => ({
      from: d.range.startOffset,
      to: d.range.endOffset,
      message: d.message,
      severity: d.severity === 1 ? 'error' : 'warning',
    })),
  );
});

myEditor.onCompletion((query: string, offset: number) => {
  return service.getCompletions(query, offset);
});
```

## Choosing between helper and explicit wiring

Use `registerCosmosDbSql(...)` when:

- you want everything on quickly
- the default trigger characters are fine
- the default diagnostics controller behavior is fine

Use explicit wiring when:

- you only want some features
- you want diagnostics without completions or hover
- you want custom debounce timing
- you want to control lifetime / disposal separately
- you are integrating into a custom editor surface

## Validation

After changing adapter wiring, validate with:

```powershell
npm run lint
npm run build
npx vitest run tests/parser/parser.test.ts
```
