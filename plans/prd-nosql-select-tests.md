# PRD: Comprehensive SELECT Query Test Suite for NoSQL AST Parser

**Date:** 2026-05-04
**Status:** Draft
**Scope:** `packages/nosql-language-service` unit tests + integration test fixtures

---

## 1. Problem Statement

The existing AST parser (`SqlParser.test.ts`) validates that individual SELECT features parse without crashing, but:

- Coverage is **one query per feature** — no combinatorial or edge-case combinations.
- **No test data** exists that ties a query to expected output rows.
- There are **no negative tests** (queries that must fail with a specific error).
- The visitor, formatter, and completion tests rely on different, inconsistent mini-schemas — making it hard to add integration tests later.

Without a canonical set of test-container schemas and a covering query matrix, it's impossible to write meaningful end-to-end / integration tests that run against a real Cosmos DB Emulator.

---

## 2. Goals

1. **Full unit test coverage** of every SELECT syntax variant the parser supports — each variant gets its own `it(...)` case with explicit AST assertions.
2. **Three canonical test-container schemas** with realistic, well-documented sample documents that can later be seeded into an emulator.
3. **A negative-test catalogue** — a curated list of queries and documents that must produce errors (parse errors, runtime errors, or zero results), so integration tests have obvious assertions.
4. Keep all test data in version-controlled JSON fixtures so both unit tests and future integration tests share the same source of truth.

---

## 3. Non-Goals

- Implementing the integration test runner itself (separate PR).
- Covering language-service features other than parsing and AST shape (completions, hover, diagnostics — those already have dedicated test files).
- Performance / throughput benchmarks.

---

## 4. Test Container Schemas

### 4.1 Container `Products` — flat, e-commerce

Represents a simple product catalogue. Good for scalar comparisons, aggregations, TOP / OFFSET-LIMIT, and basic string functions.

**Schema:**

```ts
interface Product {
  id: string;           // "prod-001"
  name: string;         // "Wireless Headphones"
  category: string;     // "Electronics" | "Clothing" | "Books" | "Food"
  brand: string;        // "BrandX"
  price: number;        // 29.99
  rating: number;       // 4.5  (0..5, can be null if unrated)
  inStock: boolean;
  tags: string[];       // ["sale", "wireless", "bluetooth"]
  description: string;
  createdAt: string;    // ISO-8601 "2024-03-15T10:00:00Z"
  _partitionKey: string; // same as category
}
```

**Seed data:** 20 documents — 5 per category, prices ranging $5–$500, some with `rating: null` (unrated), some with empty `tags: []`.

**Deliberately tricky documents:**
- One product with `description: null` (tests `IS_NULL`).
- One product with no `brand` field (tests `IS_DEFINED`).
- One product with `price: 0` (edge for BETWEEN and > 0 filters).
- Two products with identical `name` (tests DISTINCT).

---

### 4.2 Container `Orders` — nested objects + arrays

Represents customer orders. Good for JOIN, array iterator, nested property access, EXISTS subqueries.

**Schema:**

```ts
interface Order {
  id: string;
  customerId: string;   // "cust-001"
  status: string;       // "pending" | "processing" | "shipped" | "delivered" | "cancelled"
  totalAmount: number;
  createdAt: string;    // ISO-8601
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  shipping: {
    address: {
      street: string;
      city: string;
      state: string;
      country: string;   // "US" | "CA" | "UK" | "DE"
      zip: string;
    };
    carrier: string;     // "FedEx" | "UPS" | "DHL" | null (not shipped yet)
    trackingNumber: string | null;
  };
  discount: number | null;  // percentage, null = no discount
  _partitionKey: string;    // same as customerId
}
```

**Seed data:** 25 documents — ~5 orders per customer (`cust-001..cust-005`), statuses distributed across all values, 1–5 line items per order.

**Deliberately tricky documents:**
- Order with `items: []` (empty array — tests `ARRAY_LENGTH = 0`).
- Order with `shipping.carrier: null` (tests `IS_NULL` on nested path).
- Two orders from same customer on same day (tests date functions and deduplication).
- Order with `discount: 0` vs `discount: null` (tests `IS_NULL` vs `= 0`).
- Order with 10 items (max, tests `ARRAY_LENGTH` > 5 queries).

---

### 4.3 Container `Events` — time-series, sparse properties

Represents user activity events. Good for dynamic / undefined properties, date arithmetic, GROUP BY aggregations, OFFSET LIMIT pagination.

**Schema:**

