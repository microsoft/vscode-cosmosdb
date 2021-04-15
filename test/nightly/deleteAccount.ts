/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementModels } from '@azure/arm-cosmosdb';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DialogResponses } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { AccountApi, accountList, client, resourceGroupList } from './global.resource.test';

suite('Delete Account', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(10 * 60 * 1000);
    const accountItem: {} = {};

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        await Promise.all([delayDeleteAccount(5, AccountApi.MongoDB), delayDeleteAccount(10, AccountApi.Core)]);
    });

    test('Delete Mongo account', async () => {
        await doAccountExsit(AccountApi.MongoDB);
    });

    test('Delete SQL account', async () => {
        await doAccountExsit(AccountApi.Core);
    });

    async function doAccountExsit(accountType: string): Promise<void> {
        assert.ok(accountItem[accountType]);
        const getDatabaseAccount: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupList[accountType]);
        const accountExists: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = getDatabaseAccount.find((account: CosmosDBManagementModels.DatabaseAccountGetResults) => account.name === accountList[accountType]);
        assert.ifError(accountExists);
    }

    async function deleteAccount(accountType: string): Promise<void> {
        const getAccount: CosmosDBManagementModels.DatabaseAccountGetResults = await client.databaseAccounts.get(resourceGroupList[accountType], accountList[accountType]);
        accountItem[accountType] = getAccount;
        const testInputs: string[] = [`${accountList[accountType]} (${accountType})`, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteAccount');
        });
    }

    async function delayDeleteAccount(ms: number, accountType: string): Promise<void> {
        await new Promise<void>((resolve: () => void): void => {
            setTimeout(async () => {
                try {
                    await deleteAccount(accountType);
                } catch {
                }
                finally {
                    resolve();
                }
            }, ms * 1000);
        });
    }
});
