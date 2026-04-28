/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ItemDefinition,
    type JSONObject,
    type JSONValue,
    type PartitionKey,
    type PartitionKeyDefinition,
    type QueryMetrics,
} from '@azure/cosmos';
import { isJSONObject } from 'es-toolkit';

export const DEFAULT_PAGE_SIZE = 100 as const;
export const DEFAULT_EXECUTION_TIMEOUT = 600_000 as const; // 10 minutes (600 seconds)

// Record from the query result. Might have no fields if the query result is empty.
// NOTE: I've created the interface here for two reasons:
// 1. Avoid imports from the Cosmos DB SDK in the webview and other places.
// 2. Avoid `any` type in the code.
export type QueryResultRecord = JSONValue;

// Record with fields which exactly match the Cosmos DB record with service fields starting with "_".
export interface CosmosDBRecord extends ItemDefinition {
    id: string; // This is the unique name that identifies the document, i.e. no two documents can share the same id in partition. The id must not exceed 255 characters.

    _rid: string; // This is a system generated property. The resource ID (_rid) is a unique identifier that is also hierarchical per the resource stack on the resource model. It is used internally for placement and navigation of the document resource.
    _ts: number; // This is a system generated property. It specifies the last updated timestamp of the resource. The value is a timestamp.
    _self: string; // This is a system generated property. It is the unique addressable URI for the resource.
    _etag: string; // This is a system generated property that specifies the resource etag required for optimistic concurrency control.
    _attachments: string; // This is a system generated property that specifies the addressable path for the attachments resource.

    [key: string]: JSONValue | undefined;
}

/**
 * Object that uniquely identifies a document in a Cosmos DB container.
 * _rid is the preferred way to identify a document.
 * If _rid is not available, use id and partitionKey to identify a document.
 * If partitionKey is not available, use only id.
 */
export type CosmosDBRecordIdentifier = {
    id?: string;
    partitionKey?: PartitionKey;
    _rid?: string;
};

/**
 * Type guard: returns true when a value has enough fields to be used as a
 * Cosmos DB document identifier:
 * - a non-empty `_rid` string is sufficient on its own (_rid encodes location
 *   globally and does not require a partition key), OR
 * - a non-empty `id` string AND, if `partitionKey` is provided, all partition
 *   key paths must exist in the object.
 */
export function isCosmosDBRecordIdentifier(
    value: unknown,
    partitionKey?: PartitionKeyDefinition,
): value is CosmosDBRecordIdentifier {
    if (!isJSONObject(value)) return false;

    // _rid is globally unique — no partition key needed
    if (typeof value['_rid'] === 'string' && value['_rid'].length > 0) return true;

    // Without _rid, need at least a non-empty id
    if (!(typeof value['id'] === 'string' && value['id'].length > 0)) return false;

    // If a partition key definition is provided, verify every path exists in the object
    if (partitionKey) {
        for (const path of partitionKey.paths) {
            const parts = path.split('/').filter((p) => p !== '');
            let current: JSONValue = value;
            let found = true;

            for (const part of parts) {
                if (current !== null && typeof current === 'object' && !Array.isArray(current) && part in current) {
                    current = (current as JSONObject)[part];
                } else {
                    found = false;
                    break;
                }
            }

            if (!found) return false;
        }
    }

    return true;
}

/**
 * Type guard: returns true when a value looks like a full Cosmos DB document,
 * i.e. it has all mandatory system-generated fields (`id`, `_rid`, `_ts`,
 * `_self`, `_etag`, `_attachments`).
 */
export function isCosmosDBRecord(value: unknown): value is CosmosDBRecord {
    if (!isJSONObject(value)) return false;

    return (
        typeof value['id'] === 'string' &&
        typeof value['_rid'] === 'string' &&
        typeof value['_ts'] === 'number' &&
        typeof value['_self'] === 'string' &&
        typeof value['_etag'] === 'string' &&
        typeof value['_attachments'] === 'string'
    );
}

export type QueryResult = {
    activityId?: string;
    documents: QueryResultRecord[];
    iteration: number;
    metadata: QueryMetadata;
    indexMetrics: string;
    queryMetrics?: QueryMetrics;
    requestCharge: number;
    roundTrips: number;
    hasMoreResults: boolean;
};

export type SerializedQueryMetrics = {
    documentLoadTime: number;
    documentWriteTime: number;
    indexHitDocumentCount: number;
    outputDocumentCount: number;
    outputDocumentSize: number;
    indexLookupTime: number;
    retrievedDocumentCount: number;
    retrievedDocumentSize: number;
    vmExecutionTime: number;
    runtimeExecutionTimes: {
        queryEngineExecutionTime: number;
        systemFunctionExecutionTime: number;
        userDefinedFunctionExecutionTime: number;
    };
    totalQueryExecutionTime: number;
};

export type SerializedQueryResult = {
    activityId?: string;
    documents: QueryResultRecord[];
    iteration: number;
    metadata: QueryMetadata;
    indexMetrics: string;
    queryMetrics?: SerializedQueryMetrics;
    requestCharge: number;
    roundTrips: number;
    hasMoreResults: boolean;

    query: string; // The query that was executed
};

export type QueryMetadata = {
    sessionId?: string; // The session ID for the query, if specified, used for take the same session for subsequent queries
    countPerPage?: number;
    timeout?: number; // How long the query is allowed to run in seconds
    throughputBucket?: number; // The throughput bucket selected by the user
};
