/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CosmosDBManagementModels } from 'azure-arm-cosmosdb';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import * as request from 'request-promise';
import { randomUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { WebResource, ServiceClientCredentials } from "ms-rest";
import { resourceGroupsToDelete, client, testAccount } from './global.resource.test';

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

    test('Create MongoDB Database', async () => {
        const databaseName: string = randomUtils.getRandomHexString(12);
        const collectionName: string = randomUtils.getRandomHexString(12);
        const testInputs: string[] = [testAccount.getSubscriptionContext().subscriptionDisplayName, `${accountName} (MongoDB)`, databaseName, collectionName];
        await testUserInput.runWithInputs(testInputs, async () => {
            await vscode.commands.executeCommand('cosmosDB.createMongoDatabase');
        });
        const response: string = await getMongoDBDatabase(await getUrl(databaseName));
        assert.equal(JSON.parse(response).properties.id, databaseName);
    });

    async function getUrl(Path: string): Promise<string> {
        let baseUrl: string = testAccount.getSubscriptionContext().environment.resourceManagerEndpointUrl;
        return baseUrl + (baseUrl.endsWith('/') ? '' : '/') + `subscriptions/${client.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}/apis/mongodb/databases/${Path}?api-version=2015-04-08`;
    }
});

async function signRequest(req: WebResource, cred: ServiceClientCredentials): Promise<void> {
    await new Promise((resolve: () => void, reject: (err: Error) => void): void => {
        cred.signRequest(req, (err: Error | undefined) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function getMongoDBDatabase(url: string): Promise<string> {
    const requestOptions: WebResource = new WebResource();
    requestOptions.method = 'GET';
    requestOptions.url = url;
    await signRequest(requestOptions, testAccount.getSubscriptionContext().credentials)
    return await <Thenable<string>>request(requestOptions);
}




