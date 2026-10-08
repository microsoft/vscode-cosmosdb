/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders } from '@azure/core-rest-pipeline';
import {
    LogsQueryClient,
    LogsQueryResultStatus,
    type LogsQueryResult,
    type LogsTable,
} from '@azure/monitor-query-logs';
import { describe, expect, it, vi } from 'vitest';
import {
    classifyLogsError,
    cleanQueryText,
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    logWindow,
    probeCdbLogs,
    tableToRecords,
    type LogsQueryExecutor,
    type LogsTimespan,
} from './logs';
import { LogsFetchError, type LogsDiagnostic, type LogsOperation } from './logsDiagnostics';

const RESOURCE = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/acct';
const SPAN: LogsTimespan = logWindow(Date.parse('2024-01-02T00:00:00Z'));

/** An Error subclass carrying the SDK-style `code`/`statusCode` fields the classifier inspects. */
function sdkError(props: { code?: string; statusCode?: number; message?: string }): Error {
    return Object.assign(new Error(props.message ?? 'error'), props);
}

/** Builds a `LogsTable` from a header row + data rows. */
function table(columns: string[], rows: unknown[][]): LogsTable {
    return {
        name: 'PrimaryResult',
        columnDescriptors: columns.map((name) => ({ name, type: 'string' })),
        rows,
    } as unknown as LogsTable;
}

/** A fully-successful `LogsQueryResult` carrying a single table. */
function success(t: LogsTable): LogsQueryResult {
    return { status: 'Success', tables: [t] } as unknown as LogsQueryResult;
}

/** An executor that answers each query by matching a substring of the KQL against a canned table. */
function executorByQuery(map: { match: string; table: LogsTable }[]): LogsQueryExecutor {
    return {
        queryResource(_resourceId: string, query: string): Promise<LogsQueryResult> {
            const hit = map.find((m) => query.includes(m.match));
            return Promise.resolve(success(hit ? hit.table : table([], [])));
        },
    };
}

describe('tableToRecords', () => {
    it('maps each row into a column → cell record', () => {
        const records = tableToRecords(table(['QueryText', 'executions'], [['SELECT 1', 42]]));
        expect(records).toEqual([{ QueryText: 'SELECT 1', executions: 42 }]);
    });

    it('returns an empty array for a missing table', () => {
        expect(tableToRecords(undefined)).toEqual([]);
    });
});

describe('classifyLogsError', () => {
    it('maps a missing-table semantic error to logAnalyticsDisabled', () => {
        const err = {
            code: 'SemanticError',
            message: "Failed to resolve table or column expression named 'CDBDataPlaneRequests'",
        };
        expect(classifyLogsError(err)).toBe('logAnalyticsDisabled');
    });

    it('maps a BadArgument error naming a CDB table to logAnalyticsDisabled', () => {
        expect(classifyLogsError({ code: 'BadArgument', message: 'CDBQueryRuntimeStatistics not found' })).toBe(
            'logAnalyticsDisabled',
        );
    });

    it('maps a 403 to rbac', () => {
        expect(classifyLogsError({ statusCode: 403, message: 'Forbidden' })).toBe('rbac');
    });

    it('recognizes authorization failures inside a Log Analytics error envelope', () => {
        expect(
            classifyLogsError({
                code: 'PartialError',
                details: [{ code: 'InsufficientAccessError', message: 'Insufficient access to query the resource.' }],
            }),
        ).toBe('rbac');
    });

    it('does not label a query syntax or column error as disabled Log Analytics', () => {
        expect(
            classifyLogsError({
                code: 'BadArgumentError',
                message: 'The request had some invalid properties',
                innererror: {
                    code: 'SemanticError',
                    message: "Failed to resolve scalar expression named 'MissingColumn'",
                },
            }),
        ).not.toBe('logAnalyticsDisabled');
    });

    it('degrades anything else to noData', () => {
        expect(classifyLogsError({ statusCode: 503, message: 'Service unavailable' })).toBe('noData');
        expect(classifyLogsError(new Error('socket hang up'))).toBe('noData');
    });
});

