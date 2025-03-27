/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONValue, type PartitionKey, type QueryMetrics } from '@azure/cosmos';

export const DEFAULT_PAGE_SIZE = 100 as const;
export const DEFAULT_EXECUTION_TIMEOUT = 600_000 as const; // 10 minutes (600 seconds)

// Record from the query result. Might have no fields if the query result is empty.
// NOTE: I've created the interface here for two reasons:
// 1. Avoid imports from the Cosmos DB SDK in the webview and other places.
// 2. Avoid `any` type in the code.
export interface QueryResultRecord {
    id?: string;
    [key: string]: JSONValue | undefined;
}

// Record with fields which exactly match the Cosmos DB record with service fields starting with "_".
export interface CosmosDBRecord {
    id: string; // This is the unique name that identifies the item, i.e. no two items can share the same id in partition. The id must not exceed 255 characters.

    _rid: string; // This is a system generated property. The resource ID (_rid) is a unique identifier that is also hierarchical per the resource stack on the resource model. It is used internally for placement and navigation of the item resource.
    _ts: number; // This is a system generated property. It specifies the last updated timestamp of the resource. The value is a timestamp.
    _self: string; // This is a system generated property. It is the unique addressable URI for the resource.
    _etag: string; // This is a system generated property that specifies the resource etag required for optimistic concurrency control.
    _attachments: string; // This is a system generated property that specifies the addressable path for the attachments' resource.

    [key: string]: JSONValue;
}

/**
 * Object that uniquely identifies an item in a Cosmos DB container.
 * _rid is the preferred way to identify an item.
 * If _rid is not available, use id and partitionKey to identify an item.
 * If partitionKey is not available, use only id.
 */
export type CosmosDBItemIdentifier = {
    id?: string;
    partitionKey?: PartitionKey;
    _rid?: string;
};

export type QueryResult = {
    activityId?: string;
    records: QueryResultRecord[];
    iteration: number;
    metadata: ResultViewMetadata;
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
    records: QueryResultRecord[];
    iteration: number;
    metadata: ResultViewMetadata;
    indexMetrics: string;
    queryMetrics?: SerializedQueryMetrics;
    requestCharge: number;
    roundTrips: number;
    hasMoreResults: boolean;

    query: string; // The query that was executed
};

export type ResultViewMetadata = {
    countPerPage?: number;
    timeout?: number; // How long the query is allowed to run in seconds
};
