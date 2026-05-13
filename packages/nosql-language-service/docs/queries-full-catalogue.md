# NoSQL SELECT Query Catalogue

All queries planned for the test suite, grouped by feature.
Containers: **Products** (flat), **Orders** (nested + arrays), **Events** (sparse, time-series).

---

## Basic SELECT (S series)

| ID   | Query                                         |
| ---- | --------------------------------------------- |
| S-01 | `SELECT * FROM c`                             |
| S-02 | `SELECT c.id, c.name, c.price FROM c`         |
| S-03 | `SELECT VALUE c.price FROM c`                 |
| S-04 | `SELECT DISTINCT c.category FROM c`           |
| S-05 | `SELECT TOP 5 * FROM c`                       |
| S-06 | `SELECT TOP @n * FROM c`                      |
| S-07 | `SELECT c.id, c["name"] FROM c`               |
| S-08 | `SELECT {"id": c.id, "label": c.name} FROM c` |
| S-09 | `SELECT [c.price, c.rating] FROM c`           |
| S-10 | `SELECT DISTINCT TOP 3 c.category FROM c`     |

---

## FROM and aliases (F series)

| ID   | Query                                                                    |
| ---- | ------------------------------------------------------------------------ |
| F-01 | `SELECT * FROM Products p`                                               |
| F-02 | `SELECT p.name FROM Products AS p`                                       |
| F-03 | `SELECT * FROM (SELECT c.id, c.price FROM c WHERE c.inStock = true) sub` |

---

## JOIN and array iterators (J series)

| ID   | Query                                                                                 |
| ---- | ------------------------------------------------------------------------------------- |
| J-01 | `SELECT c.id, t FROM c JOIN t IN c.tags`                                              |
| J-02 | `SELECT c.id, item.name FROM c JOIN item IN c.items`                                  |
| J-03 | `SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2`          |
| J-04 | `SELECT c.id, item.name, sub.city FROM c JOIN item IN c.items JOIN sub IN c.shipping` |
| J-05 | `SELECT VALUE t FROM c JOIN t IN c.tags WHERE t = "sale"`                             |

---

## WHERE — comparisons (W series)

| ID   | Query                                                               |
| ---- | ------------------------------------------------------------------- |
| W-01 | `SELECT * FROM c WHERE c.price = 29.99`                             |
| W-02 | `SELECT * FROM c WHERE c.price != 0`                                |
| W-03 | `SELECT * FROM c WHERE c.price > 100`                               |
| W-04 | `SELECT * FROM c WHERE c.price >= 100`                              |
| W-05 | `SELECT * FROM c WHERE c.price < 10`                                |
| W-06 | `SELECT * FROM c WHERE c.price <= 10`                               |
| W-07 | `SELECT * FROM c WHERE c.inStock = true`                            |
| W-08 | `SELECT * FROM c WHERE c.inStock = false`                           |
| W-09 | `SELECT * FROM c WHERE c.rating = null`                             |
| W-10 | `SELECT * FROM c WHERE c.price > 10 AND c.price < 100`              |
| W-11 | `SELECT * FROM c WHERE c.category = "Books" OR c.category = "Food"` |
| W-12 | `SELECT * FROM c WHERE NOT c.inStock`                               |
| W-13 | `SELECT * FROM c WHERE NOT (c.price > 100 AND c.inStock = false)`   |

---

## WHERE — BETWEEN, IN, LIKE (B series)

| ID   | Query                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | `SELECT * FROM c WHERE c.price BETWEEN 10 AND 50`                                                                                                                               |
| B-02 | `SELECT * FROM c WHERE c.price NOT BETWEEN 10 AND 50`                                                                                                                           |
| B-03 | `SELECT * FROM c WHERE c.category IN ("Electronics", "Books")`                                                                                                                  |
| B-04 | `SELECT * FROM c WHERE c.category NOT IN ("Food")`                                                                                                                              |
| B-05 | `SELECT * FROM c WHERE c.name LIKE "%Headphone%"`                                                                                                                               |
| B-06 | `SELECT * FROM c WHERE c.name LIKE "Wireless%"`                                                                                                                                 |
| B-07 | `SELECT * FROM c WHERE c.name NOT LIKE "%Cheap%"`                                                                                                                               |
| B-08 | `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.category IN ('Electronics', 'Clothing')` — ⚠️ parentheses around BETWEEN required to avoid ambiguity with logical AND |
| B-09 | `SELECT * FROM c WHERE c.price BETWEEN @min AND @max`                                                                                                                           |

