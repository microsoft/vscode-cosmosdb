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
| `uuid`          | `string`         | `UUID` (subtype 4)                 | RFC 4122 UUID                        |
| `uuid-legacy`   | `string`         | `UUID` (subtype 3)                 | Legacy UUID encoding                 |
| `regexp`        | `string`         | `BSONRegExp` / native `RegExp`     | Regular expression                   |
| `binary`        | `string`         | `Binary` / `Uint8Array` / `Buffer` | Binary data                          |
| `symbol`        | `string`         | `BSONSymbol` / native `Symbol`     | BSON or JavaScript symbol            |
| `timestamp`     | `string`         | `Timestamp`                        | Internal MongoDB timestamp           |
| `code`          | `string`         | `Code` (no scope)                  | JavaScript code                      |
| `codewithscope` | `object`         | `Code` (with scope)                | JavaScript code + scope object       |
| `map`           | `object`         | `Map`                              | JavaScript Map                       |
| `dbref`         | `object`         | `DBRef`                            | Database reference                   |
| `minkey`        | `null`           | `MinKey`                           | Compares lower than all BSON values  |
| `maxkey`        | `null`           | `MaxKey`                           | Compares higher than all BSON values |
| `_unknown_`     | `string`         | —                                  | Fallback for unrecognized values     |

### Type Inference Priority

`null` and `undefined` are recognized first. Native strings, booleans and symbols receive their corresponding
tags; native JavaScript numbers receive `double`, not the legacy `number` tag. Unsupported primitives and
functions receive `_unknown_`.

Non-null objects are checked in this order, without `instanceof` or constructor-name comparisons:

1. `Array.isArray(value)` returns `array`.
2. `Uint8Array` views, including Node.js `Buffer`, return `binary`.
3. Native `Date` shape returns `date`.
4. Native `Map` shape returns `map`.
5. Native `RegExp` shape returns `regexp`.
6. Compatible BSON shapes are classified by `_bsontype` and type-specific members.
7. Other objects, including incompatible BSON-like shapes, return `object`.

Native dates, maps and regular expressions are recognized using `Object.prototype.toString.call(value)` and
the required fields and methods. This supports values from other JavaScript realms.
Byte arrays require an `ArrayBuffer` view with the `Uint8Array` tag; other typed arrays and `DataView` are not binary.

BSON recognition requires a known `_bsontype`, a callable `toExtendedJSON` member, and the data and methods
consumed for that type. For example, `ObjectId` requires a 12-byte ID and `toHexString()`;
`BSONRegExp` requires string `pattern` and `options` fields. Recognition works across independent BSON copies,
including ESM/CJS imports, rather than depending on constructor identity.

UUID recognition additionally requires a compatible `Binary` shape, 16 used bytes, and the UUID
`toHexString()` / `toJSON()` methods. Subtype 4 produces `uuid`; subtype 3 produces `uuid-legacy`.
Plain `Binary` values remain `binary`, even with those subtypes. Compatible `Code` values produce
`codewithscope` when a scope object is present and `code` otherwise.

A `_bsontype` field alone is insufficient. These checks establish interface compatibility, not authenticity
or a security boundary. Inference does not invoke serialization, coercion or binary-length methods to
validate their results; errors from property getters propagate. See the
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

## Adding a New Type System

The following steps are for contributors modifying the library's source. Although `TypeAdapter` is
exported as a type, no public entry point accepts custom adapters at runtime.

To support a new type system in the library:

1. Define a type union (e.g., `type MyType = 'foo' | 'bar' | ...`)
2. Implement `TypeAdapter<MyType>` from `core/schemaTraversal.ts`
3. Create a sub-module under `src/my-system/` with public API functions
4. Add an export entry in `package.json` `exports`

See [ADR-001](./decisions.md#adr-001-typeadapter-pattern-for-jsonbson-polymorphism) for the design rationale.