describe('probeCdbLogs', () => {
    it.each(['CDBDataPlaneRequests', 'CDBQueryRuntimeStatistics'] as const)(
        'probes only the schema of %s using the normalized Cosmos ARM resource ID',
        async (tableName) => {
            const queryResource = vi.fn().mockResolvedValue(success(table(['x'], [])));
            const onDiagnostic = vi.fn();
            await expect(
                probeCdbLogs({ queryResource }, RESOURCE, SPAN, { table: tableName, onDiagnostic }),
            ).resolves.toEqual({ available: true });
            expect(queryResource).toHaveBeenCalledExactlyOnceWith(RESOURCE.slice(1), `${tableName} | take 0`, SPAN);
            expect(onDiagnostic).not.toHaveBeenCalled();
        },
    );

    it('reports available when the probe query succeeds (even with zero rows)', async () => {
        const executor: LogsQueryExecutor = {
            queryResource: () => Promise.resolve(success(table(['x'], []))),
        };
        await expect(probeCdbLogs(executor, RESOURCE, SPAN)).resolves.toEqual({ available: true });
    });

    it('classifies a missing-table failure as logAnalyticsDisabled', async () => {
        const executor: LogsQueryExecutor = {
            queryResource: () =>
                Promise.reject(
                    sdkError({ code: 'SemanticError', message: 'Failed to resolve table CDBDataPlaneRequests' }),
                ),
        };
        await expect(probeCdbLogs(executor, RESOURCE, SPAN)).resolves.toEqual({
            available: false,
            reason: 'logAnalyticsDisabled',
        });
    });

    it('classifies a 403 as rbac', async () => {
        const executor: LogsQueryExecutor = {
            queryResource: () => Promise.reject(sdkError({ statusCode: 403 })),
        };
        await expect(probeCdbLogs(executor, RESOURCE, SPAN)).resolves.toEqual({ available: false, reason: 'rbac' });
    });

    it('does not report a partial authorization failure as a successful probe', async () => {
        const executor: LogsQueryExecutor = {
            queryResource: async () => ({
                status: LogsQueryResultStatus.PartialFailure,
                partialTables: [],
                partialError: {
                    code: 'InsufficientAccessError',
                    message: 'Insufficient access to query the resource.',
                },
            }),
        };
        await expect(probeCdbLogs(executor, RESOURCE, SPAN)).resolves.toMatchObject({
            available: false,
            reason: 'rbac',
        });
    });

    it('defaults to the data-plane schema and reports a partial error even with rows', async () => {
        const queryResource = vi.fn().mockResolvedValue({
            status: 'PartialFailure',
            partialTables: [table(['document'], [['PRIVATE_DOCUMENT']])],
            partialError: { code: 'PartialError', message: 'Query exceeded its memory limit.' },
        });
        const onDiagnostic = vi.fn();
        await expect(probeCdbLogs({ queryResource }, RESOURCE, SPAN, { onDiagnostic })).resolves.toEqual({
            available: false,
            reason: 'noData',
        });
        expect(queryResource).toHaveBeenCalledExactlyOnceWith(RESOURCE.slice(1), 'CDBDataPlaneRequests | take 0', SPAN);
        expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                operation: 'probeDataPlane',
                kind: 'partialFailure',
                codes: ['PartialError'],
                messages: ['Query exceeded its memory limit.'],
            }),
        );
        expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('PRIVATE_DOCUMENT');
    });

    it.each([undefined, {}, { status: 'Success', tables: [] }, { status: 'Success', tables: [{}] }])(
        'does not report malformed results as available: %j',
        async (result) => {
            const onDiagnostic = vi.fn();
            await expect(
                probeCdbLogs({ queryResource: vi.fn().mockResolvedValue(result) }, RESOURCE, SPAN, {
                    onDiagnostic,
                }),
            ).resolves.toEqual({ available: false, reason: 'noData' });
            expect(onDiagnostic).toHaveBeenCalledOnce();
            expect(onDiagnostic.mock.calls[0][0].messages).toEqual(['Log query returned no valid result table.']);
        },
    );
});

describe('cleanQueryText', () => {
    it('unwraps the JSON envelope and collapses whitespace', () => {
        expect(cleanQueryText('{"query":"SELECT  *\\n  FROM c","parameters":[]}')).toBe('SELECT * FROM c');
    });

    it('passes through a raw (non-JSON) query, collapsing whitespace', () => {
        expect(cleanQueryText('SELECT   *\t FROM c')).toBe('SELECT * FROM c');
    });
});

