# Plan: Typo / Near-Miss Keyword Diagnostics

## Problem

The parser accepts `SELECT FORM c` as valid syntax because `FORM` is parsed
as an identifier (expression alias). Syntactically correct, but almost
certainly a typo for `FROM`. The same applies to other common near-miss
keywords:

| Typed     | Likely intended |
| --------- | --------------- |
| `FORM`    | `FROM`          |
| `WHER`    | `WHERE`         |
| `SELCT`   | `SELECT`        |
| `GRUOP`   | `GROUP`         |
| `ORDR`    | `ORDER`         |
| `DISTICT` | `DISTINCT`      |
| `JOINN`   | `JOIN`          |
| `LIMT`    | `LIMIT`         |
| `OFSET`   | `OFFSET`        |

## Proposed Solution

Add a **post-parse diagnostic pass** (warning severity, not error) that
detects identifiers whose text is within edit-distance 1–2 of a SQL keyword
and that appear in a position where the keyword would be syntactically valid.

### Approach

1. After a successful parse (no hard errors), walk the AST looking for
   identifiers in "keyword-like" positions (e.g. right after SELECT expressions,
   at the start of a clause, etc.).
2. Compute Levenshtein distance between the identifier and known keywords.
3. If distance ≤ 2 and the keyword would be valid in that position, emit a
   `DiagnosticSeverity.Warning` with a suggestion:
   `"Did you mean 'FROM'? 'FORM' looks like a typo."`
4. Optionally provide a **code action** (quick fix) to replace the typo.

### Considerations

- Must not false-positive on legitimate aliases like `f`, `doc`, `item`.
- Distance threshold should be conservative (≤ 2) to avoid noise.
- Only flag identifiers in clause-boundary positions, not inside expressions.
- This is a **warning**, not an error — the query may be intentional.

## Status

- [ ] Not started — tracked for future implementation.

