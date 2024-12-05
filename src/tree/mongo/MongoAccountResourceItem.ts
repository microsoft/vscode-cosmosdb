/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import {
    appendExtensionUserAgent,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    parseError,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type MongoClient } from 'mongodb';
import { Links, testDb } from '../../constants';
import { ext } from '../../extensionVariables';
import { connectToMongoClient } from '../../mongo/connectToMongoClient';
import { getDatabaseNameFromConnectionString } from '../../mongo/mongoConnectionStrings';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { DatabaseItem } from './DatabaseItem';
import { type IDatabaseInfo } from './IDatabaseInfo';
import { type MongoAccountModel } from './MongoAccountModel';

export class MongoAccountResourceItem extends CosmosAccountResourceItemBase {
    constructor(
        protected account: MongoAccountModel,
        protected subscription?: AzureSubscription, // optional for the case of a workspace connection
        readonly databaseAccount?: DatabaseAccountGetResults,
        readonly isEmulator?: boolean,
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

    async getChildren(): Promise<TreeElementBase[]> {
        ext.outputChannel.appendLine(`Cosmos DB for MongoDB (RU): Loading details for "${this.cosmosAccount.name}"`);

        let mongoClient: MongoClient | undefined;
        try {
            let databases: IDatabaseInfo[];

            if (!this.account.connectionString) {
                if (this.subscription) {
                    const cString = await this.discoverConnectionString();
                    this.account.connectionString = cString;
                }
                if (!this.account.connectionString) {
                    throw new Error('Missing connection string');
                }
            }

            // Azure MongoDB accounts need to have the name passed in for private endpoints
            mongoClient = await connectToMongoClient(
                this.account.connectionString,
                this.databaseAccount ? nonNullProp(this.databaseAccount, 'name') : appendExtensionUserAgent(),
            );

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
                const result: { databases: IDatabaseInfo[] } = await mongoClient.db(testDb).admin().listDatabases();
                databases = result.databases;
            }
            return databases
                .filter(
                    (database: IDatabaseInfo) =>
                        !(database.name && database.name.toLowerCase() === 'admin' && database.empty),
                ) // Filter out the 'admin' database if it's empty
                .map((database) => new DatabaseItem(this.account, database));
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
