/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AdvisorManagementClient } from '@azure/arm-advisor';
import { AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { MonitorClient, type EventData } from '@azure/arm-monitor';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountHealth } from './accountHealth';
import {
    getAccountRequestStatusCounts,
    getAutoscaleUtilization,
    getContainerIdlePeak,
    getContainerIndexingUsage,
    getThrottledOperationCounts,
} from './advisories/fetchers/metrics';
import { __resetAdvisorCache, getActiveAlertSummary, getAlerts, getRecommendations } from './alertsRecommendations';
import { getInventoryResult } from './inventory';
import { getPartitionStorageSeries } from './partitionHealth';
import { readMetrics, readRequest, recordReadFailure, withReadDiagnostics } from './readDiagnostics';
import { getRuTrends, getThrottleRate } from './ruTrends';
import { getContainerCreatedAt } from './resourceAge';
import { pagedItems, mockClient, throwingClient } from './testFixtures';

const accountId =
    '/subscriptions/private-sub/resourceGroups/private-rg/providers/Microsoft.DocumentDB/databaseAccounts/private-account';
const credential = { getToken: async () => null };
const denied = () =>
    Object.assign(new Error(`Insufficient access to '${accountId}'. Bearer PRIVATE_TOKEN`), {
        statusCode: 403,
        details: { error: { code: 'AuthorizationFailed', message: 'Insufficient access.' } },
    });

beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdvisorCache();
});

