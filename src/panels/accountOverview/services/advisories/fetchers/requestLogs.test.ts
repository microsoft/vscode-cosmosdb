/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus, type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { describe, expect, it, vi } from 'vitest';
import {
    fetchConsistencyReadRu,
    fetchCrossPartitionShapes,
    fetchSharedThroughputTraffic,
    fetchUncontrolledIngestion,
    logWindow,
    requestLogWindow,
    selectDataPlaneSource,
    type LogsQueryExecutor,
} from './logs';

const RESOURCE = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/acct';
const NOW = Date.parse('2026-11-11T09:17:23.456Z');
const SPAN = requestLogWindow('CDBDataPlaneRequests5M', NOW);

function success(columns: string[] = [], rows: unknown[][] = []): LogsQueryResult {
    return {
        status: LogsQueryResultStatus.Success,
        tables: [
            {
                name: 'PrimaryResult',
                columnDescriptors: columns.map((name) => ({ name, type: 'string' })),
                // SDK cell types omit null; fixtures also exercise malformed service responses deliberately.
                rows: rows as LogsTable['rows'],
            },
        ],
    };
}

function missingTable(table: string) {
    return { code: 'SemanticError', message: `Failed to resolve table or column expression named '${table}'` };
}

describe('request-log source selection', () => {
    it('prefers one aggregate source without querying raw data or requiring nonempty telemetry', async () => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>().mockResolvedValue(success());
        const report = vi.fn();
        await expect(selectDataPlaneSource({ queryResource }, RESOURCE, SPAN, report)).resolves.toBe(
            'CDBDataPlaneRequests5M',
        );
        expect(queryResource).toHaveBeenCalledExactlyOnceWith(
            RESOURCE.slice(1),
            'CDBDataPlaneRequests5M | take 0',
            SPAN,
        );
        expect(report).not.toHaveBeenCalled();
    });

    it('falls back to raw only for an explicitly missing aggregate table, without false partial coverage', async () => {
        const queryResource = vi
            .fn<LogsQueryExecutor['queryResource']>()
            .mockRejectedValueOnce(missingTable('CDBDataPlaneRequests5M'))
            .mockResolvedValueOnce(success());
        const report = vi.fn();
        await expect(selectDataPlaneSource({ queryResource }, RESOURCE, SPAN, report)).resolves.toBe(
            'CDBDataPlaneRequests',
        );
        expect(queryResource.mock.calls.map((call) => call[1])).toEqual([
            'CDBDataPlaneRequests5M | take 0',
            'CDBDataPlaneRequests | take 0',
        ]);
        expect(report).not.toHaveBeenCalled();
    });

    it.each([
        { statusCode: 403, code: 'Forbidden' },
        { statusCode: 429, code: 'TooManyRequests' },
        { code: 'SemanticError', message: "Failed to resolve scalar expression named 'RequestCount'" },
    ])('does not conceal an aggregate query failure with a raw fallback: %j', async (error) => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>().mockRejectedValue(error);
        const report = vi.fn();
        await expect(selectDataPlaneSource({ queryResource }, RESOURCE, SPAN, report)).resolves.toBeUndefined();
        expect(queryResource).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'probeDataPlane5M' }));
    });

    it('reports both failures when neither source can be queried', async () => {
        const queryResource = vi
            .fn<LogsQueryExecutor['queryResource']>()
            .mockRejectedValueOnce(missingTable('CDBDataPlaneRequests5M'))
            .mockRejectedValueOnce({ statusCode: 403 });
        const report = vi.fn();
        await expect(selectDataPlaneSource({ queryResource }, RESOURCE, SPAN, report)).resolves.toBeUndefined();
        expect(report.mock.calls.map(([diagnostic]) => [diagnostic.operation, diagnostic.reason])).toEqual([
            ['probeDataPlane', 'rbac'],
            ['probeDataPlane5M', 'logAnalyticsDisabled'],
        ]);
    });
});

