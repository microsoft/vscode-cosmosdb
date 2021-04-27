/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementModels } from '@azure/arm-cosmosdb';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { AccountApi, accountList, client, delayOpAccount, resourceGroupList, resourceGroupsToDelete } from './global.resource.test';

suite('Create Account', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(10 * 60 * 1000);

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        await Promise.all([delayOpAccount(5000, /graph/, createAccount), delayOpAccount(10000, /MongoDB/, createAccount), delayOpAccount(15000, /SQL/, createAccount)]);
    });

    test('Create SQL account', async () => {
        const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = await client.databaseAccounts.get(resourceGroupList[AccountApi.Core], accountList[AccountApi.Core]);
        assert.ok(getDatabaseAccount);
    });

    test('Create MongoDB account', async () => {
        const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = await client.databaseAccounts.get(resourceGroupList[AccountApi.MongoDB], accountList[AccountApi.MongoDB]);
        assert.ok(getDatabaseAccount);
    });

    test('Create graph account', async () => {
        const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = (await client.databaseAccounts.get(resourceGroupList[AccountApi.Graph], accountList[AccountApi.Graph]))._response.parsedBody;
        assert.ok(getDatabaseAccount);
    });
});

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
