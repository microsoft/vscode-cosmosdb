---
description: Diagnostic codes, examples, and validation boundaries for language service version 1.0.0.
---

# Diagnostics

This page describes **`@azure/cosmosdb-nosql-language-service` 1.0.0**, the published version used by this site.
These are package diagnostics, not Cosmos DB server error codes or a complete specification of the query language.
For language rules and function behavior, use the [Microsoft Learn query reference](https://learn.microsoft.com/en-us/cosmos-db/query/).

## Parser errors versus service diagnostics

`parse(query).errors` reports lexer and parser errors for a single query.
`new SqlLanguageService().getDiagnostics(query)` includes those errors plus the additional checks below.
The parser can accept a query that the service then flags, such as an `ORDER BY` inside a subquery.
Error recovery may also produce a partial AST alongside errors; an AST alone does not establish validity.

```ts
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";

const service = new SqlLanguageService();
const diagnostics = service.getDiagnostics("SELECT * FORM c");
for (const diagnostic of diagnostics) {
  console.log(diagnostic.code, diagnostic.severity, diagnostic.range);
  console.log(diagnostic.message);
}
```

This example produces both a `MISSING_KEYWORD` error and a `POSSIBLE_TYPO` warning.
Use `code` and `severity` for programmatic handling rather than matching human-readable messages.
One query can produce several diagnostics; fixing one issue may resolve multiple entries.

## Lexer and parser errors

All parser errors become severity **Error (1)** in `getDiagnostics()`.
The categories below describe the codes actually emitted in version 1.0.0, not every possible invalid query.

| Code               | Severity  | Example query                | Suggested correction            |
| ------------------ | --------- | ---------------------------- | ------------------------------- |
| `UNEXPECTED_TOKEN` | Error (1) | `SELECT VALUE #1`            | `SELECT VALUE 1`                |
| `MISSING_KEYWORD`  | Error (1) | `SELECT * FROM c ORDER c.id` | `SELECT * FROM c ORDER BY c.id` |
| `UNEXPECTED_EOF`   | Error (1) | `SELECT * FROM`              | `SELECT * FROM c`               |

- **`UNEXPECTED_TOKEN`**: an unrecognized character or another unexpected token. Check the highlighted text and surrounding expression.
- **`MISSING_KEYWORD`**: an expected token or grammar construct was not found. Despite its name, this code also covers some token mismatches and trailing input, not only missing keywords.
- **`UNEXPECTED_EOF`**: the input ended before a required part of the query. Complete the expression, clause, or closing delimiter. This is normal while typing.

`SqlErrorCode` also declares `INVALID_LITERAL` and `QUERY_TOO_COMPLEX`, but the published 1.0.0 parser does not emit them.
Do not rely on dedicated literal validation or a nesting-depth safeguard based on those enum members.

## Additional service checks

These checks are added by `getDiagnostics()`; they are not included in `parse(query).errors`.
Warnings are heuristic guidance, not proof that the server will reject the query.

| Code                         | Severity    | Example query                                                                      | Suggested correction                                                          |
| ---------------------------- | ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POSSIBLE_TYPO`              | Warning (2) | `SELECT * FORM c`                                                                  | `SELECT * FROM c`                                                             |
| `BETWEEN_AMBIGUITY`          | Warning (2) | `SELECT * FROM c WHERE c.x BETWEEN 1 AND 2 AND c.y = 3`                            | `SELECT * FROM c WHERE (c.x BETWEEN 1 AND 2) AND c.y = 3`                     |
| `ORDER_BY_IN_SUBQUERY`       | Error (1)   | `SELECT VALUE (SELECT VALUE x.name FROM x IN c.items ORDER BY x.name) FROM c`      | `SELECT VALUE (SELECT VALUE x.name FROM x IN c.items) FROM c`                 |
| `RANKED_ORDER_BY_SORT_ORDER` | Error (1)   | `SELECT TOP 10 c.title FROM c ORDER BY RANK FullTextScore(c.title, "search") DESC` | `SELECT TOP 10 c.title FROM c ORDER BY RANK FullTextScore(c.title, "search")` |

- **`POSSIBLE_TYPO`**: an identifier resembles a clause keyword in a plausible keyword position. This is not a general spellchecker; check the suggestion before changing a legitimate identifier.
- **`BETWEEN_AMBIGUITY`**: an unparenthesized `BETWEEN ... AND ... AND` pattern at the same nesting depth. Group the `BETWEEN` expression explicitly. A parser error may appear alongside this warning.
- **`ORDER_BY_IN_SUBQUERY`**: the parsed AST contains an `ORDER BY` inside a nested query. Remove it or redesign the query to order outer results. Moving ordering outward is not necessarily equivalent to sorting a nested array.
- **`RANKED_ORDER_BY_SORT_ORDER`**: the outer `ORDER BY RANK` clause includes `ASC` or `DESC`. Remove the explicit direction; see [ORDER BY RANK](https://learn.microsoft.com/en-us/cosmos-db/query/order-by-rank).

The corrections above clear local diagnostics; they do not establish runtime validity or preserve every intended query behavior.
For example, full-text ranking still requires the appropriate service configuration and indexes.

## Positions and multiple queries

Diagnostic ranges use zero-based JavaScript string offsets (UTF-16 code units), one-based lines/columns, and exclusive ends.
Editor adapters convert them to each editor's coordinate system. Version 1.0.0 EOF error ranges can extend one offset
past the input; clamp ranges to the document bounds when writing a custom adapter.
The service emits Error (1) and Warning (2); Information (3) and Hint (4) exist in the type but are not emitted by these checks.

With `new SqlLanguageService({ multiQuery: true })`, the same checks run independently for each non-empty query region,
and ranges refer to the full document. This is an editor feature, not support for executing query batches.
The standalone `parse()` and `service.parse()` remain single-query APIs.

## What is not validated

An empty diagnostics array means only that these local checks found no issues.
In version 1.0.0, supplying a schema provides field completion and hover information, not unknown-field or field-type validation.
The service does not comprehensively check function existence, argument counts or types, parameter values, UDF availability,
indexes, account capabilities, permissions, or runtime semantics.

Use the [playground](./playground.md) to explore feedback and the [Language Service API](./language-service.md) to integrate it.
Review [Limitations](./limitations.md#parsing-is-not-execution) and validate production queries against the actual service separately.
