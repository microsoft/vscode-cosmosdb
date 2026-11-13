/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { vi } from 'vitest';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { armTestSubscription, createArmTestClient, createArmTestContext } from './armTestUtils';
import { AzureResourceMetadata } from './AzureResourceMetadata';
import { SERVERLESS_CAPABILITY_NAME } from './cosmosdb-shared-constants';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, action: (context: IActionContext) => Promise<unknown>) => action(createArmTestContext()),
    ),
}));
vi.mock('../utils/azureClients', () => ({
    createCosmosDBManagementClient: vi.fn(),
}));

/**
 * The real constructor is `protected` (instances are meant to be built via the async static
 * `create`). A tiny subclass lets us construct instances directly with a controlled
 * `databaseAccount` so we can unit-test the pure getters without any network/SDK calls.
 */
class TestableAzureResourceMetadata extends AzureResourceMetadata {
    public constructor(databaseAccount: Partial<DatabaseAccountGetResults>) {
        super(
            { subscriptionId: 'sub-1' } as unknown as AzureSubscription,
            'account-id',
            'account-name',
            'resource-group',
            databaseAccount,
        );
    }
}

describe('AzureResourceMetadata', () => {
    describe('account snapshot', () => {
        it.each([
            [true, true],
            [false, false],
            [undefined, undefined],
            [null, undefined],
            ['false', undefined],
        ])('preserves the unmodeled change-feed flag %j as %j', async (value, expected) => {
            const client = createArmTestClient();
            vi.mocked(createCosmosDBManagementClient).mockResolvedValue(client);
            const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({
                    properties: {
                        documentEndpoint: 'https://account.documents.azure.com',
                        enableAllVersionsAndDeletesChangeFeed: value,
                    },
                }),
            }));
            const result = await AzureResourceMetadata.create({
                id: 'account-id',
                name: 'account',
                resourceGroup: 'rg',
                subscription: armTestSubscription,
                azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
                raw: {},
            });
            expect(result?.databaseAccount).toMatchObject({
                enableAllVersionsAndDeletesChangeFeed: expected,
                documentEndpoint: 'https://account.documents.azure.com',
            });
            expect(send).toHaveBeenCalledOnce();
        });
    });

    describe('documentEndpoint', () => {
        it('returns the document endpoint when present', () => {
            const metadata = new TestableAzureResourceMetadata({
                documentEndpoint: 'https://acc.documents.azure.com:443/',
            });
            expect(metadata.documentEndpoint).toBe('https://acc.documents.azure.com:443/');
        });

        it('returns an empty string when the endpoint is missing', () => {
            const metadata = new TestableAzureResourceMetadata({});
            expect(metadata.documentEndpoint).toBe('');
        });
    });

    describe('isServerless', () => {
        it('is true when capabilities include the serverless capability', () => {
            const metadata = new TestableAzureResourceMetadata({
                capabilities: [{ name: SERVERLESS_CAPABILITY_NAME }],
            });
            expect(metadata.isServerless).toBe(true);
        });

        it('is true even when mixed with other capabilities', () => {
            const metadata = new TestableAzureResourceMetadata({
                capabilities: [{ name: 'EnableGremlin' }, { name: SERVERLESS_CAPABILITY_NAME }],
            });
            expect(metadata.isServerless).toBe(true);
        });

        it('is false when capabilities do not include the serverless capability', () => {
            const metadata = new TestableAzureResourceMetadata({
                capabilities: [{ name: 'EnableGremlin' }],
            });
            expect(metadata.isServerless).toBe(false);
        });

        it('is false when there are no capabilities', () => {
            const metadata = new TestableAzureResourceMetadata({});
            expect(metadata.isServerless).toBe(false);
        });
    });
});
