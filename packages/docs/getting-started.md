---
description: Install the published packages and connect inferred JSON fields to SQL completions.
---

# Getting started

## Install the published packages

The libraries require Node.js **22 or later** and an ESM application. Both packages publish ESM JavaScript and TypeScript declarations.

```sh
npm install @azure/cosmosdb-nosql-language-service@1.0.0 @azure/cosmosdb-schema-analyzer@1.0.0
```

The language service depends on the schema analyzer, but declare the analyzer directly when your application imports it. Install editor peers only for the adapter you use; headless parsing does not require Monaco or CodeMirror.

## Connect documents to completions

```ts
import { SqlLanguageService } from "@azure/cosmosdb-nosql-language-service";
import { getSchemaFromDocuments } from "@azure/cosmosdb-schema-analyzer/json";

const schema = getSchemaFromDocuments([
  { id: "p1", name: "Notebook", price: 8, tags: ["paper"] },
  { id: "p2", name: "Pencil", price: 2, inStock: true }
]);

const service = new SqlLanguageService({ getSchema: () => schema });
const query = "SELECT c. FROM c";
const offset = query.indexOf("c.") + "c.".length;

console.log(service.getCompletions(query, offset).map((item) => item.label));
console.log(service.getDiagnostics("SELECT * FORM c"));
console.log(service.format("select  *  from c"));
```

The unfinished `c.` is deliberate: completion works while you type. Its offset is a **zero-based JavaScript string position**, not a line number. The malformed `FORM` query demonstrates diagnostics, not database execution.

No schema yet? `new SqlLanguageService()` still provides syntax and built-in language features; schema-derived fields need `getSchema`.

## Choose an integration

| Environment                      | Import                                              |
| -------------------------------- | --------------------------------------------------- |
| Headless or custom editor        | `@azure/cosmosdb-nosql-language-service`            |
| Service facade and service types | `@azure/cosmosdb-nosql-language-service/services`   |
| [Monaco](./monaco.md)            | `@azure/cosmosdb-nosql-language-service/monaco`     |
| [CodeMirror 6](./codemirror.md)  | `@azure/cosmosdb-nosql-language-service/codemirror` |
| [VS Code extension](./vscode.md) | `@azure/cosmosdb-nosql-language-service/vscode`     |
| Browser-safe JSON inference      | `@azure/cosmosdb-schema-analyzer/json`              |
| Node.js BSON inference           | `@azure/cosmosdb-schema-analyzer/bson`              |

Do not import the BSON entry point into a browser bundle. It requires the optional `mongodb` peer; JSON inference does not.
