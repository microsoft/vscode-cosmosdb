/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { armTestSubscription } from '../../../../cosmosdb/armTestUtils';
import { AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { iso, mockClient, pdims, throwingClient } from '../../../accountOverview/services/testFixtures';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { inventoryMetricsProcedures } from './inventoryMetricsRouter';
import { metricSeriesProcedures } from './metricSeriesRouter';
import { partitionHealthProcedures } from './partitionHealthRouter';

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
            kind: 'GlobalDocumentDB',
            capabilities: isServerless ? [{ name: 'EnableServerless' }] : [],
            capacity: { totalThroughputLimit: limit },
            provisioningState: 'Succeeded',
        });
    }
}

function createCaller(metadata: TestMetadata) {
    return accountOverviewRouter({
        ...partitionHealthProcedures,
        ...inventoryMetricsProcedures,
        ...metricSeriesProcedures,
    }).createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata,
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
    });
}

const selection = { databaseId: 'db', containerId: 'container', timeRange: '24H' as const };

describe('Partition Health metric applicability', () => {
    it.each(['ru', 'storage'] as const)(
        'uses storage for Serverless requested mode %s and never fetches normalized RU',
        async (mode) => {
            const metadata = new TestMetadata(true);
            const client = mockClient({
                PhysicalPartitionSizeInfo: {
                    value: [
                        {
                            timeseries: [
                                {
                                    metadatavalues: pdims('db', 'container', 'PhysicalPartitionId', '0'),
                                    data: [{ timeStamp: iso(Date.now()), maximum: 1024 }],
                                },
                            ],
                        },
                    ],
                },
            });
            const list = vi.spyOn(client.metrics, 'list');
            metadata.getMonitorClient.mockResolvedValue(client);
            const caller = createCaller(metadata);
            const result = await caller.getPartitionHealth({ ...selection, mode });
            expect(result).toMatchObject({ mode: 'storage', available: true, partitionCount: 1 });
            expect(result.tiles[0].sharePercent).toBe(100);
            await caller.getInventoryMetrics({ timeRange: '24H' });
            await caller.getMetricSeries({ metric: 'normalizedRu', timeRange: '24H' });
            expect(list).toHaveBeenCalledWith(
                '/account',
                expect.objectContaining({ metricnames: 'PhysicalPartitionSizeInfo' }),
            );
            expect(list).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ metricnames: 'NormalizedRUConsumption' }),
            );
        },
    );

    it.each([
        { client: mockClient({}), reason: 'noData' },
        { client: throwingClient({ statusCode: 403 }), reason: 'rbac' },
        { client: throwingClient({ statusCode: 500 }), reason: 'error' },
        { client: undefined, reason: 'error' },
    ])('preserves the actual Serverless storage outcome: $reason', async ({ client, reason }) => {
        const metadata = new TestMetadata(true);
        metadata.getMonitorClient.mockResolvedValue(client);
        expect(await createCaller(metadata).getPartitionHealth({ ...selection, mode: 'ru' })).toMatchObject({
            mode: 'storage',
            available: false,
            reason,
            tiles: [],
        });
    });

    it.each([undefined, -1, 0, 4000])(
        'preserves both Provisioned modes regardless of throughput limit %s',
        async (limit) => {
            const metadata = new TestMetadata(false, limit);
            const client = mockClient({});
            const list = vi.spyOn(client.metrics, 'list');
            metadata.getMonitorClient.mockResolvedValue(client);
            const caller = createCaller(metadata);
            for (const mode of ['ru', 'storage'] as const) {
                expect(await caller.getPartitionHealth({ ...selection, mode })).toMatchObject({
                    mode,
                    reason: 'noData',
                });
            }
            await caller.getInventoryMetrics({ timeRange: '24H' });
            expect(
                list.mock.calls.filter(([, options]) => options?.metricnames === 'NormalizedRUConsumption'),
            ).toHaveLength(2);
            expect(list).toHaveBeenCalledWith(
                '/account',
                expect.objectContaining({ metricnames: 'PhysicalPartitionSizeInfo' }),
            );
        },
    );
});
