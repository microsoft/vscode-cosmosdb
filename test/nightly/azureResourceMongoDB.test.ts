/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementModels } from '@azure/arm-cosmosdb';
import * as assert from 'assert';
import { Collection, MongoClient } from 'mongodb';
import { runWithTestActionContext } from 'vscode-azureextensiondev';
import { appendExtensionUserAgent, connectToMongoClient, createMongoCollection, createMongoDatabase, deleteMongoCollection, deleteMongoDB, DialogResponses, IDatabaseInfo, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { AccountApi, accountList, client, resourceGroupList, testAccount } from './global.resource.test';

suite('MongoDB action', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let databaseName1: string;
    let databaseName2: string;
    let collectionName1: string;

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = resourceGroupList[AccountApi.MongoDB];
        accountName = accountList[AccountApi.MongoDB];
        databaseName1 = randomUtils.getRandomHexString(12);
        databaseName2 = randomUtils.getRandomHexString(12);
        collectionName1 = randomUtils.getRandomHexString(12);
    });

    test('Create MongoDB account', async () => {
        const getAccount: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create Mongo Database', async () => {
        const collectionName2: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName1, collectionName2];
        await runWithTestActionContext('createMongoDatabase', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await createMongoDatabase(context);
            });
        });
        assert.ok(await doesMongoDatabaseExist(accountName, databaseName1));
    });

    test('Create Mongo Collection', async () => {
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, '$(plus) Create new Database...', databaseName2, collectionName1];
        await runWithTestActionContext('createMongoCollection', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await createMongoCollection(context);
            });
        });
        assert.ok(await doesMongoCollectionExist(accountName, databaseName2, collectionName1));
    });

    test('Delete Mongo Collection', async () => {
        assert.ok(await doesMongoCollectionExist(accountName, databaseName2, collectionName1));
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName2, collectionName1, DialogResponses.deleteResponse.title];
        await runWithTestActionContext('deleteMongoCollection', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await deleteMongoCollection(context);
            });
        });
        const mongoCollection: Collection | undefined = await doesMongoCollectionExist(accountName, databaseName2, collectionName1);
        assert.ifError(mongoCollection);
    });

    test('Delete Mongo Database', async () => {
        assert.ok(await doesMongoDatabaseExist(accountName, databaseName1));
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName1, DialogResponses.deleteResponse.title];
        await runWithTestActionContext('deleteMongoDB', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await deleteMongoDB(context);
            });
        });
        const mongoDatabase: IDatabaseInfo | undefined = await doesMongoDatabaseExist(accountName, databaseName1);
        assert.ifError(mongoDatabase);
    });

    async function getMongoClient(resourceName: string): Promise<MongoClient> {
        const connectionString: string = await getConnectionString(resourceName);
        return await connectToMongoClient(connectionString, appendExtensionUserAgent());
    }

    async function doesMongoDatabaseExist(mongodbAccountName: string, databasebName: string): Promise<IDatabaseInfo | undefined> {
        const mongoClient: MongoClient | undefined = await getMongoClient(mongodbAccountName);
        const listDatabases: { databases: IDatabaseInfo[] } = await mongoClient.db(mongodbAccountName).admin().listDatabases();
        return listDatabases.databases.find((database: IDatabaseInfo) => database.name === databasebName);
    }

    async function doesMongoCollectionExist(mongodbAccountName: string, databasebName: string, collectionName: string): Promise<Collection | undefined> {
        const mongoClient: MongoClient | undefined = await getMongoClient(mongodbAccountName);
        const listCollections: Collection[] = await mongoClient.db(databasebName).collections();
        return listCollections.find((collection: Collection) => collection.collectionName === collectionName);

    }
});
