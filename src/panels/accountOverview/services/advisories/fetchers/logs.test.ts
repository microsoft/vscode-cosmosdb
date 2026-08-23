/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { describe, expect, it } from 'vitest';
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

    it('reads rows from a partial (partialTables) result', () => {
        const partial = {
            status: 'PartialFailure',
            partialTables: [table(['n'], [[1], [2]])],
        } as unknown as LogsQueryResult;
        // firstTable is internal; exercise it through a fetcher that reads partialTables.
        expect(partial).toBeDefined();
        // tableToRecords itself only takes a table, so assert the shape it produces from that partial table.
        expect(tableToRecords((partial as unknown as { partialTables: LogsTable[] }).partialTables[0])).toEqual([
            { n: 1 },
            { n: 2 },
        ]);
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

    it('degrades anything else to noData', () => {
        expect(classifyLogsError({ statusCode: 503, message: 'Service unavailable' })).toBe('noData');
        expect(classifyLogsError(new Error('socket hang up'))).toBe('noData');
    });
});

describe('probeCdbLogs', () => {
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