describe('fetchCrossPartitionShapes', () => {
    it.each([
        table(['QueryText', 'executions', 'avgFanout', 'maxFanout'], [['SELECT p1', 1000, 100]]),
        table(['QueryText', 'executions', 'avgFanout'], [['SELECT p1', 1000, 100]]),
    ])('rejects incomplete rows and schemas instead of fabricating zero counts', async (resultTable) => {
        const onDiagnostic = vi.fn();
        await expect(
            fetchCrossPartitionShapes(
                { queryResource: async () => success(resultTable) },
                RESOURCE,
                'db',
                'coll',
                SPAN,
                onDiagnostic,
            ),
        ).rejects.toMatchObject({ name: 'LogsFetchError', reason: 'noData' });
        expect(onDiagnostic).toHaveBeenCalledOnce();
    });

    it('uses only the first successful table and emits no diagnostics', async () => {
        const onDiagnostic = vi.fn();
        const executor: LogsQueryExecutor = {
            queryResource: async () =>
                ({
                    status: 'Success',
                    tables: [
                        table([], []),
                        table(['QueryText', 'executions', 'avgFanout', 'maxFanout'], [['ignored', 1, 1, 1]]),
                    ],
                }) as unknown as LogsQueryResult,
        };
        await expect(
            fetchCrossPartitionShapes(executor, RESOURCE, 'db', 'coll', SPAN, onDiagnostic),
        ).resolves.toMatchObject({
            shapes: [],
        });
        expect(onDiagnostic).not.toHaveBeenCalled();
    });

    it('maps rows into query shapes and drops empty QueryText', async () => {
        const executor = executorByQuery([
            {
                match: 'CDBQueryRuntimeStatistics',
                table: table(
                    ['QueryText', 'executions', 'avgFanout', 'maxFanout'],
                    [
                        ['{"query":"SELECT * FROM c WHERE c.email=@e"}', 800, 2.0, 2],
                        ['SELECT * FROM c WHERE c.pk=@p', 200, 1.0, 1],
                        ['', 5, 1.0, 1],
                    ],
                ),
            },
        ]);
        const result = await fetchCrossPartitionShapes(executor, RESOURCE, 'db', 'orders', SPAN);
        expect(result).toMatchObject({ databaseId: 'db', containerId: 'orders' });
        expect(result.shapes).toEqual([
            { text: 'SELECT * FROM c WHERE c.email=@e', executions: 800, avgFanout: 2.0, maxFanout: 2 },
            { text: 'SELECT * FROM c WHERE c.pk=@p', executions: 200, avgFanout: 1.0, maxFanout: 1 },
        ]);
    });

    it('sanitizes database/container names into the KQL literal', async () => {
        let seen = '';
        const executor: LogsQueryExecutor = {
            queryResource: (_r, query) => {
                seen = query;
                return Promise.resolve(success(table([], [])));
            },
        };
        await fetchCrossPartitionShapes(executor, RESOURCE, "db'; drop", "coll'x", SPAN);
        expect(seen).toContain("DatabaseName == 'db; drop'");
        expect(seen).toContain("CollectionName == 'collx'");
    });
});

