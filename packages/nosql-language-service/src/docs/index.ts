/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ⚠️  AUTO-GENERATED — do not edit manually.
// Re-generate with:  node scripts/generate-docs-index.mjs

/** Hover documentation for built-in functions (key = uppercase function name). */
export const functionDocs = new Map<string, string>([
    ["ABS", `# ABS

**Category:** Math
**Syntax:** \`ABS(number)\`

Returns the absolute (positive) value of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | The numeric expression. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT ABS(-5) -- 5
SELECT ABS(c.balance) FROM c
\`\`\`

---

📖 **Documentation:** [ABS](https://learn.microsoft.com/en-us/cosmos-db/query/abs)`],
    ["ACOS", `# ACOS

**Category:** Math
**Syntax:** \`ACOS(number)\`

Returns the angle, in radians, whose cosine is the specified numeric expression. Also called arccosine.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Value between -1 and 1. |

## Return Value
Returns radians (numeric).

---

📖 **Documentation:** [ACOS](https://learn.microsoft.com/en-us/cosmos-db/query/acos)`],
    ["ARRAY_AVG", `# ARRAY_AVG

**Category:** Array
**Syntax:** \`ARRAY_AVG(array)\`

Returns the average value of all numeric elements in the specified array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | An array of numeric values. |

## Return Value
Returns a numeric value, or \`undefined\` if any element is not numeric.

---

📖 **Documentation:** [ARRAY_AVG](https://learn.microsoft.com/en-us/cosmos-db/query/array-avg)`],
    ["ARRAY_CONCAT", `# ARRAY_CONCAT

**Category:** Array
**Syntax:** \`ARRAY_CONCAT(array1, array2 [, ...])\`

Returns an array that is the result of concatenating two or more array values.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array1\` | array | First array. |
| \`array2\` | array | Second array. |

## Return Value
Returns the concatenated array.

---

📖 **Documentation:** [ARRAY_CONCAT](https://learn.microsoft.com/en-us/cosmos-db/query/array-concat)`],
    ["ARRAY_CONTAINS", `# ARRAY_CONTAINS

**Category:** Array
**Syntax:** \`ARRAY_CONTAINS(array, value [, partial])\`

Returns a Boolean indicating whether the array contains the specified value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | The array to search in. |
| \`value\` | any | The value to search for. |
| \`partial\` | boolean | Optional. \`true\` for partial match on objects. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ARRAY_CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/array-contains)`],
    ["ARRAY_CONTAINS_ALL", `# ARRAY_CONTAINS_ALL

**Category:** Array
**Syntax:** \`ARRAY_CONTAINS_ALL(array, value1, value2, ...)\`

Returns a Boolean indicating whether the array contains all the specified elements.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | The array to search in. |
| \`value1\` | any | First value to look for. |
| \`value2...\` | any | Additional values. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ARRAY_CONTAINS_ALL](https://learn.microsoft.com/en-us/cosmos-db/query/array-contains-all)`],
    ["ARRAY_CONTAINS_ANY", `# ARRAY_CONTAINS_ANY

**Category:** Array
**Syntax:** \`ARRAY_CONTAINS_ANY(array, value1, value2, ...)\`

Returns a Boolean indicating whether the array contains any of the specified elements.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | The array to search in. |
| \`value1\` | any | First value to look for. |
| \`value2...\` | any | Additional values. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ARRAY_CONTAINS_ANY](https://learn.microsoft.com/en-us/cosmos-db/query/array-contains-any)`],
    ["ARRAY_LENGTH", `# ARRAY_LENGTH

**Category:** Array
**Syntax:** \`ARRAY_LENGTH(array)\`

Returns the number of elements in the specified array expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | The array expression. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [ARRAY_LENGTH](https://learn.microsoft.com/en-us/cosmos-db/query/array-length)`],
    ["ARRAY_MAX", `# ARRAY_MAX

**Category:** Array
**Syntax:** \`ARRAY_MAX(array)\`

Returns the maximum value among all elements in the specified array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | An array of primitive values. |

## Return Value
Returns the maximum value.

---

📖 **Documentation:** [ARRAY_MAX](https://learn.microsoft.com/en-us/cosmos-db/query/array-max)`],
    ["ARRAY_MEDIAN", `# ARRAY_MEDIAN

**Category:** Array
**Syntax:** \`ARRAY_MEDIAN(array)\`

Returns the median value among all numeric elements in the specified array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | An array of numeric values. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [ARRAY_MEDIAN](https://learn.microsoft.com/en-us/cosmos-db/query/array-median)`],
    ["ARRAY_MIN", `# ARRAY_MIN

**Category:** Array
**Syntax:** \`ARRAY_MIN(array)\`

Returns the minimum value among all elements in the specified array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | An array of primitive values. |

## Return Value
Returns the minimum value.

---

📖 **Documentation:** [ARRAY_MIN](https://learn.microsoft.com/en-us/cosmos-db/query/array-min)`],
    ["ARRAY_SLICE", `# ARRAY_SLICE

**Category:** Array
**Syntax:** \`ARRAY_SLICE(array, start [, length])\`

Returns part of an array expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | The array to slice. |
| \`start\` | integer | 0-based start index. Negative values count from end. |
| \`length\` | integer | Optional max number of elements. |

## Return Value
Returns an array.

---

📖 **Documentation:** [ARRAY_SLICE](https://learn.microsoft.com/en-us/cosmos-db/query/array-slice)`],
    ["ARRAY_SUM", `# ARRAY_SUM

**Category:** Array
**Syntax:** \`ARRAY_SUM(array)\`

Returns the sum of all numeric elements in the specified array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | An array of numeric values. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [ARRAY_SUM](https://learn.microsoft.com/en-us/cosmos-db/query/array-sum)`],
    ["ASIN", `# ASIN

**Category:** Math
**Syntax:** \`ASIN(number)\`

Returns the angle, in radians, whose sine is the specified numeric expression. Also called arcsine.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Value between -1 and 1. |

## Return Value
Returns radians (numeric).

---

📖 **Documentation:** [ASIN](https://learn.microsoft.com/en-us/cosmos-db/query/asin)`],
    ["ATAN", `# ATAN

**Category:** Math
**Syntax:** \`ATAN(number)\`

Returns the angle, in radians, whose tangent is the specified numeric expression. Also called arctangent.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns radians (numeric).

---

📖 **Documentation:** [ATAN](https://learn.microsoft.com/en-us/cosmos-db/query/atan)`],
    ["ATN2", `# ATN2

**Category:** Math
**Syntax:** \`ATN2(y, x)\`

Returns the angle, in radians, between the positive x-axis and the ray from the origin to the point (y, x).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`y\` | numeric | Y coordinate. |
| \`x\` | numeric | X coordinate. |

## Return Value
Returns radians (numeric).

---

📖 **Documentation:** [ATN2](https://learn.microsoft.com/en-us/cosmos-db/query/atn2)`],
    ["AVG", `# AVG

**Category:** Aggregate
**Syntax:** \`AVG(expression)\`

Returns the average of the values in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | numeric | A numeric expression. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT AVG(c.price) FROM c
SELECT AVG(c.score) FROM c WHERE c.active = true
\`\`\`

## Notes
- Non-numeric values are skipped.
- Returns \`undefined\` if no numeric values are found.

---

📖 **Documentation:** [AVG](https://learn.microsoft.com/en-us/cosmos-db/query/avg)`],
    ["CEILING", `# CEILING

**Category:** Math
**Syntax:** \`CEILING(number)\`

Returns the smallest integer value greater than or equal to the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns an integer numeric value.

## Examples
\`\`\`sql
SELECT CEILING(4.2)  -- 5
SELECT CEILING(-4.8) -- -4
\`\`\`

---

📖 **Documentation:** [CEILING](https://learn.microsoft.com/en-us/cosmos-db/query/ceiling)`],
    ["CHOOSE", `# CHOOSE

**Category:** Math
**Syntax:** \`CHOOSE(index, value1, value2, ...)\`

Returns the item at the specified 1-based index from a list of values. Returns \`undefined\` if index is out of bounds.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`index\` | integer | 1-based index (positive integer). |
| \`value1\` | any | First value in the list. |
| \`value2\` | any | Second value (and more optional). |

## Return Value
Returns the value at the specified index position.

## Examples
\`\`\`sql
SELECT CHOOSE(2, "a", "b", "c") -- "b"
\`\`\`

---

📖 **Documentation:** [CHOOSE](https://learn.microsoft.com/en-us/cosmos-db/query/choose)`],
    ["CONCAT", `# CONCAT

**Category:** String
**Syntax:** \`CONCAT(string1, string2 [, ...])\`

Returns a string that is the result of concatenating two or more string values.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string1\` | string | First string. |
| \`string2\` | string | Second string. |

Additional strings can follow.

## Return Value
Returns the concatenated string.

## Examples
\`\`\`sql
SELECT CONCAT(c.firstName, ' ', c.lastName) FROM c
\`\`\`

---

📖 **Documentation:** [CONCAT](https://learn.microsoft.com/en-us/cosmos-db/query/concat)`],
    ["CONTAINS", `# CONTAINS

**Category:** String
**Syntax:** \`CONTAINS(string, substring [, ignoreCase])\`

Returns a Boolean indicating whether the first string expression contains the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`substring\` | string | The string to search for. |
| \`ignoreCase\` | boolean | Optional. Case-insensitive search when \`true\`. |

## Return Value
Returns \`true\` or \`false\`.

## Examples
\`\`\`sql
SELECT * FROM c WHERE CONTAINS(c.name, 'smith', true)
\`\`\`

---

📖 **Documentation:** [CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/contains)`],
    ["CONTAINS_ALL_CI", `# CONTAINS_ALL_CI

**Category:** String
**Syntax:** \`CONTAINS_ALL_CI(string, value1, value2, ...)\`

Returns a Boolean indicating if the source string contains all values using case-insensitive search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`value1\` | string | First string to look for. |
| \`value2...\` | string | Additional strings. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [CONTAINS_ALL_CI](https://learn.microsoft.com/en-us/cosmos-db/query/contains-all-ci)`],
    ["CONTAINS_ALL_CS", `# CONTAINS_ALL_CS

**Category:** String
**Syntax:** \`CONTAINS_ALL_CS(string, value1, value2, ...)\`

Returns a Boolean indicating if the source string contains all values using case-sensitive search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`value1\` | string | First string to look for. |
| \`value2...\` | string | Additional strings. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [CONTAINS_ALL_CS](https://learn.microsoft.com/en-us/cosmos-db/query/contains-all-cs)`],
    ["CONTAINS_ANY_CI", `# CONTAINS_ANY_CI

**Category:** String
**Syntax:** \`CONTAINS_ANY_CI(string, value1, value2, ...)\`

Returns a Boolean indicating if the source string contains any of the values using case-insensitive search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`value1\` | string | First string to look for. |
| \`value2...\` | string | Additional strings. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [CONTAINS_ANY_CI](https://learn.microsoft.com/en-us/cosmos-db/query/contains-any-ci)`],
    ["CONTAINS_ANY_CS", `# CONTAINS_ANY_CS

**Category:** String
**Syntax:** \`CONTAINS_ANY_CS(string, value1, value2, ...)\`

Returns a Boolean indicating if the source string contains any of the values using case-sensitive search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`value1\` | string | First string to look for. |
| \`value2...\` | string | Additional strings. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [CONTAINS_ANY_CS](https://learn.microsoft.com/en-us/cosmos-db/query/contains-any-cs)`],
    ["COS", `# COS

**Category:** Math
**Syntax:** \`COS(number)\`

Returns the trigonometric cosine of the specified angle in radians.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Angle in radians. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [COS](https://learn.microsoft.com/en-us/cosmos-db/query/cos)`],
    ["COT", `# COT

**Category:** Math
**Syntax:** \`COT(number)\`

Returns the trigonometric cotangent of the specified angle in radians.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Angle in radians. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [COT](https://learn.microsoft.com/en-us/cosmos-db/query/cot)`],
    ["COUNT", `# COUNT

**Category:** Aggregate
**Syntax:** \`COUNT(expression)\`

Returns the count of values in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any scalar expression. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT COUNT(c.id) FROM c
SELECT COUNT(1) FROM c WHERE c.status = "active"
\`\`\`

## Notes
- \`COUNT(1)\` counts all documents including those with
  \`undefined\` values.
- \`COUNT(c.field)\` counts only documents where \`c.field\`
  is defined (not \`undefined\`).

---

📖 **Documentation:** [COUNT](https://learn.microsoft.com/en-us/cosmos-db/query/count)`],
    ["COUNTIF", `# COUNTIF

**Category:** Aggregate
**Syntax:** \`COUNTIF(condition)\`

Returns the count of items that satisfy the Boolean condition.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`condition\` | boolean | A Boolean expression to evaluate. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT COUNTIF(c.status = "active") FROM c
\`\`\`

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["DATETIMEADD", `# DATETIMEADD

**Category:** Date/Time
**Syntax:** \`DATETIMEADD(part, number, datetime)\`

Adds a specified number value to a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`part\` | string | \`'year'\`, \`'month'\`, \`'day'\`, \`'hour'\`, \`'minute'\`, \`'second'\`, \`'millisecond'\`. |
| \`number\` | integer | The amount to add. |
| \`datetime\` | string | UTC date/time ISO 8601 string. |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [DATETIMEADD](https://learn.microsoft.com/en-us/cosmos-db/query/datetimeadd)`],
    ["DATETIMEBIN", `# DATETIMEBIN

**Category:** Date/Time
**Syntax:** \`DATETIMEBIN(datetime, part [, binSize [, origin]])\`

Rounds (bins) a datetime value to a multiple of the specified date/time part.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | The datetime string. |
| \`part\` | string | The datetime part to bin by. |
| \`binSize\` | integer | Optional bin size (default: 1). |
| \`origin\` | string | Optional origin datetime (default: \`'1970-01-01T00:00:00.000000Z'\`). |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [DATETIMEBIN](https://learn.microsoft.com/en-us/cosmos-db/query/datetimebin)`],
    ["DATETIMEDIFF", `# DATETIMEDIFF

**Category:** Date/Time
**Syntax:** \`DATETIMEDIFF(part, startDate, endDate)\`

Returns the difference, as a signed integer, of the specified date/time part between two date/time values.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`part\` | string | The datetime part (\`'year'\`, \`'month'\`, etc.). |
| \`startDate\` | string | Start datetime string. |
| \`endDate\` | string | End datetime string. |

## Return Value
Returns an integer.

---

📖 **Documentation:** [DATETIMEDIFF](https://learn.microsoft.com/en-us/cosmos-db/query/datetimediff)`],
    ["DATETIMEFORMAT", `# DATETIMEFORMAT

**Category:** Date/Time
**Syntax:** \`DATETIMEFORMAT(datetime, format)\`

Formats a datetime string according to the specified format string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | The datetime string. |
| \`format\` | string | The format specifier string. |

## Return Value
Returns a formatted string.

---

📖 **Documentation:** [DATETIMEFORMAT](https://learn.microsoft.com/en-us/cosmos-db/query/datetimeformat)`],
    ["DATETIMEFROMPARTS", `# DATETIMEFROMPARTS

**Category:** Date/Time
**Syntax:** \`DATETIMEFROMPARTS(year, month, day [, hour [, minute [, second [, ms]]]])\`

Constructs a datetime string from individual numeric parts.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`year\` | integer | Year value. |
| \`month\` | integer | Month value. |
| \`day\` | integer | Day value. |
| \`hour\` | integer | Optional hour (default: 0). |
| \`minute\` | integer | Optional minute (default: 0). |
| \`second\` | integer | Optional second (default: 0). |
| \`ms\` | integer | Optional fractional second (default: 0). |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [DATETIMEFROMPARTS](https://learn.microsoft.com/en-us/cosmos-db/query/datetimefromparts)`],
    ["DATETIMEPART", `# DATETIMEPART

**Category:** Date/Time
**Syntax:** \`DATETIMEPART(part, datetime)\`

Returns the value of the specified date/time part for the provided datetime.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`part\` | string | A datetime part (\`'year'\`, \`'month'\`, \`'day'\`, etc.). |
| \`datetime\` | string | A datetime string. |

## Return Value
Returns an integer.

---

📖 **Documentation:** [DATETIMEPART](https://learn.microsoft.com/en-us/cosmos-db/query/datetimepart)`],
    ["DATETIMETOTICKS", `# DATETIMETOTICKS

**Category:** Date/Time
**Syntax:** \`DATETIMETOTICKS(datetime)\`

Converts the specified datetime string to ticks (100-nanosecond intervals since Unix epoch).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | A datetime string. |

## Return Value
Returns a numeric value (ticks).

---

📖 **Documentation:** [DATETIMETOTICKS](https://learn.microsoft.com/en-us/cosmos-db/query/datetimetoticks)`],
    ["DATETIMETOTIMESTAMP", `# DATETIMETOTIMESTAMP

**Category:** Date/Time
**Syntax:** \`DATETIMETOTIMESTAMP(datetime)\`

Converts the specified datetime string to a Unix timestamp (milliseconds since epoch).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | A datetime string. |

## Return Value
Returns a numeric value (milliseconds).

---

📖 **Documentation:** [DATETIMETOTIMESTAMP](https://learn.microsoft.com/en-us/cosmos-db/query/datetimetotimestamp)`],
    ["DAY", `# DAY

**Category:** Date/Time
**Syntax:** \`DAY(datetime)\`

Returns the day component (1-31) of a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | A datetime string. |

## Return Value
Returns an integer.

---

📖 **Documentation:** [DAY](https://learn.microsoft.com/en-us/cosmos-db/query/day)`],
    ["DEGREES", `# DEGREES

**Category:** Math
**Syntax:** \`DEGREES(radians)\`

Returns the corresponding angle in degrees for an angle specified in radians.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`radians\` | numeric | Angle in radians. |

## Return Value
Returns degrees (numeric).

---

📖 **Documentation:** [DEGREES](https://learn.microsoft.com/en-us/cosmos-db/query/degrees)`],
    ["DOCUMENTID", `# DOCUMENTID

**Category:** Other
**Syntax:** \`DOCUMENTID(document)\`

Returns the internal document ID of the specified document.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`document\` | identifier | The document alias (e.g. \`c\`). |

## Return Value
Returns a string.

---

📖 **Documentation:** [DOCUMENTID](https://learn.microsoft.com/en-us/cosmos-db/query/documentid)`],
    ["ENDSWITH", `# ENDSWITH

**Category:** String
**Syntax:** \`ENDSWITH(string, suffix [, ignoreCase])\`

Returns a Boolean indicating whether the first string expression ends with the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to check. |
| \`suffix\` | string | The suffix to look for. |
| \`ignoreCase\` | boolean | Optional case-insensitive flag. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ENDSWITH](https://learn.microsoft.com/en-us/cosmos-db/query/endswith)`],
    ["EXP", `# EXP

**Category:** Math
**Syntax:** \`EXP(number)\`

Returns the exponent (e^number) of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [EXP](https://learn.microsoft.com/en-us/cosmos-db/query/exp)`],
    ["FLOOR", `# FLOOR

**Category:** Math
**Syntax:** \`FLOOR(number)\`

Returns the largest integer less than or equal to the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns an integer numeric value.

## Examples
\`\`\`sql
SELECT FLOOR(4.8)  -- 4
SELECT FLOOR(-4.2) -- -5
\`\`\`

---

📖 **Documentation:** [FLOOR](https://learn.microsoft.com/en-us/cosmos-db/query/floor)`],
    ["FULLTEXT_CONTAINS", `# FULLTEXT_CONTAINS

**Category:** Full-text search
**Syntax:** \`FULLTEXT_CONTAINS(field, term)\`

Returns a Boolean indicating whether the field contains the specified term using full-text search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`field\` | expression | The field to search. |
| \`term\` | string | The term to search for. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`FULLTEXTCONTAINS\`.
- Requires a full-text index on the field.

---

📖 **Documentation:** [FULLTEXT_CONTAINS](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontains)`],
    ["FULLTEXT_CONTAINS_ALL", `# FULLTEXT_CONTAINS_ALL

**Category:** Full-text search
**Syntax:** \`FULLTEXT_CONTAINS_ALL(field, term1, term2, ...)\`

Returns a Boolean indicating whether the field contains all the specified terms.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`field\` | expression | The field to search. |
| \`term1\` | string | First term. |
| \`term2...\` | string | Additional terms. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`FULLTEXTCONTAINSALL\`.

---

📖 **Documentation:** [FULLTEXT_CONTAINS_ALL](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontainsall)`],
    ["FULLTEXT_CONTAINS_ANY", `# FULLTEXT_CONTAINS_ANY

**Category:** Full-text search
**Syntax:** \`FULLTEXT_CONTAINS_ANY(field, term1, term2, ...)\`

Returns a Boolean indicating whether the field contains any of the specified terms.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`field\` | expression | The field to search. |
| \`term1\` | string | First term. |
| \`term2...\` | string | Additional terms. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`FULLTEXTCONTAINSANY\`.

---

📖 **Documentation:** [FULLTEXT_CONTAINS_ANY](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextcontainsany)`],
    ["FULLTEXTSCORE", `# FULLTEXTSCORE

**Category:** Full-text search
**Syntax:** \`FULLTEXTSCORE(field, term)\`

Returns the BM25 relevance score for the specified full-text search.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`field\` | expression | The field to score. |
| \`term\` | string | The search term. |

## Return Value
Returns a numeric relevance score.

## Notes
- Used with \`ORDER BY RANK\` for relevance ranking.

---

📖 **Documentation:** [FULLTEXTSCORE](https://learn.microsoft.com/en-us/cosmos-db/query/fulltextscore)`],
    ["GETCURRENTDATETIME", `# GETCURRENTDATETIME

**Category:** Date/Time
**Syntax:** \`GETCURRENTDATETIME()\`

Returns the current UTC date and time as an ISO 8601 string.

## Parameters
None.

## Return Value
Returns a datetime string (e.g. \`'2024-01-15T12:30:00.0000000Z'\`).

## Notes
- Non-deterministic. Use \`GETCURRENTDATETIMESTATIC\` for a value that stays constant within a query.

---

📖 **Documentation:** [GETCURRENTDATETIME](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentdatetime)`],
    ["GETCURRENTDATETIMESTATIC", `# GETCURRENTDATETIMESTATIC

**Category:** Date/Time
**Syntax:** \`GETCURRENTDATETIMESTATIC()\`

Returns the current UTC date and time as an ISO 8601 string, constant for the duration of the query.

## Parameters
None.

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [GETCURRENTDATETIMESTATIC](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentdatetimestatic)`],
    ["GETCURRENTTICKS", `# GETCURRENTTICKS

**Category:** Date/Time
**Syntax:** \`GETCURRENTTICKS()\`

Returns the current UTC date/time in ticks.

## Parameters
None.

## Return Value
Returns a numeric value (ticks).

---

📖 **Documentation:** [GETCURRENTTICKS](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentticks)`],
    ["GETCURRENTTICKSSTATIC", `# GETCURRENTTICKSSTATIC

**Category:** Date/Time
**Syntax:** \`GETCURRENTTICKSSTATIC()\`

Returns the current UTC date/time in ticks, constant for the duration of the query.

## Parameters
None.

## Return Value
Returns a numeric value (ticks).

---

📖 **Documentation:** [GETCURRENTTICKSSTATIC](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrentticksstatic)`],
    ["GETCURRENTTIMESTAMP", `# GETCURRENTTIMESTAMP

**Category:** Date/Time
**Syntax:** \`GETCURRENTTIMESTAMP()\`

Returns the current UTC date/time as a Unix timestamp (milliseconds since epoch).

## Parameters
None.

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [GETCURRENTTIMESTAMP](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrenttimestamp)`],
    ["GETCURRENTTIMESTAMPSTATIC", `# GETCURRENTTIMESTAMPSTATIC

**Category:** Date/Time
**Syntax:** \`GETCURRENTTIMESTAMPSTATIC()\`

Returns the current UTC date/time as a Unix timestamp, constant for the duration of the query.

## Parameters
None.

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [GETCURRENTTIMESTAMPSTATIC](https://learn.microsoft.com/en-us/cosmos-db/query/getcurrenttimestampstatic)`],
    ["HASH", `# HASH

**Category:** Other
**Syntax:** \`HASH(expression [, modulo])\`

Returns a hash value of the specified expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | The value to hash. |
| \`modulo\` | integer | Optional modulo (result will be in 0..modulo-1). |

## Return Value
Returns a numeric hash value.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["IIF", `# IIF

**Category:** Other
**Syntax:** \`IIF(condition, trueValue, falseValue)\`

Returns one of two values depending on a Boolean condition.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`condition\` | boolean | The condition to evaluate. |
| \`trueValue\` | any | Returned if condition is \`true\`. |
| \`falseValue\` | any | Returned if condition is not \`true\`. |

## Return Value
Returns \`trueValue\` or \`falseValue\`.

## Notes
- If \`condition\` is not a Boolean, returns \`falseValue\`.

---

📖 **Documentation:** [IIF](https://learn.microsoft.com/en-us/cosmos-db/query/iif)`],
    ["INDEX_OF", `# INDEX_OF

**Category:** String
**Syntax:** \`INDEX_OF(string, substring [, start])\`

Returns the starting position of the first occurrence of the second string expression within the first, or -1 if not found.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`substring\` | string | The string to search for. |
| \`start\` | integer | Optional 0-based start position. |

## Return Value
Returns a numeric value (0-based index, or -1).

---

📖 **Documentation:** [INDEX_OF](https://learn.microsoft.com/en-us/cosmos-db/query/index-of)`],
    ["INTADD", `# INTADD

**Category:** Integer math
**Syntax:** \`INTADD(left, right)\`

Returns the result of integer addition (left + right) as a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTADD](https://learn.microsoft.com/en-us/cosmos-db/query/intadd)`],
    ["INTBITAND", `# INTBITAND

**Category:** Integer math
**Syntax:** \`INTBITAND(left, right)\`

Returns the result of bitwise AND on two 64-bit integers.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITAND](https://learn.microsoft.com/en-us/cosmos-db/query/intbitand)`],
    ["INTBITLEFTSHIFT", `# INTBITLEFTSHIFT

**Category:** Integer math
**Syntax:** \`INTBITLEFTSHIFT(left, right)\`

Returns the result of left bit-shift (left << right) on two 64-bit integers.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | The value to shift. |
| \`right\` | integer | Number of bits to shift. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITLEFTSHIFT](https://learn.microsoft.com/en-us/cosmos-db/query/intbitleftshift)`],
    ["INTBITNOT", `# INTBITNOT

**Category:** Integer math
**Syntax:** \`INTBITNOT(value)\`

Returns the result of bitwise NOT (~value) on a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`value\` | integer | The value to negate. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITNOT](https://learn.microsoft.com/en-us/cosmos-db/query/intbitnot)`],
    ["INTBITOR", `# INTBITOR

**Category:** Integer math
**Syntax:** \`INTBITOR(left, right)\`

Returns the result of bitwise OR on two 64-bit integers.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITOR](https://learn.microsoft.com/en-us/cosmos-db/query/intbitor)`],
    ["INTBITRIGHTSHIFT", `# INTBITRIGHTSHIFT

**Category:** Integer math
**Syntax:** \`INTBITRIGHTSHIFT(left, right)\`

Returns the result of right bit-shift (left >> right) on two 64-bit integers.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | The value to shift. |
| \`right\` | integer | Number of bits to shift. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITRIGHTSHIFT](https://learn.microsoft.com/en-us/cosmos-db/query/intbitrightshift)`],
    ["INTBITXOR", `# INTBITXOR

**Category:** Integer math
**Syntax:** \`INTBITXOR(left, right)\`

Returns the result of bitwise XOR on two 64-bit integers.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTBITXOR](https://learn.microsoft.com/en-us/cosmos-db/query/intbitxor)`],
    ["INTDIV", `# INTDIV

**Category:** Integer math
**Syntax:** \`INTDIV(left, right)\`

Returns the result of integer division (left / right) as a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Dividend. |
| \`right\` | integer | Divisor. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTDIV](https://learn.microsoft.com/en-us/cosmos-db/query/intdiv)`],
    ["INTMOD", `# INTMOD

**Category:** Integer math
**Syntax:** \`INTMOD(left, right)\`

Returns the result of integer modulo (left %% right) as a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Dividend. |
| \`right\` | integer | Divisor. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTMOD](https://learn.microsoft.com/en-us/cosmos-db/query/intmod)`],
    ["INTMUL", `# INTMUL

**Category:** Integer math
**Syntax:** \`INTMUL(left, right)\`

Returns the result of integer multiplication (left * right) as a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTMUL](https://learn.microsoft.com/en-us/cosmos-db/query/intmul)`],
    ["INTSUB", `# INTSUB

**Category:** Integer math
**Syntax:** \`INTSUB(left, right)\`

Returns the result of integer subtraction (left - right) as a 64-bit integer.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`left\` | integer | Left operand. |
| \`right\` | integer | Right operand. |

## Return Value
Returns a 64-bit integer.

---

📖 **Documentation:** [INTSUB](https://learn.microsoft.com/en-us/cosmos-db/query/intsub)`],
    ["IS_ARRAY", `# IS_ARRAY

**Category:** Type check
**Syntax:** \`IS_ARRAY(expression)\`

Returns a Boolean indicating if the type of the value is an array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_ARRAY](https://learn.microsoft.com/en-us/cosmos-db/query/is-array)`],
    ["IS_BOOL", `# IS_BOOL

**Category:** Type check
**Syntax:** \`IS_BOOL(expression)\`

Returns a Boolean indicating if the type of the value is a Boolean.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`IS_BOOLEAN\`.

---

📖 **Documentation:** [IS_BOOL](https://learn.microsoft.com/en-us/cosmos-db/query/is-bool)`],
    ["IS_DATETIME", `# IS_DATETIME

**Category:** Type check
**Syntax:** \`IS_DATETIME(expression)\`

Returns a Boolean indicating if the type of the value is a datetime string (ISO 8601 format).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_DATETIME](https://learn.microsoft.com/en-us/cosmos-db/query/is-datetime)`],
    ["IS_DEFINED", `# IS_DEFINED

**Category:** Type check
**Syntax:** \`IS_DEFINED(expression)\`

Returns a Boolean indicating if the property has been assigned a value (i.e., is not \`undefined\`).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_DEFINED](https://learn.microsoft.com/en-us/cosmos-db/query/is-defined)`],
    ["IS_FINITE_NUMBER", `# IS_FINITE_NUMBER

**Category:** Type check
**Syntax:** \`IS_FINITE_NUMBER(expression)\`

Returns a Boolean indicating if the type of the value is a finite number (not NaN or Infinity).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_FINITE_NUMBER](https://learn.microsoft.com/en-us/cosmos-db/query/is-finite-number)`],
    ["IS_INTEGER", `# IS_INTEGER

**Category:** Type check
**Syntax:** \`IS_INTEGER(expression)\`

Returns a Boolean indicating if the type of the value is an integer (INT64).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_INTEGER](https://learn.microsoft.com/en-us/cosmos-db/query/is-integer)`],
    ["IS_NULL", `# IS_NULL

**Category:** Type check
**Syntax:** \`IS_NULL(expression)\`

Returns a Boolean indicating if the type of the value is \`null\`.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_NULL](https://learn.microsoft.com/en-us/cosmos-db/query/is-null)`],
    ["IS_NUMBER", `# IS_NUMBER

**Category:** Type check
**Syntax:** \`IS_NUMBER(expression)\`

Returns a Boolean indicating if the type of the value is a number.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_NUMBER](https://learn.microsoft.com/en-us/cosmos-db/query/is-number)`],
    ["IS_OBJECT", `# IS_OBJECT

**Category:** Type check
**Syntax:** \`IS_OBJECT(expression)\`

Returns a Boolean indicating if the type of the value is a JSON object.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_OBJECT](https://learn.microsoft.com/en-us/cosmos-db/query/is-object)`],
    ["IS_PRIMITIVE", `# IS_PRIMITIVE

**Category:** Type check
**Syntax:** \`IS_PRIMITIVE(expression)\`

Returns a Boolean indicating if the type of the value is a primitive (string, number, Boolean, or null).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_PRIMITIVE](https://learn.microsoft.com/en-us/cosmos-db/query/is-primitive)`],
    ["IS_STRING", `# IS_STRING

**Category:** Type check
**Syntax:** \`IS_STRING(expression)\`

Returns a Boolean indicating if the type of the value is a string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [IS_STRING](https://learn.microsoft.com/en-us/cosmos-db/query/is-string)`],
    ["LASTINDEXOF", `# LASTINDEXOF

**Category:** String
**Syntax:** \`LASTINDEXOF(string, substring [, start])\`

Returns the starting position of the last occurrence of the second string, or -1 if not found.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search in. |
| \`substring\` | string | The string to search for. |
| \`start\` | integer | Optional position to start searching backward from. |

## Return Value
Returns a numeric value (0-based index, or -1).

---

📖 **Documentation:** [LASTINDEXOF](https://learn.microsoft.com/en-us/cosmos-db/query/lastindexof)`],
    ["LASTSUBSTRINGAFTER", `# LASTSUBSTRINGAFTER

**Category:** String
**Syntax:** \`LASTSUBSTRINGAFTER(string, substring)\`

Returns the part of a string after the last occurrence of another string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`substring\` | string | The substring to search for. |

## Return Value
Returns a string.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["LASTSUBSTRINGBEFORE", `# LASTSUBSTRINGBEFORE

**Category:** String
**Syntax:** \`LASTSUBSTRINGBEFORE(string, substring)\`

Returns the part of a string before the last occurrence of another string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`substring\` | string | The substring to search for. |

## Return Value
Returns a string.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["LEFT", `# LEFT

**Category:** String
**Syntax:** \`LEFT(string, length)\`

Returns the left part of a string with the specified number of characters.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`length\` | integer | Number of characters to take. |

## Return Value
Returns a string.

---

📖 **Documentation:** [LEFT](https://learn.microsoft.com/en-us/cosmos-db/query/left)`],
    ["LENGTH", `# LENGTH

**Category:** String
**Syntax:** \`LENGTH(string)\`

Returns the number of characters of the specified string expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string expression. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [LENGTH](https://learn.microsoft.com/en-us/cosmos-db/query/length)`],
    ["LOG", `# LOG

**Category:** Math
**Syntax:** \`LOG(number [, base])\`

Returns the natural logarithm of the specified numeric expression, or the logarithm using the specified base.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A positive numeric expression. |
| \`base\` | numeric | Optional logarithm base (default: e). |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [LOG](https://learn.microsoft.com/en-us/cosmos-db/query/log)`],
    ["LOG10", `# LOG10

**Category:** Math
**Syntax:** \`LOG10(number)\`

Returns the base-10 logarithm of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A positive numeric expression. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [LOG10](https://learn.microsoft.com/en-us/cosmos-db/query/log10)`],
    ["LOWER", `# LOWER

**Category:** String
**Syntax:** \`LOWER(string)\`

Returns a string expression after converting uppercase characters to lowercase.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string expression. |

## Return Value
Returns the lowercase string.

---

📖 **Documentation:** [LOWER](https://learn.microsoft.com/en-us/cosmos-db/query/lower)`],
    ["LTRIM", `# LTRIM

**Category:** String
**Syntax:** \`LTRIM(string [, chars])\`

Returns a string after removing leading whitespace or specified characters.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to trim. |
| \`chars\` | string | Optional characters to trim from the left. |

## Return Value
Returns the trimmed string.

---

📖 **Documentation:** [LTRIM](https://learn.microsoft.com/en-us/cosmos-db/query/ltrim)`],
    ["MAKELIST", `# MAKELIST

**Category:** Aggregate
**Syntax:** \`MAKELIST(expression)\`

Aggregates values into an array. Used within GROUP BY queries.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any scalar expression. |

## Return Value
Returns an array of all values within the group.

## Examples
\`\`\`sql
SELECT c.category, MAKELIST(c.name)
FROM c
GROUP BY c.category
\`\`\`

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["MAKESET", `# MAKESET

**Category:** Aggregate
**Syntax:** \`MAKESET(expression)\`

Aggregates distinct values into an array. Used within GROUP BY queries.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any scalar expression. |

## Return Value
Returns an array of distinct values within the group.

## Examples
\`\`\`sql
SELECT c.category, MAKESET(c.tag)
FROM c
GROUP BY c.category
\`\`\`

## Notes
- Unlike MAKELIST, MAKESET removes duplicate values.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["MAX", `# MAX

**Category:** Aggregate
**Syntax:** \`MAX(expression)\`

Returns the maximum value in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any scalar expression. |

## Return Value
Returns the maximum value, respecting CosmosDB type ordering.

## Examples
\`\`\`sql
SELECT MAX(c.price) FROM c
\`\`\`

---

📖 **Documentation:** [MAX](https://learn.microsoft.com/en-us/cosmos-db/query/max)`],
    ["MIN", `# MIN

**Category:** Aggregate
**Syntax:** \`MIN(expression)\`

Returns the minimum value in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | Any scalar expression. |

## Return Value
Returns the minimum value, respecting CosmosDB type ordering.

## Examples
\`\`\`sql
SELECT MIN(c.price) FROM c
\`\`\`

---

📖 **Documentation:** [MIN](https://learn.microsoft.com/en-us/cosmos-db/query/min)`],
    ["MONTH", `# MONTH

**Category:** Date/Time
**Syntax:** \`MONTH(datetime)\`

Returns the month component (1-12) of a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | A datetime string. |

## Return Value
Returns an integer.

---

📖 **Documentation:** [MONTH](https://learn.microsoft.com/en-us/cosmos-db/query/month)`],
    ["NUMBERBIN", `# NUMBERBIN

**Category:** Math
**Syntax:** \`NUMBERBIN(number, binSize)\`

Rounds a numeric value down to a multiple of the specified bin size.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | The numeric value to bin. |
| \`binSize\` | numeric | The bin size. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT NUMBERBIN(13.5, 5) -- 10
\`\`\`

---

📖 **Documentation:** [NUMBERBIN](https://learn.microsoft.com/en-us/cosmos-db/query/numberbin)`],
    ["OBJECTTOARRAY", `# OBJECTTOARRAY

**Category:** Conversion
**Syntax:** \`OBJECTTOARRAY(object)\`

Converts a JSON object to an array of {k, v} pairs.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`object\` | object | A JSON object. |

## Return Value
Returns an array of \`{k: key, v: value}\` objects.

## Notes
- Also available as \`OBJECT_TO_ARRAY\`.

---

📖 **Documentation:** [OBJECTTOARRAY](https://learn.microsoft.com/en-us/cosmos-db/query/objecttoarray)`],
    ["PI", `# PI

**Category:** Math
**Syntax:** \`PI()\`

Returns the constant value of PI (3.14159265358979...).

## Parameters
None.

## Return Value
Returns the numeric constant PI.

## Examples
\`\`\`sql
SELECT PI() -- 3.14159265358979
\`\`\`

---

📖 **Documentation:** [PI](https://learn.microsoft.com/en-us/cosmos-db/query/pi)`],
    ["POWER", `# POWER

**Category:** Math
**Syntax:** \`POWER(base, exponent)\`

Returns the value of the specified expression raised to the given power.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`base\` | numeric | The base number. |
| \`exponent\` | numeric | The exponent value. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT POWER(2, 10) -- 1024
\`\`\`

---

📖 **Documentation:** [POWER](https://learn.microsoft.com/en-us/cosmos-db/query/power)`],
    ["RADIANS", `# RADIANS

**Category:** Math
**Syntax:** \`RADIANS(degrees)\`

Returns radians when a numeric expression in degrees is entered.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`degrees\` | numeric | Angle in degrees. |

## Return Value
Returns radians (numeric).

---

📖 **Documentation:** [RADIANS](https://learn.microsoft.com/en-us/cosmos-db/query/radians)`],
    ["RAND", `# RAND

**Category:** Math
**Syntax:** \`RAND()\`

Returns a randomly generated numeric value between 0 and 1.

## Parameters
None.

## Return Value
Returns a numeric value in [0, 1).

## Notes
- RAND is a non-deterministic function. Repeated calls
  may return different results.

---

📖 **Documentation:** [RAND](https://learn.microsoft.com/en-us/cosmos-db/query/rand)`],
    ["REGEXEXTRACT", `# REGEXEXTRACT

**Category:** String
**Syntax:** \`REGEXEXTRACT(string, pattern [, modifiers [, groupId]])\`

Returns the first match for a regular expression from a source string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search. |
| \`pattern\` | string | The regex pattern. |
| \`modifiers\` | string | Optional regex modifiers (\`'i'\`, \`'m'\`, \`'s'\`, \`'x'\`). |
| \`groupId\` | integer | Optional capture group ID (default: 0). |

## Return Value
Returns the matched string, or \`undefined\`.

---

📖 **Documentation:** [REGEXEXTRACT](https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch)`],
    ["REGEXEXTRACTALL", `# REGEXEXTRACTALL

**Category:** String
**Syntax:** \`REGEXEXTRACTALL(string, pattern [, modifiers [, groups]])\`

Returns all matches for a regular expression from a source string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to search. |
| \`pattern\` | string | The regex pattern. |
| \`modifiers\` | string | Optional regex modifiers. |
| \`groups\` | array | Optional array of capture group IDs. |

## Return Value
Returns an array of match arrays, or \`undefined\`.

---

📖 **Documentation:** [REGEXEXTRACTALL](https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch)`],
    ["REGEXMATCH", `# REGEXMATCH

**Category:** String
**Syntax:** \`REGEXMATCH(string, pattern [, modifiers])\`

Returns a Boolean indicating whether a string matches a regular expression pattern.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to test. |
| \`pattern\` | string | The regex pattern. |
| \`modifiers\` | string | Optional: \`'i'\` (ignore case), \`'m'\` (multiline), \`'s'\` (single-line), \`'x'\` (ignore whitespace). |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [REGEXMATCH](https://learn.microsoft.com/en-us/cosmos-db/query/regexmatch)`],
    ["REPLACE", `# REPLACE

**Category:** String
**Syntax:** \`REPLACE(string, find, replacement)\`

Replaces all occurrences of a specified string value with another string value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`find\` | string | The substring to find. |
| \`replacement\` | string | The replacement string. |

## Return Value
Returns the modified string.

---

📖 **Documentation:** [REPLACE](https://learn.microsoft.com/en-us/cosmos-db/query/replace)`],
    ["REPLICATE", `# REPLICATE

**Category:** String
**Syntax:** \`REPLICATE(string, count)\`

Repeats a string value a specified number of times.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to replicate. |
| \`count\` | integer | Number of repetitions. |

## Return Value
Returns the repeated string.

## Notes
- Maximum result length is 10,000 characters.

---

📖 **Documentation:** [REPLICATE](https://learn.microsoft.com/en-us/cosmos-db/query/replicate)`],
    ["REVERSE", `# REVERSE

**Category:** String
**Syntax:** \`REVERSE(string)\`

Returns the reverse order of a string value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to reverse. |

## Return Value
Returns the reversed string.

---

📖 **Documentation:** [REVERSE](https://learn.microsoft.com/en-us/cosmos-db/query/reverse)`],
    ["RIGHT", `# RIGHT

**Category:** String
**Syntax:** \`RIGHT(string, length)\`

Returns the right part of a string with the specified number of characters.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`length\` | integer | Number of characters to take. |

## Return Value
Returns a string.

---

📖 **Documentation:** [RIGHT](https://learn.microsoft.com/en-us/cosmos-db/query/right)`],
    ["ROUND", `# ROUND

**Category:** Math
**Syntax:** \`ROUND(number [, length])\`

Returns a numeric value, rounded to the specified length or precision.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | The value to round. |
| \`length\` | integer | Optional decimal places (default: 0). |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT ROUND(3.14159, 2) -- 3.14
\`\`\`

---

📖 **Documentation:** [ROUND](https://learn.microsoft.com/en-us/cosmos-db/query/round)`],
    ["RRF", `# RRF

**Category:** Vector/AI
**Syntax:** \`RRF(score1, score2, ...)\`

Reciprocal Rank Fusion — combines multiple ranking scores into a single score.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`score1\` | numeric | First score expression. |
| \`score2\` | numeric | Second score expression. |

Additional scores may follow.

## Return Value
Returns a numeric combined score.

## Notes
- Used with \`ORDER BY RANK\` for hybrid search queries.

---

📖 **Documentation:** [RRF](https://learn.microsoft.com/en-us/cosmos-db/query/rrf)`],
    ["RTRIM", `# RTRIM

**Category:** String
**Syntax:** \`RTRIM(string [, chars])\`

Returns a string after removing trailing whitespace or specified characters.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to trim. |
| \`chars\` | string | Optional characters to trim from the right. |

## Return Value
Returns the trimmed string.

---

📖 **Documentation:** [RTRIM](https://learn.microsoft.com/en-us/cosmos-db/query/rtrim)`],
    ["SETDIFFERENCE", `# SETDIFFERENCE

**Category:** Set
**Syntax:** \`SETDIFFERENCE(set1, set2)\`

Returns a set containing elements from the first set that are not in the second set, with no duplicates.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`set1\` | array | The first set. |
| \`set2\` | array | The second set. |

## Return Value
Returns an array.

## Notes
- Also available as \`SET_DIFFERENCE\`.

---

📖 **Documentation:** [SETDIFFERENCE](https://learn.microsoft.com/en-us/cosmos-db/query/setdifference)`],
    ["SETEQUAL", `# SETEQUAL

**Category:** Set
**Syntax:** \`SETEQUAL(set1, set2)\`

Returns a Boolean indicating whether the two sets are equal after removing duplicates.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`set1\` | array | The first set. |
| \`set2\` | array | The second set. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`SET_EQUAL\`.

---

📖 **Documentation:** [SETEQUAL](https://learn.microsoft.com/en-us/cosmos-db/query/setequal)`],
    ["SETINTERSECT", `# SETINTERSECT

**Category:** Set
**Syntax:** \`SETINTERSECT(set1, set2)\`

Returns an array of elements in the intersection of both sets, with no duplicates.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`set1\` | array | The first set. |
| \`set2\` | array | The second set. |

## Return Value
Returns an array.

## Notes
- Also available as \`SET_INTERSECT\`.

---

📖 **Documentation:** [SETINTERSECT](https://learn.microsoft.com/en-us/cosmos-db/query/setintersect)`],
    ["SETUNION", `# SETUNION

**Category:** Set
**Syntax:** \`SETUNION(set1, set2)\`

Returns an array of elements in the union of both sets, with no duplicates.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`set1\` | array | The first set. |
| \`set2\` | array | The second set. |

## Return Value
Returns an array.

## Notes
- Also available as \`SET_UNION\`.

---

📖 **Documentation:** [SETUNION](https://learn.microsoft.com/en-us/cosmos-db/query/setunion)`],
    ["SIGN", `# SIGN

**Category:** Math
**Syntax:** \`SIGN(number)\`

Returns the sign value (-1, 0, 1) of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns -1 (negative), 0 (zero), or 1 (positive).

---

📖 **Documentation:** [SIGN](https://learn.microsoft.com/en-us/cosmos-db/query/sign)`],
    ["SIN", `# SIN

**Category:** Math
**Syntax:** \`SIN(number)\`

Returns the trigonometric sine of the specified angle in radians.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Angle in radians. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [SIN](https://learn.microsoft.com/en-us/cosmos-db/query/sin)`],
    ["SQRT", `# SQRT

**Category:** Math
**Syntax:** \`SQRT(number)\`

Returns the square root of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A non-negative numeric expression. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [SQRT](https://learn.microsoft.com/en-us/cosmos-db/query/sqrt)`],
    ["SQUARE", `# SQUARE

**Category:** Math
**Syntax:** \`SQUARE(number)\`

Returns the square of the specified numeric expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns a numeric value (number * number).

---

📖 **Documentation:** [SQUARE](https://learn.microsoft.com/en-us/cosmos-db/query/square)`],
    ["ST_AREA", `# ST_AREA

**Category:** Spatial
**Syntax:** \`ST_AREA(polygon)\`

Returns the area of a GeoJSON Polygon expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`polygon\` | GeoJSON | A GeoJSON Polygon. |

## Return Value
Returns a numeric value (square meters).

---

📖 **Documentation:** [ST_AREA](https://learn.microsoft.com/en-us/cosmos-db/query/st-area)`],
    ["ST_DISTANCE", `# ST_DISTANCE

**Category:** Spatial
**Syntax:** \`ST_DISTANCE(point1, point2)\`

Returns the distance between two GeoJSON Point expressions.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`point1\` | GeoJSON | First GeoJSON point. |
| \`point2\` | GeoJSON | Second GeoJSON point. |

## Return Value
Returns a numeric value (distance in meters).

---

📖 **Documentation:** [ST_DISTANCE](https://learn.microsoft.com/en-us/cosmos-db/query/st-distance)`],
    ["ST_INTERSECTS", `# ST_INTERSECTS

**Category:** Spatial
**Syntax:** \`ST_INTERSECTS(geometry1, geometry2)\`

Returns a Boolean indicating whether two GeoJSON objects intersect.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`geometry1\` | GeoJSON | First geometry. |
| \`geometry2\` | GeoJSON | Second geometry. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ST_INTERSECTS](https://learn.microsoft.com/en-us/cosmos-db/query/st-intersects)`],
    ["ST_ISVALID", `# ST_ISVALID

**Category:** Spatial
**Syntax:** \`ST_ISVALID(geometry)\`

Returns a Boolean indicating if the specifiedGeoJSON object is valid.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`geometry\` | GeoJSON | A GeoJSON expression. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ST_ISVALID](https://learn.microsoft.com/en-us/cosmos-db/query/st-isvalid)`],
    ["ST_ISVALIDDETAILED", `# ST_ISVALIDDETAILED

**Category:** Spatial
**Syntax:** \`ST_ISVALIDDETAILED(geometry)\`

Returns a JSON object with a Boolean \`valid\` property and a \`reason\` string if the geometry is invalid.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`geometry\` | GeoJSON | A GeoJSON expression. |

## Return Value
Returns an object: \`{valid: true/false, reason: '...'}\`.

---

📖 **Documentation:** [ST_ISVALIDDETAILED](https://learn.microsoft.com/en-us/cosmos-db/query/st-isvaliddetailed)`],
    ["ST_WITHIN", `# ST_WITHIN

**Category:** Spatial
**Syntax:** \`ST_WITHIN(geometry, polygon)\`

Returns a Boolean indicating whether the first GeoJSON object is within the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`geometry\` | GeoJSON | The geometry to test. |
| \`polygon\` | GeoJSON | The containing polygon. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [ST_WITHIN](https://learn.microsoft.com/en-us/cosmos-db/query/st-within)`],
    ["STARTSWITH", `# STARTSWITH

**Category:** String
**Syntax:** \`STARTSWITH(string, prefix [, ignoreCase])\`

Returns a Boolean indicating whether the first string expression starts with the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to check. |
| \`prefix\` | string | The prefix to look for. |
| \`ignoreCase\` | boolean | Optional case-insensitive flag. |

## Return Value
Returns \`true\` or \`false\`.

---

📖 **Documentation:** [STARTSWITH](https://learn.microsoft.com/en-us/cosmos-db/query/startswith)`],
    ["STRINGEQUALS", `# STRINGEQUALS

**Category:** String
**Syntax:** \`STRINGEQUALS(string1, string2 [, ignoreCase])\`

Returns a Boolean indicating whether the first string matches the second.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string1\` | string | The first string. |
| \`string2\` | string | The second string. |
| \`ignoreCase\` | boolean | Optional case-insensitive flag. |

## Return Value
Returns \`true\` or \`false\`.

## Notes
- Also available as \`STRING_EQUALS\`.

---

📖 **Documentation:** [STRINGEQUALS](https://learn.microsoft.com/en-us/cosmos-db/query/stringequals)`],
    ["STRINGJOIN", `# STRINGJOIN

**Category:** String
**Syntax:** \`STRINGJOIN(array, separator)\`

Concatenates all string elements of an array using the specified separator.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`array\` | array | Array of strings to join. |
| \`separator\` | string | The separator string. |

## Return Value
Returns a joined string.

## Notes
- Also available as \`STRING_JOIN\`.

---

📖 **Documentation:** [STRINGJOIN](https://learn.microsoft.com/en-us/cosmos-db/query/stringjoin)`],
    ["STRINGSPLIT", `# STRINGSPLIT

**Category:** String
**Syntax:** \`STRINGSPLIT(string, separator)\`

Returns an array of substrings obtained by splitting the source string by the specified delimiter.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`separator\` | string | The delimiter string. |

## Return Value
Returns an array of strings.

## Notes
- Also available as \`STRING_SPLIT\`.

---

📖 **Documentation:** [STRINGSPLIT](https://learn.microsoft.com/en-us/cosmos-db/query/stringsplit)`],
    ["STRINGTOARRAY", `# STRINGTOARRAY

**Category:** Conversion
**Syntax:** \`STRINGTOARRAY(string)\`

Converts a JSON string expression to an array.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | A valid JSON array string. |

## Return Value
Returns an array, or \`undefined\` if conversion fails.

## Notes
- Also available as \`STRING_TO_ARRAY\`.

---

📖 **Documentation:** [STRINGTOARRAY](https://learn.microsoft.com/en-us/cosmos-db/query/stringtoarray)`],
    ["STRINGTOBOOLEAN", `# STRINGTOBOOLEAN

**Category:** Conversion
**Syntax:** \`STRINGTOBOOLEAN(string)\`

Converts a string expression (\`'true'\` / \`'false'\`) to a Boolean value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | \`'true'\` or \`'false'\`. |

## Return Value
Returns a Boolean, or \`undefined\` if conversion fails.

## Notes
- Also available as \`STRING_TO_BOOLEAN\`.

---

📖 **Documentation:** [STRINGTOBOOLEAN](https://learn.microsoft.com/en-us/cosmos-db/query/stringtoboolean)`],
    ["STRINGTONULL", `# STRINGTONULL

**Category:** Conversion
**Syntax:** \`STRINGTONULL(string)\`

Converts a string expression (\`'null'\`) to \`null\`.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | \`'null'\`. |

## Return Value
Returns \`null\`, or \`undefined\` if conversion fails.

## Notes
- Also available as \`STRING_TO_NULL\`.

---

📖 **Documentation:** [STRINGTONULL](https://learn.microsoft.com/en-us/cosmos-db/query/stringtonull)`],
    ["STRINGTONUMBER", `# STRINGTONUMBER

**Category:** Conversion
**Syntax:** \`STRINGTONUMBER(string)\`

Converts a string expression to a numeric value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | A string representing a number. |

## Return Value
Returns a numeric value, or \`undefined\` if conversion fails.

## Notes
- Also available as \`STRING_TO_NUMBER\`.

---

📖 **Documentation:** [STRINGTONUMBER](https://learn.microsoft.com/en-us/cosmos-db/query/stringtonumber)`],
    ["STRINGTOOBJECT", `# STRINGTOOBJECT

**Category:** Conversion
**Syntax:** \`STRINGTOOBJECT(string)\`

Converts a JSON string expression to an object.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | A valid JSON object string. |

## Return Value
Returns a JSON object, or \`undefined\` if conversion fails.

## Notes
- Also available as \`STRING_TO_OBJECT\`.

---

📖 **Documentation:** [STRINGTOOBJECT](https://learn.microsoft.com/en-us/cosmos-db/query/stringtoobject)`],
    ["SUBSTRING", `# SUBSTRING

**Category:** String
**Syntax:** \`SUBSTRING(string, start, length)\`

Returns part of a string expression starting at the specified 0-based position.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`start\` | integer | 0-based start position. |
| \`length\` | integer | Number of characters to extract. |

## Return Value
Returns a string.

---

📖 **Documentation:** [SUBSTRING](https://learn.microsoft.com/en-us/cosmos-db/query/substring)`],
    ["SUBSTRINGAFTER", `# SUBSTRINGAFTER

**Category:** String
**Syntax:** \`SUBSTRINGAFTER(string, substring)\`

Returns the part of a string after the first occurrence of another string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`substring\` | string | The substring to search for. |

## Return Value
Returns a string.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["SUBSTRINGBEFORE", `# SUBSTRINGBEFORE

**Category:** String
**Syntax:** \`SUBSTRINGBEFORE(string, substring)\`

Returns the part of a string before the first occurrence of another string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The source string. |
| \`substring\` | string | The substring to search for. |

## Return Value
Returns a string.

---

⚠️ **Documentation:** No public documentation available yet. This is an internal Cosmos DB SQL function.`],
    ["SUM", `# SUM

**Category:** Aggregate
**Syntax:** \`SUM(expression)\`

Returns the sum of all values in the expression.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | numeric | A numeric expression. |

## Return Value
Returns a numeric value.

## Examples
\`\`\`sql
SELECT SUM(c.amount) FROM c
\`\`\`

---

📖 **Documentation:** [SUM](https://learn.microsoft.com/en-us/cosmos-db/query/sum)`],
    ["TAN", `# TAN

**Category:** Math
**Syntax:** \`TAN(number)\`

Returns the tangent of the specified angle in radians.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | Angle in radians. |

## Return Value
Returns a numeric value.

---

📖 **Documentation:** [TAN](https://learn.microsoft.com/en-us/cosmos-db/query/tan)`],
    ["TICKSTODATETIME", `# TICKSTODATETIME

**Category:** Date/Time
**Syntax:** \`TICKSTODATETIME(ticks)\`

Converts a ticks value to a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`ticks\` | integer | Number of ticks since Unix epoch. |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [TICKSTODATETIME](https://learn.microsoft.com/en-us/cosmos-db/query/tickstodatetime)`],
    ["TIMESTAMPTODATETIME", `# TIMESTAMPTODATETIME

**Category:** Date/Time
**Syntax:** \`TIMESTAMPTODATETIME(timestamp)\`

Converts a Unix timestamp (milliseconds) to a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`timestamp\` | integer | Unix timestamp in milliseconds. |

## Return Value
Returns a datetime string.

---

📖 **Documentation:** [TIMESTAMPTODATETIME](https://learn.microsoft.com/en-us/cosmos-db/query/timestamptodatetime)`],
    ["TOSTRING", `# TOSTRING

**Category:** String
**Syntax:** \`TOSTRING(expression)\`

Returns the string representation of the specified value.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`expression\` | any | The value to convert to string. |

## Return Value
Returns a string.

---

📖 **Documentation:** [TOSTRING](https://learn.microsoft.com/en-us/cosmos-db/query/tostring)`],
    ["TRIM", `# TRIM

**Category:** String
**Syntax:** \`TRIM(string [, chars])\`

Returns a string after removing leading and trailing whitespace or specified characters.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string to trim. |
| \`chars\` | string | Optional characters to trim. |

## Return Value
Returns the trimmed string.

---

📖 **Documentation:** [TRIM](https://learn.microsoft.com/en-us/cosmos-db/query/trim)`],
    ["TRUNC", `# TRUNC

**Category:** Math
**Syntax:** \`TRUNC(number)\`

Returns a numeric value truncated to the closest integer (toward zero).

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`number\` | numeric | A numeric expression. |

## Return Value
Returns an integer numeric value.

## Examples
\`\`\`sql
SELECT TRUNC(4.8)  -- 4
SELECT TRUNC(-4.8) -- -4
\`\`\`

---

📖 **Documentation:** [TRUNC](https://learn.microsoft.com/en-us/cosmos-db/query/trunc)`],
    ["UPPER", `# UPPER

**Category:** String
**Syntax:** \`UPPER(string)\`

Returns a string expression after converting lowercase characters to uppercase.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`string\` | string | The string expression. |

## Return Value
Returns the uppercase string.

---

📖 **Documentation:** [UPPER](https://learn.microsoft.com/en-us/cosmos-db/query/upper)`],
    ["VECTORDISTANCE", `# VECTORDISTANCE

**Category:** Vector/AI
**Syntax:** \`VECTORDISTANCE(vector1, vector2 [, brute_force [, distanceFunction]])\`

Returns the similarity score between two vectors.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`vector1\` | array | First vector (array of numbers). |
| \`vector2\` | array | Second vector (array of numbers). |
| \`brute_force\` | boolean | Optional. Force brute-force search. |
| \`distanceFunction\` | string | Optional: \`'cosine'\`, \`'euclidean'\`, or \`'dotproduct'\`. |

## Return Value
Returns a numeric similarity score.

---

📖 **Documentation:** [VECTORDISTANCE](https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance)`],
    ["YEAR", `# YEAR

**Category:** Date/Time
**Syntax:** \`YEAR(datetime)\`

Returns the year component of a datetime string.

## Parameters
| Name | Type | Description |
|------|------|-------------|
| \`datetime\` | string | A datetime string. |

## Return Value
Returns an integer.

---

📖 **Documentation:** [YEAR](https://learn.microsoft.com/en-us/cosmos-db/query/year)`],
]);

