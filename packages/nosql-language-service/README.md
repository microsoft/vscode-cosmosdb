# @azure/cosmosdb-nosql-language-service

TypeScript parser for the Cosmos DB query language with error recovery,
autocomplete, and AST transformation.

Built on [Chevrotain](https://chevrotain.io/) — for Node.js and
modern browser/Electron applications using an ESM-capable bundler.

For the query language itself, see the [Microsoft Learn query reference](https://learn.microsoft.com/en-us/cosmos-db/query/)
and [built-in functions](https://learn.microsoft.com/en-us/cosmos-db/query/#system-functions).
This README describes the package API, not the complete language or server validation rules.

## Features

- ✅ **Full grammar** — Cosmos DB query language constructs: SELECT, FROM,
  WHERE, JOIN, GROUP BY, ORDER BY, OFFSET/LIMIT, TOP,
  DISTINCT, VALUE, UDF, BETWEEN, IN, LIKE,
  EXISTS, ARRAY, subqueries, ternary, coalesce, bitwise operators
- ✅ **Error recovery** — reports syntax errors with typed codes;
  recovers a partial AST when possible and rejects excessive complexity
- ✅ **Source positions** — optional `{ offset, line, col }` ranges on
  AST nodes for editor integration
- ✅ **Autocomplete** — context-aware suggestions with schema
  field navigation and priority ranking
- ✅ **Round-trip** — parse → modify AST → print back to query text
- ✅ **Visitor pattern** — type-safe AST traversal
- ✅ **IDE-agnostic** — pure API with zero editor dependencies
- ✅ **Ready-made providers** — plug-and-play adapters for
  Monaco, VS Code, and CodeMirror 6
- ✅ **Editor-independent core** — runtime dependencies are Chevrotain
  and `@azure/cosmosdb-schema-analyzer`; editor SDKs are optional peers

## Install

Runtime and dependency requirements are declared in [package.json](package.json).
For browser/Electron applications, configure editor workers and assets through your bundler.

| Entry point         | Additional editor requirements                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Root or `/services` | None; no editor peers needed                                                                                    |
| `/monaco`           | `monaco-editor`                                                                                                 |
| `/codemirror`       | `@codemirror/autocomplete`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/state`, `@codemirror/view` |
| `/vscode`           | Actual VS Code extension host; host-provided `vscode` API and `@types/vscode` for TypeScript development        |

Editor peers are optional for core users, but install the peers for the adapter you use.

Core or language service only:

```bash
npm install @azure/cosmosdb-nosql-language-service
```

Monaco:

```bash
npm install @azure/cosmosdb-nosql-language-service monaco-editor
```

CodeMirror 6 (all five peers):

```bash
npm install @azure/cosmosdb-nosql-language-service @codemirror/autocomplete @codemirror/language @codemirror/lint @codemirror/state @codemirror/view
```

VS Code extension:

```bash
npm install @azure/cosmosdb-nosql-language-service
npm install --save-dev @types/vscode
```

The `/vscode` adapter runs in a VS Code extension host, which supplies the `vscode` API.
Align `@types/vscode` with your extension's target and keep `vscode` external when bundling.

## Debugging the published package

See the [changelog](CHANGELOG.md) for release changes and compatibility notes.

JavaScript source maps include the original TypeScript for debugging. Declaration maps are also included;
navigating from declarations to source requires a separate source checkout.

## Architecture — Three Layers

```
┌────────────────────────────────────────────────────┐
│  Layer 1: Core API                                 │
│  parse(), sqlToString(), getCompletions(),         │
│  AST types, Visitor, errors                        │
├────────────────────────────────────────────────────┤
│  Layer 2: Language Service                         │
│  SqlLanguageService — IDE-agnostic facade          │
│  Diagnostics, Hover, Signature Help, Formatting    │
├─────────────────────────────────────────────────   ┤
│  Layer 3: Provider Adapters (pick one)             │
│  @azure/cosmosdb-nosql-language-service/monaco     │
│  @azure/cosmosdb-nosql-language-service/vscode     │
│  @azure/cosmosdb-nosql-language-service/codemirror │
│  (or write your own)                               │
└────────────────────────────────────────────────────┘
```

**You can use any layer independently:**

- **Layer 1 only** — import `parse`, `getCompletions`, etc.
  and wire up your own editor integration.
- **Layer 2** — use `SqlLanguageService` for a unified API
  that returns generic types (no editor deps).
- **Layer 3** — use a registration helper for Monaco/VS Code, or compose CodeMirror extensions.

## Quick Start

### Option A: Use the Core API directly

```typescript
import { parse, sqlToString, getCompletions, type JSONSchema } from "@azure/cosmosdb-nosql-language-service";

const schema: JSONSchema = {
  type: "object",
  properties: { age: { type: "number" }, name: { type: "string" } },
};

// Parse a query
const { ast, errors } = parse("SELECT * FROM c WHERE c.age > 21");

if (ast && errors.length === 0) {
  console.log(ast.query.select.spec.kind); // "SelectStarSpec"

  // Round-trip: AST → query text
  const sql = sqlToString(ast);
  console.log(sql); // "SELECT * FROM c WHERE c.age > 21"
}

// Autocomplete
const items = getCompletions({ query: "SELECT c.", offset: 9, schema });
```

### Option B: Use the Language Service

```typescript
import { DiagnosticSeverity, SqlLanguageService, type JSONSchema } from "@azure/cosmosdb-nosql-language-service";

const collectionSchema: JSONSchema = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" } },
};

const service = new SqlLanguageService({
  getSchema: () => collectionSchema,
});

// All features through a single object
const diagnostics = service.getDiagnostics("SELECT * FORM c");
const errors = diagnostics.filter(diagnostic => diagnostic.severity === DiagnosticSeverity.Error);
const completions = service.getCompletions("SELECT c.", 9);
const hover       = service.getHoverInfo("SELECT COUNT(c.id) FROM c", 7);
const signatureQuery = "CONTAINS(c.name, ";
const sigHelp     = service.getSignatureHelp(signatureQuery, signatureQuery.length);
const formatted   = service.format("SELECT  *  FROM  c");
```

### Option C: Use a Provider (Monaco)

Run in a browser/Electron renderer with the Monaco install and bundler setup above.

```typescript
import * as monaco from "monaco-editor";
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import { registerCosmosDbSql } from "@azure/cosmosdb-nosql-language-service/monaco";

const service = new SqlLanguageService();

// One line — registers completions, diagnostics, hover,
// signature help, and formatting
const disposable = registerCosmosDbSql(monaco, service);

const container = document.createElement("div");
container.style.height = "300px";
document.body.appendChild(container);
const model = monaco.editor.createModel("SELECT * FROM c", "cosmosdb-sql");
const editor = monaco.editor.create(container, { model });

// On application teardown: editor.dispose(); model.dispose(); disposable.dispose();
```

### Option D: Use a Provider (VS Code Extension)

This is an extension entry point, loaded by VS Code, not a standalone script. Configure your
extension manifest's entry point, activation and language contribution for `cosmosdb-sql`;
open a document with that language ID. Registration below is disposed through `context.subscriptions`.

```typescript
import * as vscode from "vscode";
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import { registerCosmosDbSql } from "@azure/cosmosdb-nosql-language-service/vscode";

export function activate(context: vscode.ExtensionContext) {
  const service = new SqlLanguageService();

  registerCosmosDbSql(vscode, service, context);
}
```

### Option E: Use a Provider (CodeMirror 6)

Run in a browser/Electron renderer with all five CodeMirror peers installed.

```typescript
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import {
  createCompletionSource,
  createLintSource,
  createHoverTooltipSource,
} from "@azure/cosmosdb-nosql-language-service/codemirror";

const service = new SqlLanguageService();

const extensions = [
  autocompletion({ override: [createCompletionSource(service)] }),
  linter(createLintSource(service)),
  hoverTooltip(createHoverTooltipSource(service)),
];

const editor = new EditorView({
  state: EditorState.create({ doc: "SELECT * FROM c", extensions }),
  parent: document.body,
});

// On application teardown: editor.destroy();
```

## Package Exports

| Import path                                         | What you get                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@azure/cosmosdb-nosql-language-service`            | Core API + language service + runtime enums and public types                                      |
| `@azure/cosmosdb-nosql-language-service/services`   | Language service, `DiagnosticSeverity`, function metadata, multi-query helpers, and service types |
| `@azure/cosmosdb-nosql-language-service/monaco`     | Monaco adapter                                                                                    |
| `@azure/cosmosdb-nosql-language-service/vscode`     | VS Code adapter                                                                                   |
| `@azure/cosmosdb-nosql-language-service/codemirror` | CodeMirror 6 adapter                                                                              |

## API Reference

### Core

#### `parse(query: string): ParseResult`

Parse query text. Returns `{ ast?, errors[] }`.

Syntax errors are reported in `errors`; recovery may return a partial AST, but its presence and
completeness are not guaranteed. Check both `errors` and `ast` before printing or evaluating a result.

To bound stack usage, parsing allows at most **512 simultaneously active grammar rules**, and the
returned AST at most **256 node levels**, counting the `Program` root as level 1 (arrays of children
do not add a level). These are structural limits, not a character or parenthesis count: unary,
coalesce and conditional chains also consume the budget. Exceeding either limit returns
`QUERY_TOO_COMPLEX` with no AST. Subsequent calls, including other regions in a multi-query document,
remain usable. Formatting preserves the text of rejected query regions.

This is not an unconditional "never throws" guarantee: unexpected implementation errors and runtime
resource failures propagate. These limits do not bound total query length, token count, or execution time.

#### Source coordinates

Offsets and columns count **UTF-16 code units**, matching JavaScript string indexing (not bytes,
Unicode code points, or rendered graphemes). Offsets are 0-based; lines and columns are 1-based.
Tabs count as one code unit. LF, CRLF and CR each advance one line.
Ranges include the start and exclude the end; EOF errors have an empty range at `query.length`.
For example, a supplementary Unicode character such as an emoji occupies two code units.

The same units apply to completion cursor offsets, AST/error ranges, hover ranges, and formatting edits.
Multi-query regions use document offsets, while their `parseResult` ranges are local to the region's text;
the language service maps diagnostics and editor-facing results back to document coordinates.
See [editor coordinate mapping](docs/editor-integration.md#coordinate-contract).

#### `sqlToString(program: SqlProgram): string`

Serialize an AST back to canonical query text.

#### `getCompletions(request: CompletionRequest): CompletionItem[]`

Get autocomplete suggestions for a cursor position.

```typescript
interface CompletionRequest {
  query: string;           // the full query text
  offset: number;          // 0-based UTF-16 code-unit cursor offset
  schema?: JSONSchema;     // collection schema (optional)
  aliases?: string[];      // override auto-detected aliases
}

interface CompletionItem {
  label: string;
  kind: "keyword" | "field" | "function" | "snippet" | "parameter" | "alias";
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
  multiQuery?: boolean;
}
```

#### Schema input and ownership

`JSONSchema` is re-exported from `@azure/cosmosdb-schema-analyzer`. The language service uses a
**field projection**, not a general JSON Schema validator: supply the collection document shape
with a root `properties` map and object-valued property schemas. Nested objects use `properties`;
array navigation uses `type: "array"` with a single object-valued `items` schema, not tuple items.
Field `type` supplies display text (completion uses the first entry of a type array), and optional
`x-occurrence` percentages rank completions. `$ref`, `allOf`/`anyOf`/`oneOf`, boolean schemas and
validation keywords are not resolved into fields. Normalize such schemas to this projection first.

Completion paths remove the collection alias before navigating this shape. Field hover currently walks
the literal dotted prefix, including an alias such as `c`; it is not a general alias/schema resolver,
so a collection-shaped schema does not guarantee hover for every aliased field.

The host and its schema remain caller-owned: the service reads callbacks as features are requested;
it does not clone or freeze the supplied schema. Keep it stable during a call, and return the current
schema when your collection changes. No schema is required for parsing or built-in function help.
Schema-assisted suggestions and local diagnostics do not establish that the Cosmos DB server will accept a query.

AST nodes are readonly by TypeScript convention, not runtime-frozen. Create replacement nodes when
transforming a tree. In particular, `QueryRegion.parseResult` is lazy and memoized: repeated reads of
one region return the same result/AST, not independent copies. The mutable snapshots for function
metadata and signature help described below do not imply a blanket copy guarantee for all API results.

#### `service.getDiagnostics(query): Diagnostic[]`

Returns structured diagnostics with range, severity, code.
`DiagnosticSeverity` is a runtime enum available from both the root and `/services`:
`Error = 1`, `Warning = 2`, `Information = 3`, `Hint = 4`.

#### `service.getCompletions(query, offset): CompletionItem[]`

Context-aware autocomplete (same as `getCompletions` but uses
the host's schema automatically).

#### `service.getHoverInfo(query, offset): HoverInfo | null`

Returns hover content for functions, keywords, and schema
fields.

#### `service.getSignatureHelp(query, offset): SignatureHelpResult | null`

Returns active function signature and parameter index.
The result is an independently mutable snapshot, including nested signatures and parameters.
Changes to it do not affect subsequent calls or other language service instances.

#### `getFunctionMeta(name)` and `FUNCTION_SIGNATURES`

Available from the root and `/services`. `getFunctionMeta()` performs a case-insensitive lookup and returns
an independent mutable metadata snapshot, or `undefined` for an unknown function.
`FUNCTION_SIGNATURES` is the shared built-in registry and is deeply read-only in both TypeScript and JavaScript.
Its entries, signature arrays, signatures, parameter arrays and parameters are frozen; it is not a registration API.
Code that previously edited the registry must instead modify a snapshot returned by `getFunctionMeta()`;
those local changes do not customize the language service's built-ins.

#### `service.format(query): string`

Returns formatted query text (parse → reprint).

#### `service.getFormatEdits(query): TextEdit[]`

Returns text edits for incremental formatting.

### Provider Adapters

Monaco and VS Code ship **standalone provider classes** for fine-grained control, plus a convenience
`registerCosmosDbSql()` helper. CodeMirror exposes source/extension factories that you compose yourself.

For full, explicit wiring examples — including diagnostics-only
setup and standalone adapter usage for Monaco, VS Code, and
CodeMirror — see [Editor Integration](docs/editor-integration.md).

| Adapter      | One-line helper                                 | Explicit diagnostics adapter |
| ------------ | ----------------------------------------------- | ---------------------------- |
| Monaco       | `registerCosmosDbSql(monaco, service)`          | `MonacoDiagnosticsProvider`  |
| VS Code      | `registerCosmosDbSql(vscode, service, context)` | `VSCodeDiagnosticsProvider`  |
| CodeMirror 6 | compose extensions manually                     | `createLintSource(service)`  |

The Monaco and VS Code registration helpers accept options to enable/disable individual features
(completions, diagnostics, hover, signatureHelp, formatting). For CodeMirror, select the factories
and extensions you need.

## Error Handling

```typescript
import { parse } from "@azure/cosmosdb-nosql-language-service";

const { ast, errors } = parse("SELECT * FORM c");

for (const err of errors) {
  console.log(err.code);    // "UNEXPECTED_TOKEN"
  console.log(err.message); // "expecting FROM but found..."
  console.log(err.range);   // { start: { offset, line, col }, end: ... }
}
// ast may be present as a recovered partial tree; check before use.
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
- [Grammar Discrepancies](docs/grammar-discrepancies.md) —
  known differences between the TypeScript parser and the C++ reference
- [Error Messages](docs/error-messages.md) — human-friendly
  error message provider design
- [Typo Detection](docs/typo-detection.md) — keyword-typo
  diagnostic heuristics
- [Design Decisions](docs/decisions.md) — why Chevrotain,
  why immutable AST, token ordering
- [Test Suite](docs/test-suite.md) — fixture breakdown,
  unit vs integration layers, known emulator limitations,
  how to run tests locally

## Development

```bash
npm install
npm run vitest          # unit tests (no emulator needed)
npm run vitest:ui       # watch mode with UI
npm run build           # compile ESM
npm run lint            # ESLint
```

### Integration tests (requires Cosmos DB Emulator)

```bash
# Start the emulator (from repo root)
docker compose up -d

# Seed test data (first time or after --reset)
node scripts/import-seed.mjs --all --endpoint https://localhost:8081

# Run all tests including integration
cd packages/nosql-language-service
NODE_TLS_REJECT_UNAUTHORIZED=0 COSMOS_ENDPOINT=https://localhost:8081 npx vitest run
```

See [docs/test-suite.md](docs/test-suite.md) for the full fixture breakdown.

## License

MIT
