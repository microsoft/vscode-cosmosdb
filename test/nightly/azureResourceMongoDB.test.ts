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

suite('MongoDB action', async function (this: ISuiteCallbackContext): Promise<void> {
    this.timeout(20 * 60 * 1000);

    suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
    });

    test('create Cosmos DB account', async () => {
        const resourceGroupName: string = randomUtils.getRandomHexString(12);
        // Cosmos DB account must have lower case name
        const accountName: string = randomUtils.getRandomHexString(12).toLowerCase();
        resourceGroupsToDelete.push(resourceGroupName);
        const testInputs: string[] = [accountName, 'MongoDB', '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const createAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(createAccount);
    });
});