```ts
interface Event {
  id: string;
  type: string;         // "click" | "purchase" | "view" | "signup" | "error"
  userId: string;       // "u-001".."u-010"
  sessionId: string;
  timestamp: string;    // ISO-8601
  durationMs: number | null;   // null for instant events
  properties: {
    // sparse — different keys per event type
    page?: string;
    productId?: string;
    errorCode?: string;
    errorMessage?: string;
    referrer?: string;
    amount?: number;
  };
  _partitionKey: string; // same as userId
}
```

**Seed data:** 50 documents — 10 per user across ~7 days, type distribution: click×20, view×15, purchase×8, signup×5, error×2.

**Deliberately tricky documents:**
- Two events with identical `(userId, timestamp)` — tests deduplication / TOP 1.
- Events missing `durationMs` entirely (verify `IS_DEFINED` vs `IS_NULL`).
- Events with `properties.errorCode` only on `error` type (sparse field queries).
- An event with `durationMs: 0` (edge for `> 0` filters).

---

## 5. SELECT Query Coverage Matrix

Each row below is one `it(...)` unit-test case AND one candidate integration query.
The **Expected error** column marks queries whose integration result should be zero rows or a runtime error.

### 5.1 Basic SELECT

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| S-01 | `SELECT * FROM c` | Products | SelectStarSpec, no WHERE | — |
| S-02 | `SELECT c.id, c.name, c.price FROM c` | Products | SelectListSpec, 3 items | — |
| S-03 | `SELECT VALUE c.price FROM c` | Products | SelectValueSpec | — |
| S-04 | `SELECT DISTINCT c.category FROM c` | Products | `distinct: true` | — |
| S-05 | `SELECT TOP 5 * FROM c` | Products | TopSpec with literal 5 | — |
| S-06 | `SELECT TOP @n * FROM c` | Products | TopSpec with ParameterRef @n | — |
| S-07 | `SELECT c.id, c["name"] FROM c` | Products | MemberExpression (bracket notation) | — |
| S-08 | `SELECT {"id": c.id, "label": c.name} FROM c` | Products | ObjectCreateExpression in SELECT | — |
| S-09 | `SELECT [c.price, c.rating] FROM c` | Products | ArrayCreateExpression in SELECT | — |
| S-10 | `SELECT DISTINCT TOP 3 c.category FROM c` | Products | Both DISTINCT and TopSpec | — |

### 5.2 FROM and Aliases

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| F-01 | `SELECT * FROM Products p` | Products | AliasedCollectionExpression with alias "p" | — |
| F-02 | `SELECT p.name FROM Products AS p` | Products | AS keyword alias | — |
| F-03 | `SELECT * FROM (SELECT c.id, c.price FROM c WHERE c.inStock = true) sub` | Products | Subquery in FROM | — |

### 5.3 JOIN and Array Iterators

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| J-01 | `SELECT c.id, t FROM c JOIN t IN c.tags` | Products | JoinCollectionExpression + ArrayIterator | — |
| J-02 | `SELECT c.id, item.name FROM c JOIN item IN c.items` | Orders | Array iterator over items | — |
| J-03 | `SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2` | Orders | JOIN + WHERE on iterator variable | — |
| J-04 | `SELECT c.id, item.name, sub.city FROM c JOIN item IN c.items JOIN sub IN c.shipping` | Orders | Double JOIN | — |
| J-05 | `SELECT VALUE t FROM c JOIN t IN c.tags WHERE t = "sale"` | Products | SELECT VALUE with JOIN | — |

### 5.4 WHERE — comparisons

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| W-01 | `SELECT * FROM c WHERE c.price = 29.99` | Products | BinaryScalarExpression Equal | — |
| W-02 | `SELECT * FROM c WHERE c.price != 0` | Products | NotEqual | — |
| W-03 | `SELECT * FROM c WHERE c.price > 100` | Products | GreaterThan | — |
| W-04 | `SELECT * FROM c WHERE c.price >= 100` | Products | GreaterThanOrEqual | — |
| W-05 | `SELECT * FROM c WHERE c.price < 10` | Products | LessThan | — |
| W-06 | `SELECT * FROM c WHERE c.price <= 10` | Products | LessThanOrEqual | — |
| W-07 | `SELECT * FROM c WHERE c.inStock = true` | Products | BooleanLiteral | — |
| W-08 | `SELECT * FROM c WHERE c.inStock = false` | Products | BooleanLiteral false | — |
| W-09 | `SELECT * FROM c WHERE c.rating = null` | Products | NullLiteral | — |
| W-10 | `SELECT * FROM c WHERE c.price > 10 AND c.price < 100` | Products | AND with two comparisons | — |
| W-11 | `SELECT * FROM c WHERE c.category = "Books" OR c.category = "Food"` | Products | OR | — |
| W-12 | `SELECT * FROM c WHERE NOT c.inStock` | Products | UnaryScalarExpression NOT | — |
| W-13 | `SELECT * FROM c WHERE NOT (c.price > 100 AND c.inStock = false)` | Products | NOT on grouped AND | — |

