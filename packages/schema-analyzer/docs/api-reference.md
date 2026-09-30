# API Reference

Detailed API reference for `@azure/cosmosdb-schema-analyzer`.

## Document inputs and limits

Both analyzers synchronously inspect document objects. Pass a record at the root, not serialized JSON,
an array, `null`, or a primitive. Parse JSON text before calling the analyzer. Root validation is not a
separate API guarantee: invalid JavaScript inputs can throw or produce unhelpful schemas.

Document graphs and supplied schemas must be finite and acyclic. There is no cycle detection,
cancellation, or traversal budget. A cycle can cause nontermination or resource exhaustion; recursive
simplification can overflow the stack for deeply nested inputs. Repeated references without cycles
are analyzed at each occurrence, not deduplicated by object identity.

For predictable JSON output, use plain JSON-compatible values and finite numbers:

| Input                                    | JSON analyzer behavior / limitation                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `undefined`                              | Preserves the `undefined` tag, mapped to JSON Schema `null`; this does not convert the value to `null`                            |
| `Date`, `RegExp`, `Map`, class instances | Treated as objects with own enumerable fields, not as BSON/native special types; map entries are not traversed as document fields |
| `bigint`, symbols, functions             | Classified as `_unknown_`, mapped to JSON Schema `string`; this does not serialize or convert the original value                  |
| `NaN`, positive/negative infinity        | Classified as numbers but not rejected; numeric statistics can be non-finite and do not round-trip faithfully through JSON        |

