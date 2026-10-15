# Type Systems

This document describes the two type systems supported by `@azure/cosmosdb-schema-analyzer` and how they map to JSON Schema types.

## JSON Analyzer Types

Used by `@azure/cosmosdb-schema-analyzer/json`. Type extension key: `x-dataType`.

| Type Tag    | JSON Schema Type | Description                      |
| ----------- | ---------------- | -------------------------------- |
| `string`    | `string`         | JavaScript string                |
| `number`    | `number`         | JavaScript number (float64)      |
| `boolean`   | `boolean`        | `true` / `false`                 |
| `object`    | `object`         | Plain object (`{}`)              |
| `array`     | `array`          | Array (`[]`)                     |
| `null`      | `null`           | JSON `null`                      |
| `undefined` | `null`           | JavaScript `undefined`           |
| `timestamp` | `string`         | Timestamp string                 |
| `_unknown_` | `string`         | Fallback for unrecognized values |

### Type Inference Logic

```
null        → 'null'
undefined   → 'undefined'
typeof === 'string'   → 'string'
typeof === 'number'   → 'number'
typeof === 'boolean'  → 'boolean'
Array.isArray(value)  → 'array'
typeof === 'object'   → 'object'
otherwise             → '_unknown_'
```

## BSON Analyzer Types

Used by `@azure/cosmosdb-schema-analyzer/bson`. Type extension key: `x-bsonType`.

Reference: [MongoDB BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/)

| BSON Type       | JSON Schema Type | Representation                     | Description                          |
| --------------- | ---------------- | ---------------------------------- | ------------------------------------ |
| `string`        | `string`         | —                                  | Native string                        |
| `double`        | `number`         | `Double` / native `number`         | 64-bit float                         |
| `int32`         | `number`         | `Int32`                            | 32-bit integer                       |
| `long`          | `number`         | `Long`                             | 64-bit integer                       |
| `decimal128`    | `number`         | `Decimal128`                       | 128-bit decimal                      |
| `number`        | `number`         | —                                  | Generic number (legacy)              |
| `boolean`       | `boolean`        | —                                  | Native boolean                       |
| `object`        | `object`         | —                                  | Plain object                         |
| `array`         | `array`          | —                                  | Native array                         |
| `null`          | `null`           | —                                  | JSON null                            |
| `undefined`     | `null`           | —                                  | JavaScript undefined                 |
| `date`          | `string`         | `Date`                             | JavaScript Date                      |
| `objectid`      | `string`         | `ObjectId`                         | 12-byte ObjectId                     |
| `uuid`          | `string`         | `Binary` / `UUID` (subtype 4)      | UUID with 16 used bytes              |
| `uuid-legacy`   | `string`         | `Binary` (subtype 3)               | Legacy UUID with 16 used bytes       |
| `regexp`        | `string`         | `BSONRegExp` / native `RegExp`     | Regular expression                   |
| `binary`        | `string`         | `Binary` / `Uint8Array` / `Buffer` | Binary data                          |
| `symbol`        | `string`         | `BSONSymbol`                       | BSON symbol                          |
| `timestamp`     | `string`         | `Timestamp`                        | Internal MongoDB timestamp           |
| `code`          | `string`         | `Code` (no scope)                  | JavaScript code                      |
| `codewithscope` | `object`         | `Code` (with scope)                | JavaScript code + scope object       |
| `map`           | `object`         | `Map`                              | JavaScript Map                       |
| `dbref`         | `object`         | `DBRef`                            | Database reference                   |
| `minkey`        | `null`           | `MinKey`                           | Compares lower than all BSON values  |
| `maxkey`        | `null`           | `MaxKey`                           | Compares higher than all BSON values |
| `_unknown_`     | `string`         | —                                  | Fallback for unrecognized values     |

### Type Inference Priority

`null` and `undefined` are recognized first. Native strings and booleans receive their corresponding tags;
native JavaScript numbers receive `double`, not the legacy `number` tag. JavaScript `Symbol`, `bigint`,
and functions receive `_unknown_`; only compatible `BSONSymbol` wrappers receive `symbol`.

Non-null objects are checked in this order, without `instanceof` or constructor-name comparisons:

