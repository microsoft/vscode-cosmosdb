/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared test fixtures for the convertors test suite. Not a test file itself (no `*.test.ts`
 * suffix) so vitest does not pick it up as a suite.
 */

import { type SerializedQueryMetrics, type SerializedQueryResult } from '../../cosmosdb/types/queryResult';

/** Build a SerializedQueryResult with sensible defaults, overriding only what a test needs. */
export function makeResult(partial: Partial<SerializedQueryResult> = {}): SerializedQueryResult {
    return {
        documents: [],
        iteration: 1,
        metadata: {},
        indexMetrics: '',
        requestCharge: 0,
        roundTrips: 0,
        hasMoreResults: false,
        query: '',
        ...partial,
    };
}

/** Build a SerializedQueryMetrics with all-zero defaults. */
export function makeMetrics(partial: Partial<SerializedQueryMetrics> = {}): SerializedQueryMetrics {
    return {
        documentLoadTime: 0,
        documentWriteTime: 0,
        indexHitDocumentCount: 0,
        outputDocumentCount: 0,
        outputDocumentSize: 0,
        indexLookupTime: 0,
        retrievedDocumentCount: 0,
        retrievedDocumentSize: 0,
        vmExecutionTime: 0,
        runtimeExecutionTimes: {
            queryEngineExecutionTime: 0,
            systemFunctionExecutionTime: 0,
            userDefinedFunctionExecutionTime: 0,
        },
        totalQueryExecutionTime: 0,
        ...partial,
    };
}
