/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { randomUtils, appendExtensionUserAgent, connectToMongoClient, IDatabaseInfo, DialogResponses } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { resourceGroupsToDelete, client, testAccount } from './global.resource.test';
import { MongoClient, Collection } from 'mongodb';

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
        const mongoClient: MongoClient | undefined = await getMongoClient();
        const listDatabases: { databases: IDatabaseInfo[] } = await mongoClient.db(accountName).admin().listDatabases();
        const mongoDatabase: IDatabaseInfo | undefined = listDatabases.databases.find((database: IDatabaseInfo) => database.name === databaseName);
        assert.ok(mongoDatabase);
    });

    test('Create Mongo Collection', async () => {
        const databaseName: string = randomUtils.getRandomHexString(12);
        const collectionName: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, '$(plus) Create new Database...', databaseName, collectionName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createMongoCollection');
        });
        const mongoClient: MongoClient | undefined = await getMongoClient();
        const listCollections: Collection[] = await mongoClient.db(databaseName).collections();
        const collection: Collection | undefined = listCollections.find((collection: Collection) => collection.collectionName === collectionName);
        assert.ok(collection);
    });

    test('Delete account', async () => {
        const createAccount: CosmosDBManagementModels.DatabaseAccount = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(createAccount);
        const testInputs: string[] = [`${accountName} (MongoDB)`, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteAccount');
        });
        const listAccounts: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupName);
        const accountExists: CosmosDBManagementModels.DatabaseAccount | undefined = listAccounts.find((account: CosmosDBManagementModels.DatabaseAccount) => account.name === accountName);
        assert.ifError(accountExists);
    });

    async function getMongoClient(): Promise<MongoClient> {
        await vscode.env.clipboard.writeText('');
        await testUserInput.runWithInputs([`${accountName} (MongoDB)`], async () => {
            await vscode.commands.executeCommand('cosmosDB.copyConnectionString');
        });
        const connectionString: string = await vscode.env.clipboard.readText();
        return await connectToMongoClient(connectionString, appendExtensionUserAgent());
    }
});