describe('weighted five-minute request logs', () => {
    it('anchors a full day at the last complete bucket without changing the raw window', () => {
        expect(SPAN).toEqual({
            startTime: new Date('2026-11-10T09:15:00Z'),
            endTime: new Date('2026-11-11T09:15:00Z'),
        });
        expect(SPAN.endTime.getTime() - SPAN.startTime.getTime()).toBe(86_400_000);
        expect(requestLogWindow('CDBDataPlaneRequests', NOW)).toEqual(logWindow(NOW));
    });

    it('uses weighted totals, five-minute bursts and user-agent counts from one table/window/destination', async () => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) => {
            if (query.includes('totalRu =')) {
                return success(['totalRu', 'writeRu', 'reqs', 'throttles', 'invalidRows'], [[1000, 900, 2000, 500, 0]]);
            }
            if (query.includes('peak =')) {
                return success(['peak', 'avg', 'invalidRows'], [[600, 100, 0]]);
            }
            return success(['UserAgent', 'n', 'invalidRows'], [['bulk', 1500, 0]]);
        });
        const result = await fetchUncontrolledIngestion(
            { queryResource },
            RESOURCE,
            'db',
            'items',
            SPAN,
            undefined,
            'CDBDataPlaneRequests5M',
        );
        expect(result).toMatchObject({
            totalRu: 1000,
            writeRu: 900,
            totalRequests: 2000,
            throttledRequests: 500,
            burstFactor: 6,
            dominantUserAgent: 'bulk',
            requestLogEvidence: {
                sourceTable: 'CDBDataPlaneRequests5M',
                sourceResolution: 'PT5M',
                observationStart: '2026-11-10T09:15:00.000Z',
                observationEnd: '2026-11-11T09:15:00.000Z',
            },
        });
        expect(queryResource).toHaveBeenCalledTimes(3);
        const [summary, burst, agent] = queryResource.mock.calls.map((call) => call[1]);
        expect(summary).toContain('totalRu = sum(TotalRequestCharge)');
        expect(summary).toContain('writeRu = sumif(TotalRequestCharge, OperationName in');
        expect(summary).toContain('reqs = sum(RequestCount), throttles = sumif(RequestCount, StatusCode == 429)');
        expect(burst).toContain('ru = sum(TotalRequestCharge)');
        expect(burst).toContain('by bin(TimeGenerated, 5m)');
        expect(burst).toContain('invalidRows = sum(invalidRows)');
        expect(agent).toContain('n = sum(RequestCount)');
        for (const [, query, window] of queryResource.mock.calls) {
            expect(query).toMatch(/^CDBDataPlaneRequests5M /);
            expect(query).toContain('TimeGenerated != bin(TimeGenerated, 5m)');
            expect(query).toContain('floor(RequestCount, 1.0) != RequestCount');
            expect(query).toContain('not(isfinite(TotalRequestCharge))');
            expect(query.indexOf('sort by destinationRows desc, TenantId asc')).toBeLessThan(
                query.indexOf("DatabaseName == 'db'"),
            );
            expect(window).toBe(SPAN);
            expect(query).not.toMatch(/union|avg\(RequestCharge\)|(?<!5M)CDBDataPlaneRequests /);
        }
    });

    it('uses weighted shared-pool requests and charges rather than aggregate-row counts', async () => {
        const queryResource = vi
            .fn<LogsQueryExecutor['queryResource']>()
            .mockResolvedValue(
                success(
                    ['CollectionName', 'requests', 'throttled', 'ru', 'invalidRows'],
                    [['shared', 10_000, 2500, 123_456, 0]],
                ),
            );
        const result = await fetchSharedThroughputTraffic(
            { queryResource },
            RESOURCE,
            'db',
            400,
            SPAN,
            undefined,
            'CDBDataPlaneRequests5M',
        );
        expect(result.collections).toEqual([
            { containerId: 'shared', requests: 10_000, throttledRequests: 2500, ruConsumed: 123_456 },
        ]);
        expect(queryResource.mock.calls[0][1]).toContain(
            'requests = sum(RequestCount), throttled = sumif(RequestCount, StatusCode == 429), ru = sum(TotalRequestCharge)',
        );
    });

    it.each([
        [1000, 900, 2000, 500, 1],
        [1000, 900, 2000, 500, null],
        [1000, 900, 2000, 500, undefined],
        [null, 900, 2000, 500, 0],
        [Number.POSITIVE_INFINITY, 900, 2000, 500, 0],
        [1000, -1, 2000, 500, 0],
        [1000, 900, 2.5, 1, 0],
        [1000, 900, '2000', 500, 0],
        [1000, 900, true, 0, 0],
        [1000, 900, 2, 3, 0],
        [1000, 1001, 2000, 500, 0],
    ])('rejects malformed or inconsistent aggregate totals: %j', async (...row) => {
        const report = vi.fn();
        const executor: LogsQueryExecutor = {
            queryResource: async (_id, query) =>
                query.includes('totalRu =')
                    ? success(['totalRu', 'writeRu', 'reqs', 'throttles', 'invalidRows'], [row])
                    : success(),
        };
        await expect(
            fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'items', SPAN, report, 'CDBDataPlaneRequests5M'),
        ).rejects.toMatchObject({ name: 'LogsFetchError', reason: 'noData' });
        expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'ingestionSummary' }));
    });

    it('keeps an empty source and a zero-write window distinct from invalid aggregates', async () => {
        const empty: LogsQueryExecutor = { queryResource: async () => success() };
        await expect(
            fetchUncontrolledIngestion(empty, RESOURCE, 'db', 'items', SPAN, undefined, 'CDBDataPlaneRequests5M'),
        ).resolves.toBeUndefined();
        const executor: LogsQueryExecutor = {
            queryResource: async (_id, query) =>
                query.includes('totalRu =')
                    ? success(['totalRu', 'writeRu', 'reqs', 'throttles', 'invalidRows'], [[100, 0, 20, 0, 0]])
                    : query.includes('peak =')
                      ? success(['peak', 'avg', 'invalidRows'], [[null, null, 0]])
                      : success(),
        };
        await expect(
            fetchUncontrolledIngestion(executor, RESOURCE, 'db', 'items', SPAN, undefined, 'CDBDataPlaneRequests5M'),
        ).resolves.toMatchObject({ burstFactor: 0, writeRu: 0 });
    });

    it.each(['startTime', 'endTime'] as const)('rejects partial %s buckets before querying', async (boundary) => {
        const queryResource = vi.fn();
        const window = { ...SPAN, [boundary]: new Date(SPAN[boundary].getTime() + 1) };
        await expect(
            fetchSharedThroughputTraffic(
                { queryResource },
                RESOURCE,
                'db',
                400,
                window,
                undefined,
                'CDBDataPlaneRequests5M',
            ),
        ).rejects.toThrow('five-minute-aligned');
        expect(queryResource).not.toHaveBeenCalled();
    });
});

