/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { AzureResourceMetadata } from './AzureResourceMetadata';

export const armTestSubscription = {
    subscriptionId: 'sub-1',
    tenantId: 'tenant-1',
    name: 'Test subscription',
    isCustomCloud: false,
    authentication: {
        getSession: () => undefined,
        getSessionWithScopes: () => undefined,
    },
    environment: {
        name: 'AzureCloud',
        portalUrl: 'https://portal.azure.com',
        managementEndpointUrl: 'https://management.core.windows.net',
        resourceManagerEndpointUrl: 'https://management.azure.com/',
        activeDirectoryEndpointUrl: 'https://login.microsoftonline.com',
        activeDirectoryResourceId: 'https://management.azure.com/',
        validateAuthority: true,
    },
} satisfies AzureSubscription;

export function createArmTestClient(): CosmosDBManagementClient {
    return new CosmosDBManagementClient(
        { getToken: () => Promise.resolve({ token: 'test-token', expiresOnTimestamp: Date.now() + 3_600_000 }) },
        armTestSubscription.subscriptionId,
    );
}

export class ArmTestMetadata extends AzureResourceMetadata {
    public constructor(
        private readonly client: CosmosDBManagementClient,
        subscription = armTestSubscription,
    ) {
        super(subscription, 'account-id', 'account', 'rg', {
            documentEndpoint: 'https://account.documents.azure.com',
        });
    }

    public override getClient(): Promise<CosmosDBManagementClient> {
        return Promise.resolve(this.client);
    }
}

export function createArmTestContext(): IActionContext {
    const unexpectedPrompt = () => Promise.reject(new Error('Unexpected prompt'));
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            onDidFinishPrompt: () => ({ dispose() {} }),
            showQuickPick: unexpectedPrompt,
            showInputBox: unexpectedPrompt,
            showWarningMessage: unexpectedPrompt,
            showOpenDialog: unexpectedPrompt,
            showWorkspaceFolderPick: unexpectedPrompt,
        },
    };
}
