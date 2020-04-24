/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import * as vscode from 'vscode';
import { randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { accountList, api, client, resourceGrouList } from './global.resource.test';

suite('Create account', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(20 * 60 * 1000);

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        await Promise.all([promise(5, /graph/), promise(10, /MongoDB/), promise(15, /SQL/)]);
    });

    test('Create SQL account', async () => {
        await doesAccountExists(api.Core);
    });

    test('Create MongoDB account', async () => {
        await doesAccountExists(api.MongoDB);
    });

    test('Create graph account', async () => {
        await doesAccountExists(api.Graph);
    });

    async function createAccount(accountType: RegExp): Promise<CosmosDBManagementModels.DatabaseAccount | undefined> {
        // Cosmos DB account must have lower case name
        const accountName: string = randomUtils.getRandomHexString(12).toLowerCase();
        const resourceGroupName: string = randomUtils.getRandomHexString(12);
        accountList[accountType.source] = accountName;
        resourceGrouList[accountType.source] = resourceGroupName;
        const testInputs: (string | RegExp)[] = [accountName, accountType, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        return await client.databaseAccounts.get(resourceGroupName, accountName);
    }

    async function doesAccountExists(key: string): Promise<void> {
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGrouList[key], accountList[key]);
        assert.ok(getAccount);
    }

    const promise = (m: number, accountType: RegExp) => new Promise((resolve) => {
        setTimeout(async () => {
            try {
                resolve(await createAccount(accountType));
            } catch {
                resolve();
            }
        }, m * 1000);
    });
});
