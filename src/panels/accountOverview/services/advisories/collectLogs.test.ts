/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus, type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { createLogsOutputReporter } from '../../logsOutput';
import { collectTier2Logs } from './collect';
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import { computeDerivedAdvisories } from './engine';
import { type LogsQueryExecutor } from './fetchers/logs';

const resource = '/subscriptions/test/resourceGroups/test/providers/Microsoft.DocumentDB/databaseAccounts/test';
const targets = [{ databaseId: 'db', containerId: 'container' }];
const inventory = [{ ...targets[0], throughputMode: 'shared' as const, throughputRU: 400 }];

function success(columns: string[] = [], rows: LogsTable['rows'] = []): LogsQueryResult {
    return {
        status: LogsQueryResultStatus.Success,
        tables: [{ name: 'PrimaryResult', columnDescriptors: columns.map((name) => ({ name, type: 'string' })), rows }],
    };
}

function client(fail?: (query: string) => unknown, hasData = (_query: string) => true): LogsQueryExecutor {
    return {
        queryResource: vi.fn(async (_id, query) => {
            const error = fail?.(query);
            if (error) {
                throw Object.assign(new Error('Simulated Log Analytics failure'), error);
            }
            if (query.startsWith('CDBDataPlaneRequests5M ') && query.endsWith('| take 1 | summarize n = count()')) {
                throw Object.assign(new Error('Failed to resolve table CDBDataPlaneRequests5M'), {
                    code: 'SemanticError',
                });
            }
            if (query.endsWith('| take 1 | summarize n = count()')) {
                return success(['n'], [[hasData(query) ? 1 : 0]]);
            }
            if (query.includes('totalQueryRu')) {
                return success(
                    ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                    [['SELECT 1', 100, 100, 1000]],
                );
            }
            if (query.includes('by CorrelatedActivityId')) {
                return success(['QueryText', 'executions', 'avgFanout', 'maxFanout'], [['SELECT 1', 100, 2, 2]]);
            }
            if (query.includes('totalRu =')) {
                return success(['totalRu', 'writeRu', 'reqs', 'throttles'], [[1000, 900, 500, 50]]);
            }
            if (query.includes('peak =')) {
                return success(['peak', 'avg'], [[100, 50]]);
            }
            if (query.includes('by UserAgent')) {
                return success(['UserAgent', 'n'], [['test-client', 10]]);
            }
            if (query.includes('by CollectionName')) {
                return success(['CollectionName', 'requests', 'throttled', 'ru'], [['container', 500, 50, 1000]]);
            }
            return success();
        }),
    };
}