describe('optional logical-query RU enrichment', () => {
    function executor(chargeResult: LogsQueryResult | Error) {
        return {
            queryResource: vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) => {
                if (!query.includes('totalQueryRu')) {
                    return success(
                        ['QueryText', 'executions', 'avgFanout', 'maxFanout'],
                        [['{"query":"SELECT  p1"}', 100, 4, 4]],
                    );
                }
                if (chargeResult instanceof Error) {
                    throw chargeResult;
                }
                return chargeResult;
            }),
        };
    }

    it('joins pre-grouped raw charges to distinct activities and attaches the cost of the logical execution', async () => {
        const client = executor(
            success(
                ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                [['{"query":"SELECT  p1"}', 100, 100, 1234]],
            ),
        );
        const result = await fetchCrossPartitionShapes(client, RESOURCE, 'db', 'items', SPAN, undefined, true);
        expect(result.shapes).toEqual([
            { text: 'SELECT p1', executions: 100, avgFanout: 4, maxFanout: 4, avgRu: 12.34 },
        ]);
        expect(client.queryResource).toHaveBeenCalledTimes(2);
        const query = client.queryResource.mock.calls[1][1];
        expect(query).toContain('| distinct ActivityId, CorrelatedActivityId, QueryText | join kind=leftouter');
        expect(query).toContain('by ActivityId) on ActivityId');
        expect(query).toContain('missingRequests = countif(isnull(requestRu))');
        expect(query.match(/sort by destinationRows desc, TenantId asc/g)).toHaveLength(2);
        expect(query.match(/TimeGenerated >= datetime\(2026-11-10T09:15:00.000Z\)/g)).toHaveLength(4);
        expect(query).not.toContain('CDBDataPlaneRequests5M');
    });

    it.each([
        [100, 99, 1234],
        [99, 99, 1234],
        [100, 0, 0],
    ])('does not invent a full-query cost from incomplete matches: %j', async (...values) => {
        const client = executor(
            success(
                ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                [['{"query":"SELECT  p1"}', ...values]],
            ),
        );
        const result = await fetchCrossPartitionShapes(client, RESOURCE, 'db', 'items', SPAN, undefined, true);
        expect(result.shapes[0]).not.toHaveProperty('avgRu');
        expect(result.shapes[0].executions).toBe(100);
    });

    it.each(['', null])(
        'does not drop an unidentified activity (%j) from a partially charged execution',
        async (id) => {
            const activities = [
                { id: 'known', charge: 10 },
                { id, charge: undefined },
            ];
            const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_resourceId, query) => {
                if (!query.includes('totalQueryRu')) {
                    return success(['QueryText', 'executions', 'avgFanout', 'maxFanout'], [['SELECT p1', 1, 4, 4]]);
                }
                const left = query.split('| join kind=leftouter')[0];
                const retained = left.includes('isnotempty(ActivityId)')
                    ? activities.filter((activity) => activity.id)
                    : activities;
                const complete = retained.every((activity) => activity.charge !== undefined);
                return success(
                    ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                    [['SELECT p1', 1, complete ? 1 : 0, complete ? 10 : 0]],
                );
            });
            const result = await fetchCrossPartitionShapes(
                { queryResource },
                RESOURCE,
                'db',
                'items',
                SPAN,
                undefined,
                true,
            );
            expect(result.shapes).toEqual([{ text: 'SELECT p1', executions: 1, avgFanout: 4, maxFanout: 4 }]);
            const chargeQuery = queryResource.mock.calls[1][1];
            expect(chargeQuery.split('| join kind=leftouter')[0]).not.toContain('isnotempty(ActivityId)');
            expect(chargeQuery.split('| join kind=leftouter')[1]).toContain('| where isnotempty(ActivityId)');
        },
    );

    it.each([
        new Error('Request logs unavailable.'),
        success(['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'], [['shape', 100, 101, 2]]),
        success(['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'], [['shape', 100, 100, null]]),
        {
            status: LogsQueryResultStatus.PartialFailure,
            partialTables: [],
            partialError: { code: 'PartialError', message: 'Incomplete.' },
        } satisfies LogsQueryResult,
    ])('reports failed/malformed/partial enrichment but preserves structural evidence', async (response) => {
        const report = vi.fn();
        const result = await fetchCrossPartitionShapes(executor(response), RESOURCE, 'db', 'items', SPAN, report, true);
        expect(result.shapes).toEqual([{ text: 'SELECT p1', executions: 100, avgFanout: 4, maxFanout: 4 }]);
        expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'crossPartitionRu' }));
    });
});

