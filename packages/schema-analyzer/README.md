# @cosmosdb/schema-analyzer

Schema inference and statistical analysis for JSON / NoSQL and BSON / MongoDB documents.

Inspects one or more documents and produces a **JSON Schema** (draft-07 compatible) enriched with `x-*` vendor extensions that capture structural and statistical metadata:

- Property names and their observed types (`anyOf`)
- Occurrence counts per property and per type
- Min/max statistics for strings, numbers, booleans, arrays, objects, dates, and binary data

## Sub-modules

| Import path | Use case | Dependencies |
|---|---|---|
| `@cosmosdb/schema-analyzer` | Shared `JSONSchema` types only | None |
| `@cosmosdb/schema-analyzer/json` | Plain JSON / CosmosDB NoSQL documents | `denque` |
| `@cosmosdb/schema-analyzer/bson` | MongoDB API / DocumentDB API documents | `denque`, `mongodb` (peer) |

## Installation

```bash
pnpm add @cosmosdb/schema-analyzer

# If using the BSON sub-module, also install mongodb:
pnpm add mongodb
```

## Quick start — JSON

```typescript
import {
  getSchemaFromDocuments,
  getPropertyNamesAtLevel,
} from "@cosmosdb/schema-analyzer/json";

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
import { SchemaAnalyzer } from "@cosmosdb/schema-analyzer/bson";

const analyzer = new SchemaAnalyzer();
analyzer.addDocument({ _id: new ObjectId(), name: "Alice", createdAt: new Date() });
analyzer.addDocument({ _id: new ObjectId(), name: "Bob", score: new Int32(42) });

const schema = analyzer.getSchema();
const fields = analyzer.getKnownFields();
// → [{ path: "_id", type: "string", bsonType: "objectid" }, ...]
```

## JSON API

| Export                       | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `getSchemaFromDocument(doc)` | Build a schema from a single document                   |
| `getSchemaFromDocuments(docs)` | Build a merged & simplified schema from multiple docs |
| `updateSchemaWithDocument(schema, doc)` | Incrementally merge a document into an existing schema |
| `simplifySchema(schema)`    | Unwrap single-element `anyOf` arrays                    |
| `getPropertyNamesAtLevel(schema, path)` | List property names at a given nesting level |
| `buildFullPaths(path, names)` | Build dot-separated full paths                        |
| `inferNoSqlType(value)`     | Infer the NoSQL type of a JS value                      |

## BSON API

| Export | Description |
|---|---|
| `SchemaAnalyzer` | Class-based incremental analyzer with versioning and caching |
| `BSONTypes` | Enum + namespace with `inferType()`, `toJSONType()`, `toDisplayString()` |
| `getKnownFields(schema)` | Traverse schema to collect all leaf fields with types |
| `getPropertyNamesAtLevel(schema, path)` | List property names at a given nesting level |
| `buildFullPaths(path, names)` | Build dot-separated full paths |
| `valueToDisplayString(value, type)` | Convert a BSON value to a human-readable string |

## License

MIT
