# Architecture

## Pipeline

```
Query String
    │
    ▼
┌───────────┐     Chevrotain Lexer
│  SqlLexer │──→  IToken[] (with line/col/offset)
└───────────┘
    │
    ▼
┌────────────┐    Chevrotain EmbeddedActionsParser
│  SqlParser │──→ SqlProgram (AST root)
└────────────┘    with optional SourceRange on nodes
    │
    ▼
┌────────────┐
│  Consumer  │──→ One of:
└────────────┘
    ├── SqlPrinter           → query text (round-trip)
    ├── SqlVisitor           → custom traversal
    ├── SqlCompletion        → CompletionItem[] (generic)
    ├── SqlLanguageService   → IDE-agnostic facade ①
    ├── Direct AST           → validation, analysis, etc.
    │
    │   ① SqlLanguageService wraps all features:
    │
    ▼
┌──────────────────────┐
│ SqlLanguageService   │ IDE-agnostic, no editor dependencies
│  .getDiagnostics()   │
│  .getCompletions()   │
│  .getHoverInfo()     │
│  .getSignatureHelp() │
│  .format()           │
└──────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  Provider Adapters      │  (optional — pick one)
├─────────────────────────┤
│ providers/monaco/       │  → Monaco Editor
│ providers/vscode/       │  → VS Code Extension
│ providers/codemirror/   │  → CodeMirror 6
│ (write your own)        │  → any editor / custom UI
└─────────────────────────┘
```

## Module Dependency Graph

```
index.ts  (public API: parse, sqlToString, getCompletions, SqlLanguageService, types)
    ├── lexer/SqlLexer.ts
    │       └── lexer/tokens.ts   (all token definitions)
    ├── parser/SqlParser.ts
    │       ├── lexer/tokens.ts
    │       ├── ast/nodes.ts      (all AST types)
    │       └── errors/SqlErrorMessageProvider.ts  (human-friendly error messages)
    ├── printer/SqlPrinter.ts
    │       └── ast/nodes.ts
    ├── visitor/SqlVisitor.ts
    │       └── ast/nodes.ts
    ├── completion/SqlCompletion.ts
    │       ├── lexer/tokens.ts
    │       └── @azure/cosmosdb-schema-analyzer  (JSONSchema type)
    ├── diagnostics/typoDetection.ts  (near-miss keyword detection)
    │       └── lexer/tokens.ts
    ├── errors/SqlError.ts        (SourceRange, error codes)
    └── services/
        ├── types.ts              (Diagnostic, HoverInfo, etc.)
        ├── SqlLanguageService.ts (facade)
        └── functionSignatures.ts (hover/signature metadata)

providers/monaco/     ──→ services/SqlLanguageService
providers/vscode/     ──→ services/SqlLanguageService
providers/codemirror/ ──→ services/SqlLanguageService
```

## Layered Architecture

The library is organized in three layers:

### Layer 1: Core (Chevrotain and schema-analyzer, no editor dependencies)

- `lexer/` — tokenizer
- `parser/` — grammar → AST
- `ast/` — node type definitions
- `printer/` — AST → query text
- `visitor/` — visitor pattern
- `errors/` — error types
- `diagnostics/` — post-parse warnings (typo detection)
- `completion/` — autocomplete engine (uses `JSONSchema` from `@azure/cosmosdb-schema-analyzer`)

### Layer 2: Language Service (zero IDE dependencies)

- `services/SqlLanguageService.ts` — facade aggregating
  diagnostics, completions, hover, signature help, formatting
- `services/types.ts` — generic IDE-agnostic types
  (`Diagnostic`, `HoverInfo`, `TextRange`, etc.)
- `services/functionSignatures.ts` — built-in function metadata

### Layer 3: Provider Adapters (editor-specific runtime integration)

- `providers/monaco/` — accepts the `monaco` namespace at runtime
- `providers/vscode/` — accepts the host-provided `vscode` API at runtime
- `providers/codemirror/` — returns sources/commands composed with CodeMirror runtime extensions;
  the separator factory also accepts CodeMirror dependencies

Editor SDK type references in adapters do not make the whole integration type-only.
Consumer wiring imports CodeMirror extensions and the VS Code host API at runtime.
Only the root and `/services` entry points are editor-independent; import the chosen adapter
explicitly and supply its editor environment. The core does not require editor peers.

## Design Principles

