# Human-Friendly Error Messages

## Overview

The parser produces human-readable error messages instead of raw Chevrotain
token type names. A custom `SqlErrorMessageProvider` rewrites all four
Chevrotain error types into concise, user-friendly messages.

**Before:**
```
Expecting: one of these possible Token sequences:
  1. [Identifier, IN]
  2. [LET, IN]
  3. [RANK, IN]
  4. [LParen]
  5. [Identifier, Dot]
  ...
but found: ''
```

**After:**
```
Unexpected end of query. Expected name, '(', string, number, or TRUE, ....
```

## Architecture

```
Chevrotain Parser
    │
    ├── errorMessageProvider: SqlErrorMessageProvider
    │       ├── TOKEN_DISPLAY_NAMES map (30+ tokens)
    │       ├── buildMismatchTokenMessage()
    │       ├── buildNotAllInputParsedMessage()
    │       ├── buildNoViableAltMessage()
    │       └── buildEarlyExitMessage()
    │
    ▼
IRecognitionException.message  ← already human-friendly
    │
    ▼
parse() in index.ts  ← copies message as-is into SqlParseError
    │
    ▼
SqlLanguageService.getDiagnostics()  ← copies into Diagnostic.message
    │
    ▼
User sees: "Expected '(' but found 'FORM'."
```

## Token Display Names

Internal Chevrotain token names are mapped to user-friendly labels:

| Token Name       | Display Label    |
| ---------------- | ---------------- |
| `Identifier`     | `name`           |
| `LParen`         | `'('`            |
| `RParen`         | `')'`            |
| `LBracket`       | `'['`            |
| `RBracket`       | `']'`            |
| `LBrace`         | `'{'`            |
| `RBrace`         | `'}'`            |
| `Dot`            | `'.'`            |
| `Comma`          | `','`            |
| `Semicolon`      | `';'`            |
| `Colon`          | `':'`            |
| `Star`           | `'*'`            |
| `Equals`         | `'='`            |
| `StringLiteral`  | `string`         |
| `NumberLiteral`  | `number`         |
| `IntegerLiteral` | `integer`        |
| `DoubleLiteral`  | `decimal number` |
| `Parameter`      | `@parameter`     |
| `EOF`            | `end of query`   |
| Keywords         | As-is (e.g. `SELECT`, `FROM`) |

Operators like `NotEqual`, `LessThan`, `StringConcat`, `Coalesce`, etc.
are also mapped to their symbolic form (`'!=' or '<>'`, `'<'`, `'||'`, `'??'`).

## Error Message Formats

### MismatchedTokenException
Fired when `CONSUME()` fails to match the expected token.

> **Expected** `{expected}` **but found** `{actual}`**.**

Examples:
- `Expected SELECT but found end of query.`
- `Expected SELECT but found 'HELLO'.`
- `Expected LIMIT but found end of query.`

### NotAllInputParsedException
Fired when parsing completes but tokens remain.

> **Unexpected** `{token}` **after the query.**

Examples:
- `Unexpected 'FORM' after the query.`
- `Unexpected ';' after the query.`

### NoViableAltException
Fired when `OR()` cannot match any alternative.

> **Unexpected** `{actual}`**.** **Expected** `{list}`**.**

The expected list is deduplicated and limited to 5 items with `...`
for truncation.

Examples:
- `Unexpected end of query. Expected VALUE, '*', '-', '+', or '~', ....`
- `Unexpected ','. Expected @parameter, string, number, TRUE, or FALSE, ....`

### EarlyExitException
Fired when `AT_LEAST_ONE()` cannot match its first iteration.

> **Expected at least one** `{expected}` **after** `{previous}`**.**

## Alternatives List Formatting

When Chevrotain reports many expected alternatives, the provider:

1. **Deduplicates** — looks at only the first token of each expected path
2. **Maps** — converts each token type to its display name
3. **Limits** — shows at most 5 items
4. **Formats** — joins with `, ` and uses `or` before the last item
5. **Truncates** — appends `, ...` if more than 5 alternatives exist

Example: 12 alternatives → `VALUE, '*', '-', '+', or '~', ...`

## Files

| File | Purpose |
|------|---------|
| `errors/SqlErrorMessageProvider.ts` | `IParserErrorMessageProvider` implementation |
| `parser/SqlParser.ts` | Wires the provider via `errorMessageProvider` config |
| `index.ts` | Maps Chevrotain exception types to `SqlErrorCode` |
| `tests/errors/errorMessages.test.ts` | 28 tests covering all error types |