> **Parser note — BETWEEN + AND ambiguity:** `BETWEEN low AND high AND other_condition` is parsed as
> `BETWEEN low AND (high AND other_condition)` because the parser consumes `AND` greedily as the
> BETWEEN separator. Always wrap BETWEEN in parentheses when combining with logical AND:
> `(expr BETWEEN low AND high) AND other`.

---

## WHERE — type checks (T series)

| ID   | Query                                           |
| ---- | ----------------------------------------------- |
| T-01 | `SELECT * FROM c WHERE IS_NULL(c.rating)`       |
| T-02 | `SELECT * FROM c WHERE IS_DEFINED(c.brand)`     |
| T-03 | `SELECT * FROM c WHERE NOT IS_DEFINED(c.brand)` |
| T-04 | `SELECT * FROM c WHERE IS_STRING(c.name)`       |
| T-05 | `SELECT * FROM c WHERE IS_NUMBER(c.price)`      |
| T-06 | `SELECT * FROM c WHERE IS_BOOL(c.inStock)`      |
| T-07 | `SELECT * FROM c WHERE IS_ARRAY(c.tags)`        |
| T-08 | `SELECT * FROM c WHERE IS_OBJECT(c.shipping)`   |
| T-09 | `SELECT * FROM c WHERE IS_PRIMITIVE(c.price)`   |

---

## WHERE — EXISTS subquery (E series)