describe('fetchUncontrolledIngestion', () => {
    it('waits for all failed queries to report before rejecting the batch', async () => {
        let rejectBurst!: (reason: unknown) => void;
        const burst = new Promise<LogsQueryResult>((_resolve, reject) => {
            rejectBurst = reject;
        });
        const onDiagnostic = vi.fn();
        const executor: LogsQueryExecutor = {
            queryResource: async (_resourceId, query) => {
                if (query.includes('peak =')) {
                    return burst;
                }
                throw sdkError({ code: 'Forbidden' });
            },
        };
        let settled = false;
        const result = fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'coll', SPAN, onDiagnostic);
        const observed = result.catch(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledTimes(2));
        expect(settled).toBe(false);
        rejectBurst({ code: 'TimeoutError' });
        await observed;
        expect(onDiagnostic).toHaveBeenCalledTimes(3);
        expect(
            onDiagnostic.mock.calls.map(([diagnostic]) => diagnostic.operation).sort((a, b) => a.localeCompare(b)),
        ).toEqual(['ingestionBurst', 'ingestionSummary', 'ingestionUserAgent']);
    });

    it('folds the agg/burst/ua queries into the ingestion input', async () => {
        const executor = executorByQuery([
            {
                match: 'countif(StatusCode == 429)',
                table: table(['totalRu', 'writeRu', 'reqs', 'throttles'], [[1_000_000, 950_000, 300_000, 75_000]]),
            },
            { match: 'bin(TimeGenerated, 1m)', table: table(['peak', 'avg'], [[600, 100]]) },
            { match: 'by UserAgent', table: table(['UserAgent', 'n'], [['spark-connector', 12]]) },
        ]);
        const result = await fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'orders', SPAN);
        expect(result).toEqual({
            databaseId: 'db',
            containerId: 'orders',
            writeRu: 950_000,
            totalRu: 1_000_000,
            totalRequests: 300_000,
            throttledRequests: 75_000,
            burstFactor: 6,
            dominantUserAgent: 'spark-connector',
        });
    });

    it('returns undefined when there is no aggregate data-plane telemetry', async () => {
        const executor = executorByQuery([]); // all queries answer with an empty table
        await expect(fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'orders', SPAN)).resolves.toBeUndefined();
    });

    it('reports a zero burst factor when the average write RU is zero', async () => {
        const executor = executorByQuery([
            {
                match: 'countif(StatusCode == 429)',
                table: table(['totalRu', 'writeRu', 'reqs', 'throttles'], [[10, 10, 5, 0]]),
            },
            { match: 'bin(TimeGenerated, 1m)', table: table(['peak', 'avg'], [[0, 0]]) },
        ]);
        const result = await fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'orders', SPAN);
        expect(result?.burstFactor).toBe(0);
        expect(result?.dominantUserAgent).toBeUndefined();
    });
});

describe('fetchSharedThroughputTraffic', () => {
    it('maps per-collection rows into shared-throughput traffic', async () => {
        const executor = executorByQuery([
            {
                match: 'isnotempty(CollectionName)',
                table: table(
                    ['CollectionName', 'requests', 'throttled', 'ru'],
                    [
                        ['hot', 10_000, 500, 900_000],
                        ['cold', 1_000, 300, 50_000],
                        ['', 9, 0, 1],
                    ],
                ),
            },
        ]);
        const result = await fetchSharedThroughputTraffic(executor, RESOURCE, 'shareddb', 4000, SPAN);
        expect(result).toMatchObject({ databaseId: 'shareddb', sharedRu: 4000 });
        expect(result.collections).toEqual([
            { containerId: 'hot', requests: 10_000, throttledRequests: 500, ruConsumed: 900_000 },
            { containerId: 'cold', requests: 1_000, throttledRequests: 300, ruConsumed: 50_000 },
        ]);
    });
});

const detectorCalls: {
    operation: LogsOperation;
    match: string;
    run: (executor: LogsQueryExecutor, report: (diagnostic: LogsDiagnostic) => void) => Promise<unknown>;
}[] = [
    {
        operation: 'crossPartition',
        match: 'CDBQueryRuntimeStatistics',
        run: (executor, report) =>
            fetchCrossPartitionShapes(executor, RESOURCE, 'privateDatabase', 'privateContainer', SPAN, report),
    },
    ...(['ingestionSummary', 'ingestionBurst', 'ingestionUserAgent'] as const).map((operation, index) => ({
        operation,
        match: ['totalRu =', 'peak =', 'by UserAgent'][index],
        run: (executor: LogsQueryExecutor, report: (diagnostic: LogsDiagnostic) => void) =>
            fetchUncontrolledIngestion(executor, RESOURCE, 'privateDatabase', 'privateContainer', SPAN, report),
    })),
    {
        operation: 'sharedThroughput',
        match: 'isnotempty(CollectionName)',
        run: (executor, report) =>
            fetchSharedThroughputTraffic(executor, RESOURCE, 'privateDatabase', 4000, SPAN, report),
    },
];

