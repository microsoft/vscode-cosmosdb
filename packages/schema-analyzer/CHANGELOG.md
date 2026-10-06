# Changelog

## 1.1.0

This release changes schema output, value formatting, and BSON analyzer ownership contracts.

### Added

- Recognize `Uint8Array` as binary data, including Node.js `Buffer`, without requiring a global `Buffer`.
- JavaScript source maps with embedded TypeScript and declaration maps, without separate TypeScript source files.
- Documentation of ESM/Node/browser boundaries, supported inputs, mutation, ownership, and error behavior.

### Fixed

- Prevent prototype pollution and inherited-property collisions for document fields such as `__proto__`,
  `constructor`, and `toString`, including nested objects and array elements.
- Preserve types and statistics when updating simplified or serialized analyzer-produced schemas.
- Navigate simplified nested objects and arrays consistently.
- Represent empty array items with `{}` instead of an invalid empty `anyOf`.
- Recognize compatible BSON values across independent module copies and JavaScript realms without `instanceof`.
- Recognize BSON 5, 6, and 7 using inherited type tags, version markers, and compatible value shapes.
- Classify 16-byte Binary subtypes 3 and 4 as `uuid-legacy` and `uuid`, independent of the wrapper class.
- Preserve recognizable unsupported BSON wrappers as unknown fields rather than exposing their internal properties.
- Keep JavaScript symbols distinct from BSON symbols.
- Handle invalid dates without throwing during display or introducing `NaN` into date bounds.
- Handle native `Buffer`, `RegExp`, and `undefined` consistently in inference and formatting.
- Count used binary bytes rather than backing-buffer capacity in display and statistics.
- Map the legacy BSON `number` tag to JSON Schema `number`.
- Install `@types/json-schema` transitively for consumers of the public declarations.

### Compatibility notes

- Bare `Uint8Array` values now produce `binary` rather than `object` schemas. Other typed arrays remain objects;
  wrap their bytes explicitly in BSON `Binary` when binary interpretation is intended.
- Neither runtime code nor public declarations require a `bson` or `mongodb` dependency. The optional peer
  has been removed. Applications creating or parsing BSON values still declare their own BSON library.
  Compatible BSON 5/6/7 driver values remain supported; BSON 4 is not supported.
  BSON document inputs no longer require an `_id` field.
- Binary subtypes 3 and 4 with 16 used bytes now produce `uuid-legacy` and `uuid`, even when they are plain
  `Binary` instances. Other sizes remain `binary`. UUID display is JSON-quoted, dashed lowercase hex of the
  stored bytes; no legacy driver byte-order convention is guessed. UUID categories have no binary-length statistics.
- Recognizable wrappers with unsupported versions, unknown tags, or incompatible shapes produce `_unknown_`
  leaves. Ordinary documents with an own `_bsontype` field remain documents.
- JavaScript `Symbol` values now produce `_unknown_`, not BSON `symbol`. BSONSymbol remains `symbol`.
  Explicit `_unknown_` formatting now returns `"Unknown"` instead of serializing the value, including for
  unsupported wrappers, JavaScript symbols, functions, and `bigint`.
- Invalid dates retain `date` and their occurrence counts, display as `"Invalid Date"`, and do not contribute
  to `x-minDate` / `x-maxDate`. Bounds are absent until a valid date is observed.
- `SchemaAnalyzer.getSchema()` and `getKnownFields()` now return independent mutable snapshots rather than
  live state or shared cached arrays. Re-read after updates; mutating a result does not update the analyzer.
- Update errors propagate without rollback. BSON updates increment `version` and invalidate the field
  cache even on failure, so subsequent reads reflect partial progress.
- Empty arrays initially have unconstrained `items: {}`. Consumers must not assume `items.anyOf` exists.
- Formatting `undefined` returns the string `"undefined"`. JSON-backed formatting throws when serialization
  cannot return a string; serialization errors are not suppressed.
- Node.js remains `>=22`; exports remain ESM-only. Declaration-to-source navigation requires separately
  available source files because declaration maps do not embed source text.

### Upgrading from 1.0.x

1. Regenerate persisted `getSchema()` and `getKnownFields()` results from source documents. Do not merge old
   schemas into newly analyzed results: corrected wrapper fields, UUID categories, unknown values, binary sizes,
   and invalid-date bounds change the output. Rebuilding, rather than relabeling entries, restores statistics.
2. Discard previously cached field lists. The analyzer's `version` is an instance-local mutation counter,
   not a package or schema-format version; it cannot detect whether persisted data came from an older release.
3. Re-read snapshots after updates and do not mutate them to update the analyzer. If an update throws, either
   consume the newly exposed partial progress or call `reset()` and rebuild; updates are not transactional.
4. Review consumers that switch on BSON tags or parse formatted values. Handle `_unknown_`, the UUID categories,
   `"Unknown"` and `"Invalid Date"` explicitly; display strings are not a lossless serialization format.
5. Transport raw BSON documents across workers using canonical `EJSON.stringify(..., { relaxed: false })`
   and `EJSON.parse(..., { relaxed: false })`, not `structuredClone` or raw `postMessage`, which discard wrapper
   prototypes. Cloning the analyzer's plain schema snapshots is unaffected.
6. Keep BSON module resolution consistent in bundling consumers. Static imports avoid the observed dynamic-import
   CJS/ESM mismatch, but do not guarantee a single copy. This analyzer tolerates supported independent copies;
   other `instanceof` checks in an application may still fail.
