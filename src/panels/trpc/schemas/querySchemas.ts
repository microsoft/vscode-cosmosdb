/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type QueryExecutionResult } from '../../../cosmosdb/session/QuerySession';
import { type CosmosDBRecordIdentifier, type SerializedQueryResult } from '../../../cosmosdb/types/queryResult';

// ─── Primitive JSON value ────────────────────────────────────────────────────

/**
 * Matches the `JSONValue` type from `@azure/cosmos`.
 * Allows string, number, boolean, null, arrays, and nested objects.
 *
 * Uses z.lazy for the recursive definition.
 */
export const JSONValueSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(JSONValueSchema),
        z.record(z.string(), JSONValueSchema),
    ]),
);

// ─── QueryResultRecord ──────────────────────────────────────────────────────

/**
 * Matches `QueryResultRecord` (extends `ItemDefinition`).
 * Open-ended record with arbitrary JSON values.
 */
export const QueryResultRecordSchema = z.record(z.string(), JSONValueSchema.optional());

// ─── CosmosDBRecord ─────────────────────────────────────────────────────────

/**
 * Matches the `CosmosDBRecord` type — a full document with system-generated fields.
 */
export const CosmosDBRecordSchema = z
    .object({
        id: z.string(),
        _rid: z.string(),
        _ts: z.number(),
        _self: z.string(),
        _etag: z.string(),
        _attachments: z.string(),
    })
    .catchall(JSONValueSchema);

// ─── CosmosDBRecordIdentifier ───────────────────────────────────────────────

/**
 * Matches `CosmosDBRecordIdentifier` — the minimal set of fields to identify
 * a document.
 *
 * Cast to `z.ZodType<CosmosDBRecordIdentifier>` so that `z.infer` produces
 * the exact same type, eliminating `as never` casts in client-side tRPC calls.
 */
export const CosmosDBRecordIdentifierSchema = z.object({
    id: z.string().optional(),
    partitionKey: z
        .union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.undefined(),
            z.array(z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])),
            z.object({}), // NonePartitionKeyType from @azure/cosmos
        ])
        .optional(),
    _rid: z.string().optional(),
}) as unknown as z.ZodType<CosmosDBRecordIdentifier>;

// ─── SerializedQueryMetrics ─────────────────────────────────────────────────

export const SerializedQueryMetricsSchema = z.object({
    documentLoadTime: z.number(),
    documentWriteTime: z.number(),
    indexHitDocumentCount: z.number(),
    outputDocumentCount: z.number(),
    outputDocumentSize: z.number(),
    indexLookupTime: z.number(),
    retrievedDocumentCount: z.number(),
    retrievedDocumentSize: z.number(),
    vmExecutionTime: z.number(),
    runtimeExecutionTimes: z.object({
        queryEngineExecutionTime: z.number(),
        systemFunctionExecutionTime: z.number(),
        userDefinedFunctionExecutionTime: z.number(),
    }),
    totalQueryExecutionTime: z.number(),
});

// ─── QueryMetadata ──────────────────────────────────────────────────────────

export const QueryMetadataSchema = z.object({
    sessionId: z.string().optional(),
    countPerPage: z.number().optional(),
    timeout: z.number().optional(),
    throughputBucket: z.number().optional(),
});

// ─── SerializedQueryResult ──────────────────────────────────────────────────

/**
 * Cast to `z.ZodType<SerializedQueryResult>` so that `z.infer` produces
 * the exact same type, eliminating `as never` casts in client-side tRPC calls.
 */
export const SerializedQueryResultSchema = z.object({
    activityId: z.string().optional(),
    documents: z.array(QueryResultRecordSchema),
    iteration: z.number(),
    metadata: QueryMetadataSchema,
    indexMetrics: z.string(),
    queryMetrics: SerializedQueryMetricsSchema.optional(),
    requestCharge: z.number(),
    roundTrips: z.number(),
    hasMoreResults: z.boolean(),
    query: z.string(),
}) as unknown as z.ZodType<SerializedQueryResult>;

export const QueryExecutionResultSchema = z.object({
    executionId: z.string(),
    startTime: z.number(),
    endTime: z.number(),
    result: SerializedQueryResultSchema.nullable(),
    currentPage: z.number(),
    error: z.string().optional(),
}) as unknown as z.ZodType<QueryExecutionResult>;
