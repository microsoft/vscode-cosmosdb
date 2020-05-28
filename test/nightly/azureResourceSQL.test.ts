/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { CollectionMeta, DatabaseMeta, DocumentClient, QueryError } from 'documentdb';
import * as vscode from 'vscode';
import { DialogResponses, getDocumentClient, ParsedDocDBConnectionString, parseDocDBConnectionString, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { client, resourceGroupsToDelete, testAccount } from './global.resource.test';

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
        resourceGroupName = randomUtils.getRandomHexString(12);
        // Cosmos DB account must have lower case name
        accountName = randomUtils.getRandomHexString(12).toLowerCase();
        databaseName = randomUtils.getRandomHexString(12);
        collectionId2 = randomUtils.getRandomHexString(12);
        resourceGroupsToDelete.push(resourceGroupName);
    });

    test('Create SQL account', async () => {
        const testInputs: (string | RegExp)[] = [/SQL/, accountName, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('azureDatabases.createServer');
        });
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create SQL Database', async () => {
        const collectionId1: string = randomUtils.getRandomHexString(12);
        // Partition key cannot begin with a digit
        const partitionKey1: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [`${accountName} (SQL)`, databaseName, collectionId1, partitionKey1, '1000'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBDatabase');
        });
        assert.ok(await getDatabaseMeta());
    });

    test('Create SQL collection', async () => {
        // Partition key cannot begin with a digit
        const partitionKey2: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (SQL)`, databaseName, collectionId2, partitionKey2, '1000'];
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
        const SQLAccount: CosmosDBManagementModels.DatabaseAccount = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(SQLAccount);
        const testInputs: string[] = [`${accountName} (SQL)`, DialogResponses.deleteResponse.title];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.deleteAccount');
        });
        const listAccounts: CosmosDBManagementModels.DatabaseAccountsListResult = await client.databaseAccounts.listByResourceGroup(resourceGroupName);
        const accountExists: CosmosDBManagementModels.DatabaseAccount | undefined = listAccounts.find((account: CosmosDBManagementModels.DatabaseAccount) => account.name === accountName);
        assert.ifError(accountExists);
    });

    async function getClient(resourceName: string): Promise<DocumentClient> {
        const connectionString: string = await getConnectionString(resourceName);
        const getParsedConnectionString: ParsedDocDBConnectionString = parseDocDBConnectionString(connectionString);
        return getDocumentClient(getParsedConnectionString.documentEndpoint, getParsedConnectionString.masterKey, false);
    }

    async function getDatabases(docDBClient: DocumentClient): Promise<DatabaseMeta[]> {
        return new Promise((resolve, reject) => docDBClient.readDatabases().toArray((err: QueryError, res: DatabaseMeta[]) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        }));
    }

    async function getCollections(docDBClient: DocumentClient, databaseId: string): Promise<CollectionMeta[]> {
        return new Promise((resolve, reject) => docDBClient.readCollections(`/dbs/${databaseId}`).toArray((err: QueryError, res: CollectionMeta[]) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        }));
    }

    async function getDatabaseMeta(): Promise<DatabaseMeta | undefined> {
        const getDocDBClient: DocumentClient = await getClient(accountName);
        const databaseMetaList: DatabaseMeta[] = await getDatabases(getDocDBClient);
        return databaseMetaList.find((database: DatabaseMeta) => database.id === databaseName);
    }

    async function getDocDBCollectionMeta(accountId: string, databaseId: string, collectionId: string): Promise<CollectionMeta | undefined> {
        const getDocDBClient: DocumentClient = await getClient(accountId);
        const collectionMetaList: CollectionMeta[] = await getCollections(getDocDBClient, databaseId);
        return collectionMetaList.find((collection: CollectionMeta) => collection.id === collectionId);
    }
});
