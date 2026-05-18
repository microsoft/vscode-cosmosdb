# Architecture

## Overview

`@cosmosdb/schema-analyzer` is a schema inference engine that analyzes JSON and BSON documents to produce enriched [JSON Schema (draft-07)](https://json-schema.org/draft-07/json-schema-release-notes.html) output with statistical vendor extensions (`x-*` properties).

The package is designed to serve two primary use cases within the VS Code Cosmos DB extension:

1. **Editor autocompletion** — provide Monaco / other editors with property name suggestions
2. **Data exploration** — discover document structure at different nesting levels (e.g., for table views, tree views)

## High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│                    Public API Layer                     │
│                                                         │
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │  json/              │   │  bson/                  │  │
│  │  SchemaAnalyzer.ts  │   │  SchemaAnalyzer.ts      │  │
│  │  (functional API)   │   │  (class-based API)      │  │
│  └────────┬────────────┘   └────────┬────────────────┘  │
│           │                         │                   │
│           │   ┌─────────────────┐   │                   │
│           └──►│  TypeAdapter<T> │◄──┘                   │
│               └────────┬────────┘                       │
│                        │                                │
│           ┌────────────▼────────────┐                   │
│           │  core/                  │                   │
│           │  schemaTraversal.ts     │                   │
│           │  (generic BFS engine)   │                   │
│           └────────────┬────────────┘                   │
│                        │                                │
│           ┌────────────▼────────────┐                   │
│           │  core/                  │                   │
│           │  schemaUtils.ts         │                   │
│           │  (query & simplify)     │                   │
│           └─────────────────────────┘                   │
│                                                         │
│           ┌─────────────────────────┐                   │
│           │  JSONSchema.ts          │                   │
│           │  (shared types)         │                   │
│           └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

## Module Decomposition

### `JSONSchema.ts` — Shared Types

Extends the standard `JSONSchema7` interface from `@types/json-schema` with vendor `x-*` properties that store statistical metadata:

| Extension                             | Purpose                                        |
| ------------------------------------- | ---------------------------------------------- |
| `x-documentsInspected`                | Total documents analyzed at this schema node   |
| `x-occurrence`                        | How many documents contained this property     |
| `x-typeOccurrence`                    | How many times this specific type was observed |
| `x-dataType` / `x-bsonType`           | Original type tag (JSON or BSON)               |
| `x-minProperties` / `x-maxProperties` | Object property count range                    |
| `x-minItems` / `x-maxItems`           | Array length range                             |
| `x-minLength` / `x-maxLength`         | String length or binary size range             |
| `x-minValue` / `x-maxValue`           | Numeric value range                            |
| `x-minDate` / `x-maxDate`             | Date range (epoch ms)                          |
| `x-trueCount` / `x-falseCount`        | Boolean distribution                           |

### `core/schemaTraversal.ts` — Generic BFS Engine

The heart of the analyzer. Performs **breadth-first traversal** of a document, incrementally updating a schema. All type-specific logic is abstracted via the `TypeAdapter<TType>` interface:

```typescript
interface TypeAdapter<TType extends string> {
  inferType(value: unknown): TType;
  toJSONType(type: TType): string;
  typeExtensionKey: string;
  initializeStats(value: unknown, type: TType, entry: JSONSchema): void;
  aggregateStats(value: unknown, type: TType, entry: JSONSchema): void;
  trackNestedObjectDocs?: boolean;
}
```

**Why BFS?** BFS guarantees that we process all fields at the same depth before going deeper, preventing stack overflow on deeply nested documents and enabling flat iteration with a queue (`Denque`).

### `core/schemaUtils.ts` — Schema Utilities

Type-system-agnostic functions for querying and transforming schemas:

- `getKnownFields()` — BFS traversal that collects all leaf field paths with their dominant types
- `simplifySchema()` — unwraps single-element `anyOf` arrays for cleaner output
- `getSchemaAtPath()` — navigate to a specific nesting level
- `getPropertyNamesAtLevel()` — list property names at a given path
- `buildFullPaths()` — construct dot-notated paths

### `json/` — JSON / CosmosDB NoSQL Analyzer

Provides a **functional API** for plain JSON documents:

- `getSchemaFromDocument(doc)` — single document
- `getSchemaFromDocuments(docs)` — batch with auto-simplification
- `updateSchemaWithDocument(schema, doc)` — incremental update

Uses `x-dataType` as the type extension key. Type inference handles JS primitives (`string`, `number`, `boolean`, `null`, `undefined`) plus `array` and `object`.

### `bson/` — BSON / MongoDB Analyzer

Provides a **class-based API** (`SchemaAnalyzer`) for MongoDB/DocumentDB documents:

- Incremental analysis with `addDocument()` / `addDocuments()`
- Version tracking for cache invalidation
- Cached `getKnownFields()` with lazy recomputation

Uses `x-bsonType` as the type extension key. Type inference handles 23+ BSON types including `ObjectId`, `Int32`, `Long`, `Double`, `Decimal128`, `Date`, `Binary`, `UUID`, `RegExp`, `Code`, `DBRef`, etc.

Key difference from JSON analyzer: enables `trackNestedObjectDocs` for accurate probability calculation in nested objects.

## Key Design Decisions

See [decisions.md](./decisions.md) for the full ADR log.
