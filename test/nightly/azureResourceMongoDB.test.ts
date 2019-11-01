/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { randomUtils, appendExtensionUserAgent, connectToMongoClient, IDatabaseInfo } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { resourceGroupsToDelete, client, testAccount } from './global.resource.test';
import { MongoClient } from 'mongodb';

suite('MongoDB action', async function (this: ISuiteCallbackContext): Promise<void> {
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

    test('Create MongoDB account', async () => {
        const testInputs: string[] = [accountName, 'MongoDB', '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const createAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(createAccount);
    });

    test('Create Mongo Database', async () => {
        const databaseName: string = randomUtils.getRandomHexString(12);
        const collectionName: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName, collectionName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createMongoDatabase');
        });
        await vscode.env.clipboard.writeText('');
        await testUserInput.runWithInputs([`${accountName} (MongoDB)`], async () => {
            await vscode.commands.executeCommand('cosmosDB.copyConnectionString');
        });
        const connectionString: string = await vscode.env.clipboard.readText();
        const mongoClient: MongoClient | undefined = await connectToMongoClient(connectionString, appendExtensionUserAgent())
        let listDatabases: { databases: IDatabaseInfo[] } = await mongoClient.db(accountName).admin().listDatabases();
        const MongoDatabase: IDatabaseInfo[] = listDatabases.databases.filter((database: IDatabaseInfo) => (database.name == databaseName));
        assert.ok(MongoDatabase[0].name == databaseName, `Mongo Database should be ${databaseName} rather than ${MongoDatabase[0].name}.`);
    });
});

