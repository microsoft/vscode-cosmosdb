# NoSQL Query Test Suite

## Overview

The test suite has two layers that share the same **`QueryFixture`** objects:

| Layer | File | What it tests | Emulator required |
|---|---|---|---|
| **Unit** | `SqlParser.fixtures.test.ts` | Parser output (`expectAst`) | No |
| **Integration** | `src/test-fixtures/integration.test.ts` | Runtime query execution | Yes (`COSMOS_ENDPOINT`) |

---

## Test count breakdown

Total: **623 tests** (with emulator) / **480 tests** (without emulator)

| Group | Count | Unit | Integration |
|---|---|---|---|
| `QueryFixture` — query fixtures (S/F/J/W/B/T/E/STR/M/A/D/O/G/P/SQ/OP/UDF/CX series) | ~145 | ✅ | ✅ (minus `@param`) |
| `QueryFixture` with `@param` (S-06, B-09, P-03, PR-01..03, CX-06) | 7 | ✅ | ❌ need explicit values |
| `NegativeParserFixture` (N-01..N-14) | 14 | ✅ | ❌ test parser errors, not runtime |
| Smoke tests (`SqlParser.smoke.test.ts`) | 10 | ✅ | ❌ separate file |
| Language service tests (completion, hover, diagnostics, formatting, visitor, folding…) | ~303 | ✅ | ❌ not emulator-relevant |
| **Negative integration fixtures** (I-01..I-10) | 10 | ❌ | ✅ |

---

## Running tests

### Unit tests only (no emulator)

```bash
npm run vitest
```

### Unit + integration tests (emulator required)

```bash
docker compose up -d   # start the vnext-preview emulator
node scripts/import-seed.mjs --all --endpoint https://localhost:8081   # seed once

NODE_TLS_REJECT_UNAUTHORIZED=0 \
COSMOS_ENDPOINT=https://localhost:8081 \
npx vitest run --reporter=verbose
```

### Seed options

```bash
# First-time or after emulator restart with wiped volume
node scripts/import-seed.mjs --all --reset --endpoint https://localhost:8081

# Resume an interrupted seed (idempotent — skips already-inserted batches)
node scripts/import-seed.mjs --all --endpoint https://localhost:8081
```

---

## Fixture series reference

| Series | Container | Description |
|---|---|---|
| S | products | Basic SELECT (star, list, VALUE, DISTINCT, TOP) |
| F | products | FROM and aliases |
| J | orders | JOIN and array iterators |
| W | products | WHERE comparisons (=, !=, >, <, AND, OR, NOT) |
| B | products | BETWEEN, IN, LIKE |
| T | products | Type-checking functions (IS_NULL, IS_DEFINED, …) |
| E | products | EXISTS subquery |
| STR | products | String functions (CONTAINS, STARTSWITH, UPPER, …) |
| M | products | Math functions (ABS, CEILING, LOG, …) |
| A | products/orders | Array functions (ARRAY_LENGTH, ARRAY_CONTAINS, …) |
| D | events | Date/time functions (GetCurrentDateTime, DateTimeDiff, …) |
| O | products | ORDER BY |
| G | products/orders/events | GROUP BY + aggregates (COUNT, SUM, AVG, MIN, MAX) |
| P | products/events | OFFSET / LIMIT |
| SQ | orders | Scalar subqueries (ARRAY, FIRST, LAST, COUNT) |
| OP | products | Operators (arithmetic, bitwise, ternary, coalesce) |
| PR | products | Parameter references (`@param`) |
| UDF | products | User-defined function calls |
| CX | products/orders/events | Complex / compositional queries |
| N | — | Negative parser fixtures (must produce errors) |
| I | products/orders/events | Negative integration fixtures (must return 0 rows or throw) |

---

## Known limitations (vnext-preview emulator)

Some fixtures are marked with `knownLimitation` in their definition. These tests **still run** against the emulator but a failure is printed as `console.warn` rather than failing the test. The parser correctly accepts all of these — the limitation is in the emulator only.

| ID | Query feature | Reason |
|---|---|---|
| STR-12 | `TRIM()` | Not implemented in vnext-preview |
| M-07 | `LOG(0)` | Produces `-Infinity` → JSON error 4001 |
| SQ-02 | `FIRST()` subquery | Not supported in vnext-preview |
| UDF-01 | UDF in SELECT | UDF not registered in emulator |
| UDF-02 | UDF in WHERE | UDF not registered in emulator |
| UDF-03 | UDF with multiple args | UDF not registered in emulator |

When Microsoft ships a stable Linux emulator that supports these features, remove the `knownLimitation` field from the corresponding fixture.

---

## Seed data

| Container | Documents | Size |
|---|---|---|
| `products` | 200 | ~0.1 MB |
| `orders` | 150 | ~0.1 MB |
| `events` | 200 | ~0.1 MB |

Data is **deterministic** (PRNG seed = 42). Re-running `generate-nosql-seed.mjs` always produces identical bytes. Seeding is **idempotent** — re-running `import-seed.mjs` skips already-inserted batches by querying `COUNT(1)` at startup.

