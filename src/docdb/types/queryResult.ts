/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue, type PartitionKey, type QueryMetrics } from '@azure/cosmos';

export const DEFAULT_PAGE_SIZE = 100 as const;
export const DEFAULT_EXECUTION_TIMEOUT = 600_000 as const; // 10 minutes (600 seconds)

export interface CosmosDbRecord extends ItemDefinition {
    id: string; // This is the unique name that identifies the document, i.e. no two documents can share the same id in partition. The id must not exceed 255 characters.

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    ttl?: number; // Time to live in seconds for collections with TTL enabled

    _rid: string; // This is a system generated property. The resource ID (_rid) is a unique identifier that is also hierarchical per the resource stack on the resource model. It is used internally for placement and navigation of the document resource.
    _ts: number; // This is a system generated property. It specifies the last updated timestamp of the resource. The value is a timestamp.
    _self: string; // This is a system generated property. It is the unique addressable URI for the resource.
    _etag: string; // This is a system generated property that specifies the resource etag required for optimistic concurrency control.
    _attachments: string; // This is a system generated property that specifies the addressable path for the attachments resource.

    [key: string]: JSONValue;
}

/**
 * Object that uniquely identifies a document in a Cosmos DB container.
 * _rid is the preferred way to identify a document.
 * If _rid is not available, use id and partitionKey to identify a document.
 * If partitionKey is not available, use only id.
 */
export type CosmosDbRecordIdentifier = {
    id?: string;
    partitionKey?: PartitionKey;
    _rid?: string;
};

export type QueryResult = {
    activityId?: string;
    documents: CosmosDbRecord[];
    iteration: number;
    metadata: ResultViewMetadata;
    queryMetrics: QueryMetrics;
    requestCharge: number;
    roundTrips: number;
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
    documents: CosmosDbRecord[];
    iteration: number;
    metadata: ResultViewMetadata;
    queryMetrics: SerializedQueryMetrics;
    requestCharge: number;
    roundTrips: number;
};

export type ResultViewMetadata = {
    countPerPage?: number;
    timeout?: number; // How long the query is allowed to run in seconds
};
