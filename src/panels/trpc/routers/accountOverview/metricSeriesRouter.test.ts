/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { armTestSubscription } from '../../../../cosmosdb/armTestUtils';
import { AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { mockClient, throwingClient } from '../../../accountOverview/services/testFixtures';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { metricSeriesProcedures } from './metricSeriesRouter';

vi.mock('../../../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});

class TestMetadata extends AzureResourceMetadata {
    public override getMonitorClient = vi
        .fn<AzureResourceMetadata['getMonitorClient']>()
        .mockResolvedValue(mockClient({}));

    constructor(isServerless: boolean, limit?: number) {
        super(armTestSubscription, '/account', 'account', 'rg', {
            capabilities: isServerless ? [{ name: 'EnableServerless' }] : [],
            capacity: { totalThroughputLimit: limit },
        });
    }
}

function createCaller(metadata: TestMetadata) {
    return accountOverviewRouter(metricSeriesProcedures).createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata,
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
    });
}

describe('getMetricSeries applicability contract', () => {
    it.each(['normalizedRu', 'provisionedThroughput'] as const)(
        'returns Serverless %s without acquiring a Monitor client',
        async (metric) => {
            const metadata = new TestMetadata(true);
            metadata.getMonitorClient.mockRejectedValue(new Error('Must not authenticate for inapplicable metrics'));
            const result = await createCaller(metadata).getMetricSeries({
                metric,
                timeRange: '24H',
                databaseId: 'db',
                containerId: 'container',
            });
            expect(result).toMatchObject({
                metric,
                applicability: { status: 'notApplicable' },
                available: false,
                points: [],
                timeRange: '24H',
                databaseId: 'db',
                containerId: 'container',
            });
            expect(metadata.getMonitorClient).not.toHaveBeenCalled();
            expect(result.peak).toBeUndefined();
            expect(result.reason).toBeUndefined();
        },
    );

    it.each([undefined, -1, 0, 4000])(
        'queries both provisioned-capacity metrics regardless of cap %s',
        async (limit) => {
            const metadata = new TestMetadata(false, limit);
            const client = mockClient({});
            const list = vi.spyOn(client.metrics, 'list');
            metadata.getMonitorClient.mockResolvedValue(client);
            const caller = createCaller(metadata);
            for (const metric of ['normalizedRu', 'provisionedThroughput'] as const) {
                await expect(
                    caller.getMetricSeries({ metric, timeRange: '1H', databaseId: "customer's db" }),
                ).resolves.toMatchObject({
                    applicability: { status: 'applicable' },
                    available: false,
                    reason: 'noData',
                    points: [],
                });
            }
            expect(list).toHaveBeenCalledTimes(2);
            expect(list).toHaveBeenCalledWith(
                '/account',
                expect.objectContaining({
                    metricnames: 'NormalizedRUConsumption',
                    filter: "DatabaseName eq 'customer''s db'",
                }),
            );
            expect(list).toHaveBeenCalledWith(
                '/account',
                expect.objectContaining({ metricnames: 'ProvisionedThroughput' }),
            );
        },
    );

    it('keeps RBAC and missing-client failures distinct from inapplicability', async () => {
        const metadata = new TestMetadata(false);
        metadata.getMonitorClient.mockResolvedValue(throwingClient({ statusCode: 403 }));
        const caller = createCaller(metadata);
        await expect(caller.getMetricSeries({ metric: 'normalizedRu', timeRange: '7D' })).resolves.toMatchObject({
            applicability: { status: 'applicable' },
            reason: 'rbac',
        });
        metadata.getMonitorClient.mockResolvedValue(undefined);
        await expect(caller.getMetricSeries({ metric: 'normalizedRu', timeRange: '7D' })).resolves.toMatchObject({
            applicability: { status: 'applicable' },
            reason: 'error',
        });
    });
});
