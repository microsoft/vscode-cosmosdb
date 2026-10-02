# Changelog

## 1.1.0

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
- Handle native `Buffer`, `RegExp`, symbols, and `undefined` consistently in inference and formatting.
- Count used binary bytes rather than backing-buffer capacity in display and statistics.
- Map the legacy BSON `number` tag to JSON Schema `number`.
- Install `@types/json-schema` transitively for consumers of the public declarations.

### Compatibility notes

- Bare `Uint8Array` values now produce `binary` rather than `object` schemas. Other typed arrays remain objects;
  wrap their bytes explicitly in BSON `Binary` when binary interpretation is intended.
- The optional BSON peer is now `bson >=6.0.0 <8.0.0`, replacing the `mongodb` peer. BSON consumers should
  declare `bson` directly; the MongoDB driver is not required. Compatible driver values remain supported.
  JSON-only consumers need neither package. BSON document inputs no longer require an `_id` field.
- `SchemaAnalyzer.getSchema()` and `getKnownFields()` now return independent mutable snapshots rather than
  live state or shared cached arrays. Re-read after updates; mutating a result does not update the analyzer.
- Update errors propagate without rollback. BSON updates increment `version` and invalidate the field
  cache even on failure, so subsequent reads reflect partial progress.
- Empty arrays initially have unconstrained `items: {}`. Consumers must not assume `items.anyOf` exists.
- Formatting `undefined` returns the string `"undefined"`. JSON-backed formatting throws when serialization
  cannot return a string; serialization errors are not suppressed.
- Node.js remains `>=22`; exports remain ESM-only. Declaration-to-source navigation requires separately
  available source files because declaration maps do not embed source text.