### 5.5 WHERE — BETWEEN, IN, LIKE

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| B-01 | `SELECT * FROM c WHERE c.price BETWEEN 10 AND 50` | Products | BetweenScalarExpression | — |
| B-02 | `SELECT * FROM c WHERE c.price NOT BETWEEN 10 AND 50` | Products | BetweenScalarExpression negated | — |
| B-03 | `SELECT * FROM c WHERE c.category IN ("Electronics", "Books")` | Products | InScalarExpression | — |
| B-04 | `SELECT * FROM c WHERE c.category NOT IN ("Food")` | Products | InScalarExpression negated | — |
| B-05 | `SELECT * FROM c WHERE c.name LIKE "%Headphone%"` | Products | LikeScalarExpression | — |
| B-06 | `SELECT * FROM c WHERE c.name LIKE "Wireless%"` | Products | LikeScalarExpression prefix | — |
| B-07 | `SELECT * FROM c WHERE c.name NOT LIKE "%Cheap%"` | Products | LikeScalarExpression negated | — |
| B-08 | `SELECT * FROM c WHERE c.price BETWEEN 10 AND 100 AND c.category IN ("Electronics", "Clothing")` | Products | BETWEEN AND IN combination | — |
| B-09 | `SELECT * FROM c WHERE c.price BETWEEN @min AND @max` | Products | BetweenScalarExpression with parameters | — |

### 5.6 WHERE — IS_NULL, IS_DEFINED, type checks

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| T-01 | `SELECT * FROM c WHERE IS_NULL(c.rating)` | Products | FunctionCallScalarExpression IS_NULL | — |
| T-02 | `SELECT * FROM c WHERE IS_DEFINED(c.brand)` | Products | IS_DEFINED | — |
| T-03 | `SELECT * FROM c WHERE NOT IS_DEFINED(c.brand)` | Products | NOT IS_DEFINED (missing field) | — |
| T-04 | `SELECT * FROM c WHERE IS_STRING(c.name)` | Products | IS_STRING | — |
| T-05 | `SELECT * FROM c WHERE IS_NUMBER(c.price)` | Products | IS_NUMBER | — |
| T-06 | `SELECT * FROM c WHERE IS_BOOL(c.inStock)` | Products | IS_BOOL | — |
| T-07 | `SELECT * FROM c WHERE IS_ARRAY(c.tags)` | Products | IS_ARRAY | — |
| T-08 | `SELECT * FROM c WHERE IS_OBJECT(c.shipping)` | Orders | IS_OBJECT | — |

