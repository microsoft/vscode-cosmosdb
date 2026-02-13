# Azure Cosmos DB NoSQL Query Language Reference

Based on [online documentation](https://learn.microsoft.com/en-us/cosmos-db/query/overview).

This document provides a comprehensive reference for the Azure Cosmos DB NoSQL query language to help generate syntactically correct queries.

## Query Structure Overview

Azure Cosmos DB NoSQL queries follow a SQL-like syntax with the following general structure:

```
SELECT <select_specification>
FROM <from_source>
[WHERE <filter_condition>]
[ORDER BY <sort_specification>]
[GROUP BY <expression>]
[OFFSET <offset_amount> LIMIT <limit_amount>]
```

**Important Notes:**

- Cosmos DB NoSQL is READ-ONLY for queries. Do NOT generate DML statements (INSERT, UPDATE, DELETE, DROP).
- Data is typically schema-free and denormalized.
- JOINs are self-joins within a single item, NOT cross-item joins.

---

## SELECT Clause

The SELECT clause identifies fields to return in query results.

### Syntax

```
SELECT <select_specification>

<select_specification> ::=
      '*'
      | [DISTINCT] <object_property_list>
      | [DISTINCT] VALUE <scalar_expression> [[ AS ] value_alias]

<object_property_list> ::=
{ <scalar_expression> [ [ AS ] property_alias ] } [ ,...n ]
```

### Key Rules

- Use `{containerAlias}.{propertyName}` to refer to properties (e.g., `SELECT c.name FROM c`)
- Use `VALUE` keyword to return raw values instead of wrapped JSON objects
- Use `DISTINCT VALUE` (not just `DISTINCT`) when getting unique values of a property
- Give projection values aliases when possible, formatted in camelCase
- `SELECT *` is only valid when FROM clause declares exactly one alias
- Do NOT use `SELECT *` when the query includes a JOIN - project specific properties instead

### Examples

**Basic selection:**

```sql
SELECT * FROM c
```

**Selecting specific properties with aliases:**

```sql
SELECT
  c.name AS productName,
  c.price AS unitPrice
FROM products c
```

**Using VALUE for raw values:**

```sql
SELECT VALUE c.name FROM products c
```

**Using DISTINCT VALUE:**

```sql
SELECT DISTINCT VALUE c.category FROM products c
```

**JSON projection:**

```sql
SELECT VALUE {
  name: p.name,
  link: p.metadata.link,
  firstTag: p.tags[0]["value"]
}
FROM products p
```

---

## FROM Clause

The FROM clause identifies the data source for a query.

### Syntax

```
FROM <from_specification>

<from_specification> ::= <from_source> {[ JOIN <from_source>][,...n]}
<from_source> ::= <container_expression> [[AS] input_alias] | input_alias IN <container_expression>
<container_expression> ::= ROOT | container_name | input_alias | <container_expression> '.' property_name | <container_expression> '[' "property_name" | array_index ']'
```

### Key Rules

- Typically use a single-letter alias like `c` for the container
- Aliases must be unique within the query
- Can access sub-properties directly as source

### Examples

**Basic FROM with alias:**

```sql
SELECT c.name FROM products c
```

**Subroot as source:**

```sql
SELECT VALUE s FROM products.sizes s
```

---

## WHERE Clause

The WHERE clause filters items based on specified conditions.

### Syntax

```
WHERE <filter_condition>
<filter_condition> ::= <scalar_expression>
```

### Key Rules

- Use `!=` instead of `IS NOT`
- For string comparisons, assume NOT case sensitive unless specified
- Use `STRINGEQUALS` for case-insensitive string equality
- Use `BETWEEN` for **numeric** range filtering only (e.g., `c.price BETWEEN 10 AND 100`)
- **Do NOT use BETWEEN with string values** (including dates stored as strings) - use `>=` and `<=` operators instead

### Examples

**Equality filter:**

```sql
SELECT * FROM c WHERE c.status = 'active'
```

**Multiple conditions:**

```sql
SELECT * FROM c WHERE c.category = 'electronics' AND c.price > 100
```

**Numeric range filter with BETWEEN:**

```sql
SELECT * FROM c WHERE c.price BETWEEN 10 AND 50
```

**Date string range filter (use >= and <=, NOT BETWEEN):**

```sql
SELECT * FROM c WHERE c.orderDate >= '2014-01-01' AND c.orderDate <= '2014-06-30'
```

---

## ORDER BY Clause

The ORDER BY clause sorts the result set.

### Syntax

```
ORDER BY <sort_specification>

<sort_specification> ::= <expression> [ASC | DESC] [, <expression> [ASC | DESC]]...
```

### Key Rules

- ORDER BY expressions must map to a **direct document path** (e.g., `c.propertyName`)
- Do NOT use ORDER BY on **computed columns**, **aliases from subqueries**, or **aggregate results**
- Do NOT use ORDER BY with subqueries in the FROM clause - the outer query cannot sort by subquery aliases
- When you need to sort aggregated data, restructure the query to avoid subqueries or perform sorting client-side
- **Composite indexes are REQUIRED** for ORDER BY on multiple properties or mixed sort directions - see Limitations below

### Limitations

**ORDER BY does NOT work with:**

- Aliases from subqueries (e.g., `SELECT ... FROM (SELECT x AS alias ...) ORDER BY alias`)
- Computed expressions that cannot be mapped to a document path
- Results from GROUP BY aggregations in subqueries

**Composite Index Requirements:**

ORDER BY queries on **multiple properties** or with **mixed sort directions** (ASC and DESC) require a **composite index** to be defined in the container's indexing policy. Without the appropriate composite index, the query will fail with error: "The order by query does not have a corresponding composite index that it can be served from."

- **Single property ASC**: Works with default range index (no composite index needed)
- **Single property DESC**: May require a composite index depending on container configuration
- **Multiple properties**: ALWAYS requires a composite index matching the exact order and direction
- **Mixed directions** (e.g., `ORDER BY c.a ASC, c.b DESC`): ALWAYS requires a composite index

When generating queries with multi-property ORDER BY, **prefer single-property ORDER BY** when possible, or note that a composite index must exist.

### Examples

**Single property sort (works with default index):**

```sql
SELECT * FROM c ORDER BY c.name
```

**Descending sort:**

```sql
SELECT * FROM c ORDER BY c.createdAt DESC
```

**Multiple property sort (REQUIRES composite index):**

```sql
-- This query requires a composite index on (category ASC, price DESC)
-- Without the index, it will fail
SELECT * FROM c ORDER BY c.category ASC, c.price DESC
```

**INCORRECT - Will fail without composite index:**

```sql
-- Error: "The order by query does not have a corresponding composite index"
-- This needs a composite index on (orderDate ASC, id DESC)
SELECT * FROM c
WHERE c.type = 'order'
ORDER BY c.orderDate ASC, c.id DESC
OFFSET 40 LIMIT 20
```

**CORRECT - Single property ORDER BY (no composite index needed):**

```sql
-- Prefer single-property ORDER BY when possible
SELECT * FROM c
WHERE c.type = 'order'
ORDER BY c.orderDate ASC
OFFSET 40 LIMIT 20
```

**INCORRECT - Will fail (ORDER BY on subquery alias):**

```sql
-- This will fail with error 2206
SELECT TOP 5 t.city, t.customerCount
FROM (
    SELECT a.city AS city, COUNT(1) AS customerCount
    FROM c
    JOIN a IN c.addresses
    GROUP BY a.city
) AS t
WHERE t.customerCount > 50
ORDER BY t.customerCount DESC
```

**CORRECT - Alternative approach (no ORDER BY on aggregated subquery):**

```sql
-- Option 1: Remove ORDER BY and sort results client-side
SELECT t.city, t.customerCount
FROM (
    SELECT a.city AS city, COUNT(1) AS customerCount
    FROM c
    JOIN a IN c.addresses
    GROUP BY a.city
) AS t
WHERE t.customerCount > 50

-- Option 2: For simple aggregations without subquery, ORDER BY works on document paths
SELECT a.city, COUNT(1) AS customerCount
FROM c
JOIN a IN c.addresses
GROUP BY a.city
```

---

## GROUP BY Clause

The GROUP BY clause groups rows with the same values into summary rows.

### Syntax

```
GROUP BY <expression>
```

### Key Rules

- Do NOT use HAVING clause (not supported)
- Do NOT use DISTINCT within COUNT

### Examples

**Group by property:**

```sql
SELECT
  c.category,
  COUNT(1) AS itemCount
FROM products c
GROUP BY c.category
```

---

## OFFSET LIMIT Clause

The OFFSET LIMIT clause returns a subset of results by skipping and taking specified amounts.

### Syntax

```
OFFSET <offset_amount> LIMIT <limit_amount>
```

### Examples

**Pagination:**

```sql
SELECT * FROM c
ORDER BY c.name
OFFSET 10 LIMIT 20
```

---

## JOIN Clause (Self-Join)

In Cosmos DB NoSQL, JOINs are self-joins WITHIN a single item to flatten arrays. They do NOT join across items or containers.

### Key Rules

- JOINs create a cross-product of the item and its array elements
- When using JOIN, do NOT use `SELECT *` - project specific properties
- Use JOIN or EXISTS when querying properties within arrays

### Examples

**Basic self-join on array:**

```sql
SELECT
  p.name,
  s.key AS size
FROM products p
JOIN s IN p.sizes
```

**Self-join with filter:**

```sql
SELECT
  p.name,
  t.value AS tagValue
FROM products p
JOIN t IN p.tags
WHERE t.key = 'category'
```

**Multiple array joins:**

```sql
SELECT
  p.name,
  c AS color,
  s.description AS size
FROM products p
JOIN c IN p.colors
JOIN s IN p.sizes
WHERE c LIKE '%blue%'
```

---

## Subqueries

Subqueries are nested queries that can be used in SELECT, FROM, or WHERE clauses.

### Types

- **Scalar subquery**: Returns a single value
- **Multi-value subquery**: Returns multiple rows (used in FROM clause)

### Examples

**Scalar subquery in SELECT:**

```sql
SELECT
  p.name,
  (SELECT VALUE COUNT(1) FROM c IN p.colors) AS colorCount
FROM products p
```

**Subquery with JOIN for optimization:**

```sql
SELECT VALUE COUNT(1)
FROM products p
JOIN (SELECT VALUE t FROM t IN p.tags WHERE t.key IN ('fabric', 'material'))
JOIN (SELECT VALUE s FROM s IN p.sizes WHERE s["order"] >= 3)
```

---

## Keywords

### BETWEEN

Evaluates whether a **numeric** value is within an inclusive range. **Only works with numeric expressions, NOT strings.**

```sql
-- CORRECT: BETWEEN with numeric values
SELECT * FROM c WHERE c.price BETWEEN 10 AND 100

-- INCORRECT: BETWEEN with string dates will fail
-- SELECT * FROM c WHERE c.orderDate BETWEEN '2014-01-01' AND '2014-06-30'

-- CORRECT: Use >= and <= for string/date ranges
SELECT * FROM c WHERE c.orderDate >= '2014-01-01' AND c.orderDate <= '2014-06-30'
```

### DISTINCT

Eliminates duplicates in results. Use with VALUE for property values.

```sql
SELECT DISTINCT VALUE c.category FROM c
```

### LIKE

Pattern matching for strings. Use `%` as wildcard.

```sql
SELECT * FROM c WHERE c.name LIKE '%jacket%'
SELECT * FROM c WHERE c.color LIKE 'blue%'
```

### IN

Checks if a value matches any value in a list.

```sql
SELECT * FROM c WHERE c.status IN ('active', 'pending', 'approved')
```

### TOP

Returns the first N results (undefined order unless ORDER BY used).

```sql
SELECT TOP 10 * FROM c
```

---

## Operators

### Comparison Operators

| Operator | Description                           |
| -------- | ------------------------------------- |
| `=`      | Equal to                              |
| `!=`     | Not equal to (use this, NOT `IS NOT`) |
| `<`      | Less than                             |
| `>`      | Greater than                          |
| `<=`     | Less than or equal                    |
| `>=`     | Greater than or equal                 |

### Logical Operators

| Operator | Description |
| -------- | ----------- |
| `AND`    | Logical AND |
| `OR`     | Logical OR  |
| `NOT`    | Logical NOT |

### Arithmetic Operators

| Operator | Description    |
| -------- | -------------- |
| `+`      | Addition       |
| `-`      | Subtraction    |
| `*`      | Multiplication |
| `/`      | Division       |
| `%`      | Modulo         |

### Ternary Operator

```sql
SELECT (c.quantity > 0 ? 'In Stock' : 'Out of Stock') AS availability FROM c
```

---

## System Functions

### Aggregate Functions

| Function      | Description       |
| ------------- | ----------------- |
| `AVG(expr)`   | Average of values |
| `COUNT(expr)` | Count of items    |
| `MAX(expr)`   | Maximum value     |
| `MIN(expr)`   | Minimum value     |
| `SUM(expr)`   | Sum of values     |

**Important:** Use `ARRAY_LENGTH()`, NOT `COUNT()`, for array length.

### String Functions

| Function                                  | Description                                  |
| ----------------------------------------- | -------------------------------------------- |
| `CONCAT(str1, str2, ...)`                 | Concatenates strings                         |
| `CONTAINS(str, substr [, ignoreCase])`    | Checks if string contains substring          |
| `STARTSWITH(str, prefix [, ignoreCase])`  | Checks if string starts with prefix          |
| `ENDSWITH(str, suffix [, ignoreCase])`    | Checks if string ends with suffix            |
| `LENGTH(str)`                             | Returns string length                        |
| `LOWER(str)`                              | Converts to lowercase                        |
| `UPPER(str)`                              | Converts to uppercase                        |
| `TRIM(str)`                               | Removes leading/trailing whitespace          |
| `LTRIM(str)`                              | Removes leading whitespace                   |
| `RTRIM(str)`                              | Removes trailing whitespace                  |
| `LEFT(str, n)`                            | Returns left n characters                    |
| `RIGHT(str, n)`                           | Returns right n characters                   |
| `SUBSTRING(str, start, length)`           | Returns substring                            |
| `REPLACE(str, find, replace)`             | Replaces occurrences                         |
| `REVERSE(str)`                            | Reverses string                              |
| `INDEX_OF(str, substr)`                   | Returns index of substring (-1 if not found) |
| `REGEXMATCH(str, pattern)`                | Regular expression match                     |
| `STRINGEQUALS(str1, str2 [, ignoreCase])` | Case-sensitive/insensitive equality          |
| `TOSTRING(expr)`                          | Converts to string                           |

**Case Sensitivity Note:** Do NOT normalize using `LOWER()` within `CONTAINS()`. Instead, set the case sensitivity parameter to `true`:

```sql
SELECT * FROM c WHERE CONTAINS(c.name, 'jacket', true)
```

### Array Functions

| Function                                 | Description                                |
| ---------------------------------------- | ------------------------------------------ |
| `ARRAY_LENGTH(arr)`                      | Returns array length (use this, NOT COUNT) |
| `ARRAY_CONTAINS(arr, value [, partial])` | Checks if array contains value             |
| `ARRAY_CONCAT(arr1, arr2, ...)`          | Concatenates arrays                        |
| `ARRAY_SLICE(arr, start [, length])`     | Returns subset of array                    |
| `ARRAY_CONTAINS_ALL(arr, values)`        | Checks if array contains all values        |
| `ARRAY_CONTAINS_ANY(arr, values)`        | Checks if array contains any values        |
| `SETINTERSECT(arr1, arr2)`               | Returns intersection of arrays             |
| `SETUNION(arr1, arr2)`                   | Returns union of arrays                    |

### Date and Time Functions

**CRITICAL RULES:**

- Use `DateTimeDiff` instead of `DATEDIFF`
- Use `DateTimeAdd` instead of `DATEADD`
- Do NOT use `DateTimeSubtract` - use `DateTimeAdd` with negative value
- Use `GetCurrentDateTime()` for current UTC date/time as ISO 8601 string
- Use `GetCurrentTimestamp()` for milliseconds since Unix epoch
- The `_ts` property represents last updated timestamp in SECONDS
- Convert milliseconds to seconds (divide by 1000) when comparing with `_ts`
- Use `TimestampToDateTime` (NOT `DateTimeFromTimestamp`) to convert timestamps

| Function                               | Description                              |
| -------------------------------------- | ---------------------------------------- |
| `GetCurrentDateTime()`                 | Current UTC date/time as ISO 8601 string |
| `GetCurrentTimestamp()`                | Milliseconds since Unix epoch            |
| `DateTimeAdd(part, amount, datetime)`  | Add time to datetime                     |
| `DateTimeDiff(part, start, end)`       | Difference between datetimes             |
| `DateTimePart(part, datetime)`         | Extract part of datetime                 |
| `DateTimeToTimestamp(datetime)`        | Convert to timestamp (milliseconds)      |
| `TimestampToDateTime(timestamp)`       | Convert timestamp to datetime            |
| `DateTimeBin(part, datetime, binSize)` | Round datetime to bin                    |

**Date Parts:** `year`, `month`, `day`, `hour`, `minute`, `second`, `millisecond`

**Examples:**

```sql
-- Get items from last 7 days
SELECT * FROM c
WHERE c.createdAt > DateTimeAdd('day', -7, GetCurrentDateTime())

-- Get items updated in last hour (using _ts in seconds)
SELECT * FROM c
WHERE c._ts > (GetCurrentTimestamp() / 1000 - 3600)
```

### Mathematical Functions

| Function            | Description               |
| ------------------- | ------------------------- |
| `ABS(n)`            | Absolute value            |
| `CEILING(n)`        | Smallest integer >= n     |
| `FLOOR(n)`          | Largest integer <= n      |
| `ROUND(n)`          | Round to nearest integer  |
| `TRUNC(n)`          | Truncate to integer       |
| `SQRT(n)`           | Square root               |
| `POWER(n, exp)`     | n raised to power         |
| `EXP(n)`            | e raised to power n       |
| `LOG(n)`            | Natural logarithm         |
| `LOG10(n)`          | Base-10 logarithm         |
| `SIN/COS/TAN(n)`    | Trigonometric functions   |
| `ASIN/ACOS/ATAN(n)` | Inverse trig functions    |
| `DEGREES(radians)`  | Convert to degrees        |
| `RADIANS(degrees)`  | Convert to radians        |
| `PI()`              | Pi constant               |
| `RAND()`            | Random number 0-1         |
| `SIGN(n)`           | Sign of number (-1, 0, 1) |

### Type Checking Functions

| Function             | Description                  |
| -------------------- | ---------------------------- |
| `IS_DEFINED(expr)`   | Check if property is defined |
| `IS_NULL(expr)`      | Check if value is null       |
| `IS_ARRAY(expr)`     | Check if value is array      |
| `IS_BOOL(expr)`      | Check if value is boolean    |
| `IS_NUMBER(expr)`    | Check if value is number     |
| `IS_STRING(expr)`    | Check if value is string     |
| `IS_OBJECT(expr)`    | Check if value is object     |
| `IS_PRIMITIVE(expr)` | Check if value is primitive  |

### Type Conversion Functions

| Function               | Description               |
| ---------------------- | ------------------------- |
| `TOSTRING(expr)`       | Convert to string         |
| `STRINGTONUMBER(str)`  | Convert string to number  |
| `STRINGTOBOOLEAN(str)` | Convert string to boolean |
| `STRINGTONULL(str)`    | Convert string to null    |
| `STRINGTOARRAY(str)`   | Convert string to array   |
| `STRINGTOOBJECT(str)`  | Convert string to object  |

### Conditional Functions

| Function                              | Description  |
| ------------------------------------- | ------------ |
| `IIF(condition, true_val, false_val)` | If-then-else |

---

## EXISTS Expression

The EXISTS expression checks if a subquery returns any rows.

```sql
SELECT * FROM products p
WHERE EXISTS (
  SELECT VALUE t
  FROM t IN p.tags
  WHERE t.key = 'featured'
)
```

**Note:** `EXISTS` can be more efficient than `ARRAY_CONTAINS` for complex filtering within arrays.

---

## ARRAY Expression

The ARRAY expression projects subquery results as an array in the SELECT clause.

```sql
SELECT
  p.name,
  ARRAY(SELECT VALUE s.key FROM s IN p.sizes) AS sizeKeys
FROM products p
```

---

## Spatial Functions

For GeoJSON data:
| Function | Description |
|----------|-------------|
| `ST_DISTANCE(point1, point2)` | Distance between two points |
| `ST_WITHIN(point, polygon)` | Check if point is within polygon |
| `ST_INTERSECTS(geo1, geo2)` | Check if geometries intersect |
| `ST_ISVALID(geo)` | Check if GeoJSON is valid |
| `ST_ISVALIDDETAILED(geo)` | Detailed validity check |
| `ST_AREA(polygon)` | Area of polygon |

---

## Vector Search Functions

For vector similarity:
| Function | Description |
|----------|-------------|
| `VectorDistance(vector1, vector2, [similar], [type])` | Calculate similarity score |

---

## Full Text Search Functions

| Function                                 | Description                         |
| ---------------------------------------- | ----------------------------------- |
| `FullTextContains(path, keyword)`        | Check if text contains keyword      |
| `FullTextContainsAll(path, keywords...)` | Check if text contains all keywords |
| `FullTextContainsAny(path, keywords...)` | Check if text contains any keywords |
| `FullTextScore(path, keywords...)`       | BM25 relevance score                |
| `RRF(score1, score2, ...)`               | Reciprocal Rank Fusion              |

---

## Common Query Patterns

### Count with condition

```sql
SELECT VALUE COUNT(1) FROM c WHERE c.status = 'active'
```

### Get first record (schema inspection)

```sql
SELECT TOP 1 * FROM c
```

### Pagination

```sql
SELECT * FROM c
ORDER BY c.createdAt DESC
OFFSET 20 LIMIT 10
```

### Aggregation with grouping

```sql
SELECT
  c.category,
  COUNT(1) AS count,
  AVG(c.price) AS avgPrice
FROM products c
GROUP BY c.category
```

### Filtering arrays with JOIN

```sql
SELECT p.name, t.value
FROM products p
JOIN t IN p.tags
WHERE t.key = 'material' AND t.value = 'leather'
```

### Checking array contents

```sql
SELECT * FROM c
WHERE ARRAY_CONTAINS(c.categories, 'electronics')
```

### Nested property access

```sql
SELECT c.address.city, c.address.country FROM customers c
```

### Accessing array elements by index

```sql
SELECT c.tags[0].value AS firstTag FROM c
```

---

## Query Best Practices Summary

1. **Always use container alias** (e.g., `c.propertyName`)
2. **Use VALUE for single-value results** to get clean output
3. **Use DISTINCT VALUE** (not just DISTINCT) for unique property values
4. **Never use SELECT \* with JOIN** - project specific properties
5. **Use BETWEEN for numeric ranges only** - for strings/dates use `>=` and `<=`
6. **Use != instead of IS NOT**
7. **Use ARRAY_LENGTH for array length**, not COUNT
8. **Use proper date functions**: DateTimeAdd, DateTimeDiff, GetCurrentDateTime
9. **Convert timestamps correctly** when comparing with `_ts` (seconds vs milliseconds)
10. **Use STRINGEQUALS for case-insensitive string equality**
11. **Use EXISTS or JOIN** for filtering on array element properties
12. **Do NOT use HAVING** (not supported)
13. **Do NOT use DISTINCT within COUNT**
14. **Do NOT generate DML statements** (INSERT, UPDATE, DELETE, DROP)
15. **Do NOT use ORDER BY on subquery aliases or computed columns** - ORDER BY requires direct document paths
16. **Prefer single-property ORDER BY** - multi-property ORDER BY or mixed directions (ASC/DESC) require composite indexes which may not exist
