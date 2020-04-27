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
        await Promise.all([delayCreateAccount(5, /graph/), delayCreateAccount(10, /MongoDB/), delayCreateAccount(15, /SQL/)]);
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

    async function createAccount(accountType: RegExp): Promise<void> {
        // Cosmos DB account must have lower case name
        const accountName: string = randomUtils.getRandomHexString(12).toLowerCase();
        const resourceGroupName: string = randomUtils.getRandomHexString(12);
        accountList[accountType.source] = accountName;
        resourceGrouList[accountType.source] = resourceGroupName;
        const testInputs: (string | RegExp)[] = [accountName, accountType, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
    }

    async function doesAccountExists(key: string): Promise<void> {
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGrouList[key], accountList[key]);
        assert.ok(getAccount);
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
});
