# Type Systems

This document describes the two type systems supported by `@cosmosdb/schema-analyzer` and how they map to JSON Schema types.

## JSON / CosmosDB NoSQL Types

Used by `@cosmosdb/schema-analyzer/json`. Type extension key: `x-dataType`.

| NoSQL Type  | JSON Schema Type | Description                      |
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

## BSON / MongoDB Types

Used by `@cosmosdb/schema-analyzer/bson`. Type extension key: `x-bsonType`.

Reference: [MongoDB BSON Types](https://www.mongodb.com/docs/manual/reference/bson-types/)

| BSON Type       | JSON Schema Type | MongoDB Class              | Description                          |
| --------------- | ---------------- | -------------------------- | ------------------------------------ |
| `string`        | `string`         | —                          | Native string                        |
| `double`        | `number`         | `Double` / native `number` | 64-bit float                         |
| `int32`         | `number`         | `Int32`                    | 32-bit integer                       |
| `long`          | `number`         | `Long`                     | 64-bit integer                       |
| `decimal128`    | `number`         | `Decimal128`               | 128-bit decimal                      |
| `number`        | `number`         | —                          | Generic number (legacy)              |
| `boolean`       | `boolean`        | —                          | Native boolean                       |
| `object`        | `object`         | —                          | Plain object                         |
| `array`         | `array`          | —                          | Native array                         |
| `null`          | `null`           | —                          | JSON null                            |
| `undefined`     | `null`           | —                          | JavaScript undefined                 |
| `date`          | `string`         | `Date`                     | JavaScript Date                      |
| `objectid`      | `string`         | `ObjectId`                 | 12-byte ObjectId                     |
| `uuid`          | `string`         | `UUID` (subtype 4)         | RFC 4122 UUID                        |
| `uuid-legacy`   | `string`         | `UUID` (subtype 3)         | Legacy UUID encoding                 |
| `regexp`        | `string`         | `RegExp`                   | Regular expression                   |
| `binary`        | `string`         | `Binary` / `Buffer`        | Binary data                          |
| `symbol`        | `string`         | `BSONSymbol`               | Deprecated BSON symbol               |
| `timestamp`     | `string`         | `Timestamp`                | Internal MongoDB timestamp           |
| `code`          | `string`         | `Code` (no scope)          | JavaScript code                      |
| `codewithscope` | `object`         | `Code` (with scope)        | JavaScript code + scope object       |
| `map`           | `object`         | `Map`                      | JavaScript Map                       |
| `dbref`         | `object`         | `DBRef`                    | Database reference                   |
| `minkey`        | `null`           | `MinKey`                   | Compares lower than all BSON values  |
| `maxkey`        | `null`           | `MaxKey`                   | Compares higher than all BSON values |
| `_unknown_`     | `string`         | —                          | Fallback for unrecognized values     |

### Type Inference Priority

For `typeof value === 'object'`, BSON types are checked via `instanceof` in the following order:

1. `Array.isArray()` → `array`
2. `ObjectId` → `objectid`
3. `Int32` → `int32`
4. `Double` → `double`
5. `Date` → `date`
6. `Timestamp` → `timestamp`
7. `Decimal128` → `decimal128`
8. `Long` → `long`
9. `MinKey` → `minkey`
10. `MaxKey` → `maxkey`
11. `BSONSymbol` → `symbol`
12. `DBRef` → `dbref`
13. `Map` → `map`
14. `UUID` (subtype 4) → `uuid`
15. `UUID` (subtype 3) → `uuid-legacy`
16. `Buffer` / `Binary` → `binary`
17. `RegExp` → `regexp`
18. `Code` (with scope) → `codewithscope`
19. `Code` (without scope) → `code`
20. Default → `object`

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

To support a new type system:

1. Define a type union (e.g., `type MyType = 'foo' | 'bar' | ...`)
2. Implement `TypeAdapter<MyType>` from `core/schemaTraversal.ts`
3. Create a sub-module under `src/my-system/` with public API functions
4. Add an export entry in `package.json` `exports`

See [ADR-001](./decisions.md#adr-001-typeadapter-pattern-for-jsonbson-polymorphism) for the design rationale.
