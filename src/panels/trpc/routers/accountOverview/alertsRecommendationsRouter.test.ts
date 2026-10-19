/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armTestSubscription } from '../../../../cosmosdb/armTestUtils';
import { AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { pagedItems } from '../../../accountOverview/services/testFixtures';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { alertsRecommendationsProcedures } from './alertsRecommendationsRouter';

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('../../../../utils/azureClients', () => ({}));
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});
vi.mock(
    '../../../accountOverview/services',
    async () => import('../../../accountOverview/services/alertsRecommendations'),
);

const router = accountOverviewRouter(alertsRecommendationsProcedures);
const accountId = '/subscriptions/sub-1/providers/Microsoft.DocumentDB/databaseAccounts/account';
const alertId = '/subscriptions/sub-1/providers/Microsoft.AlertsManagement/alerts/alert';

class TestMetadata extends AzureResourceMetadata {
    public constructor(
        portalUrl: string,
        private readonly client: AlertsManagementClient,
    ) {
        super(
            { ...armTestSubscription, environment: { ...armTestSubscription.environment, portalUrl } },
            accountId,
            'account',
            'rg',
            { kind: 'GlobalDocumentDB', documentEndpoint: 'https://account.documents.azure.com' },
        );
    }

    public override getAlertsClient(): Promise<AlertsManagementClient> {
        return Promise.resolve(this.client);
    }
}

beforeEach(() => vi.restoreAllMocks());

describe('alert portal routing', () => {
    it.each([
        'https://portal.azure.com',
        'https://ms.portal.azure.com/',
        'https://portal.azure.us',
        'https://portal.azure.cn/',
    ])('uses the subscription portal %s and tenant through the real router', async (portalUrl) => {
        const client = new AlertsManagementClient({ getToken: async () => null });
        const getAll = vi.spyOn(client.alerts, 'getAll').mockReturnValue(
            pagedItems([
                {
                    id: alertId,
                    name: 'alert',
                    properties: { essentials: { severity: 'Sev1' } },
                },
            ]),
        );
        const caller = router.createCaller({
            webviewName: 'cosmosDbAccountOverview',
            metadata: new TestMetadata(portalUrl, client),
            getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
            onNavigation: () => ({ dispose() {} }),
        });
        const result = await caller.getAlerts({ timeRange: '7d' });
        expect(getAll).toHaveBeenCalledExactlyOnceWith('/subscriptions/sub-1', {
            targetResource: accountId,
            timeRange: '7d',
            monitorCondition: 'Fired',
        });
        expect(result.alerts[0].portalUrl).toBe(
            `${portalUrl.replace(/\/$/, '')}/#@tenant-1/blade/Microsoft_Azure_Monitoring/AlertDetailsTemplateBlade/alertId/${encodeURIComponent(alertId)}`,
        );
    });
});
