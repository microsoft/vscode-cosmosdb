/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbortError, ErrorResponse, TimeoutError, type QueryIterator } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { CosmosDbOperationsService } from '../../chat';
import { ext } from '../../extensionVariables';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { getCosmosDBKeyCredential } from '../CosmosDBCredential';
import { getCosmosClient } from '../getCosmosClient';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import {
    DEFAULT_EXECUTION_TIMEOUT,
    DEFAULT_PAGE_SIZE,
    type QueryMetadata,
    type QueryResultRecord,
    type SerializedQueryResult,
} from '../types/queryResult';
import { QuerySessionResult } from './QuerySessionResult';

/**
 * Result of a query execution operation (run, nextPage, prevPage, firstPage).
 */
export type QueryExecutionResult = {
    executionId: string;
    startTime: number;
    endTime: number;
    result: SerializedQueryResult | null;
    currentPage: number;
    error?: string;
};

export class QuerySession {
    public readonly id: string;
    private readonly connection: NoSqlQueryConnection;
    private readonly databaseId: string;
    private readonly containerId: string;
    private readonly resultViewMetadata: QueryMetadata = {};
    private readonly query: string;
    // For telemetry
    private readonly endpoint: string;
    private readonly masterKey: string;

    public readonly sessionResult: QuerySessionResult;

    private abortController: AbortController | null = null;
    private iterator: QueryIterator<QueryResultRecord> | null = null;
    private currentIteration = 0;
    private _isDisposed = false;

    constructor(connection: NoSqlQueryConnection, query: string, resultViewMetadata: QueryMetadata) {
        const { databaseId, containerId, endpoint, credentials } = connection;

        this.id = uuid();
        this.connection = connection;
        this.databaseId = databaseId;
        this.containerId = containerId;
        this.endpoint = endpoint;
        this.masterKey = getCosmosDBKeyCredential(credentials)?.key ?? '';
        this.resultViewMetadata = resultViewMetadata;
        this.query = query;

        this.sessionResult = new QuerySessionResult(this.query, resultViewMetadata);
    }

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    public async run(): Promise<QueryExecutionResult> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.queryEditor.session.run',
            async (context) => {
                context.errorHandling.rethrow = true;
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
                }

                if (this.iterator) {
                    throw new Error(l10n.t('Session is already running'));
                }

                const isFetchAll = this.resultViewMetadata.countPerPage === -1;

