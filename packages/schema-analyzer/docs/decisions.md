# Design Decisions

This document records key architectural decisions for `@cosmosdb/schema-analyzer` using the ADR (Architecture Decision Record) format.

---

## ADR-001: TypeAdapter pattern for JSON/BSON polymorphism

**Status:** Accepted

**Context:**
The package must support two fundamentally different type systems:

- **JSON (NoSQL)** — 7 types (`string`, `number`, `boolean`, `object`, `array`, `null`, `undefined`)
- **BSON (MongoDB)** — 23+ types (`objectid`, `int32`, `long`, `double`, `decimal128`, `date`, `binary`, `uuid`, etc.)

Both share the same traversal logic (BFS over document properties and array items), but diverge in type inference, JSON Schema mapping, and statistics collection.

**Decision:**
Introduce a generic `TypeAdapter<TType>` interface that abstracts all type-specific behavior. The core BFS engine (`schemaTraversal.ts`) is fully generic and delegates to the adapter for:

- Type inference (`inferType`)
- JSON Schema type mapping (`toJSONType`)
- Statistics initialization and aggregation (`initializeStats`, `aggregateStats`)
- Type extension key selection (`x-dataType` vs `x-bsonType`)

**Consequences:**

- Zero code duplication in traversal logic
- Adding a new type system (e.g., Avro, Protobuf) requires only a new adapter, no core changes
- Slightly more indirection than inline type checks, but the generic parameter `TType` ensures full type safety

---

## ADR-002: BFS traversal over recursive DFS

**Status:** Accepted

**Context:**
Documents can be deeply nested (100+ levels in user data). Schema traversal must handle arbitrary depth without stack overflow.

**Decision:**
Use breadth-first traversal with a `Denque` FIFO queue instead of recursive function calls.

**Consequences:**

- No stack overflow risk regardless of document depth
- Predictable memory usage (proportional to the widest level, not the deepest)
- `Denque` provides O(1) push/shift operations (vs O(n) for `Array.shift()`)
- Slightly less intuitive than recursive code, but the work-item queue pattern is well-understood

---

## ADR-003: Incremental schema construction

**Status:** Accepted

**Context:**
In real usage, documents are loaded page by page from the database. The analyzer must support adding documents incrementally rather than requiring all documents upfront.

**Decision:**
The core `updateSchemaWithDocument()` function mutates an existing schema in place. Each call:

1. Increments `x-documentsInspected`
2. For each field, either creates a new type entry or increments counters on an existing one
3. Aggregates min/max statistics per type

The JSON module exposes this as a free function. The BSON module wraps it in a `SchemaAnalyzer` class with version tracking.

**Consequences:**

- Supports streaming/paging without re-analyzing previous documents
- The BSON `SchemaAnalyzer` can cache derived data (e.g., `getKnownFields()`) and invalidate on version change
- Schema object is mutable — consumers should not hold references across `addDocument()` calls without awareness

---

## ADR-004: `anyOf` array for polymorphic fields

**Status:** Accepted

**Context:**
A single field (e.g., `status`) may contain different types across documents (`"active"` in one, `true` in another, `1` in a third). The schema must represent this.

**Decision:**
Each property in the schema has an `anyOf` array where each entry represents one observed type. Each entry carries:

- `type` — JSON Schema type (`"string"`, `"number"`, etc.)
- `x-dataType` / `x-bsonType` — original type tag
- `x-typeOccurrence` — count of observations
- Type-specific statistics (`x-minLength`, `x-maxValue`, etc.)

`simplifySchema()` post-processes: if a field has only one type entry, the `anyOf` wrapper is removed and the entry is merged directly into the property node.

**Consequences:**

- Full polymorphism support with occurrence counts
- Consumers can determine the "dominant" type by `x-typeOccurrence`
- `simplifySchema()` produces cleaner output for the common case (single type)
- `anyOf` is valid JSON Schema draft-07, so the output is interoperable

---

## ADR-005: Functional API (JSON) vs Class API (BSON)

**Status:** Accepted

**Context:**
The two sub-modules have different usage patterns:

- **JSON**: typically used for one-shot analysis of a known set of documents
- **BSON**: used in long-lived editor sessions where documents arrive incrementally and derived data (field lists) must be cached

**Decision:**

- `json/` exposes pure functions: `getSchemaFromDocument()`, `getSchemaFromDocuments()`, `updateSchemaWithDocument()`
- `bson/` exposes a `SchemaAnalyzer` class with internal state, version tracking, and cached accessors

**Consequences:**

- JSON API is simple, stateless, easy to test
- BSON API supports caching (`getKnownFields()` is recomputed only when the version changes)
- Both build on the same core engine via `TypeAdapter`

---

## ADR-006: Separate sub-module entry points to avoid mandatory `mongodb` dependency

**Status:** Accepted

**Context:**
The `mongodb` driver is a heavy dependency (~2MB). Projects that only need JSON schema analysis (e.g., CosmosDB NoSQL) should not be forced to install it.

**Decision:**
Three entry points via `package.json` `exports`:

- `@cosmosdb/schema-analyzer` — shared types only, zero dependencies
- `@cosmosdb/schema-analyzer/json` — JSON analyzer, depends only on `denque`
- `@cosmosdb/schema-analyzer/bson` — BSON analyzer, requires `mongodb` as a peer dependency

**Consequences:**

- Tree-shaking friendly: importing `json/` never touches BSON code
- `mongodb` is a peer dependency with `optional: true` — no install error if not needed
- Consumers must use the specific sub-path import, not the bare package name, for analyzers

---

## ADR-007: `Denque` over native `Array` for BFS queue

**Status:** Accepted

**Context:**
`Array.shift()` is O(n) due to re-indexing. For large documents with thousands of fields, this becomes a bottleneck.

**Decision:**
Use [`denque`](https://github.com/invertase/denque) — a high-performance double-ended queue with O(1) `push()` and `shift()`.

**Consequences:**

- O(1) queue operations regardless of queue size
- Single lightweight dependency (~3KB minified)
- Used in both `schemaTraversal.ts` (BFS engine) and `schemaUtils.ts` (`getKnownFields`)

---

## ADR-008: Nested object `x-documentsInspected` tracking (BSON only)

**Status:** Accepted

**Context:**
For the BSON analyzer, knowing `x-occurrence` alone is insufficient to calculate field probability in nested objects. If an object field `address` appears in 80 out of 100 documents, and `address.city` appears in 75 of those 80, we need to know the 80 to compute 75/80 = 93.75%.

**Decision:**
The `TypeAdapter` has an optional `trackNestedObjectDocs` flag. When enabled (BSON adapter), each nested object type entry gets its own `x-documentsInspected` counter incremented during traversal.

**Consequences:**

- Accurate per-level probability calculation for BSON
- Slight memory overhead for the extra counter on each nested object entry
- JSON analyzer opts out (not needed for its use cases)
