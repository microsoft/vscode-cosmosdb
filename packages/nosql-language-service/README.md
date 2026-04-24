# @cosmosdb/nosql-language-service

TypeScript parser for CosmosDB NoSQL SQL with error recovery,
autocomplete, and AST transformation.

Built on [Chevrotain](https://chevrotain.io/) — works in
Node.js and browsers (including Electron).

## Features

- ✅ **Full grammar** — all CosmosDB NoSQL: SELECT, FROM,
  WHERE, JOIN, GROUP BY, ORDER BY, OFFSET/LIMIT, TOP,
  DISTINCT, VALUE, UDF, BETWEEN, IN, LIKE,
  EXISTS, ARRAY, subqueries, ternary, coalesce, bitwise operators
- ✅ **Error recovery** — never throws; returns partial AST +
  structured errors with typed codes
- ✅ **Source positions** — `{ offset, line, col }` on every
  AST node for editor integration
- ✅ **Autocomplete** — context-aware suggestions with schema
  field navigation and priority ranking
- ✅ **Round-trip** — parse → modify AST → print back to SQL
- ✅ **Visitor pattern** — type-safe AST traversal
- ✅ **IDE-agnostic** — pure API with zero editor dependencies
- ✅ **Ready-made providers** — plug-and-play adapters for
  Monaco, VS Code, and CodeMirror 6
- ✅ **Zero runtime deps** — only Chevrotain (~45KB)

## Install

```bash
npm install @cosmosdb/nosql-language-service
```

## Architecture — Three Layers

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Core API                              │
│  parse(), sqlToString(), getCompletions(),      │
│  AST types, Visitor, errors                     │
├─────────────────────────────────────────────────┤
│  Layer 2: Language Service                      │
│  SqlLanguageService — IDE-agnostic facade       │
│  Diagnostics, Hover, Signature Help, Formatting │
├─────────────────────────────────────────────────┤
│  Layer 3: Provider Adapters (pick one)          │
│  @cosmosdb/nosql-language-service/monaco        │
│  @cosmosdb/nosql-language-service/vscode        │
│  @cosmosdb/snosql-language-service/codemirror   │
│  (or write your own)                            │
└─────────────────────────────────────────────────┘
```

**You can use any layer independently:**

- **Layer 1 only** — import `parse`, `getCompletions`, etc.
  and wire up your own editor integration.
- **Layer 2** — use `SqlLanguageService` for a unified API
  that returns generic types (no editor deps).
- **Layer 3** — use a ready-made provider to register all
  language features in one line.

## Quick Start

### Option A: Use the Core API directly

```typescript
import { parse, sqlToString, getCompletions } from "@cosmosdb/nosql-language-service";

// Parse a query
const { ast, errors } = parse("SELECT * FROM c WHERE c.age > 21");

if (errors.length === 0) {
  console.log(ast.query.select.spec.kind); // "SelectStarSpec"
}

// Round-trip: AST → SQL string
const sql = sqlToString(ast!);
console.log(sql); // "SELECT * FROM c WHERE c.age > 21"

// Autocomplete
const items = getCompletions({ query: "SELECT c.", offset: 9, schema });
```

### Option B: Use the Language Service

```typescript
import { SqlLanguageService } from "@cosmosdb/nosql-language-service";

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

// All features through a single object
const diagnostics = service.getDiagnostics("SELECT * FORM c");
const completions = service.getCompletions("SELECT c.", 9);
const hover       = service.getHoverInfo("SELECT COUNT(c.id) FROM c", 7);
const sigHelp     = service.getSignatureHelp("CONTAINS(c.name, ", 18);
const formatted   = service.format("SELECT  *  FROM  c");
```

### Option C: Use a Provider (Monaco)

```typescript
import * as monaco from "monaco-editor";
import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
import { registerCosmosDbSql } from "@cosmosdb/nosql-language-service/monaco";

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

// One line — registers completions, diagnostics, hover,
// signature help, and formatting
const disposable = registerCosmosDbSql(monaco, service);
```

### Option C: Use a Provider (VS Code Extension)

```typescript
import * as vscode from "vscode";
import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
import { registerCosmosDbSql } from "@cosmosdb/nosql-language-service/vscode";

export function activate(context: vscode.ExtensionContext) {
  const service = new SqlLanguageService({
    getSchema: () => collectionSchema,
  });

  registerCosmosDbSql(vscode, service, context);
}
```

### Option C: Use a Provider (CodeMirror 6)

```typescript
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { hoverTooltip } from "@codemirror/view";
import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
import {
  createCompletionSource,
  createLintSource,
  createHoverTooltipSource,
} from "@cosmosdb/nosql-language-service/codemirror";

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

const extensions = [
  autocompletion({ override: [createCompletionSource(service)] }),
  linter(createLintSource(service)),
  hoverTooltip(createHoverTooltipSource(service)),
];
```

## Package Exports

| Import path | What you get |
|---|---|
| `@cosmosdb/nosql-language-service` | Core API + `SqlLanguageService` + all types |
| `@cosmosdb/nosql-language-service/services` | `SqlLanguageService` + types only |
| `@cosmosdb/nosql-language-service/monaco` | Monaco adapter |
| `@cosmosdb/nosql-language-service/vscode` | VS Code adapter |
| `@cosmosdb/nosql-language-service/codemirror` | CodeMirror 6 adapter |

## API Reference

### Core

#### `parse(query: string): ParseResult`

Parse a SQL string. Returns `{ ast?, errors[] }`.

#### `sqlToString(program: SqlProgram): string`

Serialize an AST back to a canonical SQL string.

#### `getCompletions(request: CompletionRequest): CompletionItem[]`

Get autocomplete suggestions for a cursor position.

```typescript
interface CompletionRequest {
  query: string;           // the full query text
  offset: number;          // 0-based cursor offset
  schema?: JSONSchema;     // collection schema (optional)
  aliases?: string[];      // override auto-detected aliases
}

interface CompletionItem {
  label: string;
  kind: "keyword" | "field" | "function" | "snippet" | "alias";
  detail?: string;         // e.g., field type
  sortText?: string;       // for priority ordering
  insertText?: string;     // text to insert (e.g., "COUNT($0)")
}
```

### Language Service

#### `new SqlLanguageService(host?)`

Create a language service with an optional host for runtime
configuration:

```typescript
interface LanguageServiceHost {
  getSchema?(): JSONSchema | undefined;
  getAliases?(): string[] | undefined;
}
```

#### `service.getDiagnostics(query): Diagnostic[]`

Returns structured diagnostics with range, severity, code.

#### `service.getCompletions(query, offset): CompletionItem[]`

Context-aware autocomplete (same as `getCompletions` but uses
the host's schema automatically).

#### `service.getHoverInfo(query, offset): HoverInfo | null`

Returns hover content for functions, keywords, and schema
fields.

#### `service.getSignatureHelp(query, offset): SignatureHelpResult | null`

Returns active function signature and parameter index.

#### `service.format(query): string`

Returns formatted SQL (parse → reprint).

#### `service.getFormatEdits(query): TextEdit[]`

Returns text edits for incremental formatting.

### Provider Adapters

Each provider adapter ships with **standalone provider
classes** for fine-grained control, plus a convenience
`registerCosmosDbSql()` that wires everything up at once.

For full, explicit wiring examples — including diagnostics-only
setup and standalone adapter usage for Monaco, VS Code, and
CodeMirror — see [Editor Integration](docs/editor-integration.md).

| Adapter | One-line helper | Explicit diagnostics adapter |
|---|---|---|
| Monaco | `registerCosmosDbSql(monaco, service)` | `MonacoDiagnosticsProvider` |
| VS Code | `registerCosmosDbSql(vscode, service, context)` | `VSCodeDiagnosticsProvider` |
| CodeMirror 6 | compose extensions manually | `createLintSource(service)` |

All providers accept an options object to enable/disable
individual features (completions, diagnostics, hover,
signatureHelp, formatting).

## Error Handling

```typescript
const { ast, errors } = parse("SELECT * FORM c");

for (const err of errors) {
  console.log(err.code);    // "UNEXPECTED_TOKEN"
  console.log(err.message); // "expecting FROM but found..."
  console.log(err.range);   // { start: { offset, line, col }, end: ... }
}
// ast is still present (partial, via error recovery)
```

## Writing a Custom Provider

If your editor isn't Monaco, VS Code, or CodeMirror, use the
`SqlLanguageService` directly. For the full custom adapter example
and the generic diagnostics/completion shapes, see
[Editor Integration](docs/editor-integration.md).

## AST Node Types

Every node has a `kind` discriminant for exhaustive
pattern matching:

- **Query structure:** `Program`, `Query`, `SelectClause`,
  `FromClause`, `WhereClause`, `GroupByClause`,
  `OrderByClause`, `OffsetLimitClause`
- **SELECT spec:** `SelectListSpec`, `SelectValueSpec`,
  `SelectStarSpec`, `SelectItem`, `TopSpec`
- **Collections:** `AliasedCollectionExpression`,
  `ArrayIteratorCollectionExpression`,
  `JoinCollectionExpression`, `InputPathCollection`,
  `SubqueryCollection`
- **Scalar expressions:** `BinaryScalarExpression`,
  `UnaryScalarExpression`, `PropertyRefScalarExpression`,
  `FunctionCallScalarExpression`, `LiteralScalarExpression`,
  `BetweenScalarExpression`, `InScalarExpression`,
  `LikeScalarExpression`, `ConditionalScalarExpression`,
  `CoalesceScalarExpression`, `ExistsScalarExpression`,
  `ArrayScalarExpression`, `SubqueryScalarExpression`,
  `MemberIndexerScalarExpression`,
  `ArrayCreateScalarExpression`,
  `ObjectCreateScalarExpression`, and more
- **Leaves:** `Identifier`, `Parameter`, `StringLiteral`,
  `NumberLiteral`, `BooleanLiteral`, `NullLiteral`,
  `UndefinedLiteral`

## Documentation

- [Architecture](docs/architecture.md) — pipeline, module
  graph, layered design, provider pattern
- [Editor Integration](docs/editor-integration.md) — explicit
  Monaco, VS Code, CodeMirror, and custom editor wiring
- [Completion Engine](docs/completion.md) — context detection,
  priority weights, schema navigation
- [C++ Grammar Parity](docs/cpp-parity.md) — source-of-truth
  grammar contract, locked precedence rules, intentional
  recovery-only deviations
- [Design Decisions](docs/decisions.md) — why Chevrotain,
  why immutable AST, token ordering

## Development

```bash
npm install
npm test            # run tests (vitest)
npm run test:watch  # watch mode
npm run build       # compile ESM + CJS
npm run lint        # type-check
```

## License

MIT