1. **Readonly AST contract** — nodes are plain objects with readonly TypeScript fields and a
   `kind` discriminant, not runtime-frozen objects. Create replacement nodes to transform a tree.
   Multi-query regions lazily memoize `parseResult`; repeated reads share that result and its AST.
   Do not infer independent copies from the snapshot contract of function metadata/signature help.

2. **Error recovery** — syntax errors are reported in `ParseResult.errors`;
   recovery may return a partial AST. More than 512 active parser rules
   or 256 AST node levels produces `QUERY_TOO_COMPLEX` without an AST.
   Parser depth is restored on every rule exit; AST depth is checked iteratively.
   Only the dedicated complexity exception is handled; unexpected exceptions propagate.

3. **Position tracking** — every AST node carries an optional
   `SourceRange` with `{ offset, line, col }` at start and end.
   Offsets are 0-based UTF-16 code units, lines/columns are 1-based,
   and ends are exclusive. EOF errors have zero-width ranges.

4. **No codegen step** — the grammar lives in TypeScript code
   (Chevrotain rules), not in a `.y` or `.ne` file that requires
   compilation. Trade-off: harder to diff against `sql.y`, but
   no build-time dependency on a parser generator.

5. **Schema-agnostic parser** — the parser knows nothing about collection schemas.
   Completion consumes a field projection using `properties`, `type`, single-schema array `items`
   and optional `x-occurrence`, not full JSON Schema validation or reference/composition resolution.
   Host schema objects are read, not cloned or frozen. See the
   [schema input contract](../README.md#schema-input-and-ownership), including field-hover limitations.
   Local parsing and diagnostics are not a substitute for Cosmos DB server validation.

6. **IDE-agnostic core** — the core API and `SqlLanguageService` have zero editor dependencies.
   Monaco and CodeMirror SDKs are optional peers; the VS Code API is supplied by the extension host.
   Users can write their own adapters without installing these editor SDKs.

## Package Exports

All public exports are **ESM-only**, with `import` and `types` entries and no CommonJS `require` entry.
The manifest declares **Node >=22**; editor peers and tooling may require newer runtimes.
Browser/Electron renderer consumers need a modern ESM-capable npm bundler and suitable runtime,
not raw browser imports of bare npm specifiers. The VS Code adapter requires the actual extension host.
See [installation and editor requirements](../README.md#install) for peer versions and recipes.

```
@azure/cosmosdb-nosql-language-service            → Core API + LanguageService
@azure/cosmosdb-nosql-language-service/services   → LanguageService + runtime helpers, enums and types
@azure/cosmosdb-nosql-language-service/monaco     → Monaco adapter
@azure/cosmosdb-nosql-language-service/vscode     → VS Code adapter
@azure/cosmosdb-nosql-language-service/codemirror → CodeMirror 6 adapter
```

## Key Files

| File                                | Purpose                        |
| ----------------------------------- | ------------------------------ |
| `ast/nodes.ts`                      | All AST interfaces (30+ types) |
| `parser/SqlParser.ts`               | Full grammar — the core        |
| `lexer/tokens.ts`                   | Token definitions (50+ tokens) |
| `completion/SqlCompletion.ts`       | Autocomplete engine            |
| `printer/SqlPrinter.ts`             | AST → query text serializer    |
| `visitor/SqlVisitor.ts`             | Visitor pattern dispatch       |
| `errors/SqlError.ts`                | Error types + source locations |
| `errors/SqlErrorMessageProvider.ts` | Human-friendly error messages  |
| `diagnostics/typoDetection.ts`      | Near-miss keyword warnings     |
| `services/SqlLanguageService.ts`    | IDE-agnostic facade            |
| `services/types.ts`                 | Generic language service types |
| `services/functionSignatures.ts`    | Function hover/sig metadata    |
| `providers/monaco/index.ts`         | Monaco editor adapter          |
| `providers/vscode/index.ts`         | VS Code extension adapter      |
| `providers/codemirror/index.ts`     | CodeMirror 6 adapter           |
| `index.ts`                          | Public API surface             |

## Grammar Origin

The grammar is a manual port of the LALR(1) grammar in:

```
{...}/sql/sql.y
```

The original uses Yacc/Bison with `squak.exe` to generate C++
parse tables (`y_tab.cpp`). This TypeScript version uses
Chevrotain's LL(k) algorithm with `EmbeddedActionsParser`,
which builds AST nodes directly inside grammar rules (similar
to the `{ $$ = SqlQuery::Create(...) }` actions in the `.y`).