                try {
                    this.abortController = new AbortController();

                    // TODO: This is a read operation, so it should not require claims challenge handling (need to verify)
                    const client = getCosmosClient(this.connection, {
                        connectionPolicy: {
                            requestTimeout: this.resultViewMetadata.timeout ?? DEFAULT_EXECUTION_TIMEOUT,
                        },
                        throughputBucket: this.resultViewMetadata.throughputBucket,
                    });

                    this.iterator = client
                        .database(this.databaseId)
                        .container(this.containerId)
                        .items.query<QueryResultRecord>(this.query, {
                            abortSignal: this.abortController.signal,
                            populateQueryMetrics: true,
                            populateIndexMetrics: true,
                            maxItemCount: isFetchAll
                                ? undefined
                                : (this.resultViewMetadata?.countPerPage ?? DEFAULT_PAGE_SIZE),
                            maxDegreeOfParallelism: 1000,
                            bufferItems: true,
                            forceQueryPlan: true,
                        });

                    if (this.resultViewMetadata.countPerPage === -1) {
                        return await this.executeFetch(context, async () => {
                            const response = await this.iterator!.fetchAll();
                            this.sessionResult.push(response);
                            this.currentIteration++;
                        });
                    } else {
                        return await this.executeFetch(context, async () => {
                            if (this.currentIteration + 1 > this.sessionResult.iterationsCount) {
                                const response = await this.iterator!.fetchNext();
                                this.sessionResult.push(response);
                            }
                            this.currentIteration++;
                        });
                    }
                } catch (error) {
                    return this.buildErrorResult(error, context);
                }
            },
        );

        return result ?? this.buildFallbackError();
    }

    public async nextPage(): Promise<QueryExecutionResult> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.queryEditor.session.nextPage',
            async (context) => {
                context.errorHandling.rethrow = true;
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
                }

                if (!this.iterator) {
                    throw new Error(l10n.t('Session is not running! Please run the session first'));
                }

                if (this.resultViewMetadata.countPerPage === -1) {
                    throw new Error(l10n.t('Cannot fetch next page if all records have been fetched before'));
                }

                if (this.sessionResult.getResult(this.currentIteration)?.hasMoreResults === false) {
                    throw new Error(l10n.t('Cannot fetch next page if current page is the last page'));
                }

                return this.executeFetch(context, async () => {
                    if (this.currentIteration + 1 > this.sessionResult.iterationsCount) {
                        const response = await this.iterator!.fetchNext();
                        this.sessionResult.push(response);
                    }

                    this.currentIteration++;
                });
            },
        );

        return result ?? this.buildFallbackError();
    }

    public async prevPage(): Promise<QueryExecutionResult> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.queryEditor.session.prevPage',
            async (context) => {
                context.errorHandling.rethrow = true;
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
                }

                if (!this.iterator) {
                    throw new Error(l10n.t('Session is not running! Please run the session first'));
                }

                if (this.resultViewMetadata.countPerPage === -1) {
                    throw new Error(l10n.t('Cannot fetch previous page if all records have been fetched before'));
                }

                if (this.currentIteration - 1 <= 0) {
                    throw new Error(l10n.t('Cannot fetch previous page if current page is the first page'));
                }

                return this.executeFetch(context, async () => {
                    this.currentIteration--;
                });
            },
        );

        return result ?? this.buildFallbackError();
    }

    public async firstPage(): Promise<QueryExecutionResult> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.nosql.queryEditor.session.firstPage',
            async (context) => {
                context.errorHandling.rethrow = true;
                this.setTelemetryProperties(context);

                if (this.isDisposed) {
                    throw new Error(l10n.t('Session is disposed'));
                }

                if (!this.iterator) {
                    throw new Error(l10n.t('Session is not running! Please run the session first'));
                }

                return this.executeFetch(context, async () => {
                    this.currentIteration = 1;
                });
            },
        );

        return result ?? this.buildFallbackError();
    }

    public stop(): { executionId: string; endTime: number } {
        if (this.isDisposed) {
            throw new Error(l10n.t('Session is disposed'));
        }

        try {
            this.abortController?.abort();
        } finally {
            this.iterator = null;
        }

        return { executionId: this.id, endTime: Date.now() };
    }

    public dispose(): void {
        this._isDisposed = true;
        this.abortController?.abort();
    }

    private async executeFetch(context: IActionContext, action: () => Promise<void>): Promise<QueryExecutionResult> {
        const startTime = Date.now();
        try {
            await action();

            const serializedResult = this.sessionResult.getSerializedResult(this.currentIteration);

            // Record query execution to in-memory history for AI context
            if (serializedResult) {
                CosmosDbOperationsService.getInstance().recordQueryExecution(
                    this.connection.accountId,
                    this.databaseId,
                    this.containerId,
                    serializedResult,
                );
            }

            return {
                executionId: this.id,
                startTime,
                endTime: Date.now(),
                result: serializedResult ?? null,
                currentPage: this.currentIteration,
            };
        } catch (error) {
            return this.buildErrorResult(error, context, startTime);
        }
    }

    private buildErrorResult(error: unknown, context: IActionContext, startTime?: number): QueryExecutionResult {
        const now = Date.now();
        const errorMessage = this.getQueryErrorMessage(error, context);

        this.showError(errorMessage);

        return {
            executionId: this.id,
            startTime: startTime ?? now,
            endTime: now,
            result: null,
            currentPage: this.currentIteration,
            error: errorMessage,
        };
    }

    private buildFallbackError(): QueryExecutionResult {
        const now = Date.now();
        return {
            executionId: this.id,
            startTime: now,
            endTime: now,
            result: null,
            currentPage: this.currentIteration,
            error: l10n.t('Query execution failed'),
        };
    }

    private getQueryErrorMessage(error: unknown, context: IActionContext): string {
        const isObject = error && typeof error === 'object';
        if (error instanceof ErrorResponse) {
            const code: string = `${error.code ?? 'Unknown'}`;
            return error.body?.message ?? l10n.t('Query failed with status code {0}', code);
        } else if (error instanceof TimeoutError) {
            return l10n.t('Query timed out');
        } else if (error instanceof AbortError || (isObject && 'name' in error && error.name === 'AbortError')) {
            return l10n.t('Query was aborted');
        } else {
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            return getErrorMessage(error);
        }
    }

    private showError(message: string): void {
        ext.outputChannel.error(message);
        vscode.window.showErrorMessage(message, l10n.t('Go to output')).then((result) => {
            if (result) {
                ext.outputChannel.show();
            }
        });
    }

    private setTelemetryProperties(context: IActionContext): void {
        context.valuesToMask.push(this.query, this.masterKey, this.endpoint, this.databaseId, this.containerId);

        context.errorHandling.suppressDisplay = true;
        context.errorHandling.suppressReportIssue = true;

        context.telemetry.properties.sessionId = this.id;
        context.telemetry.properties.query = crypto.createHash('sha256').update(this.query).digest('hex');
        context.telemetry.properties.databaseId = crypto.createHash('sha256').update(this.databaseId).digest('hex');
        context.telemetry.properties.containerId = crypto.createHash('sha256').update(this.containerId).digest('hex');
        context.telemetry.properties.countPerPage = this.resultViewMetadata?.countPerPage?.toString() ?? '';
    }
}
