/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armTestSubscription } from '../../../../cosmosdb/armTestUtils';
import { AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { ALERT_MONITOR_CONDITIONS, ALERT_TIME_RANGES } from '../../../accountOverview/services/alertsRecommendations';
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
    it('routes the independent active check through the existing account ARM client', async () => {
        const metadata = new TestMetadata(
            'https://portal.azure.com',
            new AlertsManagementClient({ getToken: async () => null }),
        );
        const client = new CosmosDBManagementClient({ getToken: async () => null }, 'sub-1');
        vi.spyOn(metadata, 'getClient').mockResolvedValue(client);
        const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify({
                count: 1,
                totalRecords: 1,
                resultTruncated: 'false',
                data: [{ totalCount: 1, criticalCount: 1, warningCount: 0 }],
            }),
        }));
        const caller = router.createCaller({
            webviewName: 'cosmosDbAccountOverview',
            metadata,
            getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
            onNavigation: () => ({ dispose() {} }),
        });
        expect(await caller.getActiveAlertSummary()).toMatchObject({
            available: true,
            totalCount: 1,
            criticalCount: 1,
            warningCount: 0,
        });
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][1].url).toContain(metadata.subscription.environment.resourceManagerEndpointUrl);
        const body = JSON.parse(String(send.mock.calls[0][1].body)) as { subscriptions: string[]; query: string };
        expect(body.subscriptions).toEqual(['sub-1']);
        expect(body.query).toContain(accountId);
    });

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
        for (const monitorCondition of ALERT_MONITOR_CONDITIONS) {
            for (const timeRange of ALERT_TIME_RANGES) {
                getAll.mockReturnValueOnce(
                    pagedItems([{ id: alertId, properties: { essentials: { severity: 'Sev1', monitorCondition } } }]),
                );
                const result = await caller.getAlerts({ timeRange, monitorCondition });
                expect(getAll).toHaveBeenLastCalledWith('/subscriptions/sub-1', {
                    targetResource: accountId,
                    timeRange,
                    monitorCondition,
                });
                expect(result).toMatchObject({ timeRange, monitorCondition });
                expect(result.alerts[0].portalUrl).toBe(
                    `${portalUrl.replace(/\/$/, '')}/#@tenant-1/view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId/${encodeURIComponent(encodeURIComponent(alertId))}/invokedFrom/CopyLinkFeature`,
                );
            }
        }
    });

    it('rejects All and incident workflow states before calling Azure', async () => {
        const client = new AlertsManagementClient({ getToken: async () => null });
        const getAll = vi.spyOn(client.alerts, 'getAll');
        const caller = router.createCaller({
            webviewName: 'cosmosDbAccountOverview',
            metadata: new TestMetadata('https://portal.azure.com', client),
            getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
            onNavigation: () => ({ dispose() {} }),
        });
        for (const monitorCondition of ['All', 'New', 'Acknowledged', 'Closed']) {
            // @ts-expect-error Invalid external input must also be rejected at the RPC boundary.
            await expect(caller.getAlerts({ timeRange: '1d', monitorCondition })).rejects.toThrow();
        }
        expect(getAll).not.toHaveBeenCalled();
    });
});
