/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AzureResourceMetadata } from '../../../../cosmosdb/AzureResourceMetadata';
import { getInventoryResult } from '../../../accountOverview/services/inventory';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewRouter } from '../../trpc';
import { accountInventoryProcedures } from './accountInventoryRouter';

// Exercise real tRPC procedure wiring, isolating only observability middleware and ARM acquisition.
vi.mock('../../trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const trpc = initWebviewTrpc<AccountOverviewRouterContext>();
    return { accountOverviewProcedure: trpc.publicProcedure, accountOverviewRouter: trpc.router };
});
vi.mock('../../../accountOverview/services/inventory', () => ({ getInventoryResult: vi.fn() }));

const router = accountOverviewRouter(accountInventoryProcedures);

function createCaller(account: DatabaseAccountGetResults = {}) {
    const metadata = {
        accountId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/acct',
        accountName: 'acct',
        resourceGroup: 'rg',
        subscription: { subscriptionId: 'sub', name: 'Production' },
        documentEndpoint: 'https://acct.documents.azure.com/',
        isServerless: false,
        databaseAccount: { kind: 'GlobalDocumentDB', ...account },
        getClient: vi.fn<AzureResourceMetadata['getClient']>().mockResolvedValue(undefined),
    };
    const caller = router.createCaller({
        webviewName: 'cosmosDbAccountOverview',
        metadata: metadata as unknown as AzureResourceMetadata,
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose: () => {} }),
    });
    return { caller, metadata };
}

beforeEach(() => vi.resetAllMocks());

describe('account summary procedure', () => {
    it('returns periodic backup settings and explicit failover false without fabricating continuous settings', async () => {
        const { caller, metadata } = createCaller({
            enableAutomaticFailover: false,
            backupPolicy: {
                type: 'Periodic',
                periodicModeProperties: { backupIntervalInMinutes: 240, backupRetentionIntervalInHours: 8 },
            },
            capacity: { totalThroughputLimit: -1 },
        });
        const summary = await caller.getAccountSummary();
        expect(summary).toMatchObject({
            accountName: 'acct',
            subscriptionId: 'sub',
            subscriptionName: 'Production',
            apiType: 'NoSQL',
            documentEndpoint: metadata.documentEndpoint,
            automaticFailoverEnabled: false,
            backupPolicyType: 'Periodic',
            backupIntervalMinutes: 240,
            backupRetentionHours: 8,
            totalThroughputLimit: -1,
        });
        expect(summary.continuousBackupTier).toBeUndefined();
        expect(metadata.getClient).not.toHaveBeenCalled();
    });

    it.each(['Continuous7Days', 'Continuous30Days'])(
        'returns the continuous tier %s, not periodic fields',
        async (tier) => {
            const { caller } = createCaller({
                enableAutomaticFailover: true,
                backupPolicy: { type: 'Continuous', continuousModeProperties: { tier } },
            });
            const summary = await caller.getAccountSummary();
            expect(summary).toMatchObject({
                automaticFailoverEnabled: true,
                backupPolicyType: 'Continuous',
                continuousBackupTier: tier,
            });
            expect(summary.backupIntervalMinutes).toBeUndefined();
            expect(summary.backupRetentionHours).toBeUndefined();
        },
    );

    it.each([
        undefined,
        { type: 'Periodic' },
        { type: 'Continuous' },
        {
            type: 'FuturePolicy',
            periodicModeProperties: { backupIntervalInMinutes: 240, backupRetentionIntervalInHours: 8 },
            continuousModeProperties: { tier: 'Continuous7Days' },
        },
    ])('keeps absent or unknown optional settings absent: %j', async (policy) => {
        const { caller } = createCaller({
            backupPolicy: policy as DatabaseAccountGetResults['backupPolicy'],
        });
        const summary = await caller.getAccountSummary();
        expect(summary.backupPolicyType).toBe(policy?.type);
        expect(summary.automaticFailoverEnabled).toBeUndefined();
        expect(summary.backupIntervalMinutes).toBeUndefined();
        expect(summary.backupRetentionHours).toBeUndefined();
        expect(summary.continuousBackupTier).toBeUndefined();
        expect(summary.totalThroughputLimit).toBeUndefined();
    });
});

describe('inventory procedure', () => {
    it('passes empty database names through the real procedure without synthesizing container rows', async () => {
        const { caller, metadata } = createCaller();
        const client = {} as NonNullable<Awaited<ReturnType<AzureResourceMetadata['getClient']>>>;
        metadata.getClient.mockResolvedValue(client);
        vi.mocked(getInventoryResult).mockResolvedValue({ available: true, rows: [], databases: ['empty-db'] });

        await expect(caller.getInventory()).resolves.toEqual({
            supported: true,
            available: true,
            rows: [],
            databases: ['empty-db'],
        });
        expect(getInventoryResult).toHaveBeenCalledExactlyOnceWith(client, 'rg', 'acct', false);
    });
});
