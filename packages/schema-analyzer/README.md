# @azure/cosmosdb-schema-analyzer

Schema inference and statistical analysis for JSON and BSON documents.

Inspects one or more documents and produces a **JSON Schema** (draft-07 compatible) enriched with `x-*` vendor extensions that capture structural and statistical metadata:

- Property names and their observed types (`anyOf`)
- Occurrence counts per property and per type
- Min/max statistics for strings, numbers, booleans, arrays, objects, dates, and binary data

## Sub-modules

| Import path                            | Use case                          |
| -------------------------------------- | --------------------------------- |
| `@azure/cosmosdb-schema-analyzer`      | Shared types and schema utilities |
| `@azure/cosmosdb-schema-analyzer/json` | JSON documents                    |
| `@azure/cosmosdb-schema-analyzer/bson` | BSON documents                    |

## Installation

```bash
npm install @azure/cosmosdb-schema-analyzer

# Only if your application creates or parses BSON values:
npm install bson
```

The analyzer has no runtime `bson` or `mongodb` dependency or BSON peer requirement. It recognizes
BSON 5, 6, and 7 values from `bson` or the MongoDB driver, including independent module copies,
using version markers and compatible shapes rather than constructor identity.
See [BSON recognition](docs/type-systems.md#type-inference-priority) for the supported contract.

**Compatibility note:** Corrected unknown, symbol, UUID, and invalid-date handling changes analyzer
output. Regenerate persisted schemas from source documents rather than mixing old and new results.

## Supported environments

Use in Node.js or bundle for modern browsers/Electron; no `Buffer` polyfill is needed.
Runtime and dependency requirements are declared in [package.json](package.json).

## Input and ownership contracts

Pass acyclic document objects, not JSON text. JSON update utilities mutate the supplied schema;
BSON analyzer reads expose the live schema and cached fields. See the [API reference](docs/api-reference.md)
for input limitations and ownership details.

## Quick start — JSON

```typescript
import {
  getSchemaFromDocuments,
  getPropertyNamesAtLevel,
} from "@azure/cosmosdb-schema-analyzer/json";

const schema = getSchemaFromDocuments([
  { name: "Alice", age: 30, tags: ["admin"] },
  { name: "Bob", age: 25, active: true },
]);

// Get root-level property names
const props = getPropertyNamesAtLevel(schema, []);
// → ["active", "age", "name", "tags"]
```

## Quick start — BSON

```typescript
import { Int32, ObjectId } from "bson";
import { SchemaAnalyzer } from "@azure/cosmosdb-schema-analyzer/bson";

const analyzer = new SchemaAnalyzer();
analyzer.addDocument({ _id: new ObjectId(), name: "Alice", createdAt: new Date() });
analyzer.addDocument({ _id: new ObjectId(), name: "Bob", score: new Int32(42) });

const schema = analyzer.getSchema();
const fields = analyzer.getKnownFields();
// → [{ path: "_id", type: "string", dataType: "objectid" }, ...]
```

Documents do not require an `_id` field. If present, it is analyzed like any other field.
For worker transport, use canonical Extended JSON rather than cloning raw BSON values;
see [BSON transport and module resolution](docs/api-reference.md#bson-transport-and-module-resolution).

## Root API

Shared schema utilities:

| Export                                     | Description                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `getKnownFields(schema, typeExtensionKey)` | Collect field paths and types; use `"x-dataType"` for JSON or `"x-bsonType"` for BSON |
| `getSchemaAtPath(schema, path)`            | Navigate a schema by property path segments                                           |
| `getPropertyNamesAtLevel(schema, path)`    | List property names at a given nesting level                                          |
| `buildFullPaths(path, names)`              | Build dot-separated full paths                                                        |
| `simplifySchema(schema)`                   | Unwrap single-element `anyOf` arrays in place                                         |

## JSON API

| Export                                  | Description                                            |
| --------------------------------------- | ------------------------------------------------------ |
| `getSchemaFromDocument(doc)`            | Build a schema from a single document                  |
| `getSchemaFromDocuments(docs)`          | Build a merged & simplified schema from multiple docs  |
| `updateSchemaWithDocument(schema, doc)` | Incrementally merge a document into an existing schema |
| `simplifySchema(schema)`                | Unwrap single-element `anyOf` arrays                   |
| `getPropertyNamesAtLevel(schema, path)` | List property names at a given nesting level           |
| `buildFullPaths(path, names)`           | Build dot-separated full paths                         |
| `inferNoSqlType(value)`                 | Infer the JSON analyzer's type tag for a JS value      |
| `noSqlTypeToJSONType(type)`             | Map a JSON analyzer type tag to a JSON Schema type     |
| `noSqlTypeToDisplayString(type)`        | Format a JSON analyzer type tag for display            |

## BSON API

| Export                                  | Description                                                  |
| --------------------------------------- | ------------------------------------------------------------ |
| `SchemaAnalyzer`                        | Class-based incremental analyzer with versioning and caching |
| `inferBsonType(value)`                  | Infer a BSON type tag                                        |
| `bsonTypeToJSONType(type)`              | Map a BSON type tag to a JSON Schema type                    |
| `bsonTypeToDisplayString(type)`         | Format a BSON type tag for display                           |
| `getPropertyNamesAtLevel(schema, path)` | List property names at a given nesting level                 |
| `buildFullPaths(path, names)`           | Build dot-separated full paths                               |
| `valueToDisplayString(value, type)`     | Convert a BSON value to a human-readable string              |

See the [API reference](docs/api-reference.md) for full signatures and behavior.

## License

MIT
