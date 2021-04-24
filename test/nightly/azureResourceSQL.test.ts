/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementModels } from '@azure/arm-cosmosdb';
import { ContainerDefinition, CosmosClient, DatabaseDefinition, Resource } from '@azure/cosmos';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { DialogResponses, getCosmosClient, ParsedDocDBConnectionString, parseDocDBConnectionString, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { AccountApi, accountList, client, resourceGroupList, testAccount } from './global.resource.test';

suite('SQL action', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let serverlessAccountName: string;
    let databaseName: string;
    let collectionId2: string;

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = resourceGroupList[AccountApi.Core];
        accountName = accountList[AccountApi.Core];
        serverlessAccountName = accountList[AccountApi.Core];
        databaseName = randomUtils.getRandomHexString(12);
        collectionId2 = randomUtils.getRandomHexString(12);
    });

    test('Create SQL account', async () => {
        const getAccount: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create SQL Database', async () => {
        const collectionId1: string = randomUtils.getRandomHexString(12);
        // Partition key cannot begin with a digit
        const partitionKey1: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [
            testAccount.getSubscriptionContext().subscriptionDisplayName,
            `${accountName} (SQL)`,
            databaseName,
            collectionId1,
            partitionKey1,
            '1000'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBDatabase');
        });
        assert.ok(await getDatabaseMeta());
    });

    test('Create SQL collection', async () => {
        // Partition key cannot begin with a digit
        const partitionKey2: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [
            testAccount.getSubscriptionContext().subscriptionDisplayName,
            `${accountName} (SQL)`,
            databaseName,
            collectionId2,
            partitionKey2,
            '1000'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBCollection');
        });
        assert.ok(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
    });

    // create collection on serverless (w/o throughput)
    test('Create SQL Database', async () => {
        const collectionId1: string = randomUtils.getRandomHexString(12);
        // Partition key cannot begin with a digit
        const partitionKey1: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [
            testAccount.getSubscriptionContext().subscriptionDisplayName,
            `${serverlessAccountName} (SQL)`,
            databaseName,
            collectionId1,
            partitionKey1
        ];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBDatabase');
        });
        assert.ok(await getDatabaseMeta());
    });

    test('Create SQL collection', async () => {
        // Partition key cannot begin with a digit
        const partitionKey2: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [
            testAccount.getSubscriptionContext().subscriptionDisplayName,
            `${serverlessAccountName} (SQL)`,
            databaseName,
            collectionId2,
            partitionKey2
        ];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBCollection');
        });
        assert.ok(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
    });

    test('Delete SQL collection', async () => {
        assert.ok(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, collectionId2, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteDocDBCollection');
        });
        assert.ifError(await getDocDBCollectionMeta(accountName, databaseName, collectionId2));
    });

    test('Delete SQL Database', async () => {
        assert.ok(await getDatabaseMeta());
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteDocDBDatabase');
        });
        assert.ifError(await getDatabaseMeta());
    });

    test('Delete SQL account', async () => {
        const SQLAccount: CosmosDBManagementModels.DatabaseAccountGetResults = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(SQLAccount);
        const testInputs: string[] = [`${accountName} (SQL)`, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteAccount');
        });
        const listAccounts: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupName);
        const accountExists: CosmosDBManagementModels.DatabaseAccountGetResults | undefined = listAccounts.find((account: CosmosDBManagementModels.DatabaseAccountGetResults) => account.name === accountName);
        assert.ifError(accountExists);
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
