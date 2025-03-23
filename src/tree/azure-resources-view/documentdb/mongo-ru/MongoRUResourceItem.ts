/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { ext } from '../../../../extensionVariables';
import { createCosmosDBManagementClient } from '../../../../utils/azureClients';
import { ClusterItemBase } from '../../../documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../documentdb/ClusterModel';

export class MongoRUResourceItem extends ClusterItemBase {
    constructor(
        readonly subscription: AzureSubscription,
        mongoCluster: ClusterModel,
    ) {
        super(mongoCluster);
    }

    public async getConnectionString(): Promise<string | undefined> {
        return callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.getConnectionString',
            async (context: IActionContext) => {
                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createCosmosDBManagementClient(
                    context,
                    this.subscription as AzureSubscription,
                );
                const connectionStringsInfo = await managementClient.databaseAccounts.listConnectionStrings(
                    this.mongoCluster.resourceGroup as string,
                    this.mongoCluster.name,
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
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.connect',
            async (context: IActionContext) => {
                ext.outputChannel.appendLine(
                    l10n.t('MongoDB Clusters: Attempting to authenticate with "{cluster}"…', {
                        cluster: this.mongoCluster.name,
                    }),
                );

                if (this.subscription) {
                    this.mongoCluster.connectionString = await this.getConnectionString();
                }

                if (!this.mongoCluster.connectionString) {
                    throw new Error(l10n.t('Connection string not found.'));
                }

                context.valuesToMask.push(this.mongoCluster.connectionString);

                const cString = new ConnectionString(this.mongoCluster.connectionString);

                // // Azure MongoDB accounts need to have the name passed in for private endpoints
                // mongoClient = await connectToMongoClient(
                //     this.account.connectionString,
                //     this.databaseAccount ? nonNullProp(this.databaseAccount, 'name') : appendExtensionUserAgent(),
                // );

                //TODO: simplify the api for CrednetialCache to accept full connection strings with credentials
                const username: string | undefined = cString.username;
                const password: string | undefined = cString.password;
                CredentialCache.setCredentials(this.id, cString.toString(), username, password);

                const mongoClient = await ClustersClient.getClient(this.id).catch(async (error) => {
                    console.error(error);
                    // If connection fails, remove cached credentials, as they might be invalid
                    await ClustersClient.deleteClient(this.id);
                    CredentialCache.deleteCredentials(this.id);
                    return null;
                });

                return mongoClient;
            },
        );

        return result ?? null;
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.mongoCluster.name,
            description: `(${this.experience.shortName})`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