Use `/bson` for the [documented BSON/native representations](#inferbsontypevalue-bsontype).
Its type tags describe normalized categories, not validation of BSON values against JSON Schema.
Numeric statistics use JavaScript `number`; large integers and high-precision BSON numbers can lose
precision when converted for min/max statistics. Neither analyzer is a lossless serializer.

Inputs are read, not deliberately mutated, but enumeration and BSON operations can invoke getters,
coercion, or value methods. Exceptions propagate. Updates are not transactional and can leave partial
progress; BSON updates also advance `version` and invalidate cached fields on failure.
`getSchemaFromDocuments([])` throws; an empty BSON batch is allowed.
JSON update/simplification functions mutate their schema arguments. BSON read methods return independent
mutable snapshots, whereas `getSchemaAtPath()` returns a node belonging to the supplied schema.

For ESM, Node.js, browser boundaries and entry-point dependencies, see
[Supported environments](../README.md#supported-environments).

## Root Entry Point: `@azure/cosmosdb-schema-analyzer`

Shared types and utilities that do not depend on JSON or BSON.

### Supported schema inputs

Update and traversal utilities support analyzer-produced schemas (including serialized copies), in expanded,
simplified, or mixed form. Preserve their type tags and statistical extensions when passing results between
operations. The JSON update function expects JSON-analyzer output; it does not convert BSON type tags.
These utilities are not an importer/interpreter for arbitrary JSON Schema: `$ref`, `oneOf`, tuple items,
boolean schemas and custom compositions are not supported as accumulator inputs.

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

Exported type describing the internal JSON/BSON traversal adapter. No public function currently accepts
a custom adapter, so this is not a runtime plugin API. The
[type-system extension guide](./type-systems.md#adding-a-new-type-system) is for changes to the library's source.

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
Import this function from the package root, not `/bson`. Pass `"x-dataType"` for JSON schemas
or `"x-bsonType"` for BSON schemas. BSON analyzer instances also provide the cached
`analyzer.getKnownFields()` method without arguments.
Both return caller-owned field lists; the analyzer keeps its cached representation private.

#### `getPropertyNamesAtLevel(schema, path): string[]`

Returns sorted property names at the given nesting level. `_id` is always sorted first.
Paths contain property names, not array indexes; array items are traversed automatically, including nested arrays.
Names are combined across all reachable object variants. A terminal scalar or array without observed object
elements produces an empty list; a missing path segment throws.

#### `getSchemaAtPath(schema, path): JSONSchema | undefined`

Navigates expanded or simplified schemas using property-name segments, traversing arrays and union alternatives.
Returns the first object matching the complete path. At each path segment, candidates from all reachable parent
variants are ordered by the number of array levels traversed at that segment: direct objects first, then objects
in progressively deeper arrays. Equally deep matches retain traversal order; other candidates remain available
for resolving later segments.
A terminal field with no object variant returns `undefined`; a missing path segment throws.
An empty path returns the root. The returned node belongs to the input schema, not a copy.
Only own entries in `properties` are considered; inherited names are treated as missing path segments.

#### `simplifySchema(schema): void`

**Mutates** the schema in place. Unwraps single-element `anyOf` arrays by merging the entry's properties directly into the parent node. Applied recursively.
Simplified analyzer output remains a supported input for subsequent updates and traversal.

#### `buildFullPaths(path, names): string[]`

Combines a base path with property names to produce dot-notated full paths.

---

## JSON Entry Point: `@azure/cosmosdb-schema-analyzer/json`

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

JSON and BSON analysis includes only own enumerable string-keyed document fields, including names such as
`__proto__`, `constructor`, and `toString`. These names are stored as ordinary schema properties without changing
object prototypes. Inherited, non-enumerable, and symbol-keyed document fields are not analyzed.

#### `getSchemaFromDocuments(documents): JSONSchema`

Creates a merged schema from multiple documents, then applies `simplifySchema()`. Throws if the array is empty.

#### `updateSchemaWithDocument(schema, document): void`

Incrementally adds a document to an existing schema. **Mutates** the schema.
Both expanded single-document output and automatically simplified batch output are supported. Touched simplified
nodes are expanded into `anyOf` as needed, preserving observed types and their statistics; untouched nodes can remain
simplified. Call `simplifySchema()` to normalize the final presentation. Batch generation continues to simplify
automatically.

Errors propagate without rollback, so the supplied schema can contain partial work from the failing document.

#### `inferNoSqlType(value): NoSQLTypes`

Returns the JSON analyzer's type tag for a JavaScript value.

#### `noSqlTypeToJSONType(type): string`

Maps a JSON analyzer type tag to its JSON Schema `type` value.

#### `noSqlTypeToDisplayString(type): string`

Maps a JSON analyzer type tag to a human-readable display string (e.g., `'string'` → `'String'`).

#### `simplifySchema(schema): void`

See [`simplifySchema`](#simplifyschemaschema-void).

#### `getPropertyNamesAtLevel(schema, path): string[]`

See [`getPropertyNamesAtLevel`](#getpropertynamesatlevelschema-path-string).

#### `buildFullPaths(path, names): string[]`

See [`buildFullPaths`](#buildfullpathspath-names-string).

---

## BSON Entry Point: `@azure/cosmosdb-schema-analyzer/bson`

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

See [`FieldEntry`](#fieldentry).

### Classes

#### `SchemaAnalyzer`

Incremental schema analyzer with version tracking and caching.

Input documents use `Document` from `bson`, not the MongoDB driver's `WithId<Document>`.
The `_id` field is optional and may have any supported value type. Existing driver documents remain accepted.
Batch methods accept `ReadonlyArray<Document>`.

**Constructor:** `new SchemaAnalyzer()`

**Properties:**

| Property  | Type                | Description                                                          |
| --------- | ------------------- | -------------------------------------------------------------------- |
| `version` | `number` (readonly) | Incremented on every `addDocument()`, `addDocuments()`, or `reset()` |

**Methods:**

| Method               | Returns          | Description                                       |
| -------------------- | ---------------- | ------------------------------------------------- |
| `addDocument(doc)`   | `void`           | Analyze a single BSON `Document`                  |
| `addDocuments(docs)` | `void`           | Analyze multiple documents (single version bump)  |
| `getSchema()`        | `JSONSchema`     | Get a deep snapshot of the current schema         |
| `getDocumentCount()` | `number`         | Documents whose analysis has started              |
| `getKnownFields()`   | `FieldEntry[]`   | Deep snapshot of the internally cached field list |
| `reset()`            | `void`           | Clear the schema and start fresh                  |
| `clone()`            | `SchemaAnalyzer` | Deep-copy the analyzer state                      |

**Ownership and errors:**

- `getSchema()` and `getKnownFields()` return independent, mutable deep snapshots. Modifying any nested value
  does not affect the analyzer, its version, other snapshots, or clones. Previously returned snapshots do not
  change when more documents are analyzed or the analyzer is reset.
- Each read returns a new object/array, even when the version is unchanged. Schema reads copy the schema;
  field reads copy the cached list without repeating schema traversal.
- This replaces the former live-schema / shared-field-array behavior. Re-read after an update; do not use
  reference equality to detect changes. Use `version` instead.
- `addDocument()` and `addDocuments()` mutate internal state and are **not transactional**. Getter, conversion,
  or other analysis errors propagate; preceding documents and any partial work on the failing document remain.
  The count includes a failing document once its analysis has started, not only fully processed documents.
- Each update call increments `version` once on exit, including failure and empty batches, invalidating cached
  fields. A batch stops at the first error. Call `reset()` and reanalyze valid documents if partial state is unwanted.
- `reset()` clears accumulated state and increments the version. `clone()` creates an independent analyzer
  with version zero.

**Static Methods:**

| Method                | Returns          | Description                                           |
| --------------------- | ---------------- | ----------------------------------------------------- |
| `fromDocument(doc)`   | `SchemaAnalyzer` | Create an analyzer pre-loaded with one document       |
| `fromDocuments(docs)` | `SchemaAnalyzer` | Create an analyzer pre-loaded with multiple documents |

### Functions

#### `inferBsonType(value): BSONType`

Returns a BSON type tag for JavaScript and BSON/MongoDB values. Recognition uses the value's structure,
so values from separate BSON module copies are supported. This identifies a type; it does not validate the value.
See [type inference details](./type-systems.md#type-inference-priority) for the recognition rules.

Supported representations:

| Type               | JavaScript / Node.js   | BSON / MongoDB wrapper | Inferred tag    |
| ------------------ | ---------------------- | ---------------------- | --------------- |
| String             | `string`               | -                      | `string`        |
| Boolean            | `boolean`              | -                      | `boolean`       |
| Array              | `Array`                | -                      | `array`         |
| Object             | Plain object           | -                      | `object`        |
| Null               | `null`                 | -                      | `null`          |
| Undefined          | `undefined`            | -                      | `undefined`     |
| Double             | `number`               | `Double`               | `double`        |
| 32-bit integer     | -                      | `Int32`                | `int32`         |
| 64-bit integer     | -                      | `Long`                 | `long`          |
| Decimal            | -                      | `Decimal128`           | `decimal128`    |
| Date               | `Date`                 | -                      | `date`          |
| Object ID          | -                      | `ObjectId`             | `objectid`      |
| Timestamp          | -                      | `Timestamp`            | `timestamp`     |
| Binary             | `Uint8Array`, `Buffer` | `Binary`               | `binary`        |
| Regular expression | `RegExp`               | `BSONRegExp`           | `regexp`        |
| Symbol             | `Symbol`               | `BSONSymbol`           | `symbol`        |
| UUID               | -                      | `UUID` (subtype 4)     | `uuid`          |
| Legacy UUID        | -                      | `UUID` (subtype 3)     | `uuid-legacy`   |
| Min key            | -                      | `MinKey`               | `minkey`        |
| Max key            | -                      | `MaxKey`               | `maxkey`        |
| Database reference | -                      | `DBRef`                | `dbref`         |
| Code               | -                      | `Code` without scope   | `code`          |
| Code with scope    | -                      | `Code` with scope      | `codewithscope` |
| Map                | `Map`                  | -                      | `map`           |

The wrapper column lists BSON classes, not BSON storage support; strings, dates and other shared values use
their JavaScript representations.

Other objects are classified as `object`; unsupported primitives and functions as `_unknown_`.
Other typed arrays (such as `Uint16Array`) and `DataView` are not implicitly interpreted as binary data.
Plain `Binary` instances retain the `binary` tag even when their subtype is a UUID subtype.
UUID recognition additionally requires 16 used bytes and the UUID `toHexString()` / `toJSON()` methods.
Inference does not guarantee that a value can be JSON-serialized.

#### `bsonTypeToJSONType(type): string`

Maps a BSON type to its JSON Schema `type` value.

The original tag is preserved separately in `x-bsonType`: for example, `binary`, `regexp`, `symbol`,
`objectid`, and `uuid` map to JSON Schema `string`, numeric driver types map to `number`, and
`undefined`, `minkey`, and `maxkey` map to `null`. This mapping neither converts the input value nor
defines its display format; the generated schema describes the analyzer's normalized type categories,
not validation of raw BSON driver instances or an Extended JSON encoding.

#### `bsonTypeToDisplayString(type): string`

Maps a BSON type to a human-readable display string (e.g., `'objectid'` → `'ObjectId'`).

#### `valueToDisplayString(value, type): string`

Converts a BSON value to a human-readable string representation for display in UI.

Pass the matching type tag, normally from `inferBsonType(value)`. A successful call returns a string.
JSON-backed cases retain `JSON.stringify` semantics (including driver `toJSON()` methods); this is not
a lossless BSON serializer. Serialization errors, such as circular references or unsupported `bigint`
values, propagate. A value whose JSON serialization produces no string (for example, a function or an
object whose `toJSON()` returns `undefined`) causes a `TypeError`.

| Type                                                                              | Output example                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `string`                                                                          | `"hello"` (raw string)                                 |
| `number`, `int32`, `double`, `decimal128`, `long`                                 | `"42"`                                                 |
| `boolean`                                                                         | `"true"`                                               |
| `date`                                                                            | `"2024-01-15T00:00:00.000Z"` (ISO string)              |
| `objectid`                                                                        | `"507f1f77bcf86cd799439011"` (hex)                     |
| `null`                                                                            | `"null"`                                               |
| `undefined`                                                                       | `"undefined"`                                          |
| `binary`                                                                          | `"Binary[16]"`                                         |
| `regexp`                                                                          | `"pattern options"`                                    |
| `symbol`                                                                          | `"Symbol(s)"` for JavaScript; raw symbol text for BSON |
| `minkey`                                                                          | `"MinKey"`                                             |
| `maxkey`                                                                          | `"MaxKey"`                                             |
| `object`, `array`, `map`, `dbref`, `code`, `codewithscope`, `uuid`, `uuid-legacy` | JSON.stringify output                                  |

For `regexp`, JavaScript values use `source` and `flags`; BSON values use `pattern` and `options`.
The separating space is retained even when there are no flags or options.

For `binary`, both display length and `SchemaAnalyzer`'s `x-minLength` / `x-maxLength` statistics count
bytes: `Uint8Array.byteLength` for a byte view (including `Buffer`) and `Binary.length()` for used BSON binary data,
not the backing buffer capacity. Empty values have length zero, and mixed `Uint8Array` / `Buffer` / `Binary`
observations update the same statistics.
Invalid binary-length method results (non-integer, negative or beyond the backing buffer) cause a `TypeError`.

#### `getPropertyNamesAtLevel(schema, path): string[]`

See [`getPropertyNamesAtLevel`](#getpropertynamesatlevelschema-path-string).

#### `buildFullPaths(path, names): string[]`

See [`buildFullPaths`](#buildfullpathspath-names-string).

`simplifySchema` is not exported by `/bson`; import it from the package root or `/json`.