describe('Account Overview read diagnostics', () => {
    it.each([
        ['dedicated idle', (client: MonitorClient) => getContainerIdlePeak(client, accountId, 'private-db', 'private-container')],
        ['shared idle', (client: MonitorClient) => getContainerIdlePeak(client, accountId, 'private-db', undefined, Date.now(), ['private-container'])],
        ['autoscale', (client: MonitorClient) => getAutoscaleUtilization(client, accountId, 'private-db', 'private-container', 10000)],
        ['indexing', (client: MonitorClient) => getContainerIndexingUsage(client, accountId, 'private-db', 'private-container')],
        ['partition storage', (client: MonitorClient) => getPartitionStorageSeries(client, accountId, '7D', 'private-db', 'private-container')],
        ['shared utilization', (client: MonitorClient) => getRuTrends(client, accountId, '7D', 'private-db', undefined, undefined, ['private-container'])],
        ['shared request counts', (client: MonitorClient) => getThrottleRate(client, accountId, '7D', 'private-db', undefined, undefined, ['private-container'])],
    ] as const)('masks unquoted database/container names in %s request diagnostics', async (_label, read) => {
        const client = throwingClient(Object.assign(
            new Error('Insufficient access to private-db and private-container.'),
            { statusCode: 403 },
        ));
        const warn = vi.fn();
        await withReadDiagnostics('metrics', [accountId], warn, async () => {
            await read(client);
            return {};
        }, () => ({}));
        const output = warn.mock.calls.flat().join('\n');
        expect(output).toContain('Insufficient access');
        expect(output).not.toMatch(/private-db|private-container/);
        expect(warn).toHaveBeenCalledOnce();
    });

    it('masks all shared members without leaking masks between concurrent invocations', async () => {
        const client = new MonitorClient(credential, 'private-sub');
        vi.spyOn(client.metrics, 'list').mockImplementation(async (_uri, options) => {
            await Promise.resolve();
            const name = options?.filter?.includes('first-db') ? 'first' : 'second';
            throw Object.assign(new Error(`Insufficient access to ${name}-db, ${name}-one and ${name}-two.`), { statusCode: 403 });
        });
        const firstWarn = vi.fn();
        const secondWarn = vi.fn();
        const run = (name: string, warn: (line: string) => void) =>
            withReadDiagnostics('metrics', [accountId], warn, async () => {
                await getContainerIdlePeak(client, accountId, `${name}-db`, undefined, Date.now(), [`${name}-one`, `${name}-two`]);
                return {};
            }, () => ({}));
        await Promise.all([run('first', firstWarn), run('second', secondWarn)]);
        expect(firstWarn).toHaveBeenCalledOnce();
        expect(secondWarn).toHaveBeenCalledOnce();
        expect(firstWarn.mock.calls.flat().join('\n')).not.toMatch(/first-(db|one|two)|second-/);
        expect(secondWarn.mock.calls.flat().join('\n')).not.toMatch(/second-(db|one|two)|first-/);
    });

    it.each([['noData', 'rbac'], ['rbac', 'noData']] as const)(
        'preserves partial-failure reasons in order %j',
        async (first, second) => {
            const result = await withReadDiagnostics('logs', [], vi.fn(), async () => {
                for (const reason of [first, second, first]) {
                    recordReadFailure('logs', { operation: 'crossPartitionRu', kind: 'partialFailure', reason, codes: [], messages: [] });
                }
                return {};
            });
            expect(result.diagnostics).toEqual([
                { source: 'logs', kind: 'partialFailure', reason: first },
                { source: 'logs', kind: 'partialFailure', reason: second },
            ]);
        },
    );

    it.each([
        ['request statuses', getAccountRequestStatusCounts],
        ['throttled operations', getThrottledOperationCounts],
    ] as const)('reports failures from the account %s split without issuing another read', async (_label, read) => {
        const client = throwingClient(denied());
        const list = vi.spyOn(client.metrics, 'list');
        const warn = vi.fn();
        const result = await withReadDiagnostics(
            'metrics',
            [accountId],
            warn,
            () => read(client, accountId),
            () => ({}),
        );
        expect(result.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        expect(list).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
        expect(warn.mock.calls.flat().join('\n')).not.toContain(accountId);
    });

    it('logs real metric failures before health degrades, with only categories sent to the UI', async () => {
        const warn = vi.fn();
        const result = await withReadDiagnostics('metrics', [accountId], warn, () =>
            getAccountHealth(throwingClient(denied()), accountId, 'Succeeded'),
        );
        expect(result).toMatchObject({
            available: false,
            reason: 'rbac',
            diagnostics: [{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }],
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
        const output = warn.mock.calls.flat().join('\n');
        expect(output).toContain('AuthorizationFailed');
        expect(output).toContain('Insufficient access');
        expect(output).not.toMatch(/PRIVATE_TOKEN|private-sub|private-account/);
        expect(JSON.stringify(result.diagnostics)).not.toMatch(/Insufficient|AuthorizationFailed|private-/);
    });

    it('records ARM inventory failures, including synchronous iterator creation failures', async () => {
        const client = new CosmosDBManagementClient(credential, 'private-sub');
        vi.spyOn(client.sqlResources, 'listSqlDatabases').mockImplementation(() => {
            throw denied();
        });
        const warn = vi.fn();
        const result = await withReadDiagnostics('inventory', [accountId], warn, () =>
            getInventoryResult(client, 'private-rg', 'private-account', false),
        );
        expect(result.diagnostics).toEqual([{ source: 'inventory', kind: 'accessDenied', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('operation=listSqlDatabases'));
    });

    it('does not report expected missing throughput offers as failed access', async () => {
        const client = new CosmosDBManagementClient(credential, 'private-sub');
        vi.spyOn(client.sqlResources, 'listSqlDatabases').mockReturnValue(pagedItems([{ resource: { id: 'db' } }]));
        vi.spyOn(client.sqlResources, 'getSqlDatabaseThroughput').mockRejectedValue({ statusCode: 404 });
        vi.spyOn(client.sqlResources, 'listSqlContainers').mockReturnValue(pagedItems([]));
        const warn = vi.fn();
        const result = await withReadDiagnostics('inventory', [accountId], warn, () =>
            getInventoryResult(client, 'private-rg', 'private-account', false),
        );
        expect(result.available).toBe(true);
        expect(result).not.toHaveProperty('diagnostics');
        expect(warn).not.toHaveBeenCalled();
    });

    it('logs a denied container throughput operation without exposing the container name', async () => {
        const client = new CosmosDBManagementClient(credential, 'private-sub');
        vi.spyOn(client.sqlResources, 'listSqlDatabases').mockReturnValue(
            pagedItems([{ resource: { id: 'private-db' } }]),
        );
        vi.spyOn(client.sqlResources, 'getSqlDatabaseThroughput').mockRejectedValue({ statusCode: 404 });
        vi.spyOn(client.sqlResources, 'listSqlContainers').mockReturnValue(
            pagedItems([{ resource: { id: 'private-container' } }]),
        );
        vi.spyOn(client.sqlResources, 'getSqlContainerThroughput').mockRejectedValue(
            Object.assign(new Error('Insufficient access to private-db and private-container.'), { statusCode: 403 }),
        );
        const warn = vi.fn();
        const result = await withReadDiagnostics('inventory', [accountId], warn, () =>
            getInventoryResult(client, 'private-rg', 'private-account', false),
        );
        expect(result.reason).toBe('rbac');
        expect(warn.mock.calls.flat().join('\n')).toContain('operation=getSqlContainerThroughput');
        expect(warn.mock.calls.flat().join('\n')).not.toMatch(/private-db|private-container/);
    });

    it('reports Activity Log errors raised while iterating, rather than attributing them to metrics', async () => {
        const client = new MonitorClient(credential, 'private-sub');
        const items = pagedItems<EventData>([]);
        vi.spyOn(client.activityLogs, 'list').mockReturnValue({
            ...items,
            next: () => Promise.reject(denied()),
        });
        const warn = vi.fn();
        const result = await withReadDiagnostics(
            'metrics',
            [accountId],
            warn,
            async () => {
                await getContainerCreatedAt(client, accountId, 'db', 'container');
                return { available: true };
            },
            () => ({ available: false }),
        );
        expect(result.diagnostics).toEqual([{ source: 'activityLog', kind: 'accessDenied', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('scope=subscription'));
    });

    it('logs Advisor failures caught by the service', async () => {
        const client = new AdvisorManagementClient(credential, 'private-sub');
        vi.spyOn(client.recommendations, 'list').mockImplementation(() => {
            throw denied();
        });
        const warn = vi.fn();
        const result = await withReadDiagnostics('advisor', [accountId], warn, () =>
            getRecommendations(client, 'private-sub', accountId),
        );
        expect(result.diagnostics).toEqual([{ source: 'advisor', kind: 'accessDenied', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('operation=recommendations.list'));
    });

    it('logs Alerts Management failures caught by the service', async () => {
        const client = new AlertsManagementClient(credential);
        vi.spyOn(client.alerts, 'getAll').mockImplementation(() => {
            throw denied();
        });
        const warn = vi.fn();
        const result = await withReadDiagnostics('alerts', [accountId], warn, () =>
            getAlerts(client, 'private-sub', accountId, '1d', 'Fired'),
        );
        expect(result.diagnostics).toEqual([{ source: 'alerts', kind: 'accessDenied', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('operation=alerts.getAll'));
    });

    it('retains Resource Graph service codes, HTTP status and request ID in sanitized Output', async () => {
        const client = new CosmosDBManagementClient(credential, 'private-sub');
        vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
            request,
            status: 403,
            headers: createHttpHeaders({ 'x-ms-request-id': '11111111-2222-3333-4444-555555555555' }),
            bodyAsText: JSON.stringify({
                error: { code: 'AuthorizationFailed', message: `Insufficient access to '${accountId}'.` },
            }),
        }));
        const warn = vi.fn();
        const result = await withReadDiagnostics('alertCounts', [accountId], warn, () =>
            getActiveAlertSummary(client, 'private-sub', accountId, 'https://management.azure.com'),
        );
        expect(result.diagnostics).toEqual([{ source: 'alertCounts', kind: 'accessDenied', reason: 'rbac' }]);
        const output = warn.mock.calls.flat().join('\n');
        expect(output).toContain('HTTP 403');
        expect(output).toContain('AuthorizationFailed');
        expect(output).toContain('requestId=11111111-2222-3333-4444-555555555555');
        expect(output).not.toContain(accountId);
    });

    it('preserves successful empty responses without warnings', async () => {
        const warn = vi.fn();
        const result = await withReadDiagnostics('metrics', [], warn, () =>
            getAccountHealth(mockClient({}), accountId, 'Succeeded'),
        );
        expect(result.reason).toBe('noData');
        expect(result).not.toHaveProperty('diagnostics');
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not silently treat per-metric access errors in successful HTTP responses as no data', async () => {
        const client = new MonitorClient(credential, 'private-sub');
        vi.spyOn(client.metrics, 'list').mockResolvedValue({
            timespan: '2026-11-05T00:00:00Z/2026-11-05T01:00:00Z',
            value: [
                {
                    id: 'metric',
                    name: { value: 'TotalRequests' },
                    type: 'Microsoft.Insights/metrics',
                    unit: 'Count',
                    timeseries: [],
                    errorCode: 'Forbidden',
                    errorMessage: 'Insufficient access.',
                },
            ],
        });
        const warn = vi.fn();
        const result = await withReadDiagnostics(
            'metrics',
            [],
            warn,
            async () => {
                await readMetrics(client, accountId);
                return { available: true };
            },
            () => ({ available: false }),
        );
        expect(result.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('code=Forbidden'));
    });

    it('distinguishes authentication failures from missing roles', async () => {
        const warn = vi.fn();
        const result = await withReadDiagnostics(
            'metrics',
            [],
            warn,
            async () => {
                throw Object.assign(new Error('Token expired.'), { statusCode: 401 });
            },
            (reason) => ({ available: false, reason }),
        );
        expect(result.diagnostics).toEqual([{ source: 'metrics', kind: 'authentication', reason: 'rbac' }]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
    });

    it('keeps concurrent invocation diagnostics and masks isolated', async () => {
        const firstWarn = vi.fn();
        const secondWarn = vi.fn();
        const run = (source: 'account' | 'inventory', name: string, warn: (message: string) => void) =>
            withReadDiagnostics(
                source,
                [name],
                warn,
                async () => {
                    await Promise.resolve();
                    await readRequest(source, 'read', () =>
                        Promise.reject(
                            Object.assign(new Error(`Insufficient access to ${name}.`), { statusCode: 403 }),
                        ),
                    );
                    return { available: true };
                },
                () => ({ available: false }),
            );
        const [first, second] = await Promise.all([
            run('account', 'private-first', firstWarn),
            run('inventory', 'private-second', secondWarn),
        ]);
        expect(first.diagnostics?.map((failure) => failure.source)).toEqual(['account']);
        expect(second.diagnostics?.map((failure) => failure.source)).toEqual(['inventory']);
        expect(firstWarn.mock.calls.flat().join('\n')).not.toContain('private-first');
        expect(secondWarn.mock.calls.flat().join('\n')).not.toContain('private-second');
    });
});
