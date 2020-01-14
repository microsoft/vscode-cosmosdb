/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { resourceGroupsToDelete, client } from './global.resource.test';

suite('SQL action', async function (this: ISuiteCallbackContext): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;

    suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = randomUtils.getRandomHexString(12);
        // Cosmos DB account must have lower case name
        accountName = randomUtils.getRandomHexString(12).toLowerCase();
        resourceGroupsToDelete.push(resourceGroupName);
    });

    test('Create SQL account', async () => {
        const testInputs: (string | RegExp)[] = [accountName, /SQL/, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });
});
