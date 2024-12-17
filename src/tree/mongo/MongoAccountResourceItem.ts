/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import {
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    type IActionContext,
    type TreeElementWithId,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import ConnectionString from 'mongodb-connection-string-url';
import { type Experience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { CredentialCache } from '../../mongoClusters/CredentialCache';
import { MongoClustersClient, type DatabaseItemModel } from '../../mongoClusters/MongoClustersClient';
import { DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { type MongoClusterModel } from '../../mongoClusters/tree/MongoClusterModel';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type MongoAccountModel } from './MongoAccountModel';

/**
 * This implementation relies on information from the CosmosAccountModel, i.e.
 * will only behave as expected when used in the context of an Azure Subscription.
 */
export class MongoAccountResourceItem extends CosmosAccountResourceItemBase {
    protected declare account: MongoAccountModel;

    constructor(
        account: MongoAccountModel,
        protected experience: Experience,
        readonly databaseAccount?: DatabaseAccountGetResults, // TODO: exploring during v1->v2 migration
        readonly isEmulator?: boolean, // TODO: exploring during v1->v2 migration
    ) {
        super(account);
    }

    async discoverConnectionStringFromAccountInfo(): Promise<string | undefined> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongo.discoverConnectionString',
            async (context: IActionContext) => {
                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createCosmosDBManagementClient(
                    context,
                    this.account.subscription as AzureSubscription,
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

    async getChildren(): Promise<TreeElementWithId[]> {
        let mongoClient: MongoClustersClient | null;

        // Check if credentials are cached, and return the cached client if available
        if (CredentialCache.hasCredentials(this.id)) {
            ext.outputChannel.appendLine(
                `${this.experience.longName}: Reusing active connection details for "${this.account.name}".`,
            );
            mongoClient = await MongoClustersClient.getClient(this.id);
        } else {
            ext.outputChannel.appendLine(
                `${this.experience.longName}: Activating connection for "${this.account.name}"`,
            );

            if (this.account.subscription) {
                const cString = await this.discoverConnectionStringFromAccountInfo();
                this.account.connectionString = cString;
            }

            if (!this.account.connectionString) {
                throw new Error('Connection string not found.');
            }

            const cString = new ConnectionString(this.account.connectionString);

            // // Azure MongoDB accounts need to have the name passed in for private endpoints
            // mongoClient = await connectToMongoClient(
            //     this.account.connectionString,
            //     this.databaseAccount ? nonNullProp(this.databaseAccount, 'name') : appendExtensionUserAgent(),
            // );

            //TODO: simplify the api for CrednetialCache to accept full connection strings with credentials
            const username: string | undefined = cString.username;
            const password: string | undefined = cString.password;
            CredentialCache.setCredentials(this.id, cString.toString(), username, password);

            mongoClient = await MongoClustersClient.getClient(this.id).catch(async (error) => {
                console.error(error);
                // If connection fails, remove cached credentials, as they might be invalid
                await MongoClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);
                return null;
            });
        }

        if (!mongoClient) {
            throw new Error('Failed to connect.');
        }

        // TODO: add support for single databases via connection string.
        // move it to monogoclustersclient
        //
        // const databaseInConnectionString = getDatabaseNameFromConnectionString(this.account.connectionString);
        // if (databaseInConnectionString && !this.isEmulator) {
        //     // emulator violates the connection string format
        //     // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
        //     databases = [
        //         {
        //             name: databaseInConnectionString,
        //             empty: false,
        //         },
        //     ];
        // }

        // https://mongodb.github.io/node-mongodb-native/3.1/api/index.html
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const databases = await mongoClient.listDatabases();

        return databases
            .filter(
                (databaseInfo) =>
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

        // } catch (error) {
        //     const message = parseError(error).message;
        //     if (this.isEmulator && message.includes('ECONNREFUSED')) {
        //         // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        //         error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
        //     }
        //     throw error;
        // } finally {
        //     if (mongoClient) {
        //         void mongoClient.close();
        //     }
        // }
    }
}
