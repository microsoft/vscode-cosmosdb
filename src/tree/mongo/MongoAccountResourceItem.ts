/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import {
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    parseError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type MongoClient } from 'mongodb';
import ConnectionString from 'mongodb-connection-string-url';
import { Links } from '../../constants';
import { ext } from '../../extensionVariables';
import { getDatabaseNameFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { CredentialCache } from '../../mongoClusters/CredentialCache';
import { MongoClustersClient, type DatabaseItemModel } from '../../mongoClusters/MongoClustersClient';
import { DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { type MongoClusterModel } from '../../mongoClusters/tree/MongoClusterModel';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type CosmosDbTreeElement } from '../CosmosDbTreeElement';
import { DatabaseItem } from './DatabaseItem';
import { type IDatabaseInfo } from './IDatabaseInfo';
import { type MongoAccountModel } from './MongoAccountModel';

export class MongoAccountResourceItem extends CosmosAccountResourceItemBase {
    protected declare account: MongoAccountModel; // Not adding a new property, just changing the type of an existing one

    constructor(
        account: MongoAccountModel,
        protected subscription?: AzureSubscription, // available when the account is a azure-resource one
        readonly databaseAccount?: DatabaseAccountGetResults, // TODO: exploring during v1->v2 migration
        readonly isEmulator?: boolean, // TODO: exploring during v1->v2 migration
    ) {
        super(account);
    }

    async discoverConnectionString(): Promise<string | undefined> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongo.authenticate',
            async (context: IActionContext) => {
                ext.outputChannel.appendLine(
                    `Cosmos DB for MongoDB (RU): Attempting to authenticate with "${this.account.name}"...`,
                );
                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createCosmosDBManagementClient(
                    context,
                    this.subscription as AzureSubscription,
                );
                const connectionStringsInfo = await managementClient.databaseAccounts.listConnectionStrings(
                    this.account.resourceGroup as string,
                    this.account.name,
                );

                const connectionString: URL = new URL(
                    nonNullProp(nonNullProp(connectionStringsInfo, 'connectionStrings')[0], 'connectionString'),
                );
                // for any Mongo connectionString, append this query param because the Cosmos Mongo API v3.6 doesn't support retrywrites
                // but the newer node.js drivers started breaking this
                const searchParam: string = 'retrywrites';
                if (!connectionString.searchParams.has(searchParam)) {
                    connectionString.searchParams.set(searchParam, 'false');
                }

                const cString = connectionString.toString();
                context.valuesToMask.push(cString);

                return cString;
            },
        );

        return result ?? undefined;
    }

    async getChildren(): Promise<CosmosDbTreeElement[]> {
        ext.outputChannel.appendLine(`Cosmos DB for MongoDB (RU): Loading details for "${this.account.name}"`);

        let mongoClient: MongoClient | undefined;
        try {
            let databases: DatabaseItemModel[];

            if (!this.account.connectionString) {
                if (this.subscription) {
                    const cString = await this.discoverConnectionString();
                    if (!cString) {
                        throw new Error('Failed to discover the connection string.');
                    }
                    this.account.connectionString = cString;
                }
                if (!this.account.connectionString) {
                    throw new Error('Missing connection string');
                }
            }

            let mongoClient: MongoClustersClient | null;

            // Check if credentials are cached, and return the cached client if available
            if (CredentialCache.hasCredentials(this.id)) {
                ext.outputChannel.appendLine(`MongoDB (RU): Reusing active connection for "${this.account.name}".`);
                mongoClient = await MongoClustersClient.getClient(this.id);
            } else {
                // Call to the abstract method to authenticate and connect to the cluster
                const cString = new ConnectionString(this.account.connectionString);
                const username: string | undefined = cString.username;
                const password: string | undefined = cString.password;
                CredentialCache.setCredentials(this.id, cString.toString(), username, password);

                try {
                    mongoClient = await MongoClustersClient.getClient(this.id).catch((error: Error) => {
                        ext.outputChannel.appendLine('failed.');
                        ext.outputChannel.appendLine(`Error: ${error.message}`);

                        throw error;
                    });
                } catch (error) {
                    console.error(error);
                    // If connection fails, remove cached credentials
                    await MongoClustersClient.deleteClient(this.id);
                    CredentialCache.deleteCredentials(this.id);

                    // Return null to indicate failure
                    return [];
                }
            }

            // // Azure MongoDB accounts need to have the name passed in for private endpoints
            // mongoClient = await connectToMongoClient(
            //     this.account.connectionString,
            //     this.databaseAccount ? nonNullProp(this.databaseAccount, 'name') : appendExtensionUserAgent(),
            // );

            const databaseInConnectionString = getDatabaseNameFromConnectionString(this.account.connectionString);
            if (databaseInConnectionString && !this.isEmulator) {
                // emulator violates the connection string format
                // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
                databases = [
                    {
                        name: databaseInConnectionString,
                        empty: false,
                    },
                ];
            } else {
                // https://mongodb.github.io/node-mongodb-native/3.1/api/index.html
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                databases = await mongoClient.listDatabases();
            }
            return databases
                .filter(
                    (databaseInfo: IDatabaseInfo) =>
                        !(databaseInfo.name && databaseInfo.name.toLowerCase() === 'admin' && databaseInfo.empty),
                ) // Filter out the 'admin' database if it's empty
                .map((database) => {
                    const clusterInfo = this.account as MongoClusterModel;
                    // eslint-disable-next-line no-unused-vars
                    const databaseInfo: DatabaseItemModel = {
                        name: database.name,
                        empty: database.empty,
                    };

                    return new DatabaseItem(clusterInfo, databaseInfo);
                });
        } catch (error) {
            const message = parseError(error).message;
            if (this.isEmulator && message.includes('ECONNREFUSED')) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
            }
            throw error;
        } finally {
            if (mongoClient) {
                void mongoClient.close();
            }
        }
    }
}
