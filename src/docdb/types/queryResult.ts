/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryMetrics } from '@azure/cosmos';

export type QueryResult = {
    activityId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documents: any[];
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documents: any[];
    iteration: number;
    metadata: ResultViewMetadata;
    queryMetrics: SerializedQueryMetrics;
    requestCharge: number;
    roundTrips: number;
};

export type ResultViewMetadata = {
    countPerPage?: number;
};
