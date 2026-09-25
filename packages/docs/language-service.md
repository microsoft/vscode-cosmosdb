---
description: Practical API reference for the Cosmos DB for NoSQL SQL language service.
---

# Language service

`@azure/cosmosdb-nosql-language-service` separates the parser, an editor-independent service, and editor adapters. No database connection is involved.

## Parse and inspect a query

```ts
import { parse, sqlToString } from "@azure/cosmosdb-nosql-language-service";

const result = parse("SELECT c.name FROM c WHERE c.price < 10");
if (result.ast && result.errors.length === 0) {
  console.log(result.ast.query.select.spec.kind);
  console.log(sqlToString(result.ast));
} else {
  console.log(result.errors);
}
```

Error recovery may return a partial AST alongside errors. Check **both** before treating a query as successfully parsed. A successful parse is not proof that the server will accept or execute it.

## Configure the service

```ts
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import { getSchemaFromDocuments } from "@azure/cosmosdb-schema-analyzer/json";

let schema = getSchemaFromDocuments([{ name: "Notebook", price: 8 }]);
const service = new SqlLanguageService({
  getSchema: () => schema,
  multiQuery: true
});

// Future calls use the replacement schema; no service recreation is needed.
schema = getSchemaFromDocuments([
  { name: "Notebook", price: 8, inStock: true }
]);
```

`new SqlLanguageService(host?)` accepts these optional host members:

| Member         | Default when omitted           | Contract                                                                                                                  |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `getSchema()`  | No schema                      | Synchronously returns `JSONSchema` or `undefined` for field completion and hover information.                             |
| `getAliases()` | Detect aliases from query text | Synchronously returns `string[]` or `undefined`. A supplied array overrides detected aliases; it is not merged with them. |
| `multiQuery`   | `false`                        | Routes document-aware language features through semicolon-separated query regions.                                        |

Fetch data outside these callbacks. Return your current in-memory schema rather than a promise. One service host supplies one schema; a multi-query document does not automatically acquire a different schema per statement.

## Common methods

`query` is the full text, and `offset` is a zero-based JavaScript string offset into that text.

| Call                              | Result                                        | Use                                                           |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `parse(query)`                    | Parse result with optional `ast` and `errors` | Single-query AST access, regardless of `multiQuery`.          |
| `getDiagnostics(query)`           | `Diagnostic[]`                                | Syntax errors and additional service diagnostics.             |
| `getCompletions(query, offset)`   | `CompletionItem[]`                            | Keywords, functions, aliases, and schema fields.              |
| `getHoverInfo(query, offset)`     | `HoverInfo` or `null`                         | Documentation blocks and an optional range.                   |
| `getSignatureHelp(query, offset)` | `SignatureHelpResult` or `null`               | Function signatures and active parameter index.               |
| `format(query)`                   | `string`                                      | Canonical SQL from the parsed AST.                            |
| `getFormatEdits(query)`           | `TextEdit[]`                                  | No edit if unchanged; otherwise a whole-document replacement. |
| `parseDocument(query)`            | `MultiQueryDocument`                          | Parse regions explicitly, even when `multiQuery` is off.      |
| `getActiveRegion(query, offset)`  | Query region or `undefined`                   | Find the statement under the cursor.                          |

Diagnostic ranges use zero-based offsets and one-based lines/columns; ends are exclusive. Severity values are `1` (error), `2` (warning), `3` (information), and `4` (hint). Editor adapters perform the necessary position and severity conversion.

## Cursor-sensitive features

```ts
const completionText = "SELECT c. FROM c";
const fields = service.getCompletions(
  completionText,
  completionText.indexOf("c.") + 2
);

const hoverText = "SELECT COUNT(1) FROM c";
const hover = service.getHoverInfo(hoverText, hoverText.indexOf("COUNT") + 1);

const signatureText = "SELECT CONTAINS(c.name, ";
const signature = service.getSignatureHelp(signatureText, signatureText.length);

console.log({ fields, hover, signature });
```

The standalone `getCompletions({ query, offset, schema?, aliases? })` function is useful if you do not need a service instance. Its optional schema and aliases have the same purpose.

## Multiple queries and formatting

```ts
const text = "SELECT * FROM c;\nSELECT VALUE COUNT(1) FROM c";
const document = service.parseDocument(text);
console.log(document.regions.length);
console.log(service.getActiveRegion(text, text.lastIndexOf("SELECT")));
```

With `multiQuery: true`, diagnostics use document coordinates and cursor-sensitive features use the active region. Semicolons inside strings or comments are not statement separators.

Formatting is parse-and-print, not a whitespace-preserving edit. Invalid single queries are returned unchanged; multi-query formatting preserves invalid region text while formatting valid regions. Comments and original layout may be lost, and valid regions are joined with `;\n\n`. Keep formatting undoable and do not use it to archive source text.

For AST traversal and deeper implementation details, see the [language-service source documentation](https://github.com/microsoft/vscode-cosmosdb/tree/main/packages/nosql-language-service/docs). Review [limitations](./limitations.md) before treating editor feedback as validation.
