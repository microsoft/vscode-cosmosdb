# Implementation Plan: Comprehensive SELECT Query Test Suite

**PRD:** `plans/prd-nosql-select-tests.md`
**Date:** 2026-05-04
**Status:** Active

---

## Overview

Eight commits / PRs in order. Each one is independently mergeable and leaves `vitest` green.

```
Phase -1 — Smoke queries (10 queries, fast PR, early signal)
Phase 0  — Scaffold
Phase 1a — Seed generator + Products data
Phase 1b — Orders + Events data
Phase 2a — Unit tests: basic SELECT, FROM, JOIN, WHERE
Phase 2b — Unit tests: functions (string, math, array, date)
Phase 2c — Unit tests: GROUP BY, ORDER BY, operators, subqueries, complex
Phase 2d — Negative tests (parser errors + integration fixtures)
── manual ── Phase "smoke" — local emulator validation (no code)
Phase 3   — CI workflow (Docker emulator + caching)
```

---

## Phase -1 — Smoke queries *(ship this first)*

**Goal:** 10 maximally-diverse queries as unit tests — one small PR that can be reviewed quickly and gives early signal that the parser handles a wide range of real-world patterns.
**Reference:** `plans/queries-full-catalogue.md` → section "Smoke Test Selection — Top 10".
**Vitest:** green.

The 10 queries were selected to cover every major AST construct with zero overlap:

| # | Query | What it exercises |
|---|-------|--------------------|
| 1 | `SELECT * FROM c` | Baseline — SelectStarSpec, AliasedCollectionExpression |
| 2 | `SELECT * FROM c WHERE c.price > 10 AND c.price < 100` | BinaryScalarExpression AND chain |
| 3 | `SELECT DISTINCT c.category FROM c ORDER BY c.category ASC` | distinct flag + OrderByClause |
| 4 | `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.category IN ("Electronics", "Clothing")` | BetweenScalarExpression + InScalarExpression |
| 5 | `SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2` | JoinCollectionExpression + WHERE on iterator var |
| 6 | `SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category` | GroupByClause + FunctionCallScalarExpression aggregate |
| 7 | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")` | ExistsScalarExpression with nested SqlQuery |
| 8 | `SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c` | ArraySubqueryScalarExpression in projection |
| 9 | `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c WHERE c.timestamp BETWEEN @from AND @to GROUP BY c.type, c.userId ORDER BY cnt DESC OFFSET 0 LIMIT 20` | All major clauses + ParameterRef + ORDER BY aggregate alias |
| 10 | `SELECT FROM c` | Negative: errors[] must be non-empty |

### Commit

#### `test: add smoke test suite — 10 representative SELECT queries`

**New file:** `packages/nosql-language-service/src/parser/SqlParser.smoke.test.ts`

Structure:
```ts
describe('smoke — 10 representative SELECT queries', () => {
    // Queries 1–9: parse → assert errors empty → assert 1-2 key AST fields
    // Query 10: parse → assert errors.length > 0
});
```