describe('consistency read-charge acquisition', () => {
    it.each(['CDBDataPlaneRequests', 'CDBDataPlaneRequests5M'] as const)(
        'observes allowlisted reads from %s with an exact-account bounded query',
        async (source) => {
            const queryResource = vi.fn<LogsQueryExecutor['queryResource']>().mockResolvedValue(
                success(
                    ['OperationName', 'requests', 'ru', 'invalidRows'],
                    [
                        ['Read', 10, 25, 0],
                        ['Query', 20, 75, 0],
                        ['QueryPlan', 5, 0, 0],
                    ],
                ),
            );
            const result = await fetchConsistencyReadRu({ queryResource }, RESOURCE, SPAN, undefined, source);
            expect(result).toMatchObject({ status: 'observed', sourceTable: source, readRequests: 35, readRu: 100 });
            const query = queryResource.mock.calls[0][1];
            expect(query).toContain(`| where _ResourceId =~ '${RESOURCE}'`);
            expect(query).toContain("OperationName in ('Read', 'Query', 'QueryPlan')");
            expect(query).not.toContain("'ReadFeed'");
            expect(query).toContain(
                source === 'CDBDataPlaneRequests5M'
                    ? 'requests = sum(RequestCount), ru = sum(TotalRequestCharge)'
                    : 'requests = count(), ru = sum(RequestCharge)',
            );
            expect(query.match(/TimeGenerated < datetime/g)).toHaveLength(2);
        },
    );

    it.each([
        ['ReadFeed', 10, 25, 0],
        ['Read', 0, 0, 0],
        ['Read', 1.5, 25, 0],
        ['Read', 10, Number.NaN, 0],
        ['Read', 10, -1, 0],
        ['Read', 10, null, 0],
        ['Read', 10, 25, 1],
    ])('rejects an invalid operation aggregate: %j', async (...row) => {
        const report = vi.fn();
        await expect(
            fetchConsistencyReadRu(
                { queryResource: async () => success(['OperationName', 'requests', 'ru', 'invalidRows'], [row]) },
                RESOURCE,
                SPAN,
                report,
            ),
        ).rejects.toMatchObject({ name: 'LogsFetchError', reason: 'noData' });
        expect(report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'consistencyReadRu' }));
    });

    it('rejects duplicate operations rather than doubling their charge', async () => {
        await expect(
            fetchConsistencyReadRu(
                {
                    queryResource: async () =>
                        success(
                            ['OperationName', 'requests', 'ru', 'invalidRows'],
                            [
                                ['Read', 1, 2, 0],
                                ['Read', 1, 2, 0],
                            ],
                        ),
                },
                RESOURCE,
                SPAN,
            ),
        ).rejects.toMatchObject({ reason: 'noData' });
    });

    it('reports an empty successful source as no observations, not observed zero charge', async () => {
        await expect(
            fetchConsistencyReadRu({ queryResource: async () => success() }, RESOURCE, SPAN),
        ).resolves.toMatchObject({ status: 'noObservations', readRequests: 0, readRu: 0 });
    });
});
