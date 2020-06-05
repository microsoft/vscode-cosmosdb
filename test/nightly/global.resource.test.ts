/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { ResourceManagementClient } from 'azure-arm-resource';
import * as vscode from 'vscode';
import { TestAzureAccount } from 'vscode-azureextensiondev';
import { AzExtTreeDataProvider, AzureAccountTreeItemWithAttached, createAzureClient, ext, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';

export let testAccount: TestAzureAccount;
export let client: CosmosDBManagementClient;
export const resourceGroupsToDelete: string[] = [];
export const accountList: {} = {};
export const resourceGroupList: {} = {};
export enum AccountApi {
    MongoDB = 'MongoDB',
    Graph = 'graph',
    Core = 'SQL'
}

suiteSetup(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(20 * 60 * 1000);
        testAccount = new TestAzureAccount(vscode);
        await testAccount.signIn();
        ext.azureAccountTreeItem = new AzureAccountTreeItemWithAttached(testAccount);
        ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'azureDatabases.loadMore');
        client = createAzureClient(testAccount.getSubscriptionContext(), CosmosDBManagementClient);

        // Create account
        await Promise.all([delayCreateAccount(5, /graph/), delayCreateAccount(10, /MongoDB/), delayCreateAccount(15, /SQL/)]);
    }
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(10 * 60 * 1000);
        await deleteResourceGroups();
        ext.azureAccountTreeItem.dispose();
    }
});

async function deleteResourceGroups(): Promise<void> {
    const rmClient: ResourceManagementClient = createAzureClient(testAccount.getSubscriptionContext(), ResourceManagementClient);
    await Promise.all(resourceGroupsToDelete.map(async resourceGroup => {
        if (await rmClient.resourceGroups.checkExistence(resourceGroup)) {
            console.log(`Deleting resource group "${resourceGroup}"...`);
            await rmClient.resourceGroups.beginDeleteMethod(resourceGroup);
            console.log(`Resource group "${resourceGroup}" deleted.`);
        } else {
            // If the test failed, the resource group might not actually exist
            console.log(`Ignoring resource group "${resourceGroup}" because it does not exist.`);
        }
    }));
}

async function createAccount(accountType: RegExp): Promise<void> {
    // Cosmos DB account must have lower case name
    const accountName: string = randomUtils.getRandomHexString(12).toLowerCase();
    const resourceGroupName: string = randomUtils.getRandomHexString(12);
    accountList[accountType.source] = accountName;
    resourceGroupList[accountType.source] = resourceGroupName;
    const testInputs: (string | RegExp)[] = [accountType, accountName, '$(plus) Create new resource group', resourceGroupName, 'West US'];
    await testUserInput.runWithInputs(testInputs, async () => {
        await vscode.commands.executeCommand('azureDatabases.createServer');
    });
}

async function delayCreateAccount(ms: number, accountType: RegExp): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(async () => {
            try {
                await createAccount(accountType);
            } catch {
            }
            finally {
                resolve();
            }
        }, ms * 1000);
    });
}
