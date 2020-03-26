/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { DatabaseMeta, DocumentClient, QueryError } from 'documentdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { DialogResponses, getDocumentClient, ParsedDocDBConnectionString, parseDocDBConnectionString, randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { client, resourceGroupsToDelete } from './global.resource.test';

suite('SQL action', async function (this: ISuiteCallbackContext): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let databaseName: string;

    suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
        this.timeout(2 * 60 * 1000);
        resourceGroupName = randomUtils.getRandomHexString(12);
        // Cosmos DB account must have lower case name
        accountName = randomUtils.getRandomHexString(12).toLowerCase();
        databaseName = randomUtils.getRandomHexString(12);
        resourceGroupsToDelete.push(resourceGroupName);
    });

    test('Create SQL account', async () => {
        const testInputs: (string | RegExp)[] = [accountName, /SQL/, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create SQL Database', async () => {
        const collentionId: string = randomUtils.getRandomHexString(12);
        // Partition key cannot begin with a digit
        const partitionKey: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [`${accountName} (SQL)`, databaseName, collentionId, partitionKey, '1000'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createDocDBDatabase');
        });
        const getDocDBClient: DocumentClient = await getClient(accountName);
        const databaseMetaList: DatabaseMeta[] = await getDatabases(getDocDBClient);
        const getDatabase: DatabaseMeta | undefined = databaseMetaList.find((database: DatabaseMeta) => database.id === databaseName);
        assert.ok(getDatabase);
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
});
