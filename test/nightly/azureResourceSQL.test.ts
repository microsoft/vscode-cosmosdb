/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { ContainerDefinition, CosmosClient, DatabaseDefinition, Resource } from '@azure/cosmos';
import * as assert from 'assert';
import { runWithTestActionContext } from 'vscode-azureextensiondev';
import { createDocDBCollection, createDocDBDatabase, deleteDocDBCollection, deleteDocDBDatabase, DialogResponses, getCosmosClient, ParsedDocDBConnectionString, parseDocDBConnectionString, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { AccountApi, accountList, client, resourceGroupList, testAccount } from './global.resource.test';

suite('SQL action', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let databaseName: string;
    let collectionId2: string;

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = resourceGroupList[AccountApi.Core];
        accountName = accountList[AccountApi.Core];
        databaseName = randomUtils.getRandomHexString(12);
        collectionId2 = randomUtils.getRandomHexString(12);
    });

    test('Create SQL account', async () => {
        const getAccount: DatabaseAccountGetResults | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create SQL Database', async () => {
        const collectionId1: string = randomUtils.getRandomHexString(12);
        // Partition key cannot begin with a digit
        const partitionKey1: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, collectionId1, partitionKey1, '1000'];
        await runWithTestActionContext('createDocDBDatabase', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await createDocDBDatabase(context);
            });
        });
        assert.ok(await getDatabaseMeta());
    });

    test('Create SQL collection', async () => {
        // Partition key cannot begin with a digit
        const partitionKey2: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, collectionId2, partitionKey2, '1000'];
        await runWithTestActionContext('createDocDBCollection', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await createDocDBCollection(context);
            });
        });
        assert.ok(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
    });

    test('Delete SQL collection', async () => {
        assert.ok(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, collectionId2, DialogResponses.deleteResponse.title];
        await runWithTestActionContext('deleteDocDBCollection', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await deleteDocDBCollection(context);
            });
        });
        assert.ifError(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
    });

    test('Delete SQL Database', async () => {
        assert.ok(await getDatabaseMeta());
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, DialogResponses.deleteResponse.title];
        await runWithTestActionContext('deleteDocDBDatabase', async context => {
            await context.ui.runWithInputs(testInputs, async () => {
                await deleteDocDBDatabase(context);
            });
        });
        assert.ifError(await getDatabaseMeta());
    });

    async function getClient(resourceName: string): Promise<CosmosClient> {
        const connectionString: string = await getConnectionString(resourceName);
        const getParsedConnectionString: ParsedDocDBConnectionString = parseDocDBConnectionString(connectionString);
        return getCosmosClient(getParsedConnectionString.documentEndpoint, getParsedConnectionString.masterKey, false);
    }

    async function getDatabases(docDBClient: CosmosClient): Promise<(DatabaseDefinition & Resource)[]> {
        return (await docDBClient.databases.readAll().fetchAll()).resources;
    }

    async function getCollections(docDBClient: CosmosClient, databaseId: string): Promise<(ContainerDefinition & Resource)[]> {
        return (await docDBClient.database(databaseId).containers.readAll().fetchAll()).resources;
    }

    async function getDatabaseMeta(): Promise<(DatabaseDefinition & Resource) | undefined> {
        const getDocDBClient: CosmosClient = await getClient(accountName);
        const databaseMetaList: (DatabaseDefinition & Resource)[] = await getDatabases(getDocDBClient);
        return databaseMetaList.find((database: DatabaseDefinition & Resource) => database.id === databaseName);
    }

    async function getDocDBCollectionMeta(accountId: string, databaseId: string, collectionId: string): Promise<(ContainerDefinition & Resource) | undefined> {
        const getDocDBClient: CosmosClient = await getClient(accountId);
        const collectionMetaList: (ContainerDefinition & Resource)[] = await getCollections(getDocDBClient, databaseId);
        return collectionMetaList.find((collection: ContainerDefinition & Resource) => collection.id === collectionId);
    }
});