Key AST assertions per query (one or two per test, not exhaustive — that's Phase 2):

| # | Assert |
|---|--------|
| 1 | `selectClause.spec.type === 'SelectStarSpec'` |
| 2 | `whereClause.expression.type === 'BinaryScalarExpression'` + `operator === 'And'` |
| 3 | `selectClause.distinct === true` + `orderByClause.items.length === 1` |
| 4 | `whereClause.expression.type === 'BinaryScalarExpression'` + left child `type === 'BetweenScalarExpression'` |
| 5 | `fromClause.collection.type === 'JoinCollectionExpression'` |
| 6 | `groupByClause !== undefined` + `selectClause.spec.items[1].alias === 'avgRating'` |
| 7 | `whereClause.expression.type === 'ExistsScalarExpression'` |
| 8 | first SELECT item expression `type === 'ArraySubqueryScalarExpression'` |
| 9 | all of: `groupByClause`, `orderByClause`, `offsetLimitClause` all defined + `whereClause.expression.type === 'BetweenScalarExpression'` |
| 10 | `errors.length > 0` |

**Checklist:**
- [ ] 10 `it(...)` cases, all pass
- [ ] No new dependencies
- [ ] `npx vitest run` in `packages/nosql-language-service` exits 0
- [ ] PR is tiny enough to review in < 10 min

---

---

## Phase 0 — Scaffold

**Goal:** directory structure + shared types in place, nothing else.
**Vitest:** green (no new tests yet).

### Commits

#### `test: scaffold fixture directory structure`

Create the following empty/stub files:

```
packages/nosql-language-service/src/test-fixtures/
  containers/
    products.schema.json        ← full JSON Schema (from PRD §4.1)
    products.seed.json          ← [] (empty array, placeholder)
    orders.schema.json          ← full JSON Schema (from PRD §4.2)
    orders.seed.json            ← []
    events.schema.json          ← full JSON Schema (from PRD §4.3)
    events.seed.json            ← []
  queries/
    types.ts                    ← QueryFixture interface (see below)
    select-basic.ts             ← export const fixtures: QueryFixture[] = []
    select-from-join.ts         ← same stub
    select-where.ts
    select-functions.ts
    select-groupby-orderby.ts
    select-complex.ts
    negative-parser.ts
    negative-integration.ts
```

**`types.ts` content:**

```ts
import type { SqlQuery } from '../parser/nodes';

export interface QueryFixture {
    id: string;           // "S-01"
    description: string;
    query: string;
    container: 'products' | 'orders' | 'events';
    // Unit test: partial AST shape to assert against
    expectAst?: Partial<SqlQuery>;
    // Integration test (Phase 3): expected row count bounds
    expectMinRows?: number;
    expectMaxRows?: number;
    expectError?: boolean;   // true = Cosmos DB should throw / return error
}

export interface NegativeParserFixture {
    id: string;
    description: string;
    query: string;
    // If set, errors[0].message must contain this substring
    errorContains?: string;
}
```

**`*.schema.json` format** — one per container, mirrors the TypeScript interfaces from PRD §4.
Use JSON Schema draft-07. No runtime validation library needed — these are documentation + reference for emulator import.

**Checklist:**
- [ ] All files created
- [ ] `types.ts` compiles without errors (`npm run build` in package)
- [ ] No test files import the empty fixtures yet

---

## Phase 1a — Seed generator + Products data

**Goal:** `scripts/generate-test-data.mjs` exists and produces `products.seed.json`.
**Vitest:** green.

### Commits

#### `feat: add seed data generator script`

File: `scripts/generate-test-data.mjs`

**Requirements:**
- Pure Node.js ESM, no external dependencies (use `Math.random` with a seeded PRNG — implement a simple `mulberry32` or `xmur3` seeder, seed = `42`).
- CLI flags: `--container products|orders|events` and `--out <path>` (defaults to `packages/nosql-language-service/src/test-fixtures/containers/`).
- `--all` flag generates all three containers in sequence.
- Logs progress: container name, document count, output size.

**Products generator — 2 000 documents, ~2.5 KB each → ~5 MB:**

| Field | Generation rule |
|-------|----------------|
| `id` | `"prod-" + zero-padded index` |
| `name` | Pick from 50 product name templates |
| `category` | Weighted: Electronics 30 %, Clothing 25 %, Books 25 %, Food 20 % |
| `brand` | Pick from 20 brand names; every 50th document: field **omitted** (tests `IS_DEFINED`) |
| `price` | Uniform(0, 500), 2 decimal places; one document has `price: 0` |
| `rating` | Uniform(1, 5), 1 decimal; every 15th document: `null` (unrated) |
| `inStock` | 70 % true |
| `tags` | 0–5 tags from a list of 20; every 30th document: `[]` |
| `description` | Random lorem sentence; every 25th document: `null` |
| `createdAt` | Random ISO-8601 in range 2023-01-01..2025-12-31 |
| `_partitionKey` | Same as `category` |

**Mandatory tricky documents** (hardcoded at specific indices, not random):
- Index 0: `description: null`
- Index 1: `brand` field omitted
- Index 2: `price: 0`
- Index 3 & 4: identical `name` (tests DISTINCT)
- Index 5: `rating: null`, `tags: []`

#### `feat: generate and commit products seed data`

Run: `node scripts/generate-test-data.mjs --container products`
Commit the resulting `products.seed.json`.

**Checklist:**
- [ ] Script runs without errors
- [ ] Output is deterministic: running twice produces byte-identical JSON
- [ ] File size 4–6 MB
- [ ] Tricky documents present at expected positions
- [ ] `products.seed.json` committed

---

## Phase 1b — Orders + Events data

**Goal:** complete the seed data for the remaining two containers.
**Vitest:** green.

### Commits

#### `feat: generate orders and events seed data`

**Orders generator — 2 500 documents, ~3 KB each → ~7.5 MB:**

| Field | Generation rule |
|-------|----------------|
| `id` | `"order-" + index` |
| `customerId` | `"cust-" + (index % 500 + 1)` — 500 unique customers, ~5 orders each |
| `status` | Weighted: pending 20 %, processing 15 %, shipped 25 %, delivered 30 %, cancelled 10 % |
| `totalAmount` | Sum of `items[*].quantity * unitPrice`, rounded to 2dp |
| `createdAt` | Random ISO-8601 2023-2025 |
| `items` | 1–5 line items; every 20th document: `items: []` |
| `items[].productId` | `"prod-" + random(0, 1999)` |
| `items[].name` | Random product name |
| `items[].quantity` | 1–10; one document has a 10-item order |
| `items[].unitPrice` | Uniform(1, 300), 2dp |
| `shipping.address` | Realistic US/CA/UK/DE city/zip combos from a lookup table |
| `shipping.carrier` | FedEx/UPS/DHL; `null` when status is pending/processing |
| `shipping.trackingNumber` | Random alphanumeric; `null` when carrier is null |
| `discount` | 30 % chance of a 5/10/15/20 % value; otherwise `null` |
| `_partitionKey` | Same as `customerId` |

**Mandatory tricky documents:**
- `items: []` at index 0
- `shipping.carrier: null` at index 1
- Two orders from same customer on same day at indices 2 & 3
- `discount: 0` (not null, explicitly zero) at index 4
- 10-item order at index 5

**Events generator — 5 000 documents, ~1.5 KB each → ~7.5 MB:**

| Field | Generation rule |
|-------|----------------|
| `id` | `"evt-" + index` |
| `type` | click 40 %, view 30 %, purchase 16 %, signup 10 %, error 4 % |
| `userId` | `"u-" + (index % 10 + 1)` — 10 users |
| `sessionId` | Random UUID-like string |
| `timestamp` | Random ISO-8601 within 7-day window (2025-01-01..2025-01-07) |
| `durationMs` | click/view/purchase: Uniform(100, 30000); signup/error: `null` |
| `properties.page` | click/view only |
| `properties.productId` | purchase/view only |
| `properties.errorCode` | error type only |
| `properties.errorMessage` | error type only |
| `properties.amount` | purchase only |
| `_partitionKey` | Same as `userId` |

**Mandatory tricky documents:**
- Two events with identical `(userId, timestamp)` at indices 0 & 1
- Event missing `durationMs` entirely (field absent, not null) at index 2
- `durationMs: 0` at index 3

Run: `node scripts/generate-test-data.mjs --container orders && node scripts/generate-test-data.mjs --container events`
Commit both seed files.

**Checklist:**
- [ ] `orders.seed.json` 6–9 MB, deterministic
- [ ] `events.seed.json` 6–9 MB, deterministic
- [ ] All tricky documents present
- [ ] Both files committed

---

## Phase 2a — Unit tests: basic SELECT, FROM, JOIN, WHERE

**Goal:** ~55 new `it(...)` cases covering query groups S, F, J, W, B, T, E from PRD §5.
**Vitest:** all pass.

### Commits

#### `test: populate select-basic and select-from-join fixtures`

Fill `src/test-fixtures/queries/select-basic.ts` with fixtures for S-01..S-10, F-01..F-03, J-01..J-05 (PRD §5.1–§5.3).

Each fixture has `query` + `expectAst` with at minimum:
- `selectClause.spec.type` (e.g. `'SelectStarSpec'`)
- `fromClause.collection.type` for FROM variants
- Key flags: `distinct`, `top.expression.value` for S-04/S-05

Fill `select-from-join.ts` with the JOIN fixtures.

#### `test: add SqlParser.test.ts cases for basic SELECT, FROM, JOIN`

Extend `src/parser/SqlParser.test.ts` — new `describe('basic SELECT')`, `describe('FROM / alias')`, `describe('JOIN / array iterator')` blocks.
Each `it` calls `parse(fixture.query)`, asserts `errors` is empty, then asserts `expectAst` fields.

#### `test: populate select-where fixtures (W, B, T, E series)`

Fill `src/test-fixtures/queries/select-where.ts` with W-01..W-13, B-01..B-09, T-01..T-08, E-01..E-03 (PRD §5.4–§5.7).

Key AST assertions:
- `whereClause.expression.type` (e.g. `'BinaryScalarExpression'`, `'BetweenScalarExpression'`, `'InScalarExpression'`, `'LikeScalarExpression'`)
- `whereClause.expression.operator` for W series
- `whereClause.expression.not` boolean for NOT variants
- `whereClause.expression.type === 'ExistsScalarExpression'` + nested query for E series

#### `test: add SqlParser.test.ts cases for WHERE, BETWEEN, IN, LIKE, EXISTS`

New `describe('WHERE comparisons')`, `describe('BETWEEN / IN / LIKE')`, `describe('IS_NULL / IS_DEFINED / type checks')`, `describe('EXISTS subquery')` blocks.

**Checklist:**
- [ ] ~55 new `it(...)` cases
- [ ] All pass: `npx vitest run` in `packages/nosql-language-service`
- [ ] No existing tests broken

---

## Phase 2b — Unit tests: functions

**Goal:** ~35 new `it(...)` cases covering STR, M, A, D groups (PRD §5.8–§5.11).
**Vitest:** all pass.

### Commits

#### `test: populate select-functions fixtures (string, math, array, date)`

Fill `src/test-fixtures/queries/select-functions.ts` with STR-01..STR-14, M-01..M-11, A-01..A-09, D-01..D-06.

Key AST assertions (all are `FunctionCallScalarExpression`):
- `expression.name` equals the function name (`'CONTAINS'`, `'ABS'`, etc.)
- `expression.udf === false`
- `expression.args.length` matches expected argument count
- For operator tests (STR-14, M-10, M-11, OP-04, OP-05): `expression.type === 'BinaryScalarExpression'` with correct `operator`

#### `test: add SqlParser.test.ts cases for all function groups`

New `describe('string functions')`, `describe('math functions')`, `describe('array functions')`, `describe('date functions')` blocks.

**Checklist:**
- [ ] ~35 new `it(...)` cases
- [ ] All pass
- [ ] UDF flag (`udf: true`) is NOT set on any built-in function

---

## Phase 2c — Unit tests: aggregations, ordering, operators, subqueries, complex

**Goal:** ~50 new `it(...)` cases covering O, G, P, SQ, OP, PR, UDF, CX groups (PRD §5.12–§5.18).
**Vitest:** all pass.

### Commits

#### `test: populate select-groupby-orderby fixtures (O, G, P series)`

Fill `src/test-fixtures/queries/select-groupby-orderby.ts` with O-01..O-06, G-01..G-07b, P-01..P-04.

Key AST assertions:
- `orderByClause.items[n].order` (`'ASC'` / `'DESC'`)
- `groupByClause.expressions[0].type`
- Named aggregate: `selectClause.spec.items[1].alias === 'cnt'`
- Unnamed aggregate (`G-01b`): `selectClause.spec.items[1].alias === undefined`
- `offsetLimitClause.offset.kind` / `offsetLimitClause.limit.kind` for literal vs parameter

#### `test: populate select-complex fixtures (SQ, OP, PR, UDF, CX series)`

Fill `src/test-fixtures/queries/select-complex.ts` with SQ-01..SQ-04, OP-01..OP-13, PR-01..PR-03, UDF-01..UDF-03, CX-01..CX-08.

Key AST assertions:
- SQ series: `expression.type === 'ArraySubqueryScalarExpression'` / `'FirstScalarExpression'` / `'LastScalarExpression'`
- OP-02: `expression.type === 'CoalesceScalarExpression'`
- OP-03: `expression.type === 'ConditionalScalarExpression'`
- OP-06..OP-11: `expression.operator` is the correct bitwise operator enum value
- PR series: `expression.type === 'ParameterRefScalarExpression'`, `expression.name === '@category'`
- UDF series: `expression.udf === true`, `expression.name === 'formatPrice'`

#### `test: add SqlParser.test.ts cases for groupby/orderby/operators/subqueries/complex`

New describes per group. CX tests additionally run `sqlToString(ast)` → `parse(...)` to verify round-trip.

#### `test: add round-trip tests for all §5 fixtures`

A `describe('round-trip — all §5 fixtures')` that imports all fixture arrays, iterates, calls `parse(query)`, then `parse(sqlToString(ast))`, and asserts the second `errors` array is empty and top-level AST shape matches.

**Checklist:**
- [ ] G-01b and G-02b explicitly assert `alias === undefined` (unnamed aggregate)
- [ ] All UDF fixtures have `udf: true`
- [ ] Round-trip test covers all §5 fixtures
- [ ] All pass

---

## Phase 2d — Negative tests

**Goal:** 15 parser-error tests (N series) + 10 integration-fixture stubs (I series) committed.
**Vitest:** all pass.

### Commits

#### `test: populate negative-parser fixtures`

Fill `src/test-fixtures/queries/negative-parser.ts` with N-01..N-15 as `NegativeParserFixture[]`.
Include `errorContains` where the expected error message is predictable (e.g. N-14 `"Unexpected token"`).

#### `test: add negative parser test cases to SqlParser.test.ts`

New `describe('negative — parser errors')` block:

```ts
for (const f of negativeParserFixtures) {
    it(`${f.id}: ${f.description}`, () => {
        const result = parse(f.query);
        expect(result.errors.length, `expected parse errors for: ${f.query}`).toBeGreaterThan(0);
        if (f.errorContains) {
            expect(result.errors[0].message).toContain(f.errorContains);
        }
    });
}
```

#### `test: populate negative-integration fixtures`

Fill `src/test-fixtures/queries/negative-integration.ts` with I-01..I-10 as `QueryFixture[]` with `expectMaxRows: 0` or `expectError: true`.
These fixtures are inert at this stage (no test runs them yet — that's Phase 3).

**Checklist:**
- [ ] All 15 N-series tests produce non-empty `errors`
- [ ] No false positives (N series don't accidentally error on valid queries)
- [ ] I series fixtures compile and export correctly
- [ ] `npx vitest run` exits 0

---

## Manual smoke test (no code)

**When:** after Phase 2d is merged.
**Who:** developer with local Cosmos DB Emulator.

**Steps:**

1. Start local emulator (`https://localhost:8081`).
2. Create three databases / containers matching the schemas in `*.schema.json`.
3. Bulk-import each seed file:
   ```bash
   node scripts/import-seed.mjs --container products   # write this helper in Phase 3 or ad-hoc
   ```
   Or use the Emulator Data Explorer UI for small imports.
4. Run each query from §5 in the emulator's Data Explorer / query editor.
5. Verify §6.2 queries return 0 rows or expected errors.
6. Fix any query strings in the fixture files. Commit fixes.

**Exit criteria:** all §5 queries executed, results match expectations, fixes committed.

---

## Phase 3 — CI workflow

**Goal:** GitHub Actions workflow that spins up the Cosmos DB Emulator, seeds, and runs the integration suite.
**Prerequisite:** manual smoke test passed.

### Commits

#### `feat: add emulator seed import script`

File: `scripts/import-seed.mjs`
Uses `@azure/cosmos` to:
1. Create database + container if not exists.
2. Bulk-upsert all documents from `*.seed.json`.
3. Accept `--endpoint`, `--key`, `--container` flags.
4. Exit non-zero on error.

#### `test: add integration test runner`

File: `packages/nosql-language-service/src/test-fixtures/integration.test.ts`

```ts
// Only runs when COSMOS_ENDPOINT env var is set
const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
if (!endpoint || !key) {
    describe.skip('integration tests (no emulator)', () => {});
} else {
    // import all QueryFixture arrays + negative-integration fixtures
    // for each fixture: run query against real Cosmos DB, assert row count / error
}
```

#### `ci: add integration-tests GitHub Actions workflow`

File: `.github/workflows/integration-tests.yml`

Key sections:

```yaml
on:
  push:
    paths:
      - 'packages/**'
      - 'src/**'
      - 'scripts/import-seed.mjs'
      - '.github/workflows/integration-tests.yml'
  pull_request:
    paths:
      - 'packages/**'
      - 'src/**'

jobs:
  integration:
    runs-on: ubuntu-latest
    services:
      cosmosdb:
        image: mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
        ports: ['8081:8081']
        env:
          AZURE_COSMOS_EMULATOR_PARTITION_COUNT: 3
        options: >-
          --health-cmd "curl -f https://localhost:8081/_explorer/emulator.pem || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 12          # up to 2 min wait

    steps:
      - uses: actions/checkout@v4

      - name: Restore seed cache
        id: seed-cache
        uses: actions/cache@v4
        with:
          path: .emulator-ready
          key: seed-${{ hashFiles('packages/nosql-language-service/src/test-fixtures/containers/**') }}

      - name: Seed emulator (cache miss only)
        if: steps.seed-cache.outputs.cache-hit != 'true'
        run: |
          node scripts/import-seed.mjs --container products
          node scripts/import-seed.mjs --container orders
          node scripts/import-seed.mjs --container events
          mkdir -p .emulator-ready && echo "seeded" > .emulator-ready/done
        env:
          COSMOS_ENDPOINT: https://localhost:8081
          COSMOS_KEY: ${{ secrets.COSMOS_EMULATOR_KEY }}
          NODE_TLS_REJECT_UNAUTHORIZED: '0'

      - name: Run integration tests
        run: npx vitest run --reporter=verbose
        working-directory: packages/nosql-language-service
        env:
          COSMOS_ENDPOINT: https://localhost:8081
          COSMOS_KEY: ${{ secrets.COSMOS_EMULATOR_KEY }}
          NODE_TLS_REJECT_UNAUTHORIZED: '0'
```

**Checklist:**
- [ ] Workflow triggers only on `packages/**` / `src/**` path changes
- [ ] Cache key uses `hashFiles` over seed files
- [ ] Health-check retries give emulator time to start
- [ ] `NODE_TLS_REJECT_UNAUTHORIZED=0` set (emulator uses self-signed cert)
- [ ] All integration tests pass in CI

---

## Summary table

| Phase | Commit(s) | New tests | New files |
|-------|-----------|-----------|-----------|
| **-1 — Smoke queries** | 1 | 10 | `SqlParser.smoke.test.ts` |
| **0 — Scaffold** | 1 | 0 | `types.ts` + 8 stubs + 6 schema/seed placeholders |
| **1a — Products seed** | 2 | 0 | `generate-test-data.mjs`, `products.seed.json` |
| **1b — Orders + Events seed** | 1 | 0 | `orders.seed.json`, `events.seed.json` |
| **2a — Basic, FROM, WHERE** | 4 | ~55 | `select-basic.ts`, `select-from-join.ts`, `select-where.ts` |
| **2b — Functions** | 2 | ~35 | `select-functions.ts` |
| **2c — Aggregations, complex** | 4 | ~50 | `select-groupby-orderby.ts`, `select-complex.ts` |
| **2d — Negatives** | 3 | 15+0 | `negative-parser.ts`, `negative-integration.ts` |
| **smoke** | fixes only | — | — |
| **3 — CI** | 3 | ~10 integration | `import-seed.mjs`, `integration.test.ts`, `integration-tests.yml` |

**Total new unit tests: ~165** (10 smoke + ~155 full suite)
**Total new integration tests: ~120** (all §5 + §6.2 run against emulator)

