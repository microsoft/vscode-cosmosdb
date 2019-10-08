/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from 'azure-arm-resource';
import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { IHookCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { ext, AzureAccountTreeItemWithAttached } from '../../extension.bundle';
import { longRunningTestsEnabled } from '../global.test';
import { AzExtTreeDataProvider, createAzureClient } from 'vscode-azureextensionui';
import { TestAzureAccount } from 'vscode-azureextensiondev';

export let testAccount: TestAzureAccount;
export let client: CosmosDBManagementClient;
export const resourceGroupsToDelete: string[] = [];

suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
    if (!longRunningTestsEnabled) {
        this.skip();
    }

    this.timeout(2 * 60 * 1000);
    testAccount = new TestAzureAccount(vscode);
    await testAccount.signIn();
    ext.azureAccountTreeItem = new AzureAccountTreeItemWithAttached(testAccount);
    ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'cosmosDB.loadMore');
    client = createAzureClient(testAccount.getSubscriptionContext(), CosmosDBManagementClient);
});

suiteTeardown(async function (this: IHookCallbackContext): Promise<void> {
    if (!longRunningTestsEnabled) {
        this.skip();
    }
    this.timeout(10 * 60 * 1000);
    await deleteResourceGroups();
    ext.azureAccountTreeItem.dispose();
});

async function deleteResourceGroups(): Promise<void> {
    const client: ResourceManagementClient = createAzureClient(testAccount.getSubscriptionContext(), ResourceManagementClient);
    await Promise.all(resourceGroupsToDelete.map(async resourceGroup => {
        if (await client.resourceGroups.checkExistence(resourceGroup)) {
            console.log(`Deleting resource group "${resourceGroup}"...`);
            await client.resourceGroups.beginDeleteMethod(resourceGroup);
            console.log(`Resource group "${resourceGroup}" deleted.`);
        } else {
            // If the test failed, the resource group might not actually exist
            console.log(`Ignoring resource group "${resourceGroup}" because it does not exist.`);
        }
    }));
}