1. `Array.isArray(value)` returns `array`.
2. `Uint8Array` views, including Node.js `Buffer`, return `binary`.
3. Native `Date` shape returns `date`.
4. Native `Map` shape returns `map`.
5. Native `RegExp` shape returns `regexp`.
6. Eligible BSON wrappers are classified by their version marker, inherited `_bsontype`, and type-specific members.
   Recognizable but unsupported wrappers return `_unknown_`.
7. Other objects return `object`, including ordinary documents with an own `_bsontype` property.

Native dates, maps and regular expressions are recognized using `Object.prototype.toString.call(value)` and
the required fields and methods. This supports values from other JavaScript realms.
Byte arrays require an `ArrayBuffer` view with the `Uint8Array` tag; other typed arrays and `DataView` are not binary.

BSON wrapper eligibility excludes objects with an own `_bsontype` property or a prototype of `null` or
`Object.prototype`. An own tag is document data and is not read for inference. Eligible wrappers have an inherited
string `_bsontype` and either a numeric `Symbol.for('@@mdb.bson.version')` marker or callable `toExtendedJSON`.
Only markers 5, 6, and 7 are supported; they do not require `toExtendedJSON`.

Supported wrappers must also have a known tag and the fields and methods consumed for that type.
For example, `ObjectId` requires a 12-byte ID and `toHexString()`; `BSONRegExp` requires string `pattern`
and `options` fields. Unknown tags, unsupported numeric markers, or incompatible shapes on recognizable
wrappers produce `_unknown_`, preserved as leaves rather than traversed as objects. Markerless inherited-tag
wrappers with `toExtendedJSON` are also unknown: BSON 4 is not supported. This is not a guarantee that
every unsupported object will be recognized as a wrapper.

Equivalent supported values have source-invariant inference, display, and statistics across independent
BSON copies, ESM/CJS imports, and MongoDB driver exports. Compatibility tests target the lower versions
5.0, 6.0, and 7.0, plus recent 5/6 and current 7 releases.

Compatible `Binary` values with 16 used bytes (`position === 16`) produce `uuid` for subtype 4 and
`uuid-legacy` for subtype 3. UUID-specific `toHexString()` / `toJSON()` methods are not required.
Other sizes remain `binary`. Compatible `Code` values produce `codewithscope` when a scope object is
present and `code` otherwise. Existing object traversal for `DBRef` and `CodeWithScope` is retained;
BSON wrappers are not all opaque.

These checks establish interface compatibility, not authenticity or a security boundary. Inference does not invoke
serialization, coercion or binary-length methods to validate their results; errors from eligible getters propagate.
Ordinary document getters can still run during traversal, including an own `_bsontype` getter. See the
[API reference](./api-reference.md#inferbsontypevalue-bsontype) for supported representations and limitations.

### Statistics Collected by BSON Type

| BSON Types                                        | Statistics                                                   |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `string`                                          | `x-minLength`, `x-maxLength`                                 |
| `number`, `int32`, `long`, `double`, `decimal128` | `x-minValue`, `x-maxValue`                                   |
| `boolean`                                         | `x-trueCount`, `x-falseCount`                                |
| `date`                                            | `x-minDate`, `x-maxDate` (epoch ms)                          |
| `binary`                                          | `x-minLength`, `x-maxLength` (byte length)                   |
| `object`                                          | `x-minProperties`, `x-maxProperties`, `x-documentsInspected` |
| `array`                                           | `x-minItems`, `x-maxItems`                                   |
| All others                                        | No additional statistics                                     |

Invalid JavaScript dates retain the `date` tag and count toward occurrences, but do not contribute to
`x-minDate` / `x-maxDate`. If the first observations are invalid, the first later valid date initializes
both bounds. UUID categories have no binary-length statistics; those remain exclusive to `binary`.

## Adding a New Type System

The following steps are for contributors modifying the library's source. Although `TypeAdapter` is
exported as a type, no public entry point accepts custom adapters at runtime.

To support a new type system in the library:

1. Define a type union (e.g., `type MyType = 'foo' | 'bar' | ...`)
2. Implement `TypeAdapter<MyType>` from `core/schemaTraversal.ts`
3. Create a sub-module under `src/my-system/` with public API functions
4. Add an export entry in `package.json` `exports`

See [ADR-001](./decisions.md#adr-001-typeadapter-pattern-for-jsonbson-polymorphism) for the design rationale.
