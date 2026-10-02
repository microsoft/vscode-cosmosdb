/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module index
 *
 * Public API entry point for `@azure/cosmosdb-schema-analyzer`.
 *
 * Provides two sub-modules:
 * - `@azure/cosmosdb-schema-analyzer/json` — for JSON documents
 * - `@azure/cosmosdb-schema-analyzer/bson` — for BSON documents (no runtime `bson` or `mongodb` dependency)
 *
 * BSON 5, 6, and 7 wrappers are recognized by version markers and compatible shapes across module copies.
 * Consumers need a BSON library only to create or parse BSON values, not to run the analyzer.
 *
 * The shared `JSONSchema` type is re-exported from the root for convenience.
 *
 * @example
 * ```typescript
 * // JSON documents (no bson dependency needed)
 * import { getSchemaFromDocuments } from "@azure/cosmosdb-schema-analyzer/json";
 *
 * // BSON documents (no BSON library or MongoDB driver required by the analyzer)
 * import { SchemaAnalyzer } from "@azure/cosmosdb-schema-analyzer/bson";
 *
 * // Shared types
 * import { type JSONSchema } from "@azure/cosmosdb-schema-analyzer";
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