describe.each(detectorCalls)('$operation diagnostics', ({ operation, match, run }) => {
    it.each(['throw', 'partial', 'malformed'] as const)(
        'rejects %s with exactly one safe diagnostic',
        async (failure) => {
            const onDiagnostic = vi.fn();
            const executor: LogsQueryExecutor = {
                queryResource: async (resourceId, query) => {
                    expect(resourceId).toBe(RESOURCE.replace(/^\/+/, ''));
                    if (!query.includes(match)) {
                        return success(table([], []));
                    }
                    const error = {
                        code: 'BadArgumentError',
                        details: {
                            error: {
                                innererror: {
                                    code: 'InsufficientAccessError',
                                    message: `Insufficient access for privateDatabase 'privateContainer' acct. ${query}`,
                                },
                            },
                        },
                    };
                    if (failure === 'throw') {
                        throw Object.assign(new Error('Invalid properties.'), error);
                    }
                    if (failure === 'malformed') {
                        return success(undefined as unknown as LogsTable);
                    }
                    return {
                        status: 'PartialFailure',
                        partialError: error,
                        partialTables: [table(['QueryText', 'executions'], [['PRIVATE_DOCUMENT', 100]])],
                    } as unknown as LogsQueryResult;
                },
            };
            const result = run(executor, onDiagnostic);
            await expect(result).rejects.toBeInstanceOf(LogsFetchError);
            await expect(result).rejects.toMatchObject({
                reason: failure === 'malformed' ? 'noData' : 'rbac',
                kind: failure === 'partial' ? 'partialFailure' : failure === 'throw' ? 'accessDenied' : 'unknown',
            });
            expect(onDiagnostic).toHaveBeenCalledOnce();
            expect(onDiagnostic.mock.calls[0][0].operation).toBe(operation);
            expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(
                /privateDatabase|privateContainer|PRIVATE_DOCUMENT|summarize|acct/,
            );
            const error: unknown = await result.catch((caught: unknown) => caught);
            expect(JSON.stringify(error)).not.toMatch(/privateDatabase|privateContainer|PRIVATE_DOCUMENT|summarize/);
            expect(error).not.toHaveProperty('cause');
        },
    );
});

describe('logs SDK transport shapes', () => {
    it.each([200, 400, 403])('classifies actual SDK responses with HTTP %s without network access', async (status) => {
        const client = new LogsQueryClient(
            {
                getToken: async () => ({
                    token: 'fake-offline-test-token',
                    expiresOnTimestamp: Date.now() + 60_000,
                }),
            },
            {
                retryOptions: { maxRetries: 0 },
                httpClient: {
                    sendRequest: async (request) => ({
                        request,
                        status,
                        headers: createHttpHeaders({
                            'content-type': 'application/json',
                            'x-ms-request-id': '11111111-2222-3333-4444-555555555555',
                            authorization: 'PRIVATE_HEADER',
                        }),
                        bodyAsText: JSON.stringify({
                            tables: [
                                {
                                    name: 'PrimaryResult',
                                    columns: [{ name: 'x', type: 'string' }],
                                    rows: [['secret']],
                                },
                            ],
                            error: {
                                code: 'BadArgumentError',
                                message: 'Invalid properties.',
                                innererror: { code: 'InsufficientAccessError', message: 'Insufficient access.' },
                            },
                        }),
                    }),
                },
            },
        );
        const onDiagnostic = vi.fn();
        await expect(probeCdbLogs(client, RESOURCE, SPAN, { onDiagnostic })).resolves.toEqual({
            available: false,
            reason: 'rbac',
        });
        expect(onDiagnostic).toHaveBeenCalledOnce();
        expect(onDiagnostic.mock.calls[0][0]).toMatchObject({
            codes: ['BadArgumentError', 'InsufficientAccessError'],
            kind: status === 200 ? 'partialFailure' : 'accessDenied',
        });
        expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('secret');
        expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('PRIVATE_HEADER');
        expect(onDiagnostic.mock.calls[0][0].requestId).toBe(
            status === 200 ? undefined : '11111111-2222-3333-4444-555555555555',
        );
    });

    it('does not allow reporter failures to expose their raw errors', async () => {
        const report = vi.fn(() => {
            throw new Error('PRIVATE_REPORTER_ERROR');
        });
        await expect(
            fetchCrossPartitionShapes(
                { queryResource: async () => Promise.reject(sdkError({ code: 'Forbidden' })) },
                RESOURCE,
                'db',
                'coll',
                SPAN,
                report,
            ),
        ).rejects.toMatchObject({ name: 'LogsFetchError', reason: 'rbac' });
        expect(report).toHaveBeenCalledOnce();
    });
});
