/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, CosmosClient, DatabaseDefinition, Resource } from '@azure/cosmos';
import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import * as vscode from 'vscode';
import { randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { getConnectionString } from './getConnectionString';
import { client, resourceGroupsToDelete, testAccount } from './global.resource.test';

suite('Graph action', async function (this: Mocha.Suite): Promise<void> {
    this.timeout(20 * 60 * 1000);
    let resourceGroupName: string;
    let accountName: string;
    let databaseName: string;

    suiteSetup(async function (this: Mocha.Context): Promise<void> {
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

    test('Create graph account', async () => {
        const testInputs: (string | RegExp)[] = [accountName, /graph/, '$(plus) Create new resource group', resourceGroupName, 'West US'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createAccount');
        });
        const getAccount: CosmosDBManagementModels.DatabaseAccount | undefined = await client.databaseAccounts.get(resourceGroupName, accountName);
        assert.ok(getAccount);
    });

    test('Create graph Database', async () => {
        const testInputs: (string | RegExp)[] = [`${accountName} (Gremlin)`, databaseName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createGraphDatabase');
        });
        const connectionString: string = await getConnectionString(accountName);
        const graphClient: CosmosClient = new CosmosClient(connectionString);
        const listDatabases: (DatabaseDefinition & Resource)[] = (await graphClient.databases.readAll().fetchAll()).resources;
        const databaseExists: (DatabaseDefinition & Resource) | undefined = listDatabases.find((database: DatabaseDefinition & Resource) => database.id === databaseName);
        assert.ok(databaseExists);
    });

    test('Create graph', async () => {
        const graphId: string = randomUtils.getRandomHexString(12);
        // partition key name cannot begin with a digit
        const partitionKey: string = `f${randomUtils.getRandomHexString(12)}`;
        const testInputs: (string | RegExp)[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (Gremlin)`, databaseName, graphId, partitionKey, '1000'];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createGraph');
        });
        const connectionString: string = await getConnectionString(accountName);
        const graphClient: CosmosClient = new CosmosClient(connectionString);
        const listGraphIds: (ContainerDefinition & Resource)[] = (await graphClient.database(databaseName).containers.readAll().fetchAll()).resources;
        const graphIdExists: (ContainerDefinition & Resource) | undefined = listGraphIds.find((graph: ContainerDefinition & Resource) => graph.id === graphId);
        assert.ok(graphIdExists);
    });
});
