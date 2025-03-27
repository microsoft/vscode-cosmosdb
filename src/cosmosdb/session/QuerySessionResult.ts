/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FeedResponse, type QueryMetrics } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import {
    type QueryResult,
    type QueryResultRecord,
    type ResultViewMetadata,
    type SerializedQueryResult,
} from '../types/queryResult';

export class QuerySessionResult {
    private readonly queryResults = new Map<number, QueryResult>();
    private readonly isFetchedAll: boolean;
    private readonly metadata: ResultViewMetadata;
    private readonly query: string;

    private hasMoreResults = false;

    constructor(query: string, metadata: ResultViewMetadata) {
        this.metadata = metadata;
        this.query = query;
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

    public getRecords(pageNumber: number): QueryResultRecord[] {
        return this.queryResults.get(pageNumber)?.records ?? [];
    }

    public push(response: FeedResponse<QueryResultRecord>): void {
        if (this.iterationsCount > 0 && this.isFetchedAll) {
            throw new Error(l10n.t('Cannot add more results after fetching all'));
        }

        const pageNumber = this.iterationsCount + 1;

        if (this.queryResults.has(pageNumber)) {
            throw new Error(l10n.t('Results for page {pageNumber} already exists', { pageNumber: `${pageNumber}` }));
        }

        this.queryResults.set(pageNumber, {
            activityId: response.activityId,
            records: response.resources,
            iteration: pageNumber,
            metadata: this.metadata,
            indexMetrics: response.indexMetrics,
            // Cosmos DB library has wrong type definition
            queryMetrics: (response.queryMetrics as unknown as QueryMetrics[])['0'],
            requestCharge: response.requestCharge,
            roundTrips: 1, // TODO: Is it required field? Query Pages Until Content Present
            hasMoreResults: response.hasMoreResults,
        });
        this.hasMoreResults = response.hasMoreResults;
    }

    public getResult(pageNumber: number): QueryResult | undefined {
        return this.queryResults.get(pageNumber);
    }

    public getSerializedResult(pageNumber: number): SerializedQueryResult | undefined {
        const result = this.queryResults.get(pageNumber);

        if (result) {
            const serializedResult: SerializedQueryResult = {
                activityId: result.activityId,
                records: result.records ?? [],
                iteration: result.iteration,
                metadata: this.metadata,
                indexMetrics: result.indexMetrics,
                requestCharge: result.requestCharge,
                roundTrips: result.roundTrips,
                hasMoreResults: result.hasMoreResults,

                query: this.query,
            };

            if (result.queryMetrics) {
                serializedResult.queryMetrics = {
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
                };
            }

            return serializedResult;
        }

        return undefined;
    }

    public dispose(): void {
        this.queryResults.clear();
    }
}
