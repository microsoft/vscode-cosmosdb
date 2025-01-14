/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import ConnectionString from 'mongodb-connection-string-url';
import { type Experience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { CredentialCache } from '../../mongoClusters/CredentialCache';
import { MongoClustersClient, type DatabaseItemModel } from '../../mongoClusters/MongoClustersClient';
import { DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { type MongoClusterModel } from '../../mongoClusters/tree/MongoClusterModel';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type CosmosDBTreeElement, type ExtTreeElementBase } from '../CosmosDBTreeElement';
import { type MongoAccountModel } from './MongoAccountModel';

/**
 * This implementation relies on information from the MongoAccountModel, i.e.
 * will only behave as expected when used in the context of an Azure Subscription.
 */

// TODO: currently MongoAccountResourceItem does not reuse MongoClusterItemBase, this will be refactored after the v1 to v2 tree migration

export class MongoAccountResourceItem extends CosmosAccountResourceItemBase {
    public declare readonly account: MongoAccountModel;

    constructor(
        account: MongoAccountModel,
        readonly experience: Experience,
        readonly databaseAccount?: DatabaseAccountGetResults, // TODO: exploring during v1->v2 migration
        readonly isEmulator?: boolean, // TODO: exploring during v1->v2 migration
    ) {
        super(account);
    }

    async discoverConnectionString(): Promise<string | undefined> {
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

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        ext.outputChannel.appendLine(`Cosmos DB for MongoDB (RU): Loading details for "${this.account.name}"`);

        let mongoClient: MongoClustersClient | null = null;

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
                const cString = await this.discoverConnectionString();
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

        // TODO: add support for single databases via connection string. move it to monogoclustersclient
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

        const databases = await mongoClient.listDatabases();

        return databases.map((database) => {
            const clusterInfo = this.account as MongoClusterModel;
            clusterInfo.dbExperience = this.experience;

            // eslint-disable-next-line no-unused-vars
            const databaseInfo: DatabaseItemModel = {
                name: database.name,
                empty: database.empty,
            };

            return new DatabaseItem(clusterInfo, databaseInfo) as ExtTreeElementBase;
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

    /**
     * Creates a new database in the cluster.
     *
     * TODO: this is a plain copy&paste from mongoclusters. It will be cleaned up in one shared base class after v1 to v2 tree migration
     *
     * @param _context The action context.
     * @param databaseName The name of the database to create.
     * @returns A boolean indicating success.
     */
    /**
     * Creates a new MongoDB database with the specified name.
     *
     * @param _context - The action context.
     * @param databaseName - The name of the database to create.
     * @returns A promise that resolves to a boolean indicating the success of the operation.
     */
    async createDatabase(_context: IActionContext, databaseName: string): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.id);

        return ext.state.showCreatingChild<boolean>(
            this.id,
            localize('mongoClusters.tree.creating', 'Creating "{0}"...', databaseName),
            async (): Promise<boolean> => {
                // Adding a delay to ensure the "creating child" animation is visible.
                // The `showCreatingChild` function refreshes the parent to show the
                // "creating child" animation and label. Refreshing the parent triggers its
                // `getChildren` method. If the database creation completes too quickly,
                // the dummy node with the animation might be shown alongside the actual
                // database entry, as it will already be available in the database.
                // Note to future maintainers: Do not remove this delay.
                await new Promise((resolve) => setTimeout(resolve, 250));
                return client.createDatabase(databaseName);
            },
        );
    }
}