describe('Log Analytics collection coverage', () => {
    it.each([
        {
            name: 'empty structural observations',
            shapeRows: [],
            shapes: [],
            coverage: { available: true },
            rawReads: 0,
            reports: 0,
        },
        {
            name: 'nonempty structural observations',
            shapeRows: [['SELECT 1', 100, 2, 2]],
            shapes: [{ text: 'SELECT 1', executions: 100, avgFanout: 2, maxFanout: 2 }],
            coverage: {
                available: false,
                reason: 'logAnalyticsDisabled',
                failures: [{ operation: 'crossPartitionRu', kind: 'missingTable', reason: 'logAnalyticsDisabled' }],
            },
            rawReads: 1,
            reports: 1,
        },
    ])('queries missing raw logs only for observed query shapes ($name)', async (scenario) => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) => {
            if (/\bCDBDataPlaneRequests\b/.test(query)) {
                throw Object.assign(new Error("Failed to resolve table named 'CDBDataPlaneRequests'"), {
                    code: 'SemanticError',
                });
            }
            if (query.endsWith('| take 1 | summarize n = count()')) {
                return success(['n'], [[1]]);
            }
            if (query.includes('by CorrelatedActivityId')) {
                return success(['QueryText', 'executions', 'avgFanout', 'maxFanout'], scenario.shapeRows);
            }
            return success();
        });
        const report = vi.fn();
        const result = await collectTier2Logs({ queryResource }, resource, targets, [], report, [], []);
        expect(result.logSource).toEqual(scenario.coverage);
        expect(result.crossPartition.flatMap((input) => input.shapes)).toEqual(scenario.shapes);
        expect(report).toHaveBeenCalledTimes(scenario.reports);
        expect(queryResource.mock.calls.filter((call) => /\bCDBDataPlaneRequests\b/.test(call[1]))).toHaveLength(
            scenario.rawReads,
        );
        expect(queryResource.mock.calls.filter((call) => call[1].startsWith('CDBDataPlaneRequests '))).toEqual([]);
    });

    it('marks incomplete charge matches as partial coverage while retaining structural evidence', async () => {
        const base = client();
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (...args) =>
            args[1].includes('totalQueryRu')
                ? success(
                      ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                      [['SELECT 1', 100, 99, 990]],
                  )
                : base.queryResource(...args),
        );
        const report = vi.fn();
        const result = await collectTier2Logs({ queryResource }, resource, targets, inventory, report);
        expect(result.crossPartition[0].shapes).toEqual([
            { text: 'SELECT 1', executions: 100, avgFanout: 2, maxFanout: 2 },
        ]);
        expect(result.ingestion).toHaveLength(1);
        expect(result.sharedThroughput).toHaveLength(1);
        expect(result.logSource).toMatchObject({
            available: false,
            reason: 'noData',
            failures: [{ operation: 'crossPartitionRu', kind: 'partialFailure', reason: 'noData' }],
        });
        expect(report).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ operation: 'crossPartitionRu', kind: 'partialFailure' }),
        );
    });

    it('uses only two presence probes when both analysis-window sources are empty, regardless of container count', async () => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) =>
            query.endsWith('| take 1 | summarize n = count()') ? success(['n'], [[0]]) : success(),
        );
        const containers = Array.from({ length: 5 }, (_, index) => ({
            databaseId: 'db',
            containerId: `container${index}`,
        }));
        const report = vi.fn();
        const result = await collectTier2Logs(
            { queryResource },
            resource,
            containers,
            inventory,
            report,
            containers,
            containers,
            true,
        );
        expect(queryResource).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            crossPartition: [],
            ingestion: [],
            sharedThroughput: [],
            consistencyReadRu: {
                status: 'noObservations',
                readRequests: 0,
                readRu: 0,
                sourceTable: 'CDBDataPlaneRequests5M',
            },
            logSource: { available: true },
        });
        expect(report).not.toHaveBeenCalled();
    });

    it('uses one aligned aggregate source for ingestion, shared-pool and consistency evidence, with raw-only fan-out enrichment', async () => {
        const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) => {
            if (query.endsWith('| take 1 | summarize n = count()')) {
                return success(['n'], [[1]]);
            }
            if (query.includes('totalQueryRu')) {
                return success(
                    ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                    [['SELECT 1', 100, 100, 2000]],
                );
            }
            if (query.startsWith('CDBQueryRuntimeStatistics')) {
                return success(['QueryText', 'executions', 'avgFanout', 'maxFanout'], [['SELECT 1', 100, 4, 4]]);
            }
            if (query.includes('totalRu =')) {
                return success(['totalRu', 'writeRu', 'reqs', 'throttles', 'invalidRows'], [[1000, 900, 2000, 500, 0]]);
            }
            if (query.includes('peak =')) {
                return success(['peak', 'avg', 'invalidRows'], [[600, 100, 0]]);
            }
            if (query.includes('by UserAgent')) {
                return success(['UserAgent', 'n', 'invalidRows'], [['bulk', 1500, 0]]);
            }
            if (query.includes('by OperationName')) {
                return success(['OperationName', 'requests', 'ru', 'invalidRows'], [['Read', 10, 100, 0]]);
            }
            return success(
                ['CollectionName', 'requests', 'throttled', 'ru', 'invalidRows'],
                [['container', 2000, 500, 1000, 0]],
            );
        });
        const result = await collectTier2Logs(
            { queryResource },
            resource,
            targets,
            inventory,
            undefined,
            targets,
            targets,
            true,
        );
        expect(result.logSource).toEqual({ available: true });
        expect(result.crossPartition[0].shapes[0].avgRu).toBe(20);
        expect(result.ingestion[0].requestLogEvidence?.sourceTable).toBe('CDBDataPlaneRequests5M');
        expect(result.sharedThroughput[0].requestLogEvidence).toEqual(result.ingestion[0].requestLogEvidence);
        expect(result.consistencyReadRu).toMatchObject({
            status: 'observed',
            sourceTable: 'CDBDataPlaneRequests5M',
            readRu: 100,
        });
        const aggregateCalls = queryResource.mock.calls.filter(
            (call) =>
                call[1].startsWith('CDBDataPlaneRequests5M ') && !call[1].endsWith('| take 1 | summarize n = count()'),
        );
        expect(aggregateCalls).toHaveLength(5);
        for (const [, query, span] of aggregateCalls) {
            expect(span.startTime.getTime() % 300_000).toBe(0);
            expect(span.endTime.getTime() % 300_000).toBe(0);
            expect(span.endTime.getTime() - span.startTime.getTime()).toBe(86_400_000);
            expect(query).not.toMatch(/union|CDBDataPlaneRequests /);
        }
    });

    it.each(['CDBDataPlaneRequests5M', 'CDBDataPlaneRequests'] as const)(
        'preserves query-runtime checks independently of an empty %s source',
        async (source) => {
            const queryResource = vi.fn<LogsQueryExecutor['queryResource']>(async (_id, query) => {
                if (query.endsWith('| take 1 | summarize n = count()')) {
                    if (source === 'CDBDataPlaneRequests' && query.startsWith('CDBDataPlaneRequests5M ')) {
                        throw Object.assign(new Error('Failed to resolve table CDBDataPlaneRequests5M'), {
                            code: 'SemanticError',
                        });
                    }
                    return success(
                        ['n'],
                        [
                            [
                                query.startsWith('CDBQueryRuntimeStatistics ') ||
                                (source === 'CDBDataPlaneRequests5M' && query.startsWith('CDBDataPlaneRequests '))
                                    ? 1
                                    : 0,
                            ],
                        ],
                    );
                }
                expect(query).toMatch(/^CDBQueryRuntimeStatistics /);
                if (query.includes('totalQueryRu')) {
                    return success(
                        ['QueryText', 'executions', 'matchedExecutions', 'totalQueryRu'],
                        [['SELECT 1', 100_000, 100_000, 2_000_000]],
                    );
                }
                return success(
                    ['QueryText', 'executions', 'avgFanout', 'maxFanout'],
                    [['SELECT 1', 100_000, 100, 100]],
                );
            });
            const report = vi.fn();
            const result = await collectTier2Logs(
                { queryResource },
                resource,
                targets,
                inventory,
                report,
                targets,
                targets,
                true,
            );
            expect(queryResource).toHaveBeenCalledTimes(4);
            expect(result.crossPartition).toHaveLength(1);
            expect(result.crossPartition[0].shapes).toEqual([
                {
                    text: 'SELECT 1',
                    executions: 100_000,
                    avgFanout: 100,
                    maxFanout: 100,
                    ...(source === 'CDBDataPlaneRequests5M' ? { avgRu: 20 } : {}),
                },
            ]);
            expect(queryResource.mock.calls.filter((call) => call[1].includes('totalQueryRu'))).toHaveLength(
                source === 'CDBDataPlaneRequests5M' ? 1 : 0,
            );
            expect(
                queryResource.mock.calls.filter(
                    (call) =>
                        call[1].startsWith('CDBDataPlaneRequests ') &&
                        call[1].endsWith('| take 1 | summarize n = count()'),
                ),
            ).toHaveLength(source === 'CDBDataPlaneRequests5M' ? 0 : 1);
            expect(result.ingestion).toEqual([]);
            expect(result.sharedThroughput).toEqual([]);
            expect(result.consistencyReadRu).toMatchObject({ sourceTable: source, status: 'noObservations' });
            expect(result.logSource).toEqual({ available: true });
            expect(report).not.toHaveBeenCalled();
            const findings = computeDerivedAdvisories(
                {
                    weeklyRuPercents: [],
                    hasManualThroughput: false,
                    partitions: [],
                    storage: [],
                    indexing: [],
                    crossPartition: result.crossPartition,
                    consistencyReadRu: result.consistencyReadRu,
                    accountConfig: {
                        accountName: 'prod',
                        consistencyLevel: 'Strong',
                        regionCount: 2,
                        multiRegionWritesEnabled: false,
                        writeRegionCount: 1,
                        api: API.Core,
                    },
                },
                DEFAULT_ADVISORY_THRESHOLDS,
            );
            expect(findings).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ rule: 'CrossPartitionQuery' }),
                    expect.objectContaining({
                        rule: 'ExpensiveConsistency',
                        evidence: expect.objectContaining({ readRuStatus: 'noObservations' }),
                    }),
                ]),
            );
        },
    );

    it('skips empty query-runtime checks without suppressing independent raw request checks', async () => {
        const executor = client(undefined, (query) => !query.startsWith('CDBQueryRuntimeStatistics '));
        const result = await collectTier2Logs(executor, resource, targets, inventory);
        expect(executor.queryResource).toHaveBeenCalledTimes(7);
        expect(result.crossPartition).toEqual([]);
        expect(result.ingestion).toHaveLength(1);
        expect(result.sharedThroughput).toHaveLength(1);
        expect(result.logSource).toEqual({ available: true });
    });

    it('retains structural and config findings when optional query/read RU fails, and reports both failures', async () => {
        const executor = client((query) =>
            query.includes('totalQueryRu') || query.includes('by OperationName')
                ? { statusCode: 403, code: 'Forbidden' }
                : undefined,
        );
        const logs = await collectTier2Logs(executor, resource, targets, inventory, undefined, targets, targets, true);
        expect(logs.crossPartition).toHaveLength(1);
        expect(logs.crossPartition[0].shapes[0]).not.toHaveProperty('avgRu');
        expect(logs.consistencyReadRu).toBeUndefined();
        expect(logs.logSource).toMatchObject({
            available: false,
            reason: 'rbac',
            failures: expect.arrayContaining([
                { operation: 'crossPartitionRu', kind: 'accessDenied', reason: 'rbac' },
                { operation: 'consistencyReadRu', kind: 'accessDenied', reason: 'rbac' },
            ]),
        });
        const findings = computeDerivedAdvisories(
            {
                weeklyRuPercents: [],
                hasManualThroughput: false,
                partitions: [],
                storage: [],
                indexing: [],
                crossPartition: logs.crossPartition,
                consistencyReadRu: logs.consistencyReadRu,
                accountConfig: {
                    accountName: 'prod',
                    consistencyLevel: 'Strong',
                    regionCount: 2,
                    multiRegionWritesEnabled: false,
                    writeRegionCount: 1,
                    api: API.Core,
                },
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );
        expect(findings.find((finding) => finding.rule === 'ExpensiveConsistency')).toMatchObject({
            severity: 'Medium',
            evidence: { readRuStatus: 'unavailable' },
        });
    });

    it('keeps successful log findings and records query-runtime table unavailability', async () => {
        const executor = client((query) =>
            query.startsWith('CDBQueryRuntimeStatistics')
                ? {
                      code: 'SemanticError',
                      message: "Failed to resolve table or column expression named 'CDBQueryRuntimeStatistics'",
                  }
                : undefined,
        );
        const report = vi.fn();
        const result = await collectTier2Logs(executor, resource, targets, inventory, report);
        expect(result.crossPartition).toEqual([]);
        expect(result.ingestion).toHaveLength(1);
        expect(result.sharedThroughput).toHaveLength(1);
        expect(result.logSource).toMatchObject({
            available: false,
            reason: 'logAnalyticsDisabled',
            failures: [{ operation: 'probeQueryRuntime', kind: 'missingTable' }],
        });
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('still runs fan-out checks when only the data-plane table is denied', async () => {
        const executor = client((query) =>
            query.startsWith('CDBDataPlaneRequests') ? { statusCode: 403, code: 'InsufficientAccessError' } : undefined,
        );
        const result = await collectTier2Logs(executor, resource, targets, inventory);
        expect(result.crossPartition).toHaveLength(1);
        expect(result.ingestion).toEqual([]);
        expect(result.sharedThroughput).toEqual([]);
        expect(result.logSource).toMatchObject({ available: false, reason: 'rbac' });
    });

    it('does not report full coverage when a detector query fails after both probes succeed', async () => {
        const executor = client((query) =>
            query.includes('by CorrelatedActivityId')
                ? { code: 'SemanticError', message: "Failed to resolve scalar expression named 'MissingColumn'" }
                : undefined,
        );
        const result = await collectTier2Logs(executor, resource, targets, inventory);
        expect(result.ingestion).toHaveLength(1);
        expect(result.sharedThroughput).toHaveLength(1);
        expect(result.crossPartition).toEqual([]);
        expect(result.logSource).toMatchObject({
            available: false,
            reason: 'noData',
            failures: [{ operation: 'crossPartition', kind: 'queryError' }],
        });
    });

    it('keeps successful empty tables distinct from failures', async () => {
        const executor: LogsQueryExecutor = { queryResource: async () => success(['n'], [[0]]) };
        const report = vi.fn();
        const result = await collectTier2Logs(executor, resource, targets, inventory, report);
        expect(result.logSource).toEqual({ available: true });
        expect(report).not.toHaveBeenCalled();
    });

    it('reports missing client acquisition to Output', async () => {
        const warn = vi.fn();
        const result = await collectTier2Logs(undefined, resource, targets, inventory, createLogsOutputReporter(warn));
        expect(result.logSource).toMatchObject({ available: false, reason: 'noData' });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('kind=clientUnavailable'));
    });

    it('writes the HTTP and nested service reason to Output, without query text or resource identifiers', async () => {
        const executor = client(() => ({
            statusCode: 403,
            details: {
                error: {
                    code: 'InsufficientAccessError',
                    message: 'The provided credentials have insufficient access to perform the requested operation.',
                    innererror: {
                        code: 'AuthorizationFailedError',
                        message: `User 'private-user' does not have access to read logs for '${resource}'`,
                    },
                },
            },
        }));
        const warn = vi.fn();
        const result = await collectTier2Logs(executor, resource, targets, inventory, createLogsOutputReporter(warn));
        expect(result.logSource.available).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
        const output = warn.mock.calls.map(([line]) => line).join('\n');
        expect(output).toContain('InsufficientAccessError');
        expect(output).toContain('AuthorizationFailedError');
        expect(output).toContain('insufficient access');
        expect(output).not.toContain(resource);
        expect(output).not.toContain('private-user');
        expect(output).not.toContain('| take');
        expect(JSON.stringify(result.logSource)).not.toContain('private-user');
    });

    it('deduplicates identical Output diagnostics within, but not across, runs', () => {
        const warn = vi.fn();
        const diagnostic = {
            operation: 'crossPartition' as const,
            reason: 'rbac' as const,
            kind: 'accessDenied' as const,
            statusCode: 403,
            codes: ['InsufficientAccessError'],
            messages: ['Insufficient access.'],
        };
        const first = createLogsOutputReporter(warn);
        first(diagnostic);
        first(diagnostic);
        expect(warn).toHaveBeenCalledTimes(1);
        createLogsOutputReporter(warn)(diagnostic);
        expect(warn).toHaveBeenCalledTimes(2);
    });
});
