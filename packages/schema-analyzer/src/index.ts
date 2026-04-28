/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module index
 *
 * Public API entry point for `@cosmosdb/schema-analyzer`.
 *
 * Provides two sub-modules:
 * - `@cosmosdb/schema-analyzer/json` — for plain JSON / NoSQL documents
 * - `@cosmosdb/schema-analyzer/bson` — for MongoDB API / DocumentDB API documents (requires `mongodb` peer dependency)
 *
 * The shared `JSONSchema` type is re-exported from the root for convenience.
 *
 * @example
 * ```typescript
 * // JSON documents (no mongodb dependency needed)
 * import { getSchemaFromDocuments } from "@cosmosdb/schema-analyzer/json";
 *
 * // BSON documents (requires mongodb)
 * import { SchemaAnalyzer } from "@cosmosdb/schema-analyzer/bson";
 *
 * // Shared types
 * import { type JSONSchema } from "@cosmosdb/schema-analyzer";
 * ```
 */

// ── Shared JSON Schema types ───────────────────────────────────────────
export type { JSONSchema, JSONSchemaMap, JSONSchemaRef } from './JSONSchema.js';

// ── Shared core utilities ──────────────────────────────────────────────
export type { TypeAdapter } from './core/schemaTraversal.js';
export type { FieldEntry } from './core/schemaUtils.js';
export {
    buildFullPaths,
    getKnownFields,
    getPropertyNamesAtLevel,
    getSchemaAtPath,
    simplifySchema,
} from './core/schemaUtils.js';

