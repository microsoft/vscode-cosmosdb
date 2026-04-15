# Plan: Human-Friendly Error Messages

## Problem

Chevrotain generates error messages with raw token type names that are
meaningless to users:

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

Users don't know what `LBracket`, `RANK`, `LParen`, or `Identifier` mean.

Similarly, the `"Redundant input, expecting EOF but found: ;"` message appears
when multi-query mode is disabled and a semicolon follows a valid query.

## Current Flow

1. **Chevrotain parser** (`SqlParser`) generates `IRecognitionException` with
   raw `.message` containing token type names
2. `parse()` in `index.ts` copies `e.message` as-is into `SqlParseError`
3. `SqlLanguageService.getDiagnostics()` copies it into `Diagnostic.message`
4. Provider (Monaco/VS Code) displays it to the user

## Proposed Solution

Implement a custom Chevrotain `IParserErrorMessageProvider` that rewrites
error messages into human-readable form.

### Token Display Names

Map internal token names to user-friendly labels:

| Token Name     | Display Label          |
| -------------- | ---------------------- |
| `Identifier`   | `name`                 |
| `LParen`       | `(`                    |
| `RParen`       | `)`                    |
| `LBracket`     | `[`                    |
| `RBracket`     | `]`                    |
| `LBrace`       | `{`                    |
| `RBrace`       | `}`                    |
| `Dot`          | `.`                    |
| `Comma`        | `,`                    |
| `Semicolon`    | `;`                    |
| `Star`         | `*`                    |
| `Equals`       | `=`                    |
| `StringLiteral`| `string`               |
| `NumberLiteral`| `number`               |
| `IntegerLiteral`| `integer`             |
| `DoubleLiteral`| `decimal number`       |
| `Parameter`    | `@parameter`           |
| `EOF`          | `end of query`         |
| Keywords       | Keep as-is (uppercase) |

### Error Message Templates

Instead of listing all possible token sequences, produce concise messages:

| Chevrotain Error Type          | Rewritten Message Example                                    |
| ------------------------------ | ------------------------------------------------------------ |
| `MismatchedTokenException`     | `Expected 'FROM' but found 'FORM'.`                         |
| `NotAllInputParsedException`   | `Unexpected ';' after the query. Only one query is allowed.` |
| `NoViableAltException`         | `Unexpected 'xyz'. Expected SELECT, value, or expression.`  |
| `EarlyExitException`           | `Expected at least one expression after SELECT.`            |

### Implementation

#### Option A: `errorMessageProvider` on parser (preferred)

Chevrotain supports a custom `errorMessageProvider` in the parser config:

```ts
class SqlParser extends EmbeddedActionsParser {
    constructor() {
        super(allTokens, {
            recoveryEnabled: true,
            errorMessageProvider: new SqlErrorMessageProvider(),
        });
    }
}
```

The `SqlErrorMessageProvider` implements `IParserErrorMessageProvider` with
methods:
- `buildMismatchTokenMessage(options)` — "Expected X but found Y"
- `buildNotAllInputParsedMessage(options)` — "Unexpected X after the query"
- `buildNoViableAltMessage(options)` — "Unexpected X, expected ..."
- `buildEarlyExitMessage(options)` — "Expected at least one ..."

#### Option B: Post-process in `parse()` (fallback)

If we can't easily plug into the parser config, rewrite `e.message` in the
`parse()` function using regex matching on the Chevrotain message format.

### Grouping & Simplification

When Chevrotain lists many alternatives (like the 25-item list above),
group and simplify:

- If all alternatives start with `Identifier | LET | RANK` → show just `name`
- If alternatives include `Identifier, Dot` / `Identifier, LBracket` → show `property path`
- Collapse `Identifier, AS | Identifier, Identifier` → `expression [AS alias]`
- Limit displayed alternatives to ~3–5 most common, with "..." for rest

Example rewrites:
- Before: 25-line list of token sequences
- After: `Expected an expression (name, function call, or value).`

## Files to Change

- `packages/nosql-language-service/src/parser/SqlParser.ts` — add `errorMessageProvider`
- `packages/nosql-language-service/src/errors/SqlErrorMessageProvider.ts` — new file
- `packages/nosql-language-service/tests/errors/errorMessages.test.ts` — new tests

## Status

- [ ] Not started — tracked for future implementation.