### 5.7 WHERE — EXISTS subquery

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| E-01 | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")` | Products | ExistsScalarExpression | — |
| E-02 | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.quantity > 5)` | Orders | EXISTS on nested array | — |
| E-03 | `SELECT c.id FROM c WHERE NOT EXISTS(SELECT VALUE t FROM t IN c.tags)` | Products | NOT EXISTS | — |

### 5.8 String functions

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| STR-01 | `SELECT * FROM c WHERE CONTAINS(c.name, "phone")` | Products | CONTAINS | — |
| STR-02 | `SELECT * FROM c WHERE STARTSWITH(c.name, "Wireless")` | Products | STARTSWITH | — |
| STR-03 | `SELECT * FROM c WHERE ENDSWITH(c.brand, "X")` | Products | ENDSWITH | — |
| STR-04 | `SELECT UPPER(c.category) FROM c` | Products | UPPER in projection | — |
| STR-05 | `SELECT LOWER(c.name) FROM c` | Products | LOWER | — |
| STR-06 | `SELECT LENGTH(c.name) FROM c` | Products | LENGTH | — |
| STR-07 | `SELECT SUBSTRING(c.name, 0, 5) FROM c` | Products | SUBSTRING | — |
| STR-08 | `SELECT CONCAT(c.brand, " - ", c.name) FROM c` | Products | CONCAT with 3 args | — |
| STR-09 | `SELECT INDEX_OF(c.name, "less") FROM c` | Products | INDEX_OF | — |
| STR-10 | `SELECT REPLACE(c.name, "Wireless", "Wired") FROM c` | Products | REPLACE | — |
| STR-11 | `SELECT * FROM c WHERE REGEXMATCH(c.name, "^Wireless.*", "i")` | Products | REGEXMATCH with flags | — |
| STR-12 | `SELECT TRIM(c.description) FROM c` | Products | TRIM | — |
| STR-13 | `SELECT TOSTRING(c.price) FROM c` | Products | TOSTRING | — |
| STR-14 | `SELECT c.name || " [" || c.category || "]" FROM c` | Products | StringConcat operator `\|\|` | — |

### 5.9 Math functions

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| M-01 | `SELECT ABS(c.price - 50) FROM c` | Products | ABS | — |
| M-02 | `SELECT CEILING(c.rating) FROM c` | Products | CEILING | — |
| M-03 | `SELECT FLOOR(c.rating) FROM c` | Products | FLOOR | — |
| M-04 | `SELECT ROUND(c.price) FROM c` | Products | ROUND | — |
| M-05 | `SELECT SQRT(c.price) FROM c` | Products | SQRT | — |
| M-06 | `SELECT POWER(c.rating, 2) FROM c` | Products | POWER | — |
| M-07 | `SELECT LOG(c.price) FROM c` | Products | LOG | — |
| M-08 | `SELECT TRUNC(c.price) FROM c` | Products | TRUNC | — |
| M-09 | `SELECT SIGN(c.price - 100) FROM c` | Products | SIGN | — |
| M-10 | `SELECT c.price + c.price * 0.1 AS priceWithTax FROM c` | Products | Arithmetic in projection | — |
| M-11 | `SELECT c.totalAmount % 10 FROM c` | Orders | Modulo operator | — |

### 5.10 Array functions

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| A-01 | `SELECT ARRAY_LENGTH(c.tags) FROM c` | Products | ARRAY_LENGTH | — |
| A-02 | `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "sale")` | Products | ARRAY_CONTAINS | — |
| A-03 | `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "sale", true)` | Products | ARRAY_CONTAINS partial match | — |
| A-04 | `SELECT ARRAY_SLICE(c.tags, 0, 2) FROM c` | Products | ARRAY_SLICE | — |
| A-05 | `SELECT ARRAY_CONCAT(c.tags, ["extra"]) FROM c` | Products | ARRAY_CONCAT | — |
| A-06 | `SELECT * FROM c WHERE ARRAY_LENGTH(c.items) > 3` | Orders | ARRAY_LENGTH comparison | — |
| A-07 | `SELECT ARRAY(SELECT VALUE t FROM t IN c.tags) FROM c` | Products | ARRAY subquery in projection | — |
| A-08 | `SELECT SETUNION(c.tags, ["sale","new"]) FROM c` | Products | SETUNION | — |
| A-09 | `SELECT SETINTERSECT(c.tags, ["sale","clearance"]) FROM c` | Products | SETINTERSECT | — |

### 5.11 Date / time functions

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| D-01 | `SELECT * FROM c WHERE c.createdAt > "2024-01-01T00:00:00Z"` | Products | Date string comparison | — |
| D-02 | `SELECT GetCurrentDateTime() FROM c` | Events | GetCurrentDateTime scalar | — |
| D-03 | `SELECT * FROM c WHERE DateTimeDiff("day", "2024-01-01T00:00:00Z", c.timestamp) < 30` | Events | DateTimeDiff | — |
| D-04 | `SELECT DateTimeAdd("day", 7, c.createdAt) AS expiresAt FROM c` | Products | DateTimeAdd | — |
| D-05 | `SELECT DateTimePart("year", c.timestamp) AS year FROM c` | Events | DateTimePart | — |
| D-06 | `SELECT GetCurrentTimestamp() FROM c` | Events | GetCurrentTimestamp | — |

### 5.12 ORDER BY

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| O-01 | `SELECT * FROM c ORDER BY c.price` | Products | OrderByClause default (ASC) | — |
| O-02 | `SELECT * FROM c ORDER BY c.price ASC` | Products | ASC explicit | — |
| O-03 | `SELECT * FROM c ORDER BY c.price DESC` | Products | DESC | — |
| O-04 | `SELECT * FROM c ORDER BY c.category ASC, c.price DESC` | Products | Multi-column ORDER BY | — |
| O-05 | `SELECT * FROM c ORDER BY c.rating DESC, c.name ASC, c.id ASC` | Products | Triple ORDER BY | — |
| O-06 | `SELECT * FROM c ORDER BY c.shipping.address.city ASC` | Orders | Nested path in ORDER BY | — |

### 5.13 GROUP BY and Aggregations

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| G-01 | `SELECT c.category, COUNT(1) AS cnt FROM c GROUP BY c.category` | Products | COUNT(1) with GROUP BY, named key | — |
| G-01b | `SELECT c.category, COUNT(1) FROM c GROUP BY c.category` | Products | COUNT(1) unnamed → `{"$1": N}` key | — |
| G-02 | `SELECT c.category, SUM(c.price) AS total FROM c GROUP BY c.category` | Products | SUM aggregate, named | — |
| G-02b | `SELECT c.category, SUM(c.price) FROM c GROUP BY c.category` | Products | SUM unnamed → `{"$1": N}` | — |
| G-03 | `SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category` | Products | AVG aggregate | — |
| G-04 | `SELECT c.category, MIN(c.price) AS minPrice, MAX(c.price) AS maxPrice FROM c GROUP BY c.category` | Products | MIN + MAX together | — |
| G-05 | `SELECT c.category, c.inStock, COUNT(1) FROM c GROUP BY c.category, c.inStock` | Products | GROUP BY two columns | — |
| G-06 | `SELECT c.status, COUNT(1) AS cnt FROM c GROUP BY c.status` | Orders | GROUP BY status | — |
| G-07 | `SELECT c.type, COUNT(1) AS cnt, AVG(c.durationMs) AS avgMs FROM c GROUP BY c.type` | Events | GROUP BY event type with AVG null handling | — |

### 5.14 OFFSET / LIMIT

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| P-01 | `SELECT * FROM c OFFSET 0 LIMIT 10` | Products | OffsetLimitClause with literals | — |
| P-02 | `SELECT * FROM c ORDER BY c.price OFFSET 10 LIMIT 5` | Products | ORDER BY + OFFSET LIMIT | — |
| P-03 | `SELECT * FROM c OFFSET @skip LIMIT @take` | Products | OffsetLimitClause with parameters | — |
| P-04 | `SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT 1` | Events | "Latest event" pattern | — |

### 5.15 Scalar subqueries — ARRAY, FIRST, LAST

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| SQ-01 | `SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c` | Orders | ARRAY subquery in SELECT | — |
| SQ-02 | `SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS mostExpensive FROM c` | Orders | FIRST subquery | — |
| SQ-03 | `SELECT c.id, LAST(SELECT VALUE i FROM i IN c.items) AS lastItem FROM c` | Orders | LAST subquery | — |
| SQ-04 | `SELECT c.id, (SELECT VALUE COUNT(1) FROM i IN c.items) AS itemCount FROM c` | Orders | Scalar subquery COUNT | — |

### 5.16 Operators — arithmetic, bitwise, coalesce, ternary

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| OP-01 | `SELECT c.price * 1.2 AS inflated FROM c` | Products | Multiply | — |
| OP-02 | `SELECT c.totalAmount - c.discount ?? 0 AS effectiveAmount FROM c` | Orders | Coalesce (??) | — |
| OP-03 | `SELECT (c.price > 100 ? "expensive" : "affordable") AS priceLabel FROM c` | Products | Ternary (? :) | — |
| OP-04 | `SELECT c.price / 2 AS half FROM c` | Products | Divide | — |
| OP-05 | `SELECT c.totalAmount % 100 FROM c` | Orders | Modulo | — |
| OP-06 | `SELECT c.id & 0xF FROM c` | Events | Bitwise AND (for integer IDs) | — |
| OP-07 | `SELECT ~c.durationMs FROM c` | Events | Bitwise NOT | — |
| OP-08 | `SELECT c.id \| 0x100 FROM c` | Events | Bitwise OR | — |
| OP-09 | `SELECT c.id ^ 0xFF FROM c` | Events | Bitwise XOR | — |
| OP-10 | `SELECT c.id << 2 FROM c` | Events | Bitwise left shift | — |
| OP-11 | `SELECT c.id >> 1 FROM c` | Events | Bitwise right shift | — |
| OP-12 | `SELECT -(c.price) FROM c` | Products | Unary minus | — |
| OP-13 | `SELECT c.discount ?? c.totalAmount * 0.05 FROM c` | Orders | Coalesce with expression fallback | — |

### 5.17 Parameters

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| PR-01 | `SELECT * FROM c WHERE c.category = @category` | Products | ParameterRefScalarExpression | — |
| PR-02 | `SELECT * FROM c WHERE c.price BETWEEN @minPrice AND @maxPrice` | Products | Two parameters | — |
| PR-03 | `SELECT TOP @topN * FROM c WHERE c.inStock = @inStock ORDER BY c.price DESC OFFSET @skip LIMIT @take` | Products | Multiple parameters throughout query | — |

### 5.18 UDF calls

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| UDF-01 | `SELECT udf.formatPrice(c.price) FROM c` | Products | FunctionCallScalarExpression with udf:true | — |
| UDF-02 | `SELECT * FROM c WHERE udf.isExpensive(c.price, 100)` | Products | UDF in WHERE | — |
| UDF-03 | `SELECT udf.categoryLabel(c.category, c.brand, c.inStock) AS label FROM c` | Products | UDF with multiple args | — |

### 5.19 Complex / compositional queries

| ID | Query | Container | Expected (unit) | Expected error? |
|----|-------|-----------|-----------------|-----------------|
| CX-01 | `SELECT DISTINCT c.category FROM c WHERE c.inStock = true` | Products | DISTINCT + WHERE | — |
| CX-02 | `SELECT TOP 5 c.name, c.price FROM c WHERE c.category = "Electronics" AND c.rating > 4 ORDER BY c.price DESC` | Products | TOP + WHERE multi-condition + ORDER BY | — |
| CX-03 | `SELECT c.customerId, SUM(c.totalAmount) AS spent FROM c WHERE c.status != "cancelled" GROUP BY c.customerId` | Orders | WHERE + GROUP BY + aggregate | — |
| CX-04 | `SELECT c.id, c.name, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE STARTSWITH(t, "w")) AS wTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0` | Products | Nested ARRAY subquery with function in filter | — |
| CX-05 | `SELECT c.customerId, COUNT(1) AS cnt FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.unitPrice > 100) GROUP BY c.customerId` | Orders | EXISTS + GROUP BY | — |
| CX-06 | `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c WHERE c.timestamp BETWEEN @from AND @to GROUP BY c.type, c.userId ORDER BY cnt DESC OFFSET 0 LIMIT 20` | Events | Full query: WHERE + GROUP BY + ORDER BY aggregate alias + OFFSET LIMIT | — |
| CX-07 | `SELECT c.id, (c.status = "delivered" ? "done" : c.status = "cancelled" ? "failed" : "active") AS state FROM c` | Orders | Chained ternary | — |
| CX-08 | `SELECT * FROM c WHERE CONTAINS(c.name, "phone", true)` | Products | CONTAINS case-insensitive flag | — |

---

## 6. Negative Test Cases (Must Fail)

### 6.1 Parser-level errors (unit tests: parse should return errors array)

| ID | Query | Expected error |
|----|-------|---------------|
| N-01 | `SELECT FROM c` | Missing selection specification |
| N-02 | `SELECT * WHERE c.id = 1` | Missing FROM clause |
| N-03 | `SELECT * FROM c WHERE c.price BETWEEN 10` | Missing AND + upper bound in BETWEEN |
| N-04 | `SELECT * FROM c WHERE c.category IN ()` | Empty IN list |
| N-05 | `SELECT * FROM c ORDER BY` | Missing ORDER BY expression |
| N-06 | `SELECT * FROM c OFFSET LIMIT 10` | Missing offset value |
| N-07 | `SELECT * FROM c OFFSET 0 LIMIT` | Missing limit value |
| N-08 | `SELECT * FROM c WHERE c.price =` | Incomplete binary expression |
| N-09 | `SELECT (` | Unclosed parenthesis |
| N-10 | `SELECT * FROM c WHERE BETWEEN 1 AND 10` | BETWEEN without left operand |
| N-11 | `SELECT * FROM c WHERE c.name LIKE` | LIKE without pattern |
| N-12 | `SELECT * FROM c GROUP` | Incomplete GROUP BY |
| N-13 | `SELECT TOP * FROM c` | TOP without numeric expression |
| N-14 | `SELCT * FROM c` | Misspelled SELECT keyword |
| N-15 | `SELECT * FROM c WHERE c.price > "hello"` | *(parse succeeds, but type mismatch)* — document for integration |

### 6.2 Semantic / integration errors (zero results or runtime error)

| ID | Query | Container | Why it fails |
|----|-------|-----------|-------------|
| I-01 | `SELECT * FROM c WHERE c.nonexistent = "value"` | Products | Field does not exist → 0 results |
| I-02 | `SELECT * FROM c WHERE c.price > "expensive"` | Products | Type mismatch string vs number → 0 results |
| I-03 | `SELECT * FROM c WHERE c.tags = "sale"` | Products | Array vs string comparison → 0 results |
| I-04 | `SELECT * FROM c WHERE c.status = "unknown"` | Orders | No matching enum value → 0 results |
| I-05 | `SELECT * FROM c ORDER BY c.nonexistent ASC` | Events | Sort on undefined path → acts as null sort |
| I-06 | `SELECT * FROM c WHERE c.items.name = "Widget"` | Orders | Direct property on array without JOIN → 0 results |
| I-07 | `SELECT udf.notExists(c.id) FROM c` | Products | UDF not registered → runtime error |
| I-08 | `SELECT * FROM c OFFSET 100000 LIMIT 10` | Products | Offset beyond data size → 0 results |
| I-09 | `SELECT TOP 0 * FROM c` | Products | TOP 0 → 0 results (edge) |
| I-10 | `SELECT * FROM c WHERE SQRT(c.name) > 0` | Products | Math function on string → undefined/error behavior |

---

## 7. Test Infrastructure Design

### 7.1 File layout

```
packages/nosql-language-service/
  src/
    parser/
      SqlParser.test.ts           (existing — extend with new cases from §5)
    test-fixtures/
      containers/
        products.schema.json      (JSON Schema for validation)
        products.seed.json        (20 seed documents)
        orders.schema.json
        orders.seed.json          (25 seed documents)
        events.schema.json
        events.seed.json          (50 seed documents)
      queries/
        select-basic.ts           (query strings + expected AST shape for §5.1)
        select-from-join.ts
        select-where.ts
        select-functions.ts
        select-groupby-orderby.ts
        select-complex.ts
        negative-parser.ts        (§6.1)
        negative-integration.ts   (§6.2)
```

### 7.2 Query fixture format

```ts
export interface QueryFixture {
  id: string;           // "S-01"
  description: string;  // "SELECT * — star"
  query: string;
  container: 'products' | 'orders' | 'events';
  // For unit tests: partial AST matcher
  expectAst?: Partial<SqlQuery>;
  // For integration tests (future):
  expectMinRows?: number;
  expectMaxRows?: number;
  expectError?: boolean;
}
```

Parameters are supplied by each individual test, not stored in the fixture.

### 7.3 Unit test strategy

- Each query in §5 gets a `parse(query)` call followed by `expect(errors).toHaveLength(0)` + 1–3 focused AST assertions (e.g., `selectClause.spec.type`, `fromClause.collection.alias`).
- **Round-trip test**: every query that parses clean should survive `parse(sqlToString(ast))` producing the same AST shape.
- **Negative tests** (§6.1): `expect(errors.length).toBeGreaterThan(0)` + optionally assert on `errors[0].message`.

### 7.4 Seed data generation

- Write a one-time script `scripts/generate-test-data.mjs` that produces the JSON seed files using deterministic random (seed = 42).
- Documents must be stable across runs so snapshot tests never flicker.
- Each document includes `_partitionKey` matching the container's partition key strategy.

---

## 8. Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | All ~110 query fixtures in §5 have a passing unit test with at least one AST assertion |
| AC-2 | All 15 parser negative tests in §6.1 produce a non-empty `errors` array |
| AC-3 | All three seed JSON files are committed and validated against their TypeScript schemas |
| AC-4 | Round-trip test passes for all §5 fixtures |
| AC-5 | `npm run vitest` in the `nosql-language-service` package exits 0 |
| AC-6 | Fixture format is compatible with a future integration test harness (uses `QueryFixture` interface) |

---

## 9. Out of Scope for This PRD

- `ORDER BY RANK VectorDistance(...)` — vector search queries require dedicated embedding fixtures and are tracked separately.
- Spatial functions (`ST_DISTANCE`, `ST_WITHIN`) — require GeoJSON seed data, tracked separately.
- Completion / hover / diagnostic tests — already covered in `SqlCompletion.test.ts` and `SqlDiagnostics.test.ts`.
- Running against a live Cosmos DB Emulator — tracked in a separate integration-test PRD.

---

---

## 11. Phases

### Phase 1 — Generate seed data *(start here)*

Generate realistic fake JSON documents for all three containers. Volume target: **5–10 MB per container** (roughly 2 000–5 000 documents each at ~2 KB/doc average).

- Script: `scripts/generate-test-data.mjs` — deterministic output (fixed random seed = 42), runs offline, no network needed.
- Output files committed to `packages/nosql-language-service/src/test-fixtures/containers/`:
  - `products.seed.json`
  - `orders.seed.json`
  - `events.seed.json`
- Each file is a JSON array of documents, ready to bulk-import.
- Schema files (`*.schema.json`) committed alongside for documentation and optional validation.
- All "deliberately tricky" documents from §4 are included in the generated set.

**Deliverable:** three `.seed.json` files that pass schema validation, total size 15–30 MB.

---

### Phase 2 — Local emulator smoke test *(manual)*

Developer manually imports the seed files into a local **Cosmos DB Emulator** and runs the queries from §5 and §6 interactively to validate correctness.

- Import via Data Explorer or `@azure/cosmos` bulk-import script.
- No automated test runner at this stage — just eyeball the results.
- Feed back any query fixes into the fixture files before Phase 3.

**Deliverable:** all §5 queries return expected rows; all §6.2 queries return 0 rows / expected errors. Fixes committed.

---

### Phase 3 — Automated integration tests in CI *(last)*

Wire the fixtures into a repeatable CI pipeline using the **official Cosmos DB Emulator Docker image**.

- GitHub Actions supports Docker services natively — the emulator can be started as a `services:` container in the workflow YAML.
- A test script seeds the three containers on startup, runs the integration suite, and tears down.
- Skipped entirely until Phase 2 confirms the data and queries are correct.

**CI optimisations — skipping when nothing changed:**

GitHub Actions offers two complementary mechanisms:

1. **`on: paths:` trigger filter** — the simplest option. The workflow only starts at all when a push/PR touches a relevant path:
   ```yaml
   on:
     push:
       paths:
         - 'packages/**'
         - 'src/**'
         - '.github/workflows/integration-tests.yml'
   ```
   If no file in those paths changed, the entire workflow is skipped automatically — no runner cost.

2. **`hashFiles()` cache key for data population** — seeding 3 × 5–10 MB into the emulator is the slow part. Cache it by hashing the seed files so re-seeding only happens when the data actually changes:
   ```yaml
   - name: Cache seeded emulator state
     uses: actions/cache@v4
     with:
       path: .emulator-data/
       key: emulator-seed-${{ hashFiles('packages/nosql-language-service/src/test-fixtures/containers/**') }}
   ```
   On a cache hit the emulator starts with pre-loaded data; on a miss it re-seeds and saves the state. The `hashFiles()` function computes a SHA-256 over the glob — changing any seed document invalidates the cache automatically.

3. **Job-level `if:` condition with `git diff`** — for monorepo setups where the trigger paths are too coarse, a job can check exactly what changed:
   ```yaml
   jobs:
     integration:
       if: |
         github.event_name == 'push' &&
         contains(github.event.head_commit.modified, 'packages/')
   ```
   Or use `dorny/paths-filter` action for fine-grained per-job path matching.

**Recommendation:** use `on: paths:` (option 1) as the gate — zero cost when irrelevant files change — and `hashFiles()` cache (option 2) to avoid re-seeding on every run. Option 3 only needed if the monorepo grows and finer control is required.

**Other Phase 3 notes:**
- Cosmos DB Emulator Docker image startup time ~30–60 s — need a `wait-for` health-check step before tests start.
- Data population script runs as part of the workflow setup step, not inside the emulator image itself — keeps the Docker image vanilla and cacheable.
- Whether to keep the integration suite in `packages/nosql-language-service` or move it to `test/` at the root level — decide in Phase 2.

**Deliverable:** `.github/workflows/integration-tests.yml` that spins up the emulator Docker container, restores cached seed or re-seeds, runs the suite, and reports results.

---

## 12. Open Questions (resolved)

1. ~~Should the seed data be stored as `.json` (portable) or `.ts` (type-safe with the schema interface)?~~
   **Decision:** Seed data → `.json`. Schema → `schema.json`. No Zod. TypeScript types in `.ts` only if strict typing is needed in tests.

2. ~~For aggregation queries (§5.13), what is the expected output shape?~~
   **Decision:** Add two test variants per aggregation query — one with a named alias (`COUNT(1) AS cnt`) and one without (`COUNT(1)`). The unnamed variant tests Cosmos DB's `{"$1": N}` key behavior explicitly.

3. ~~Parameter values (`@category`, `@skip`, etc.) — should the fixture include a `defaultParameters` bag so the query can be run as-is without a test harness that provides them?~~
   **Decision:** Parameters are **not** part of the query fixture. Each test that exercises a parametrised query provides its own parameter values inline. The fixture stores only the query string.

4. ~~Should negative-integration tests (§6.2) be tagged so they are only run in CI with an emulator?~~
   **Decision:** Queries in §6.2 always return 0 rows or a well-defined error — no emulator-only gating needed. Run them unconditionally in the same suite.