/** Hover documentation for SQL keywords (key = uppercase keyword name). */
export const keywordDocs = new Map<string, string>([
    ["AND", `# AND

Logical conjunction operator. Returns \`true\` when both operands are true.

## Syntax
\`\`\`sql
expr1 AND expr2
\`\`\`

## Operator Precedence

| Operator | Priority |
|----------|----------|
| NOT      | 1        |
| **AND**  | **2**    |
| OR       | 3        |

---

📖 **Documentation:** [AND](https://learn.microsoft.com/en-us/cosmos-db/query/operators#and-operator)`],
    ["ARRAY", `# ARRAY

Creates an array from a subquery expression.

## Syntax
\`\`\`sql
ARRAY (SELECT ...)
\`\`\`

## Examples
\`\`\`sql
SELECT c.id, ARRAY(SELECT t FROM t IN c.tags) AS tags FROM c
\`\`\`

---

📖 **Documentation:** [ARRAY](https://learn.microsoft.com/en-us/cosmos-db/query/constants)`],
    ["AS", `# AS

Assigns an alias to a collection or expression.

## Syntax
\`\`\`sql
FROM collection AS alias
SELECT expr AS name
\`\`\`

## Notes
- The \`AS\` keyword is optional: \`FROM c alias\` works too.

---

📖 **Documentation:** [AS](https://learn.microsoft.com/en-us/cosmos-db/query/from)`],
    ["ASC", `# ASC

Specifies ascending sort order (default) in ORDER BY.

## Syntax
\`\`\`sql
ORDER BY expr ASC
\`\`\`

---

📖 **Documentation:** [ASC](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)`],
    ["BETWEEN", `# BETWEEN

Tests if a value is within an inclusive range.

## Syntax
\`\`\`sql
expr BETWEEN low AND high
expr NOT BETWEEN low AND high
\`\`\`

## Examples
\`\`\`sql
SELECT * FROM c WHERE c.age BETWEEN 18 AND 65
\`\`\`

---

📖 **Documentation:** [BETWEEN](https://learn.microsoft.com/en-us/cosmos-db/query/between)`],
    ["DESC", `# DESC

Specifies descending sort order in ORDER BY.

## Syntax
\`\`\`sql
ORDER BY expr DESC
\`\`\`

---

📖 **Documentation:** [DESC](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)`],
    ["DISTINCT", `# DISTINCT

Removes duplicate values from the result set.

## Syntax
\`\`\`sql
SELECT DISTINCT ...
\`\`\`

---

📖 **Documentation:** [DISTINCT](https://learn.microsoft.com/en-us/cosmos-db/query/distinct)`],
    ["EXISTS", `# EXISTS

Tests if a subquery returns any results.

## Syntax
\`\`\`sql
EXISTS (SELECT ...)
\`\`\`

## Examples
\`\`\`sql
SELECT * FROM c
WHERE EXISTS (SELECT VALUE t FROM t IN c.tags WHERE t = 'important')
\`\`\`

---

📖 **Documentation:** [EXISTS](https://learn.microsoft.com/en-us/cosmos-db/query/subquery#exists-expression)`],
    ["FALSE", `# false

Boolean false literal.

---

📖 **Documentation:** [FALSE](https://learn.microsoft.com/en-us/cosmos-db/query/constants)`],
    ["FROM", `# FROM

Specifies the source collection for the query.

## Syntax
\`\`\`sql
FROM collection [AS alias]
FROM collection alias
\`\`\`

## Examples
\`\`\`sql
SELECT * FROM c
SELECT * FROM Families f
\`\`\`

---

📖 **Documentation:** [FROM](https://learn.microsoft.com/en-us/cosmos-db/query/from)`],
    ["GROUP_BY", `# GROUP BY

Groups results by one or more expressions. Used with aggregate functions.

## Syntax
\`\`\`sql
GROUP BY expr [, ...]
\`\`\`

## Examples
\`\`\`sql
SELECT c.category, COUNT(1) as count
FROM c
GROUP BY c.category
\`\`\`

---

📖 **Documentation:** [GROUP_BY](https://learn.microsoft.com/en-us/cosmos-db/query/group-by)`],
    ["IN", `# IN

Tests if a value is in a list, or iterates an array in FROM.

## Syntax
\`\`\`sql
expr IN (value1, value2, ...)
expr NOT IN (value1, value2, ...)
FROM item IN collection.array
\`\`\`

---

📖 **Documentation:** [IN](https://learn.microsoft.com/en-us/cosmos-db/query/in)`],
    ["JOIN", `# JOIN

Joins with a nested array or subquery within the same document. Unlike standard SQL JOINs, Cosmos DB JOINs are intra-document (self-joins on arrays).

## Syntax
\`\`\`sql
FROM c JOIN child IN c.children
\`\`\`

## Examples
\`\`\`sql
SELECT c.id, child.name
FROM c
JOIN child IN c.children
WHERE child.age > 10
\`\`\`

---

📖 **Documentation:** [JOIN](https://learn.microsoft.com/en-us/cosmos-db/query/join)`],
    ["LIKE", `# LIKE

Pattern matching with wildcards.

## Syntax
\`\`\`sql
expr LIKE pattern [ESCAPE char]
expr NOT LIKE pattern
\`\`\`

## Wildcards
- \`%\` — matches zero or more characters
- \`_\` — matches exactly one character

## Examples
\`\`\`sql
SELECT * FROM c WHERE c.name LIKE '%smith%'
\`\`\`

---

📖 **Documentation:** [LIKE](https://learn.microsoft.com/en-us/cosmos-db/query/like)`],
    ["LIMIT", `# LIMIT

Limits the number of results returned (for pagination).

## Syntax
\`\`\`sql
OFFSET n LIMIT m
\`\`\`

## Notes
- Must be used together with OFFSET.

---

📖 **Documentation:** [LIMIT](https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit)`],
    ["NOT", `# NOT

Logical negation operator.

## Syntax
\`\`\`sql
NOT expr
expr NOT IN (...)
expr NOT BETWEEN a AND b
expr NOT LIKE pattern
\`\`\`

## Operator Precedence

| Operator | Priority |
|----------|----------|
| **NOT**  | **1**    |
| AND      | 2        |
| OR       | 3        |

---

📖 **Documentation:** [NOT](https://learn.microsoft.com/en-us/cosmos-db/query/operators#not-operator)`],
    ["NULL", `# null

The JSON null value. Represents an explicitly absent value.

## Notes
- \`null\` is different from \`undefined\` (missing property).
- Use \`IS_NULL()\` to check for null values.

---

📖 **Documentation:** [NULL](https://learn.microsoft.com/en-us/cosmos-db/query/constants)`],
    ["OFFSET", `# OFFSET

Skips a specified number of results (for pagination).

## Syntax
\`\`\`sql
OFFSET n LIMIT m
\`\`\`

## Notes
- Must be used together with LIMIT.
- Can use parameters: \`OFFSET @skip LIMIT @take\`

---

📖 **Documentation:** [OFFSET](https://learn.microsoft.com/en-us/cosmos-db/query/offset-limit)`],
    ["OR", `# OR

Logical disjunction operator. Returns \`true\` when either operand is true.

## Syntax
\`\`\`sql
expr1 OR expr2
\`\`\`

## Operator Precedence

| Operator | Priority |
|----------|----------|
| NOT      | 1        |
| AND      | 2        |
| **OR**   | **3**    |

---

📖 **Documentation:** [OR](https://learn.microsoft.com/en-us/cosmos-db/query/operators#or-operator)`],
    ["ORDER_BY", `# ORDER BY

Sorts the result set by one or more expressions.

## Syntax
\`\`\`sql
ORDER BY expr [ASC|DESC] [, ...]
ORDER BY RANK score_function(...)
\`\`\`

## Notes
- Default sort order is ascending (ASC).
- \`ORDER BY RANK\` is used with full-text and vector search scoring functions.

---

📖 **Documentation:** [ORDER_BY](https://learn.microsoft.com/en-us/cosmos-db/query/order-by)`],
    ["SELECT", `# SELECT

Specifies the fields or expressions to return from the query.

## Syntax
\`\`\`sql
SELECT [DISTINCT] [TOP n] <select_spec>
\`\`\`

## Variants
- \`SELECT *\` — return all fields
- \`SELECT VALUE expr\` — return scalar values
- \`SELECT expr [AS alias], ...\` — return specific fields
- \`SELECT DISTINCT\` — remove duplicates
- \`SELECT TOP n\` — limit to first n results

---

📖 **Documentation:** [SELECT](https://learn.microsoft.com/en-us/cosmos-db/query/select)`],
    ["TOP", `# TOP

Limits the result to the first N documents.

## Syntax
\`\`\`sql
SELECT TOP n ...
\`\`\`

## Notes
- Can use a parameter: \`SELECT TOP @limit\`

---

📖 **Documentation:** [TOP](https://learn.microsoft.com/en-us/cosmos-db/query/top)`],
    ["TRUE", `# true

Boolean true literal.

---

📖 **Documentation:** [TRUE](https://learn.microsoft.com/en-us/cosmos-db/query/constants)`],
    ["UNDEFINED", `# undefined

The CosmosDB undefined value. Represents a missing/non-existent property.

## Notes
- \`undefined\` is different from \`null\`.
- Use \`IS_DEFINED()\` to check if a property exists.
- Properties with value \`undefined\` are not included in query results.

---

📖 **Documentation:** [UNDEFINED](https://learn.microsoft.com/en-us/cosmos-db/query/constants)`],
    ["VALUE", `# VALUE

Returns scalar values instead of JSON objects.

## Syntax
\`\`\`sql
SELECT VALUE <expression>
\`\`\`

## Examples
\`\`\`sql
SELECT VALUE c.name FROM c
-- Returns: ['Alice', 'Bob'] instead of [{name:'Alice'}, ...]
\`\`\`

---

📖 **Documentation:** [VALUE](https://learn.microsoft.com/en-us/cosmos-db/query/select#select-value)`],
    ["WHERE", `# WHERE

Filters documents by a Boolean condition.

## Syntax
\`\`\`sql
WHERE <condition>
\`\`\`

## Examples
\`\`\`sql
SELECT * FROM c WHERE c.status = 'active'
SELECT * FROM c WHERE c.age > 21 AND c.city = 'Seattle'
\`\`\`

---

📖 **Documentation:** [WHERE](https://learn.microsoft.com/en-us/cosmos-db/query/where)`],
]);
