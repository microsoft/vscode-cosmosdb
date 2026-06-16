# NoSQL Query Test Suite

## Overview

The test suite has two layers that share the same **`QueryFixture`** objects:

| Layer           | File                                    | What it tests               | Emulator required       |
| --------------- | --------------------------------------- | --------------------------- | ----------------------- |
| **Unit**        | `SqlParser.fixtures.test.ts`            | Parser output (`expectAst`) | No                      |
| **Integration** | `src/test-fixtures/integration.test.ts` | Runtime query execution     | Yes (`COSMOS_ENDPOINT`) |

---

## Test count breakdown

Total: **623 tests** (with emulator) / **480 tests** (without emulator)

| Group                                                                                  | Count | Unit | Integration                        |
| -------------------------------------------------------------------------------------- | ----- | ---- | ---------------------------------- |
| `QueryFixture` — query fixtures (S/F/J/W/B/T/E/STR/M/A/D/O/G/P/SQ/OP/UDF/CX series)    | ~145  | ✅   | ✅ (minus `@param`)                |
| `QueryFixture` with `@param` (S-06, B-09, P-03, PR-01..03, CX-06)                      | 7     | ✅   | ❌ need explicit values            |
| `NegativeParserFixture` (N-01..N-14)                                                   | 14    | ✅   | ❌ test parser errors, not runtime |
| Smoke tests (`SqlParser.smoke.test.ts`)                                                | 10    | ✅   | ❌ separate file                   |
| Language service tests (completion, hover, diagnostics, formatting, visitor, folding…) | ~303  | ✅   | ❌ not emulator-relevant           |
| **Negative integration fixtures** (I-01..I-10)                                         | 10    | ❌   | ✅                                 |

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

| Series | Container              | Description                                                                                    |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| S      | products               | Basic SELECT (star, list, VALUE, DISTINCT, TOP)                                                |
| F      | products               | FROM and aliases                                                                               |
| J      | orders                 | JOIN and array iterators                                                                       |
| W      | products               | WHERE comparisons (=, !=, >, <, AND, OR, NOT)                                                  |
| B      | products               | BETWEEN, IN, LIKE                                                                              |
| T      | products               | Type-checking functions (IS_NULL, IS_DEFINED, IS_PRIMITIVE, …)                                 |
| E      | products               | EXISTS subquery                                                                                |
| STR    | products               | String functions (CONTAINS, STARTSWITH, UPPER, LTRIM, REVERSE, StringEquals, ContainsAnyCI, …) |
| M      | products               | Math functions (ABS, CEILING, LOG, SIN, COS, EXP, RAND, PI, …)                                 |
| A      | products/orders        | Array functions (ARRAY_LENGTH, ARRAY_CONTAINS, ARRAY_CONCAT, ARRAY_CONTAINS_ALL, …)            |
| D      | events/products        | Date/time functions (GetCurrentDateTime, DateTimeDiff, DateTimeToTimestamp, DateTimeBin, …)    |
| O      | products               | ORDER BY                                                                                       |
| G      | products/orders/events | GROUP BY + aggregates (COUNT, SUM, AVG, MIN, MAX, CountIf, MakeList, MakeSet)                  |
| P      | products/events        | OFFSET / LIMIT                                                                                 |
| SQ     | orders                 | Scalar subqueries (ARRAY, FIRST, LAST, COUNT)                                                  |
| OP     | products               | Operators (arithmetic, bitwise, ternary, coalesce)                                             |
| PR     | products               | Parameter references (`@param`)                                                                |
| UDF    | products               | User-defined function calls                                                                    |
| CX     | products/orders/events | Complex / compositional queries                                                                |
| TC     | products               | Type conversion (StringToNumber, StringToBoolean, StringToArray, StringToObject, …)            |
| CF     | products               | Conditional functions (IIF)                                                                    |
| N      | —                      | Negative parser fixtures (must produce errors)                                                 |
| I      | products/orders/events | Negative integration fixtures (must return 0 rows or throw)                                    |

---

## Known limitations (vnext-preview emulator)

Some fixtures are marked with `knownLimitation` in their definition. These tests **still run** against the emulator but a failure is printed as `console.warn` rather than failing the test. The parser correctly accepts all of these — the limitation is in the emulator only.

| ID     | Query feature     | Reason                                                              |
| ------ | ----------------- | ------------------------------------------------------------------- |
| STR-12 | `TRIM()`          | Not implemented in vnext-preview                                    |
| M-07   | `LOG(0)`          | Produces `-Infinity` → JSON error 4001                              |
| M-13   | `LOG10(0)`        | Produces `-Infinity` → JSON error 4001                              |
| UDF-01 | UDF in SELECT     | "Server-side scripts are not supported in this emulator" (HTTP 400) |
| UDF-02 | UDF in WHERE      | "Server-side scripts are not supported in this emulator" (HTTP 400) |
| UDF-03 | UDF multiple args | "Server-side scripts are not supported in this emulator" (HTTP 400) |

> **Note:** The vnext-preview Linux emulator (PGSQL backend) does not support any server-side scripts — UDFs, stored procedures, and triggers all return HTTP 400 with `"Server-side scripts are not supported in this emulator"`. The UDF registration step in `import-seed.mjs` is kept for use against production CosmosDB or a future emulator version.

When Microsoft ships a stable Linux emulator that supports these features, remove the `knownLimitation` field from the corresponding fixture.

---

## Cosmos DB language limitations (not emulator-specific)

These fixtures parse successfully (the native `sql.y` grammar accepts them) but are rejected by **both** the emulator and production Azure Cosmos DB with HTTP 400. They are **not** emulator gaps, so they will not be fixed by a future emulator — the language service flags them statically instead.

| ID            | Query feature            | Reason                                                                                                               |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| SQ-05 / SQ-06 | `ORDER BY` in a subquery | Cosmos DB does not support `ORDER BY` inside any subquery (`FIRST`/`LAST`/`ARRAY`/`EXISTS`/`(SELECT …)`/`FROM (…)`). |

> **`ORDER BY` in subqueries:** the scalar subquery expressions `FIRST()`, `LAST()`, and `ARRAY()` work (SQ-01…SQ-04 pass) — but a nested `ORDER BY` inside any subquery is invalid. This was originally mis-reported upstream as "`FIRST()` unsupported" ([Azure/azure-cosmos-db-emulator-docker#311](https://github.com/Azure/azure-cosmos-db-emulator-docker/issues/311)); the actual discriminator is the subquery `ORDER BY`. Top-level `ORDER BY` (O/P series) is fully supported. The grammar permits the construct, so the language service surfaces it as the `ORDER_BY_IN_SUBQUERY` diagnostic (severity Error) — see `src/diagnostics/orderByInSubquery.ts`.

---

## Seed data

| Container  | Documents | Size    |
| ---------- | --------- | ------- |
| `products` | 200       | ~0.1 MB |
| `orders`   | 150       | ~0.1 MB |
| `events`   | 200       | ~0.1 MB |

Data is **deterministic** (PRNG seed = 42). Re-running `generate-nosql-seed.mjs` always produces identical bytes. Seeding is **idempotent** — re-running `import-seed.mjs` skips already-inserted batches by querying `COUNT(1)` at startup.
