/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    createHttpHeaders,
    createPipelineRequest,
    type PipelineRequest,
    type PipelineResponse,
} from '@azure/core-rest-pipeline';
import { createAzureSubscriptionClient, type AzExtSubscriptionClientType } from '@microsoft/vscode-azext-azureutils';
import { type IActionContext, type ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { armTestSubscription, createArmTestContext } from '../cosmosdb/armTestUtils';
import { COSMOSDB_ARM_API_VERSION, createCosmosDBManagementClient, PRESERVE_API_VERSION_HEADER } from './azureClients';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    createSubscriptionContext: (subscription: typeof armTestSubscription) => ({
        subscriptionId: subscription.subscriptionId,
        environment: subscription.environment,
        credentials: { getToken: () => Promise.resolve(null) },
    }),
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAzureClient: vi.fn(),
    createAzureSubscriptionClient: vi.fn(
        ([, subscription]: [IActionContext, ISubscriptionContext], Client: AzExtSubscriptionClientType<unknown>) =>
            new Client(subscription.credentials, {
                endpoint: subscription.environment.resourceManagerEndpointUrl,
            }),
    ),
}));

describe('modular ARM client factories', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['public', 'https://management.azure.com/'],
        ['sovereign', 'https://management.usgovcloudapi.net/'],
    ])('preserves subscription and %s cloud endpoint through the extension factory', async (_cloud, endpoint) => {
        const subscription = {
            ...armTestSubscription,
            environment: { ...armTestSubscription.environment, resourceManagerEndpointUrl: endpoint },
        };
        const context = createArmTestContext();
        const cosmos = await createCosmosDBManagementClient(context, subscription);
        expect(cosmos).toBeInstanceOf(CosmosDBManagementClient);
        expect(createAzureSubscriptionClient).toHaveBeenCalledTimes(1);
        expect(context.valuesToMask).toContain(subscription.subscriptionId);

        const cosmosRequest = vi.spyOn(cosmos.pipeline, 'sendRequest').mockImplementation((_http, request) =>
            Promise.resolve({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({ name: 'account' }),
            }),
        );
        await cosmos.databaseAccounts.get('rg', 'account');
        expect(cosmosRequest.mock.calls[0][1].url).toContain(
            `${endpoint}subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account?`,
        );
    });

    it.each([
        ['/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account', false, true],
        ['/subscriptions/sub/providers/Microsoft.DocumentDB/locations/westus/operationResults/operation', false, true],
        ['/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account', true, false],
        ['/subscriptions/sub/providers/Microsoft.Insights/metrics', false, false],
    ])('pins API versions for %s (preserve: %s)', async (path, preserve, pinned) => {
        const client = await createCosmosDBManagementClient(createArmTestContext(), armTestSubscription);
        const policy = client.pipeline
            .getOrderedPolicies()
            .find((entry) => entry.name === 'PinCosmosDBApiVersionPolicy');
        expect(policy).toBeDefined();
        const request = createPipelineRequest({
            url: `https://management.azure.com${path}?api-version=2025-05-01-preview&other=value`,
            method: 'GET',
            headers: createHttpHeaders(preserve ? { [PRESERVE_API_VERSION_HEADER]: 'true' } : {}),
        });
        const next = vi.fn((forwarded: PipelineRequest): Promise<PipelineResponse> =>
            Promise.resolve({ request: forwarded, status: 200, headers: createHttpHeaders() }),
        );
        await policy!.sendRequest(request, next);
        const url = new URL(request.url);
        expect(url.searchParams.get('api-version')).toBe(pinned ? COSMOSDB_ARM_API_VERSION : '2025-05-01-preview');
        expect(url.searchParams.get('other')).toBe('value');
        expect(request.headers.has(PRESERVE_API_VERSION_HEADER)).toBe(false);
        expect(next).toHaveBeenCalledWith(request);
    });
});
