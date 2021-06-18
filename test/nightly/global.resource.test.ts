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
    Graph = 'Gremlin',
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
        await Promise.all([delayOpAccount(5, /Gremlin/, createAccount), delayOpAccount(10, /MongoDB/, createAccount), delayOpAccount(15, /SQL/, createAccount)]);
    }
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(10 * 60 * 1000);

        // Delete account
        await Promise.all([delayOpAccount(5, accountList[AccountApi.Graph], deleteAccount), delayOpAccount(10, accountList[AccountApi.MongoDB], deleteAccount), delayOpAccount(15, accountList[AccountApi.Core], deleteAccount)]);
        try {
            // If two or more of the following asserts fail, only one error will be thrown as a result.
            for (const key of Object.keys(accountList)) {
                const accountName: string = accountList[key];
                assert.ok(accountItem[accountName]);
                const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupList[key]);
                const accountExists: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = getDatabaseAccount.find((account: CosmosDBManagementModels.DatabaseAccountGetResults) => account.name === accountName);
                assert.ifError(accountExists);
            }
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

async function deleteAccount(name: string): Promise<void> {
    const accountType: string = await getAccountType(accountList, name);
    accountItem[name] = await client.databaseAccounts.get(resourceGroupList[accountType], name);
    const testInputs: string[] = [`${name} (${accountType})`, DialogResponses.deleteResponse.title];
    await testUserInput.runWithInputs(testInputs, async () => {
        await vscode.commands.executeCommand('cosmosDB.deleteAccount');
    });
}

async function delayOpAccount(s: number, accountTypeOrName: RegExp | string, callback: (arg0: RegExp | string) => Promise<void>): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(async () => {
            try {
                await callback(accountTypeOrName);
            } catch {
            }
            finally {
                resolve();
            }
        }, s * 1000);
    });
}

async function getAccountType(dictionary: {}, value: string): Promise<string> {
    for (const key of Object.keys(dictionary)) {
        if (dictionary[key] === value) {
            return key;
        }
    }
    throw new Error(`Account type of the ${value} resoure can't be found.`);
}
