# API Reference

Detailed API reference for `@cosmosdb/schema-analyzer`.

## Root Entry Point: `@cosmosdb/schema-analyzer`

Shared types and utilities that do not depend on JSON or BSON.

### Types

#### `JSONSchema`

Extended JSON Schema draft-07 interface with `x-*` vendor extensions. See [schema-format.md](./schema-format.md).

#### `JSONSchemaRef`

```typescript
type JSONSchemaRef = JSONSchema | boolean;
```

#### `JSONSchemaMap`

```typescript
interface JSONSchemaMap {
  [name: string]: JSONSchemaRef;
}
```

#### `TypeAdapter<TType>`

Generic interface for plugging in custom type systems. See [type-systems.md](./type-systems.md).

#### `FieldEntry`

```typescript
interface FieldEntry {
  path: string; // dot-notated path, e.g. "user.profile.name"
  type: string; // JSON Schema type of the dominant entry
  dataType: string; // dominant data type from the extension key
  dataTypes?: string[]; // all observed types (only if ≥2)
  isSparse?: boolean; // true if field is not present in all documents
  arrayItemDataType?: string; // dominant array element type (if array)
}
```

### Functions

#### `getKnownFields(schema, typeExtensionKey): FieldEntry[]`

Traverses the schema (BFS) and collects all leaf field paths with their most common types.

#### `getPropertyNamesAtLevel(schema, path): string[]`

Returns sorted property names at the given nesting level. `_id` is always sorted first.

#### `getSchemaAtPath(schema, path): JSONSchema | undefined`

Navigates into the schema following the given path segments. At each level, if the property has `anyOf`, it picks the `object` entry to descend into.

#### `simplifySchema(schema): void`

**Mutates** the schema in place. Unwraps single-element `anyOf` arrays by merging the entry's properties directly into the parent node. Applied recursively.

#### `buildFullPaths(path, names): string[]`

Combines a base path with property names to produce dot-notated full paths.

---

## JSON Entry Point: `@cosmosdb/schema-analyzer/json`

### Types

#### `NoSQLTypes`

```typescript
type NoSQLTypes =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'undefined'
  | 'timestamp'
  | '_unknown_';
```

#### `NoSQLDocument`

```typescript
type NoSQLDocument = Record<string, unknown>;
```

### Functions

#### `getSchemaFromDocument(document): JSONSchema`

Creates a new schema from a single document.

#### `getSchemaFromDocuments(documents): JSONSchema`

Creates a merged schema from multiple documents, then applies `simplifySchema()`. Throws if the array is empty.

#### `updateSchemaWithDocument(schema, document): void`

Incrementally adds a document to an existing schema. **Mutates** the schema.

#### `inferNoSqlType(value): NoSQLTypes`

Returns the NoSQL type tag for a JavaScript value.

#### `noSqlTypeToJSONType(type): string`

Maps a NoSQL type to its JSON Schema `type` value.

#### `noSqlTypeToDisplayString(type): string`

Maps a NoSQL type to a human-readable display string (e.g., `'string'` → `'String'`).

#### `simplifySchema(schema): void`

Re-exported from core. See above.

#### `getPropertyNamesAtLevel(schema, path): string[]`

Re-exported from core. See above.

#### `buildFullPaths(path, names): string[]`

Re-exported from core. See above.

---

## BSON Entry Point: `@cosmosdb/schema-analyzer/bson`

### Types

#### `BSONType`

```typescript
type BSONType =
  | 'string'
  | 'number'
  | 'int32'
  | 'double'
  | 'decimal128'
  | 'long'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'undefined'
  | 'date'
  | 'regexp'
  | 'binary'
  | 'objectid'
  | 'symbol'
  | 'timestamp'
  | 'uuid'
  | 'uuid-legacy'
  | 'minkey'
  | 'maxkey'
  | 'dbref'
  | 'code'
  | 'codewithscope'
  | 'map'
  | '_unknown_';
```

#### `FieldEntry`

Re-exported from core. See above.

### Classes

#### `SchemaAnalyzer`

Incremental schema analyzer with version tracking and caching.

**Constructor:** `new SchemaAnalyzer()`

**Properties:**

| Property  | Type                | Description                                                          |
| --------- | ------------------- | -------------------------------------------------------------------- |
| `version` | `number` (readonly) | Incremented on every `addDocument()`, `addDocuments()`, or `reset()` |

**Methods:**

| Method               | Returns          | Description                                      |
| -------------------- | ---------------- | ------------------------------------------------ |
| `addDocument(doc)`   | `void`           | Analyze a single `WithId<Document>`              |
| `addDocuments(docs)` | `void`           | Analyze multiple documents (single version bump) |
| `getSchema()`        | `JSONSchema`     | Get the current cumulative schema                |
| `getDocumentCount()` | `number`         | Total documents analyzed                         |
| `getKnownFields()`   | `FieldEntry[]`   | Cached field list (recomputed on version change) |
| `reset()`            | `void`           | Clear the schema and start fresh                 |
| `clone()`            | `SchemaAnalyzer` | Deep-copy the analyzer state                     |

**Static Methods:**

| Method                | Returns          | Description                                           |
| --------------------- | ---------------- | ----------------------------------------------------- |
| `fromDocument(doc)`   | `SchemaAnalyzer` | Create an analyzer pre-loaded with one document       |
| `fromDocuments(docs)` | `SchemaAnalyzer` | Create an analyzer pre-loaded with multiple documents |

### Functions

#### `inferBsonType(value): BSONType`

Returns the BSON type tag for a MongoDB driver value.

#### `bsonTypeToJSONType(type): string`

Maps a BSON type to its JSON Schema `type` value.

#### `bsonTypeToDisplayString(type): string`

Maps a BSON type to a human-readable display string (e.g., `'objectid'` → `'ObjectId'`).

#### `valueToDisplayString(value, type): string`

Converts a BSON value to a human-readable string representation for display in UI.

| Type                                              | Output example                            |
| ------------------------------------------------- | ----------------------------------------- |
| `string`                                          | `"hello"` (raw string)                    |
| `number`, `int32`, `double`, `decimal128`, `long` | `"42"`                                    |
| `boolean`                                         | `"true"`                                  |
| `date`                                            | `"2024-01-15T00:00:00.000Z"` (ISO string) |
| `objectid`                                        | `"507f1f77bcf86cd799439011"` (hex)        |
| `null`                                            | `"null"`                                  |
| `binary`                                          | `"Binary[16]"`                            |
| `regexp`                                          | `"pattern options"`                       |
| `minkey`                                          | `"MinKey"`                                |
| `maxkey`                                          | `"MaxKey"`                                |
| `object`, `array`, `map`, `dbref`, etc.           | JSON.stringify output                     |

#### `getPropertyNamesAtLevel(schema, path): string[]`

Re-exported from core. See above.

#### `buildFullPaths(path, names): string[]`

Re-exported from core. See above.

#### `simplifySchema(schema): void`

Re-exported from core. See above.
