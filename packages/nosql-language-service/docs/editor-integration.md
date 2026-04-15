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

This guide shows how to wire `@cosmosdb/nosql-language-service` into an editor
explicitly, without relying only on the convenience
`registerCosmosDbSql()` helpers.

The architecture is intentionally split into two layers:

- `SqlLanguageService` in `src/services/` is IDE-agnostic
- editor-specific adapters in `src/providers/` translate generic
  results into Monaco, VS Code, or CodeMirror APIs

## Shared setup

All integrations start the same way:

```typescript
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
  getAliases: () => ['c'],
  multiQuery: true, // enable multi-query document support (semicolon-separated)
});
```

You can then either:

1. use a one-line registration helper, or
2. wire each feature explicitly

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

- `src/providers/monaco.ts`
- `src/providers/vscode.ts`
- `src/providers/codemirror.ts`

Diagnostics are slightly special:

- Monaco uses `setModelMarkers(...)`
- VS Code uses `DiagnosticCollection`
- CodeMirror uses a lint source

So diagnostics are implemented as controller-style adapters rather
than a classic `register*Provider()` interface.

## Monaco

### Easiest option

```typescript
import * as monaco from 'monaco-editor';
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import { registerCosmosDbSql } from '@cosmosdb/nosql-language-service/monaco';

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
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import {
  LANGUAGE_ID,
  MonacoCompletionProvider,
  MonacoDiagnosticsProvider,
  MonacoFormattingProvider,
  MonacoHoverProvider,
  MonacoSignatureHelpProvider,
} from '@cosmosdb/nosql-language-service/monaco';

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
import { MonacoDiagnosticsProvider } from '@cosmosdb/nosql-language-service/monaco';

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

For explicit wiring:

```typescript
import { MonacoFoldingRangeProvider, MonacoMultiQueryDecorator } from '@cosmosdb/nosql-language-service/monaco';

disposables.push(
  monaco.languages.registerFoldingRangeProvider(LANGUAGE_ID, new MonacoFoldingRangeProvider(service)),
  new MonacoMultiQueryDecorator(monaco, service, {
    languageId: LANGUAGE_ID,
  }),
);
```

## VS Code

### Easiest option

```typescript
import * as vscode from 'vscode';
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import { registerCosmosDbSql } from '@cosmosdb/nosql-language-service/vscode';

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
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import {
  VSCodeCompletionProvider,
  VSCodeDiagnosticsProvider,
  VSCodeFormattingProvider,
  VSCodeHoverProvider,
  VSCodeSignatureHelpProvider,
} from '@cosmosdb/nosql-language-service/vscode';

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

```typescript
import { VSCodeDiagnosticsProvider } from '@cosmosdb/nosql-language-service/vscode';

const diagnostics = new VSCodeDiagnosticsProvider(vscode, service, {
  languageId: 'cosmosdb-sql',
  collectionName: 'cosmosdb-sql',
  diagnosticDelay: 200,
});
```

### VS Code multi-query features

When `multiQuery: true` is set on the service, `registerCosmosDbSql()`
automatically registers:

- **Folding ranges** — each query region is foldable (`VSCodeFoldingRangeProvider`)
- **Separator decorations** — horizontal lines with spacing between regions (`VSCodeMultiQueryDecorator`)

For explicit wiring:

```typescript
import { VSCodeFoldingRangeProvider, VSCodeMultiQueryDecorator } from '@cosmosdb/nosql-language-service/vscode';

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

### Explicit wiring

```typescript
import { autocompletion } from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { hoverTooltip } from '@codemirror/view';
import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import {
  createCompletionSource,
  createHoverTooltipSource,
  createLintSource,
} from '@cosmosdb/nosql-language-service/codemirror';

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
import { createLintSource } from '@cosmosdb/nosql-language-service/codemirror';

const diagnosticsExtension = linter(createLintSource(service));
```

### CodeMirror multi-query folding

```typescript
import { foldService } from '@codemirror/language';
import { createMultiQueryFoldService } from '@cosmosdb/nosql-language-service/codemirror';

const foldExtension = foldService.of(createMultiQueryFoldService(service));
```

### CodeMirror syntax highlighting

```typescript
import { StreamLanguage } from '@codemirror/language';
import { cosmosDbSqlStreamParser } from '@cosmosdb/nosql-language-service/codemirror';

const langExtension = StreamLanguage.define(cosmosDbSqlStreamParser);
// Pass `langExtension` as an extension to EditorState.create({ extensions: [langExtension] })
```

### CodeMirror document formatting

```typescript
import { keymap } from '@codemirror/view';
import { createFormatCommand } from '@cosmosdb/nosql-language-service/codemirror';

const formatCommand = createFormatCommand(service);
const ext = keymap.of([{ key: 'Shift-Alt-f', run: formatCommand }]);
```

### CodeMirror signature help

```typescript
import { createSignatureHelpSource } from '@cosmosdb/nosql-language-service/codemirror';

// Returns a Tooltip | null for the current cursor position.
// Wire it into a StateField + showTooltip, or call it from
// an EditorView.updateListener to show/hide on cursor changes.
const sigSource = createSignatureHelpSource(service);
```

## Writing your own adapter

If your editor is not Monaco, VS Code, or CodeMirror, use the
language service directly.

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
const service = new SqlLanguageService({
  getSchema: () => schema,
});

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
pnpm run lint
pnpm run build
npx vitest run tests/parser/parser.test.ts
```
