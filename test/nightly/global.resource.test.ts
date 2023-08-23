/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { ResourceManagementClient } from "@azure/arm-resources";
import { createAzureClient, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { TestAzureAccount, createTestActionContext, runWithTestActionContext } from '@microsoft/vscode-azext-dev';
import * as assert from "assert";
import * as vscode from 'vscode';
import {
    AzExtTreeDataProvider,
    AzureAccountTreeItemWithAttached,
    DialogResponses,
    createCosmosDBClient,
    createServer,
    deleteAccount,
    ext,
    randomUtils,
} from '../../extension.bundle';

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

export const longRunningTestsEnabled: boolean = !/^(false|0)?$/i.test(process.env.ENABLE_LONG_RUNNING_TESTS || '');

suiteSetup(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(20 * 60 * 1000);
        testAccount = new TestAzureAccount(vscode);
        await testAccount.signIn();
        ext.azureAccountTreeItem = new AzureAccountTreeItemWithAttached(testAccount);
        ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'azureDatabases.loadMore');
        client = await createCosmosDBClient([await createTestActionContext(), testAccount.getSubscriptionContext()]);

        // Create account
        await Promise.all([delayOpAccount(5, /Gremlin/, createTestAccount), delayOpAccount(10, /MongoDB/, createTestAccount), delayOpAccount(15, /SQL/, createTestAccount)]);
    }
});

suiteTeardown(async function (this: Mocha.Context): Promise<void> {
    if (longRunningTestsEnabled) {
        this.timeout(20 * 60 * 1000);

        // Delete account
        await Promise.all([delayOpAccount(5, accountList[AccountApi.Graph], deleteTestAccount), delayOpAccount(10, accountList[AccountApi.MongoDB], deleteTestAccount), delayOpAccount(15, accountList[AccountApi.Core], deleteTestAccount)]);
        try {
            // If two or more of the following asserts fail, only one error will be thrown as a result.
            for (const key of Object.keys(accountList)) {
                const accountName: string = accountList[key];
                assert.ok(accountItem[accountName]);
                const getDatabaseAccount = client.databaseAccounts.listByResourceGroup(resourceGroupList[key]);
                const accountExists: DatabaseAccountGetResults | undefined = (await uiUtils.listAllIterator(getDatabaseAccount)).find((account: DatabaseAccountGetResults) => account.name === accountName);
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
    const rmClient = createAzureClient([await createTestActionContext(), testAccount.getSubscriptionContext()], ResourceManagementClient);
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

async function createTestAccount(accountType: RegExp): Promise<void> {
    // Cosmos DB account must have lower case name
    const accountName: string = randomUtils.getRandomHexString(12).toLowerCase();
    const resourceGroupName: string = randomUtils.getRandomHexString(12);
    accountList[accountType.source] = accountName;
    resourceGroupList[accountType.source] = resourceGroupName;
    resourceGroupsToDelete.push(resourceGroupName);
    const testInputs: (string | RegExp)[] = [accountType, accountName, 'Provisioned Throughput', '$(plus) Create new resource group', resourceGroupName, 'West US'];
    await runWithTestActionContext('createServer', async context => {
        await context.ui.runWithInputs(testInputs, async () => {
            await createServer(context);
        });
    });
}

async function deleteTestAccount(name: string): Promise<void> {
    const accountType: string = await getAccountType(accountList, name);
    accountItem[name] = await client.databaseAccounts.get(resourceGroupList[accountType], name);
    const testInputs: string[] = [`${name} (${accountType})`, DialogResponses.deleteResponse.title];
    await runWithTestActionContext('deleteAccount', async context => {
        await context.ui.runWithInputs(testInputs, async () => {
            await deleteAccount(context);
        });
    });
}

async function delayOpAccount(timeInMs: number, accountTypeOrName: RegExp | string, callback: (arg0: RegExp | string) => Promise<void>): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(async () => {
            try {
                await callback(accountTypeOrName);
            } catch {
            }
            finally {
                resolve();
            }
        }, timeInMs * 1000);
    });
}

async function getAccountType(dictionary: {}, value: string): Promise<string> {
    for (const key of Object.keys(dictionary)) {
        if (dictionary[key] === value) {
            return key;
        }
    }
    throw new Error(`Account type of the ${value} resource can't be found.`);
}
