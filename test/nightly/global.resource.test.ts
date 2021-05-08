/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, CosmosDBManagementModels } from '@azure/arm-cosmosdb';
import { ResourceManagementClient } from '@azure/arm-resources';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { TestAzureAccount } from 'vscode-azureextensiondev';
import { AzExtTreeDataProvider, AzureAccountTreeItemWithAttached, createAzureClient, DialogResponses, ext, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';

export let testAccount: TestAzureAccount;
export let client: CosmosDBManagementClient;
export const resourceGroupsToDelete: string[] = [];
export const accountList: {} = {};
export const resourceGroupList: {} = {};
const accountItem: {} = {};
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
        await Promise.all([delayOpAccount(5, /graph/, createAccount), delayOpAccount(10, /MongoDB/, createAccount), delayOpAccount(15, /SQL/, createAccount)]);
    }
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(10 * 60 * 1000);

        // Delete account
        await Promise.all([delayOpAccount(5, /MongoDB/, deleteAccount), delayOpAccount(10, /SQL/, deleteAccount)]);
        try {
            // If two or more of the following asserts fail, only one error will be thrown as a result.
            await doesAccountExsit(AccountApi.MongoDB);
            await doesAccountExsit(AccountApi.Core);
        } catch (error) {
            throw new Error(error);
        }
        finally {
            await deleteResourceGroups();
            ext.azureAccountTreeItem.dispose();
        }
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
    resourceGroupsToDelete.push(resourceGroupName);
    const testInputs: (string | RegExp)[] = [accountType, accountName, '$(plus) Create new resource group', resourceGroupName, 'West US'];
    await testUserInput.runWithInputs(testInputs, async () => {
        await vscode.commands.executeCommand('azureDatabases.createServer');
    });
}

async function doesAccountExsit(accountType: string): Promise<void> {
    assert.ok(accountItem[accountType], `${accountType} account does not exist`);
    const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupList[accountType]);
    const accountExists: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = getDatabaseAccount.find((account: CosmosDBManagementModels.DatabaseAccountGetResults) => account.name === accountList[accountType]);
    assert.ifError(accountExists);
}

async function deleteAccount(accountType: RegExp): Promise<void> {
    const getAccount: CosmosDBManagementModels.DatabaseAccountGetResults = await client.databaseAccounts.get(resourceGroupList[accountType.source], accountList[accountType.source]);
    accountItem[accountType.source] = getAccount;
    const testInputs: string[] = [`${accountList[accountType.source]} (${accountType.source})`, DialogResponses.deleteResponse.title];
    await testUserInput.runWithInputs(testInputs, async () => {
        await vscode.commands.executeCommand('cosmosDB.deleteAccount');
    });
}

async function delayOpAccount(s: number, accountType: RegExp, callback: (arg0: RegExp) => Promise<void>): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(async () => {
            try {
                await callback(accountType);
            } catch {
            }
            finally {
                resolve();
            }
        }, s * 1000);
    });
}
