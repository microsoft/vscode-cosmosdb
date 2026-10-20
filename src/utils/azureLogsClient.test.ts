/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenCredential } from '@azure/core-auth';
import { createHttpHeaders, type PipelineRequest } from '@azure/core-rest-pipeline';
import { Environment } from '@azure/ms-rest-azure-env';
import { type createCredential, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { describe, expect, it, vi } from 'vitest';
import { createLogsQueryClient } from './azureClients';

vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAzureClient: vi.fn(),
    createAzureSubscriptionClient: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    createSubscriptionContext: vi.fn(() => {
        throw new Error('Log Analytics must not use the ARM credential.');
    }),
    createCredential: (getSession: Parameters<typeof createCredential>[0]): TokenCredential => ({
        getToken: async (scopes) => {
            const session = await getSession(typeof scopes === 'string' ? [scopes] : scopes);
            return session ? { token: session.accessToken, expiresOnTimestamp: Date.now() + 3600000 } : null;
        },
    }),
}));

function setup(environment: Environment = Environment.AzureCloud) {
    const getSession = vi.fn<AzureSubscription['authentication']['getSession']>();
    const getSessionWithScopes = vi.fn<AzureSubscription['authentication']['getSessionWithScopes']>();
    getSessionWithScopes.mockResolvedValue({
        id: 'logs-session',
        accessToken: 'logs-token',
        scopes: [],
        account: { id: 'account-id', label: 'Test account' },
    });
    const subscription: AzureSubscription = {
        authentication: { getSession, getSessionWithScopes },
        environment,
        isCustomCloud: false,
        name: 'Test subscription',
        subscriptionId: 'subscription-id',
        tenantId: 'tenant-id',
    };
    const context: IActionContext = {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        get ui(): IActionContext['ui'] {
            throw new Error('Client creation must not use the action UI.');
        },
    };
    return { subscription, context, getSession, getSessionWithScopes };
}

async function createInterceptedClient(subscription: AzureSubscription, context: IActionContext) {
    const client = await createLogsQueryClient(context, subscription);
    const requests: PipelineRequest[] = [];
    client.pipeline.addPolicy(
        {
            name: 'testTransport',
            sendRequest: async (request) => {
                requests.push(request);
                return {
                    request,
                    status: 200,
                    headers: createHttpHeaders(),
                    bodyAsText: JSON.stringify({ tables: [{ name: 'PrimaryResult', columns: [], rows: [] }] }),
                };
            },
        },
        { afterPhase: 'Sign' },
    );
    return { client, requests };
}

const resourceId = 'subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
const timespan = { duration: 'PT1H' };

describe('createLogsQueryClient', () => {
    it.each([
        { environment: Environment.AzureCloud, audience: 'https://api.loganalytics.io' },
        { environment: Environment.ChinaCloud, audience: 'https://api.loganalytics.azure.cn' },
        { environment: Environment.USGovernment, audience: 'https://api.loganalytics.us' },
    ])('uses scoped subscription authentication and endpoint $audience', async ({ environment, audience }) => {
        const { subscription, context, getSession, getSessionWithScopes } = setup(environment);
        const { client, requests } = await createInterceptedClient(subscription, context);

        await client.queryResource(resourceId, 'CDBDataPlaneRequests | take 0', timespan);

        expect(getSession).not.toHaveBeenCalled();
        expect(getSessionWithScopes).toHaveBeenCalledExactlyOnceWith([`${audience}/.default`], {
            createIfNone: true,
        });
        expect(getSessionWithScopes.mock.contexts[0]).toBe(subscription.authentication);
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(`${audience}/v1/${resourceId}/query`);
        expect(requests[0].headers.get('authorization')).toBe('Bearer logs-token');
        expect(context.valuesToMask).toContain(subscription.subscriptionId);
    });

    it('does not fall back to an ARM token when no scoped session is available', async () => {
        const { subscription, context, getSession, getSessionWithScopes } = setup();
        getSessionWithScopes.mockResolvedValue(undefined);
        const { client, requests } = await createInterceptedClient(subscription, context);

        await expect(client.queryResource(resourceId, 'CDBDataPlaneRequests | take 0', timespan)).rejects.toThrow();
        expect(getSession).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
    });

    it('propagates scoped authentication failures without sending a request', async () => {
        const { subscription, context, getSession, getSessionWithScopes } = setup();
        const error = new Error('Consent was cancelled.');
        getSessionWithScopes.mockRejectedValue(error);
        const { client, requests } = await createInterceptedClient(subscription, context);

        await expect(client.queryResource(resourceId, 'CDBDataPlaneRequests | take 0', timespan)).rejects.toThrow(
            error,
        );
        expect(getSession).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
    });
});