| ID   | Query                                                                                    |
| ---- | ---------------------------------------------------------------------------------------- |
| E-01 | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")`      |
| E-02 | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.quantity > 5)` |
| E-03 | `SELECT c.id FROM c WHERE NOT EXISTS(SELECT VALUE t FROM t IN c.tags)`                   |

---

## String functions (STR series)

| ID     | Query                                                            |
| ------ | ---------------------------------------------------------------- |
| STR-01 | `SELECT * FROM c WHERE CONTAINS(c.name, "phone")`                |
| STR-02 | `SELECT * FROM c WHERE STARTSWITH(c.name, "Wireless")`           |
| STR-03 | `SELECT * FROM c WHERE ENDSWITH(c.brand, "X")`                   |
| STR-04 | `SELECT UPPER(c.category) FROM c`                                |
| STR-05 | `SELECT LOWER(c.name) FROM c`                                    |
| STR-06 | `SELECT LENGTH(c.name) FROM c`                                   |
| STR-07 | `SELECT SUBSTRING(c.name, 0, 5) FROM c`                          |
| STR-08 | `SELECT CONCAT(c.brand, " - ", c.name) FROM c`                   |
| STR-09 | `SELECT INDEX_OF(c.name, "less") FROM c`                         |
| STR-10 | `SELECT REPLACE(c.name, "Wireless", "Wired") FROM c`             |
| STR-11 | `SELECT * FROM c WHERE REGEXMATCH(c.name, "^Wireless.*", "i")`   |
| STR-12 | `SELECT TRIM(c.description) FROM c` ⚠️ known limitation          |
| STR-13 | `SELECT TOSTRING(c.price) FROM c`                                |
| STR-14 | `SELECT c.name \|\| " [" \|\| c.category \|\| "]" FROM c`        |
| STR-15 | `SELECT LTRIM(c.name) FROM c`                                    |
| STR-16 | `SELECT RTRIM(c.name) FROM c`                                    |
| STR-17 | `SELECT LEFT(c.name, 5) FROM c`                                  |
| STR-18 | `SELECT RIGHT(c.name, 5) FROM c`                                 |
| STR-19 | `SELECT REVERSE(c.name) FROM c`                                  |
| STR-20 | `SELECT * FROM c WHERE StringEquals(c.category, "Books")`        |
| STR-21 | `SELECT * FROM c WHERE StringEquals(c.category, "books", true)`  |
| STR-22 | `SELECT * FROM c WHERE ContainsAnyCI(c.name, "python", "java")`  |
| STR-23 | `SELECT * FROM c WHERE ContainsAllCI(c.name, "crash", "course")` |

---

## Math functions (M series)

| ID   | Query                                                   |
| ---- | ------------------------------------------------------- |
| M-01 | `SELECT ABS(c.price - 50) FROM c`                       |
| M-02 | `SELECT CEILING(c.rating) FROM c`                       |
| M-03 | `SELECT FLOOR(c.rating) FROM c`                         |
| M-04 | `SELECT ROUND(c.price) FROM c`                          |
| M-05 | `SELECT SQRT(c.price) FROM c`                           |
| M-06 | `SELECT POWER(c.rating, 2) FROM c`                      |
| M-07 | `SELECT LOG(c.price) FROM c` ⚠️ known limitation        |
| M-08 | `SELECT TRUNC(c.price) FROM c`                          |
| M-09 | `SELECT SIGN(c.price - 100) FROM c`                     |
| M-10 | `SELECT c.price + c.price * 0.1 AS priceWithTax FROM c` |
| M-11 | `SELECT c.totalAmount % 10 FROM c`                      |
| M-12 | `SELECT EXP(c.rating) FROM c`                           |
| M-13 | `SELECT LOG10(c.price) FROM c` ⚠️ known limitation      |
| M-14 | `SELECT SIN(c.rating) FROM c`                           |
| M-15 | `SELECT COS(c.rating) FROM c`                           |
| M-16 | `SELECT TAN(c.rating) FROM c`                           |
| M-17 | `SELECT ASIN(0.5) FROM c`                               |
| M-18 | `SELECT ACOS(0.5) FROM c`                               |
| M-19 | `SELECT ATAN(c.price) FROM c`                           |
| M-20 | `SELECT DEGREES(c.rating) FROM c`                       |
| M-21 | `SELECT RADIANS(c.rating) FROM c`                       |
| M-22 | `SELECT PI() FROM c`                                    |
| M-23 | `SELECT RAND() FROM c`                                  |

---

## Array functions (A series)

| ID   | Query                                                                       |
| ---- | --------------------------------------------------------------------------- |
| A-01 | `SELECT ARRAY_LENGTH(c.tags) FROM c`                                        |
| A-02 | `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "sale")`                      |
| A-03 | `SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, "sale", true)`                |
| A-04 | `SELECT ARRAY_SLICE(c.tags, 0, 2) FROM c`                                   |
| A-05 | `SELECT ARRAY_CONCAT(c.tags, ["extra"]) FROM c`                             |
| A-06 | `SELECT * FROM c WHERE ARRAY_LENGTH(c.items) > 3`                           |
| A-07 | `SELECT ARRAY(SELECT VALUE t FROM t IN c.tags) FROM c`                      |
| A-08 | `SELECT SETUNION(c.tags, ["sale","new"]) FROM c`                            |
| A-09 | `SELECT SETINTERSECT(c.tags, ["sale","clearance"]) FROM c`                  |
| A-10 | `SELECT * FROM c WHERE ARRAY_CONTAINS_ALL(c.tags, ["bundle", "certified"])` |
| A-11 | `SELECT * FROM c WHERE ARRAY_CONTAINS_ANY(c.tags, ["sale", "bundle"])`      |

---

## Date functions (D series)

| ID   | Query                                                                                 |
| ---- | ------------------------------------------------------------------------------------- |
| D-01 | `SELECT * FROM c WHERE c.createdAt > "2024-01-01T00:00:00Z"`                          |
| D-02 | `SELECT GetCurrentDateTime() FROM c`                                                  |
| D-03 | `SELECT * FROM c WHERE DateTimeDiff("day", "2024-01-01T00:00:00Z", c.timestamp) < 30` |
| D-04 | `SELECT DateTimeAdd("day", 7, c.createdAt) AS expiresAt FROM c`                       |
| D-05 | `SELECT DateTimePart("year", c.timestamp) AS year FROM c`                             |
| D-06 | `SELECT GetCurrentTimestamp() FROM c`                                                 |
| D-07 | `SELECT DateTimeToTimestamp(c.createdAt) AS ts FROM c`                                |
| D-08 | `SELECT TimestampToDateTime(GetCurrentTimestamp()) AS dt FROM c`                      |
| D-09 | `SELECT DateTimeBin(c.timestamp, "day", 1) AS day FROM c`                             |

---

## ORDER BY (O series)

| ID   | Query                                                          |
| ---- | -------------------------------------------------------------- |
| O-01 | `SELECT * FROM c ORDER BY c.price`                             |
| O-02 | `SELECT * FROM c ORDER BY c.price ASC`                         |
| O-03 | `SELECT * FROM c ORDER BY c.price DESC`                        |
| O-04 | `SELECT * FROM c ORDER BY c.category ASC, c.price DESC`        |
| O-05 | `SELECT * FROM c ORDER BY c.rating DESC, c.name ASC, c.id ASC` |
| O-06 | `SELECT * FROM c ORDER BY c.shipping.address.city ASC`         |

---

## GROUP BY and aggregations (G series)

| ID    | Query                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------- |
| G-01  | `SELECT c.category, COUNT(1) AS cnt FROM c GROUP BY c.category`                                    |
| G-01b | `SELECT c.category, COUNT(1) FROM c GROUP BY c.category`                                           |
| G-02  | `SELECT c.category, SUM(c.price) AS total FROM c GROUP BY c.category`                              |
| G-02b | `SELECT c.category, SUM(c.price) FROM c GROUP BY c.category`                                       |
| G-03  | `SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category`                         |
| G-04  | `SELECT c.category, MIN(c.price) AS minPrice, MAX(c.price) AS maxPrice FROM c GROUP BY c.category` |
| G-05  | `SELECT c.category, c.inStock, COUNT(1) FROM c GROUP BY c.category, c.inStock`                     |
| G-06  | `SELECT c.status, COUNT(1) AS cnt FROM c GROUP BY c.status`                                        |
| G-07  | `SELECT c.type, COUNT(1) AS cnt, AVG(c.durationMs) AS avgMs FROM c GROUP BY c.type`                |
| G-08  | `SELECT c.category, CountIf(c.inStock) AS inStockCount FROM c GROUP BY c.category`                 |
| G-09  | `SELECT c.category, MakeList(c.brand) AS brands FROM c GROUP BY c.category`                        |
| G-10  | `SELECT c.category, MakeSet(c.brand) AS uniqueBrands FROM c GROUP BY c.category`                   |

---

## OFFSET / LIMIT (P series)

| ID   | Query                                                        |
| ---- | ------------------------------------------------------------ |
| P-01 | `SELECT * FROM c OFFSET 0 LIMIT 10`                          |
| P-02 | `SELECT * FROM c ORDER BY c.price OFFSET 10 LIMIT 5`         |
| P-03 | `SELECT * FROM c OFFSET @skip LIMIT @take`                   |
| P-04 | `SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT 1` |

---

## Scalar subqueries — ARRAY, FIRST, LAST (SQ series)

| ID    | Query                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------- |
| SQ-01 | `SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c`                          |
| SQ-02 | `SELECT c.id, FIRST(SELECT VALUE i FROM i IN c.items ORDER BY i.unitPrice DESC) AS mostExpensive FROM c` |
| SQ-03 | `SELECT c.id, LAST(SELECT VALUE i FROM i IN c.items) AS lastItem FROM c`                                 |
| SQ-04 | `SELECT c.id, (SELECT VALUE COUNT(1) FROM i IN c.items) AS itemCount FROM c`                             |

---

## Operators — arithmetic, bitwise, coalesce, ternary (OP series)

| ID    | Query                                                                      |
| ----- | -------------------------------------------------------------------------- |
| OP-01 | `SELECT c.price * 1.2 AS inflated FROM c`                                  |
| OP-02 | `SELECT c.totalAmount - c.discount ?? 0 AS effectiveAmount FROM c`         |
| OP-03 | `SELECT (c.price > 100 ? "expensive" : "affordable") AS priceLabel FROM c` |
| OP-04 | `SELECT c.price / 2 AS half FROM c`                                        |
| OP-05 | `SELECT c.totalAmount % 100 FROM c`                                        |
| OP-06 | `SELECT c.id & 0xF FROM c`                                                 |
| OP-07 | `SELECT ~c.durationMs FROM c`                                              |
| OP-08 | `SELECT c.id \| 0x100 FROM c`                                              |
| OP-09 | `SELECT c.id ^ 0xFF FROM c`                                                |
| OP-10 | `SELECT c.id << 2 FROM c`                                                  |
| OP-11 | `SELECT c.id >> 1 FROM c`                                                  |
| OP-12 | `SELECT -(c.price) FROM c`                                                 |
| OP-13 | `SELECT c.discount ?? c.totalAmount * 0.05 FROM c`                         |

---

## Parameters (PR series)

| ID    | Query                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------- |
| PR-01 | `SELECT * FROM c WHERE c.category = @category`                                                        |
| PR-02 | `SELECT * FROM c WHERE c.price BETWEEN @minPrice AND @maxPrice`                                       |
| PR-03 | `SELECT TOP @topN * FROM c WHERE c.inStock = @inStock ORDER BY c.price DESC OFFSET @skip LIMIT @take` |

---

## UDF calls (UDF series)

| ID     | Query                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- |
| UDF-01 | `SELECT udf.formatPrice(c.price) FROM c` ⚠️ known limitation                                   |
| UDF-02 | `SELECT * FROM c WHERE udf.isExpensive(c.price, 100)` ⚠️ known limitation                      |
| UDF-03 | `SELECT udf.categoryLabel(c.category, c.brand, c.inStock) AS label FROM c` ⚠️ known limitation |

> ⚠️ **UDF-01..03** — server-side scripts (UDFs) are not supported in the vnext-preview Linux emulator.
> The parser correctly handles all UDF syntax. Tests are marked `knownLimitation` and degrade to `console.warn`.

---

## Type conversion functions (TC series)

| ID    | Query                                                   | Container |
| ----- | ------------------------------------------------------- | --------- |
| TC-01 | `SELECT TOP 1 StringToNumber('42') AS n FROM c`         | Products  |
| TC-02 | `SELECT TOP 1 StringToBoolean('true') AS b FROM c`      | Products  |
| TC-03 | `SELECT TOP 1 StringToNull('null') AS v FROM c`         | Products  |
| TC-04 | `SELECT TOP 1 StringToArray('[1, 2, 3]') AS arr FROM c` | Products  |
| TC-05 | `SELECT TOP 1 StringToObject('{"a": 1}') AS obj FROM c` | Products  |

---

## Conditional functions (CF series)

| ID    | Query                                                                   | Container |
| ----- | ----------------------------------------------------------------------- | --------- |
| CF-01 | `SELECT IIF(c.inStock, 'available', 'sold out') AS availability FROM c` | Products  |

---

## Complex / compositional (CX series)

| ID    | Query                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CX-01 | `SELECT DISTINCT c.category FROM c WHERE c.inStock = true`                                                                                              |
| CX-02 | `SELECT TOP 5 c.name, c.price FROM c WHERE c.category = "Electronics" AND c.rating > 4 ORDER BY c.price DESC`                                           |
| CX-03 | `SELECT c.customerId, SUM(c.totalAmount) AS spent FROM c WHERE c.status != "cancelled" GROUP BY c.customerId`                                           |
| CX-04 | `SELECT c.id, c.name, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE STARTSWITH(t, "w")) AS wTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0`                   |
| CX-05 | `SELECT c.customerId, COUNT(1) AS cnt FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.unitPrice > 100) GROUP BY c.customerId`              |
| CX-06 | `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c WHERE c.timestamp BETWEEN @from AND @to GROUP BY c.type, c.userId ORDER BY cnt DESC OFFSET 0 LIMIT 20` |
| CX-07 | `SELECT c.id, (c.status = "delivered" ? "done" : c.status = "cancelled" ? "failed" : "active") AS state FROM c`                                         |
| CX-08 | `SELECT * FROM c WHERE CONTAINS(c.name, "phone", true)`                                                                                                 |

---

## Negative — parser errors (N series)

| ID    | Query                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CX-01 | `SELECT DISTINCT c.category FROM c WHERE c.inStock = true`                                                                                              |
| CX-02 | `SELECT TOP 5 c.name, c.price FROM c WHERE c.category = "Electronics" AND c.rating > 4 ORDER BY c.price DESC`                                           |
| CX-03 | `SELECT c.customerId, SUM(c.totalAmount) AS spent FROM c WHERE c.status != "cancelled" GROUP BY c.customerId`                                           |
| CX-04 | `SELECT c.id, c.name, ARRAY(SELECT VALUE t FROM t IN c.tags WHERE STARTSWITH(t, "w")) AS wTags FROM c WHERE ARRAY_LENGTH(c.tags) > 0`                   |
| CX-05 | `SELECT c.customerId, COUNT(1) AS cnt FROM c WHERE EXISTS(SELECT VALUE i FROM i IN c.items WHERE i.unitPrice > 100) GROUP BY c.customerId`              |
| CX-06 | `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c WHERE c.timestamp BETWEEN @from AND @to GROUP BY c.type, c.userId ORDER BY cnt DESC OFFSET 0 LIMIT 20` |
| CX-07 | `SELECT c.id, (c.status = "delivered" ? "done" : c.status = "cancelled" ? "failed" : "active") AS state FROM c`                                         |
| CX-08 | `SELECT * FROM c WHERE CONTAINS(c.name, "phone", true)`                                                                                                 |

---

## Negative — parser errors (N series)

| ID   | Query                                      | Expected                                |
| ---- | ------------------------------------------ | --------------------------------------- |
| N-01 | `SELECT FROM c`                            | Missing selection spec                  |
| N-02 | `SELECT * WHERE c.id = 1`                  | Missing FROM                            |
| N-03 | `SELECT * FROM c WHERE c.price BETWEEN 10` | Incomplete BETWEEN                      |
| N-04 | `SELECT * FROM c WHERE c.category IN ()`   | Empty IN list                           |
| N-05 | `SELECT * FROM c ORDER BY`                 | Missing ORDER BY expression             |
| N-06 | `SELECT * FROM c OFFSET LIMIT 10`          | Missing offset value                    |
| N-07 | `SELECT * FROM c OFFSET 0 LIMIT`           | Missing limit value                     |
| N-08 | `SELECT * FROM c WHERE c.price =`          | Incomplete binary expression            |
| N-09 | `SELECT (`                                 | Unclosed parenthesis                    |
| N-10 | `SELECT * FROM c WHERE BETWEEN 1 AND 10`   | BETWEEN without left operand            |
| N-11 | `SELECT * FROM c WHERE c.name LIKE`        | LIKE without pattern                    |
| N-12 | `SELECT * FROM c GROUP`                    | Incomplete GROUP BY                     |
| N-13 | `SELECT TOP * FROM c`                      | TOP without numeric expression          |
| N-14 | `SELCT * FROM c`                           | Misspelled SELECT                       |
| N-15 | `SELECT * FROM c WHERE c.price > "hello"`  | _(parses OK, type mismatch at runtime)_ |

---

## Negative — integration / zero-result (I series)

| ID   | Query                                           | Container | Why                                        |
| ---- | ----------------------------------------------- | --------- | ------------------------------------------ |
| I-01 | `SELECT * FROM c WHERE c.nonexistent = "value"` | Products  | Field does not exist → 0 rows              |
| I-02 | `SELECT * FROM c WHERE c.price > "expensive"`   | Products  | Type mismatch → 0 rows                     |
| I-03 | `SELECT * FROM c WHERE c.tags = "sale"`         | Products  | Array vs string → 0 rows                   |
| I-04 | `SELECT * FROM c WHERE c.status = "unknown"`    | Orders    | No matching enum value → 0 rows            |
| I-05 | `SELECT * FROM c ORDER BY c.nonexistent ASC`    | Events    | Sort on undefined path (null sort)         |
| I-06 | `SELECT * FROM c WHERE c.items.name = "Widget"` | Orders    | Direct prop on array without JOIN → 0 rows |
| I-07 | `SELECT udf.notExists(c.id) FROM c`             | Products  | Unregistered UDF → runtime error           |
| I-08 | `SELECT * FROM c OFFSET 100000 LIMIT 10`        | Products  | Beyond data size → 0 rows                  |
| I-09 | `SELECT TOP 0 * FROM c`                         | Products  | TOP 0 → 0 rows                             |
| I-10 | `SELECT * FROM c WHERE SQRT(c.name) > 0`        | Products  | Math on string → undefined behavior        |

---

---

# Smoke Test Selection — Top 10

Criteria: **maximum feature diversity**, **simple → complex**, independently meaningful even without full data.

| #   | ID          | Query                                                                                                                                                   | Container | Why this one                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| 1   | S-01        | `SELECT * FROM c`                                                                                                                                       | Products  | Absolute baseline — if this fails, nothing works                      |
| 2   | W-10        | `SELECT * FROM c WHERE c.price > 10 AND c.price < 100`                                                                                                  | Products  | Basic WHERE with AND — most common real-world pattern                 |
| 3   | S-04 + O-03 | `SELECT DISTINCT c.category FROM c ORDER BY c.category ASC`                                                                                             | Products  | DISTINCT + ORDER BY — two modifiers at once                           |
| 4   | B-08        | `SELECT * FROM c WHERE (c.price BETWEEN 10 AND 100) AND c.category IN ('Electronics', 'Clothing')`                                                      | Products  | BETWEEN + IN — **parentheses required** around BETWEEN                |
| 5   | J-03        | `SELECT c.id, item.name FROM c JOIN item IN c.items WHERE item.quantity > 2`                                                                            | Orders    | Array iterator JOIN + WHERE on iterator var — nested data access      |
| 6   | G-03        | `SELECT c.category, AVG(c.rating) AS avgRating FROM c GROUP BY c.category`                                                                              | Products  | GROUP BY + aggregate — fundamental analytics pattern                  |
| 7   | E-01        | `SELECT c.id FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = "sale")`                                                                     | Products  | EXISTS subquery — correlated subquery, non-trivial AST                |
| 8   | SQ-01       | `SELECT c.id, ARRAY(SELECT VALUE i.name FROM i IN c.items) AS itemNames FROM c`                                                                         | Orders    | ARRAY subquery in projection — data reshaping                         |
| 9   | CX-06       | `SELECT c.type, c.userId, COUNT(1) AS cnt FROM c WHERE c.timestamp BETWEEN @from AND @to GROUP BY c.type, c.userId ORDER BY cnt DESC OFFSET 0 LIMIT 20` | Events    | Full query: params + WHERE + GROUP BY + ORDER BY alias + OFFSET LIMIT |
| 10  | N-01        | `SELECT FROM c`                                                                                                                                         | —         | Negative: parser must reject, errors[] non-empty                      |

## Why these 10?

- **S-01** — verifies the parser doesn't crash on trivial input.
- **W-10** — compound WHERE covers `AND`, two comparisons, and `>` / `<`.
- **S-04 + O-03** — `DISTINCT` flag + `OrderByClause` both present in the same AST.
- **B-08** — `BetweenScalarExpression` + `InScalarExpression` inside a compound `AND`. Parentheses around BETWEEN are mandatory.
- **J-03** — `JoinCollectionExpression` (array iterator) with a `WHERE` that references the iterator variable — the most common NoSQL "flatten" pattern.
- **G-03** — `GroupByClause` + `FunctionCallScalarExpression` (AVG) as a SELECT item.
- **E-01** — `ExistsScalarExpression` wrapping a full nested `SqlQuery` — deepest nesting in the AST for most queries.
- **SQ-01** — `ArraySubqueryScalarExpression` in the SELECT projection — orthogonal to WHERE-based tests.
- **CX-06** — exercises every major clause simultaneously plus parameters and `ORDER BY` on an aggregate alias.
- **N-01** — confirms error recovery works: `errors` array is non-empty, `ast` is still partially built.

## What these 10 do NOT cover (intentionally deferred)

- String / math / array / date functions (STR, M, A, D) — all follow the same `FunctionCallScalarExpression` AST shape; one test suffices at smoke stage.
- Bitwise operators (OP-06..OP-11) — edge feature, rarely broken independently.
- UDF calls — require infrastructure setup to be meaningful.
- Vector / spatial functions — out of scope for this PRD.
