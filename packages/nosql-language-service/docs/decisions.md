# Design Decisions

## Why Chevrotain (not nearley.js, not Tree-sitter)

| Requirement | nearley.js | Chevrotain | Tree-sitter |
|---|---|---|---|
| Error recovery | ❌ None | ✅ Built-in | ✅ Built-in |
| TypeScript-first | ⚠️ JS with types | ✅ Native TS | ❌ C + WASM |
| No codegen step | ❌ `.ne` → `.js` | ✅ All in TS | ❌ `.js` → C → WASM |
| Browser + Node | ✅ | ✅ | ⚠️ WASM required |
| Token positions | ⚠️ Manual | ✅ Out of box | ✅ Out of box |
| Bundle size | ~15KB | ~45KB | ~200KB+ WASM |

**Deciding factor:** error recovery is mandatory for a code
editor. nearley.js (Earley algorithm) simply fails on invalid
input. Chevrotain's re-sync recovery continues parsing after
errors, producing a partial AST — exactly what Monaco needs.

## Why EmbeddedActionsParser (not CstParser)

Chevrotain offers two parser modes:

- **CstParser** — builds a generic Concrete Syntax Tree, then
  a visitor transforms it to AST. Two passes.
- **EmbeddedActionsParser** — builds the AST directly inside
  grammar rules. One pass. Similar to Yacc `{ $$ = ... }`.

We chose EmbeddedActionsParser because:
1. The original C++ parser builds AST in grammar actions
2. One-pass is faster
3. No intermediate CST allocation
4. Easier to port: `.y` rules map 1-to-1 to RULE/SUBRULE

Trade-off: grammar rules are harder to read because they mix
parsing logic with AST construction. Mitigated by comments.

## Why immutable AST (not mutable classes)

AST nodes are plain TypeScript interfaces (not classes) with
a `kind` discriminant for exhaustive pattern matching:

```typescript
if (expr.kind === "BinaryScalarExpression") {
  // TypeScript narrows the type automatically
  console.log(expr.operator); // ✅ type-safe
}
```

Benefits:
- JSON-serializable (no class instances)
- Structurally comparable (no identity issues)
- Tree-shakeable (no class methods in bundle)
- Plays well with React/Redux (immutable data)

To modify, create a new node with spread:
```typescript
const newExpr = { ...expr, right: newRight };
```

## Why token ordering matters

Chevrotain tries tokens in array order. This causes issues with
keywords that are prefixes of other keywords:

- `AS` matches before `ASC` →  `ASC` never reached
- `IN` matches before `INNER`, `INSERT`, `INTO`
- `OR` matches before `ORDER`

Solution: `longer_alt` chains tell Chevrotain to prefer longer
matches. Shorter keywords point to their longer siblings:

```typescript
export const Asc = kw("ASC", /ASC/i);
export const As  = kw("AS",  /AS/i, [Asc, Identifier]);
```

## Why Chevrotain grammar recording requires null-safety

Chevrotain's `performSelfAnalysis()` runs all grammar rules once
in "recording mode" to build internal data structures. During
recording, `CONSUME()` and `SUBRULE()` return mock/undefined
values. Any property access on results crashes.

Solution: all AST construction code uses optional chaining
(`?.`) and the `rangeFromNodes()` / `rangeStartEnd()` helpers
that gracefully handle undefined inputs.

## Why completion uses lexer-only (not full parser)

For autocomplete on incomplete queries, a full parse would:
1. Fail more often (recovery is good but not perfect)
2. Be slower (full AST construction for just a cursor position)
3. Require complex "expected tokens at position" extraction

Instead, the completion engine tokenizes the query (fast,
always succeeds) and uses simple heuristics on the last few
tokens to determine context. This is the same approach used by
VS Code's built-in language features and most SQL editors.

Trade-off: the context detection is less accurate than a full
parse for deeply nested expressions. Acceptable because:
- 95% of completion triggers are simple contexts
- The remaining 5% falls back to "suggest everything"

