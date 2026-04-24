# Grammar Discrepancies: C++ (`sql.y`) vs TypeScript (`SqlParser.ts`)

This document lists known differences between the original
C++ LALR grammar (`sql.y`) and the TypeScript Chevrotain
LL(k) parser (`SqlParser.ts`). Each entry describes the
discrepancy, its practical impact, and the affected code
locations.

Last updated: 2026-04-11

**Status:** All 6 discrepancies fixed ✅

---

## 1. ✅ FIXED — Coalesce `??` Associativity

| | C++ | TypeScript |
|---|---|---|
| **Associativity** | Right (`%right _COALESCE`) | Left (`MANY` loop) |
| **Parse of `a ?? b ?? c`** | `a ?? (b ?? c)` | `(a ?? b) ?? c` |

**Files:**
- C++: `sql.y` line 106 — `%right _COALESCE`
- TS: `SqlParser.ts` lines 502–515 — `coalesceExpression`
  uses `MANY`, which is inherently left-to-right

**Impact:** AST structure differs, but the result is
semantically equivalent for coalesce (both short-circuit
to the first non-undefined/null value).

---

## 2. ✅ FIXED — Chained Comparisons

| | C++ | TypeScript |
|---|---|---|
| **`a = b = c`** | ✅ Parses as `(a = b) = c` | ❌ Parse error after `= c` |

**Files:**
- C++: `sql.y` lines 691–764 — `binary_expression` is
  left-recursive with all comparison operators
- TS: `SqlParser.ts` lines 692–716 —
  `comparisonExpression` uses `OPTION` (at most one
  operator)

**Impact:** Chained comparisons like `a < b < c` are
accepted by C++ but rejected by TS. This pattern is
rare in real CosmosDB queries and arguably a misuse,
since the result of `a < b` is a boolean, not a number.

---

## 3. ✅ FIXED — BETWEEN / LIKE / LET Bound Precedence

| | C++ | TypeScript |
|---|---|---|
| **Bounds parsed with** | `binary_expression` (all arithmetic + comparison + bitwise + `\|\|`) | `additiveExpression` (only `+`, `-`, `*`, `/`, `%`) |

**Files:**
- C++: `sql.y` lines 632–659 (`between_scalar_expression`,
  `like_scalar_expression`, `let_scalar_expression`)
- TS: `SqlParser.ts` lines 578–582 (BETWEEN), 632/666
  (LIKE), 1078–1080 (LET)

**Affected queries:**

```sql
-- Works in C++, fails in TS:
SELECT * FROM c WHERE c.name LIKE pattern || '%'
-- TS stops at || because it's above additiveExpression

-- Works in C++, fails in TS:
SELECT * FROM c WHERE (LET x = a > 1 IN x)
-- TS stops at > because it's above additiveExpression

-- Works in both:
SELECT * FROM c WHERE c.age BETWEEN 1 * 2 AND 3 + 4
-- All operators are within additiveExpression
```

**Impact:** The `||` (string concat) operator in LIKE
patterns is the most likely real-world breakage. The LET
case is less common.

---

## 4. ✅ FIXED — OFFSET / LIMIT Accept Floating-Point Numbers

| | C++ | TypeScript |
|---|---|---|
| **Allowed values** | `_INTEGER` or `_PARAMETER` only | Any `NumberLiteral` (including floats) |

**Files:**
- C++: `sql.y` lines 291–311 — `offset_spec` and
  `limit_spec` only accept `_INTEGER`,
  `_INTEGER_ABS_MIN_VALUE`, `_PARAMETER`
- TS: `SqlParser.ts` lines 443–467 — uses
  `numberLitExpr` which matches any `NumberLiteral`

**Impact:** `OFFSET 3.14 LIMIT 2.5` parses successfully
in TS but would be rejected by C++. The backend would
reject this at execution time anyway, but the parser
should ideally catch it earlier.

**Fix:** Requires splitting `NumberLiteral` into
`IntegerLiteral` and `DoubleLiteral` tokens, or adding
a post-parse validation step.

---

## 5. ✅ FIXED — ORDER BY RANK Accepts Any Expression

| | C++ | TypeScript |
|---|---|---|
| **After RANK** | Must be `function_call_scalar_expression` | Any `scalarExpression` |

**Files:**
- C++: `sql.y` lines 261–281 —
  `score_expression_orderby_item` requires
  `function_call_scalar_expression`
- TS: `SqlParser.ts` lines 388–391 — RANK branch calls
  `this.SUBRULE(this.orderByItem)` which uses
  `scalarExpression`

**Impact:** `ORDER BY RANK c.score` parses in TS but
would be rejected by C++. The correct usage is
`ORDER BY RANK VectorDistance(...)`.

---

## 6. ✅ FIXED — Select Item Alias Does Not Accept LET / RANK

| | C++ | TypeScript |
|---|---|---|
| **Alias identifiers** | `id` → `_ID \| _LET \| _RANK` | `T.Identifier` only |

**Files:**
- C++: `sql.y` lines 370–384 — `opt_select_item_alias`
  → `identifier_alias` → `id` (which includes `_LET`,
  `_RANK`)
- TS: `SqlParser.ts` lines 182–200 —
  `selectItemAlias` uses `this.CONSUME(T.Identifier)`
  instead of `this.SUBRULE(this.id)`

**Impact:** `SELECT c.x LET` and `SELECT c.x AS RANK`
are valid aliases in C++ but fail in TS.

**Fix:** Replace `this.CONSUME(T.Identifier)` with
`this.SUBRULE(this.id)` in `selectItemAlias`.

Note: `identifierAlias` for collections (line 471–474)
correctly uses `this.SUBRULE(this.id)`.

---

## Summary Table

| # | Discrepancy | Severity | Status |
|---|---|---|---|
| 1 | `??` associativity | Low | ✅ Fixed |
| 2 | Chained comparisons | Low | ✅ Fixed |
| 3 | BETWEEN/LIKE/LET bounds | **Medium** | ✅ Fixed |
| 4 | OFFSET/LIMIT floats | Low | ✅ Fixed |
| 5 | ORDER BY RANK any expr | Low | ✅ Fixed |
| 6 | Select alias LET/RANK | Low | ✅ Fixed |

