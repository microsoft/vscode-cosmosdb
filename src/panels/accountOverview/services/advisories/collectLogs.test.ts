/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogsQueryResultStatus, type LogsQueryResult, type LogsTable } from '@azure/monitor-query-logs';
import { describe, expect, it, vi } from 'vitest';
import { createLogsOutputReporter } from '../../logsOutput';
import { collectTier2Logs } from './collect';
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

function client(fail?: (query: string) => unknown): LogsQueryExecutor {
    return {
        queryResource: vi.fn(async (_id, query) => {
            const error = fail?.(query);
            if (error) {
                throw Object.assign(new Error('Simulated Log Analytics failure'), error);
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
        const executor: LogsQueryExecutor = { queryResource: async () => success() };
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
