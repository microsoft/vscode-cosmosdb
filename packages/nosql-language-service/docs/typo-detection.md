# Typo / Near-Miss Keyword Diagnostics

## Overview

The language service detects identifiers that look like misspelled SQL
keywords and emits **warnings** (not errors). For example, `SELECT * FORM c`
produces a warning: *"Did you mean 'FROM'? 'FORM' looks like a typo."*

This is implemented as a **post-lex token scan**, not an AST walk, because
the parser absorbs typos as valid identifiers (aliases, property names).

## How It Works

1. **Lex** the query into tokens
2. **Scan** for `Identifier` tokens that:
   - Are at least 3 characters long (avoids false positives on `c`, `d`, `id`)
   - Are in a **clause-boundary position** (not after `.`, `AS`, or `:`)
   - Have **Levenshtein distance ≤ 2** from a known clause keyword
3. **Emit** a `TypoWarning` with the misspelled text, suggestion, and source range

## Detected Typos

| Typed      | Suggested  | Distance |
| ---------- | ---------- | -------- |
| `FORM`     | `FROM`     | 1        |
| `WHER`     | `WHERE`    | 1        |
| `SELCT`    | `SELECT`   | 1        |
| `GRUOP`    | `GROUP`    | 1        |
| `ORDR`     | `ORDER`    | 1        |
| `DISTICT`  | `DISTINCT` | 1        |
| `JOINN`    | `JOIN`     | 1        |
| `LIMT`     | `LIMIT`    | 1        |
| `OFSET`    | `OFFSET`   | 1        |

## False Positive Prevention

The detector avoids false positives by checking **position context**:

| Pattern                      | Flagged? | Why                          |
| ---------------------------- | -------- | ---------------------------- |
| `SELECT * FORM c`            | ✅ Yes   | Clause boundary after `*`    |
| `SELECT c.FORM FROM c`       | ❌ No    | After `.` = property access  |
| `SELECT c.name AS FORM FROM` | ❌ No    | After `AS` = explicit alias  |
| `SELECT { form: c.name }`    | ❌ No    | After `:` = object value     |
| `SELECT * FROM doc`          | ❌ No    | `doc` is distance 3 from any keyword |
| `SELECT c.id FROM c`         | ❌ No    | `c` is < 3 chars             |

## Checked Keywords

Only clause-level keywords are checked. Expression-level keywords
(`AND`, `OR`, `NOT`, `TRUE`, `FALSE`, `NULL`, etc.) are excluded
because their short length causes too many false positives.

```
SELECT, FROM, WHERE, ORDER, GROUP, JOIN, DISTINCT,
LIMIT, OFFSET, HAVING, VALUE, BETWEEN, EXISTS
```

## Integration

### Direct API

```typescript
import { detectTypos } from '@cosmosdb/nosql-language-service';

const warnings = detectTypos('SELECT * FORM c');
// [{ typed: 'FORM', suggestion: 'FROM', range: {...}, message: '...' }]
```

### Via Language Service

Typo warnings are automatically included in `getDiagnostics()`:

```typescript
const service = new SqlLanguageService();
const diagnostics = service.getDiagnostics('SELECT * FORM c');
// Includes both parse errors (severity: Error) and typo warnings (severity: Warning)
// Typo warnings have code: 'POSSIBLE_TYPO'
```

Works with both single-query and multi-query modes.

## Files

| File | Purpose |
|------|---------|
| `src/diagnostics/typoDetection.ts` | Levenshtein + token scan logic |
| `tests/diagnostics/typoDetection.test.ts` | 22 tests (detection + false positives + integration) |
| `src/services/SqlLanguageService.ts` | Integration into `getDiagnostics()` |

