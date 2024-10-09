/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FeedResponse, type QueryMetrics } from '@azure/cosmos';
import {
    type QueryResult,
    type ResultViewMetadata,
    type SerializedQueryMetrics,
    type SerializedQueryResult,
} from '../types/queryResult';

export class QuerySessionResult {
    private readonly queryResults = new Map<number, QueryResult>();
    private readonly isFetchedAll: boolean;
    private readonly metadata: ResultViewMetadata;

    private hasMoreResults = false;

    constructor(metadata: ResultViewMetadata) {
        this.metadata = metadata;
        this.isFetchedAll = metadata.countPerPage === -1;
    }

    public get iterationsCount(): number {
        return this.queryResults.size;
    }

    public get hasMore(): boolean {
        return this.hasMoreResults;
    }

    public getQueryMetrics(pageNumber: number): QueryMetrics | undefined {
        return this.queryResults.get(pageNumber)?.queryMetrics;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getDocuments(pageNumber: number): any[] {
        return this.queryResults.get(pageNumber)?.documents ?? [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public push(response: FeedResponse<any>): void {
        if (this.iterationsCount > 0 && this.isFetchedAll) {
            throw new Error('Cannot add more results after fetching all');
        }

        const pageNumber = this.iterationsCount + 1;

        if (this.queryResults.has(pageNumber)) {
            throw new Error(`Results for page ${pageNumber} already exists`);
        }

        this.queryResults.set(pageNumber, {
            activityId: response.activityId,
            documents: response.resources,
            iteration: pageNumber,
            metadata: this.metadata,
            // CosmosDB library has wrong type definition
            queryMetrics: (response.queryMetrics as unknown as QueryMetrics[])['0'],
            requestCharge: response.requestCharge,
            roundTrips: 1, // TODO: Is it required field? Query Pages Until Content Present
        });
        this.hasMoreResults = response.hasMoreResults;
    }

    public getResult(pageNumber: number): QueryResult | undefined {
        return this.queryResults.get(pageNumber);
    }

    public getSerializedResult(pageNumber: number): SerializedQueryResult | undefined {
        const result = this.queryResults.get(pageNumber);

        if (result) {
            return {
                activityId: result.activityId,
                documents: result.documents ?? [],
                iteration: result.iteration,
                metadata: this.metadata,
                queryMetrics: {
                    documentLoadTime: result.queryMetrics.documentLoadTime.totalMilliseconds(),
                    documentWriteTime: result.queryMetrics.documentWriteTime.totalMilliseconds(),
                    indexHitDocumentCount: result.queryMetrics.indexHitDocumentCount,
                    outputDocumentCount: result.queryMetrics.outputDocumentCount,
                    outputDocumentSize: result.queryMetrics.outputDocumentSize,
                    indexLookupTime: result.queryMetrics.indexLookupTime.totalMilliseconds(),
                    retrievedDocumentCount: result.queryMetrics.retrievedDocumentCount,
                    retrievedDocumentSize: result.queryMetrics.retrievedDocumentSize,
                    vmExecutionTime: result.queryMetrics.vmExecutionTime.totalMilliseconds(),
                    runtimeExecutionTimes: {
                        queryEngineExecutionTime:
                            result.queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime.totalMilliseconds(),
                        systemFunctionExecutionTime:
                            result.queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime.totalMilliseconds(),
                        userDefinedFunctionExecutionTime:
                            result.queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime.totalMilliseconds(),
                    },
                    totalQueryExecutionTime: result.queryMetrics.totalQueryExecutionTime.totalMilliseconds(),
                } as SerializedQueryMetrics,
                requestCharge: result.requestCharge,
                roundTrips: result.roundTrips,
            } as SerializedQueryResult;
        }

        return undefined;
    }

    public dispose(): void {
        this.queryResults.clear();
    }
}
