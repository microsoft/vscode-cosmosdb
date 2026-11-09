/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { armTestSubscription } from '../../../../cosmosdb/armTestUtils';
import { AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { unavailableStorage } from '../../../accountOverview/metrics/storage';
import { mockClient } from '../../../accountOverview/services/testFixtures';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { inventoryMetricsProcedures } from './inventoryMetricsRouter';

vi.mock('../../../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});

class TestMetadata extends AzureResourceMetadata {
    constructor(isServerless: boolean) {
        super(armTestSubscription, '/account', 'account', 'rg', {
            capabilities: isServerless ? [{ name: 'EnableServerless' }] : [],
        });
    }
}

describe('inventory metric fallbacks', () => {
    it.each([false, true])(
        'distinguishes a missing Monitor client from empty observations (Serverless: %s)',
        async (isServerless) => {
            const metadata = new TestMetadata(isServerless);
            const getMonitorClient = vi.spyOn(metadata, 'getMonitorClient').mockResolvedValue(undefined);
            const caller = accountOverviewRouter(inventoryMetricsProcedures).createCaller({
                webviewName: 'cosmosDbAccountOverview',
                metadata,
                getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
                onNavigation: () => ({ dispose() {} }),
            });

            await expect(caller.getInventoryMetrics({ timeRange: '24H' })).resolves.toMatchObject({
                available: false,
                metrics: {},
                storageFallback: unavailableStorage('error'),
                throttlingFallbackReason: 'error',
            });

            getMonitorClient.mockResolvedValue(mockClient({}));
            await expect(caller.getInventoryMetrics({ timeRange: '24H' })).resolves.toMatchObject({
                available: false,
                reason: 'noData',
                metrics: {},
                storageFallback: unavailableStorage('noData'),
                throttlingFallbackReason: 'noData',
            });
        },
    );
});
