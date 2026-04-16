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
└────────────┘    with SourceRange on every node
    │
    ▼
┌────────────┐
│  Consumer  │──→ One of:
└────────────┘
    ├── SqlPrinter           → SQL string (round-trip)
    ├── SqlVisitor           → custom traversal
    ├── SqlCompletion        → CompletionItem[] (generic)
    ├── SqlLanguageService   → IDE-agnostic facade ①
    ├── Direct AST           → validation, analysis, etc.
    │
    │   ① SqlLanguageService wraps all features:
    │
    ▼
┌──────────────────────┐
│ SqlLanguageService   │ IDE-agnostic, zero deps
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
│ providers/monaco.ts     │  → Monaco Editor
│ providers/vscode.ts     │  → VS Code Extension
│ providers/codemirror.ts │  → CodeMirror 6
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
    │       └── @cosmosdb/schema-analyzer  (JSONSchema type)
    ├── diagnostics/typoDetection.ts  (near-miss keyword detection)
    │       └── lexer/tokens.ts
    ├── errors/SqlError.ts        (SourceRange, error codes)
    └── services/
        ├── types.ts              (Diagnostic, HoverInfo, etc.)
        ├── SqlLanguageService.ts (facade)
        └── functionSignatures.ts (hover/signature metadata)

providers/monaco.ts     ──→ services/SqlLanguageService
providers/vscode.ts     ──→ services/SqlLanguageService
providers/codemirror.ts ──→ services/SqlLanguageService
```

## Layered Architecture

The library is organized in three layers:

### Layer 1: Core (zero dependencies beyond Chevrotain)
- `lexer/` — tokenizer
- `parser/` — grammar → AST
- `ast/` — node type definitions
- `printer/` — AST → SQL string
- `visitor/` — visitor pattern
- `errors/` — error types
- `diagnostics/` — post-parse warnings (typo detection)
- `completion/` — autocomplete engine (uses `JSONSchema` from `@cosmosdb/schema-analyzer`)

### Layer 2: Language Service (zero IDE dependencies)
- `services/SqlLanguageService.ts` — facade aggregating
  diagnostics, completions, hover, signature help, formatting
- `services/types.ts` — generic IDE-agnostic types
  (`Diagnostic`, `HoverInfo`, `TextRange`, etc.)
- `services/functionSignatures.ts` — built-in function metadata

### Layer 3: Provider Adapters (no runtime dep on editor SDK)
- `providers/monaco.ts` — accepts `monaco` namespace at runtime
- `providers/vscode.ts` — accepts `vscode` module at runtime
- `providers/codemirror.ts` — returns CM6-compatible sources

Each provider accepts the editor API as a **runtime argument**
(not an import), so the core library stays free of editor
dependencies and tree-shakes cleanly.

## Design Principles

1. **Immutable AST** — nodes are plain readonly objects with a
   `kind` discriminant. No mutation; create new nodes to
   transform.

2. **Error recovery** — the parser never throws on invalid input.
   It returns a `ParseResult` with a partial AST and an error
   list.

3. **Position tracking** — every AST node carries an optional
   `SourceRange` with `{ offset, line, col }` at start and end.

4. **No codegen step** — the grammar lives in TypeScript code
   (Chevrotain rules), not in a `.y` or `.ne` file that requires
   compilation. Trade-off: harder to diff against `sql.y`, but
   no build-time dependency on a parser generator.

5. **Schema-agnostic parser** — the parser knows nothing about
   collection schemas. The completion module accepts a JSON
   Schema externally and uses the parser only for context
   detection.

6. **IDE-agnostic** — the core API and `SqlLanguageService` have
   zero editor dependencies. Provider adapters accept the editor
   SDK as a runtime argument, never as an import. This means:
   - The library works in Node.js, browsers, Electron, Deno
   - No `monaco-editor` or `vscode` in `dependencies`
   - Users can write their own adapter for any editor

## Package Exports

```
@cosmosdb/nosql-language-service            → Core API + LanguageService
@cosmosdb/nosql-language-service/services   → LanguageService + types only
@cosmosdb/nosql-language-service/monaco     → Monaco adapter
@cosmosdb/nosql-language-service/vscode     → VS Code adapter
@cosmosdb/nosql-language-service/codemirror → CodeMirror 6 adapter
```

## Key Files

| File | Purpose |
|------|---------|
| `ast/nodes.ts` | All AST interfaces (30+ types) |
| `parser/SqlParser.ts` | Full grammar — the core |
| `lexer/tokens.ts` | Token definitions (50+ tokens) |
| `completion/SqlCompletion.ts` | Autocomplete engine |
| `printer/SqlPrinter.ts` | AST → SQL serializer |
| `visitor/SqlVisitor.ts` | Visitor pattern dispatch |
| `errors/SqlError.ts` | Error types + source locations |
| `errors/SqlErrorMessageProvider.ts` | Human-friendly error messages |
| `diagnostics/typoDetection.ts` | Near-miss keyword warnings |
| `services/SqlLanguageService.ts` | IDE-agnostic facade |
| `services/types.ts` | Generic language service types |
| `services/functionSignatures.ts` | Function hover/sig metadata |
| `providers/monaco.ts` | Monaco editor adapter |
| `providers/vscode.ts` | VS Code extension adapter |
| `providers/codemirror.ts` | CodeMirror 6 adapter |
| `index.ts` | Public API surface |

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
