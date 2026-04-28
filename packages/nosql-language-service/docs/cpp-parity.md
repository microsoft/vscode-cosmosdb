# C++ Grammar Parity Contract

This document records the intended grammar parity between the
TypeScript parser in `src/parser/SqlParser.ts` and the native C++
parser grammar in
`{...}/sql/sql.y`.

For successful parses, the native C++ grammar is the source of
truth for parse shape, precedence, and accepted syntax.

## Scope

This contract applies to:

- operator precedence and associativity
- clause ordering
- accepted keyword forms
- AST shape for valid queries

This contract does **not** require identical behavior on invalid
input. The TypeScript parser intentionally keeps Chevrotain error
recovery enabled so IDE integrations can still obtain diagnostics
and a partial AST.

## Source of truth

When there is doubt, use these in order:

1. `{...}/sql/sql.y`
2. native backend tests that exercise emitted/accepted SQL
3. `tests/parser/parser.test.ts`
4. this document

If this document disagrees with the grammar or tests, trust the
native grammar and update the document.

## Locked parity areas

The following areas are intentionally covered by regression tests
in `tests/parser/parser.test.ts`.

### Query structure

The parser follows the C++ clause order:

- `SELECT`
- `FROM`
- `WHERE`
- `GROUP BY`
- `ORDER BY`
- `OFFSET ... LIMIT`

### SELECT forms

The parser matches the native grammar for:

- `SELECT *`
- `SELECT VALUE ...`
- `SELECT DISTINCT`
- `TOP` in both regular and `DISTINCT` forms

### `ORDER BY RANK`

`ORDER BY RANK` must be followed by a function call, matching the
native grammar. Non-function forms are not valid parity behavior.

### `OFFSET` / `LIMIT` / `TOP`

Parity rules:

- `OFFSET` accepts only integer literals or parameters
- `LIMIT` accepts only integer literals or parameters
- `TOP` still accepts number literals or parameters, including
  float-like literals, because the native grammar does

### Identifier aliases

The parser intentionally accepts `LET` and `RANK` where the native
parser accepts them as identifier-like aliases.

### Chained comparisons

Comparison chains are parsed left-associatively, matching the
native grammar, for example:

- `a = b = c` -> `(a = b) = c`
- `a < b < c` -> `(a < b) < c`

### `NOT` precedence

`NOT` is at the same precedence level as the other unary
operators (`-`, `+`, `~`), placed inside `unary_expression` in
the native grammar. This means `NOT` binds tighter than all
binary operators.

Examples that must stay true:

- `NOT 1 = 2` -> `(NOT 1) = 2`
- `NOT c.x IN (1, 2)` -> `(NOT c.x) IN (...)`
- `NOT c.x BETWEEN 1 AND 2` -> `(NOT c.x) BETWEEN ...`
- `NOT c.x LIKE 'a%'` -> `(NOT c.x) LIKE 'a%'`
- `NOT a AND b` -> `(NOT a) AND b`

### `BETWEEN` vs logical `AND` / `OR`

Bare `BETWEEN` expressions must not freely participate in an outer
logical chain unless they are parenthesized.

Examples:

- valid: `c.x BETWEEN 1 AND 2`
- invalid: `c.x BETWEEN 1 AND 2 AND c.y = 3`
- valid: `(c.x BETWEEN 1 AND 2) AND c.y = 3`

The same rule applies to `NOT BETWEEN` and prefix-`NOT` around a
`BETWEEN` expression.

### `IN` and `LIKE` remain logical operands

Unlike `BETWEEN`, `IN` and `LIKE` still participate normally in
logical `AND` / `OR` chains.

Examples:

- `c.x IN (1, 2) AND c.y = 3`
- `c.x LIKE 'a%' AND c.y = 3`

### `??` precedence and associativity

`??` is right-associative and lower precedence than:

- unary operators (`-`, `~`, `NOT`)
- multiplicative operators (`*`, `/`, `%`)
- additive operators (`+`, `-`)
- comparison operators (`=`, `<`, `>`, `<=`, `>=`, shifts)
- logical `AND` / `OR`

Examples that must stay true:

- `a ?? b ?? c` -> `a ?? (b ?? c)`
- `1 + 2 ?? 3` -> `(1 + 2) ?? 3`
- `1 ?? 2 + 3` -> `1 ?? (2 + 3)`
- `1 = 2 ?? 3` -> `(1 = 2) ?? 3`
- `1 ?? 2 = 3` -> `1 ?? (2 = 3)`
- `true AND false ?? true` -> `(true AND false) ?? true`
- `true ?? false AND true` -> `true ?? (false AND true)`
- `-1 ?? 2` -> `(-1) ?? 2`
- `~1 ?? 2` -> `(~1) ?? 2`
- `NOT 1 ?? 2` -> `(NOT 1) ?? 2`

### Bitwise and additive precedence

The native grammar places these operators at the same precedence
level and parses them left-associatively:

- `|`
- `^`
- `&`
- `+`
- `-`

Examples that must stay true:

- `1 | 2 + 3` -> `(1 | 2) + 3`
- `1 + 2 | 3` -> `(1 + 2) | 3`
- `1 & 2 + 3` -> `(1 & 2) + 3`

`*`, `/`, and `%` still bind tighter than that shared level.

### `LET` expression level

`LET` expressions are intentionally parsed at comparison level,
matching the native grammar shape:

- `LET x = <binary_expression> IN <binary_expression>`

### Bounds and patterns

The parser accepts full comparison-level expressions in:

- `BETWEEN` low/high bounds
- `LIKE` patterns
- `LET` value/body expressions

This is required for parity with native examples such as bitwise
or concatenated expressions inside those positions.

## Intentional non-parity on invalid input

The TypeScript parser intentionally differs from the native parser
on malformed input:

- it should collect structured diagnostics
- it may still return a partial AST
- it should not throw for routine syntax errors

This behavior is required for IDE features such as squiggles,
hover, formatting attempts, and partial semantic assistance.

## How to validate parity

When changing grammar behavior:

1. Check the relevant rule and precedence declarations in
   `sql.y`
2. Add or update regression tests in
   `tests/parser/parser.test.ts`
3. Prefer AST-shape assertions, not only `errors.length === 0`
4. Verify both success cases and nearby rejection cases

Recommended commands:

```powershell
npm run lint
npm run build
npx vitest run tests/parser/parser.test.ts
```

## Review rule

If a future refactor changes parse shape for a valid query, treat
that as a parity regression unless the native C++ grammar or
backend tests changed first.

