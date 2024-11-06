/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    nonNullProp,
    nonNullValue,
    UserCancelledError,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type TreeItem } from 'vscode';

import { type CosmosDBManagementClient, type MongoClustersGetResponse } from '@azure/arm-cosmosdb';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createMongoClustersClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { regionToDisplayName } from '../../utils/regionToDisplayName';
import { CredentialCache } from '../CredentialCache';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { listMongoClusterNonAdminUsers } from '../utils/listMongoClusterUsers';
import { type AuthenticateWizardContext } from '../wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../wizards/authenticate/ProvidePasswordStep';
import { SelectUserNameStep } from '../wizards/authenticate/SelectUserNameStep';
import { DatabaseItem } from './DatabaseItem';
import { type MongoClusterItemBase } from './MongoClusterItemBase';
import { type MongoClusterModel } from './MongoClusterModel';

export class MongoClusterItem implements MongoClusterItemBase {
    id: string;

    constructor(
        public readonly subscription: AzureSubscription,
        public mongoCluster: MongoClusterModel,
    ) {
        this.id = mongoCluster.id ?? '';
    }

    /**
     * Authenticates and connects to the cluster to list all available databases.
     * Here, the MongoDB client is created and cached for future use.
     *
     * In case of the Azure environment (vCore), we might reach out to Azure to pull
     * the list of users known to the cluster
     *
     * (These operations can be slow as they involve network and authentication calls.)
     *
     * Children of MongoClusterItem are databases in the cluster, available after authentication.
     *
     * @returns A list of databases in the cluster or a single element to create a new database.
     */
    async getChildren(): Promise<TreeElementBase[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'mongoClusterItem.getChildren',
            async (context: IActionContext) => {
                // Error handling setup
                context.errorHandling.suppressDisplay = false;
                context.errorHandling.rethrow = true;
                context.valuesToMask.push(this.id, this.mongoCluster.name);

                ext.outputChannel.appendLine(
                    `MongoDB (vCore): Loading cluster details for "${this.mongoCluster.name}"`,
                );

                // Use the extracted authentication method
                const mongoClustersClient = await this.authenticateAndConnect(context);

                // If authentication failed, return the error element
                if (!mongoClustersClient) {
                    return [
                        createGenericElement({
                            contextValue: 'error',
                            id: `${this.id}/error`,
                            label: 'Failed to authenticate (click to retry)',
                            iconPath: new vscode.ThemeIcon('chrome-close'),
                            commandId: 'azureResourceGroups.refreshTree',
                        }),
                    ];
                }

                // List the databases
                return mongoClustersClient.listDatabases().then((databases: DatabaseItemModel[]) => {
                    if (databases.length === 0) {
                        return [
                            createGenericElement({
                                contextValue: 'mongoClusters.item.no-databases',
                                id: `${this.id}/no-databases`,
                                label: 'Create database...',
                                iconPath: new vscode.ThemeIcon('plus'),
                                commandId: 'mongoClusters.cmd.createDatabase',
                                commandArgs: [this],
                            }),
                        ];
                    }

                    // Map the databases to DatabaseItem elements
                    return databases.map(
                        (database) => new DatabaseItem(this.subscription, this.mongoCluster, database),
                    );
                });
            },
        );

        return result ?? [];
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    private async authenticateAndConnect(context: IActionContext): Promise<MongoClustersClient | null> {
        let mongoClustersClient: MongoClustersClient;

        // Check if credentials are cached
        if (!CredentialCache.hasCredentials(this.id)) {
            ext.outputChannel.appendLine(`MongoDB (vCore): Authenticating with ${this.mongoCluster.name}`);

            // Create a client to interact with the MongoDB clusters
            const client = await createMongoClustersClient(context, this.subscription);
            const cluster = await client.mongoClusters.get(
                this.mongoCluster.resourceGroup,
                this.mongoCluster.name,
            );

            context.valuesToMask.push(nonNullValue(cluster.connectionString));

            // Fetch non-admin users using the extracted method
            const clusterNonAdminUsers: string[] = await this.fetchNonAdminUsers(client, cluster);

            const wizardContext: AuthenticateWizardContext = {
                ...context,
                adminUserName: nonNullValue(cluster.administratorLogin),
                otherUserNames: clusterNonAdminUsers,
                resourceName: this.mongoCluster.name,
            };

            // Initialize the authentication wizard
            const wizard = new AzureWizard(wizardContext, {
                promptSteps: [new SelectUserNameStep(), new ProvidePasswordStep()],
                title: localize(
                    'mongoClustersAuthenticateCluster',
                    'Authenticate to connect with your MongoDB (vCore) cluster',
                ),
                showLoadingPrompt: true,
            });

            // Prompt the user for credentials
            await callWithTelemetryAndErrorHandling(
                'mongoClusterItem.getChildren.passwordPrompt',
                async (_context: IActionContext) => {
                    _context.errorHandling.rethrow = true;
                    _context.errorHandling.suppressDisplay = false;
                    try {
                        await wizard.prompt(); // This will prompt the user; results are stored in wizardContext
                    } catch (error) {
                        if (error instanceof UserCancelledError) {
                            wizardContext.aborted = true;
                        }
                    }
                },
            );

            // If the wizard was aborted, return null
            if (wizardContext.aborted) {
                return null;
            }

            ext.outputChannel.append(
                `MongoDB (vCore): Connecting to the cluster as "${wizardContext.selectedUserName}"... `,
            );

            context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

            // Cache the credentials
            CredentialCache.setCredentials(
                this.id,
                nonNullValue(cluster.connectionString),
                nonNullProp(wizardContext, 'selectedUserName'),
                nonNullProp(wizardContext, 'password'),
            );

            // Attempt to create the client with the provided credentials
            try {
                mongoClustersClient = await MongoClustersClient.getClient(this.id).catch((error: Error) => {
                    ext.outputChannel.appendLine('failed.');
                    ext.outputChannel.appendLine(`Error: ${error.message}`);

                    void vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);

                    throw error;
                });
            } catch (error) {
                console.log(error);
                // If connection fails, remove cached credentials
                await MongoClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);

                // Return null to indicate failure
                return null;
            }

            ext.outputChannel.appendLine('connected.');
        } else {
            ext.outputChannel.appendLine('MongoDB (vCore): Reusing active connection.');
            mongoClustersClient = await MongoClustersClient.getClient(this.id);
        }

        return mongoClustersClient;
    }

    /**
     * Fetches the list of non-admin users for the given cluster.
     * @param client The MongoClustersClient instance.
     * @param cluster The cluster model.
     * @returns A list of non-admin user names.
     */
    private async fetchNonAdminUsers(client: CosmosDBManagementClient, cluster: MongoClustersGetResponse): Promise<string[]> {
        ext.outputChannel.appendLine(
            `MongoDB (vCore): Listing non-admin users for ${this.mongoCluster.name}... `,
        );

        // Fetch non-admin users
        const clusterNonAdminUsers: string[] = await listMongoClusterNonAdminUsers(client, {
            clusterAdminUser: nonNullValue(cluster.administratorLogin),
            subscriptionId: this.subscription.subscriptionId,
            resourceGroupName: this.mongoCluster.resourceGroup,
            mongoClusterName: this.mongoCluster.name,
        });

        ext.outputChannel.appendLine(`Discovered ${clusterNonAdminUsers.length} non-admin user(s).`);

        return clusterNonAdminUsers;
    }

    /**
     * Creates a new database in the cluster.
     * @param _context The action context.
     * @param databaseName The name of the database to create.
     * @returns A boolean indicating success.
     */
    async createDatabase(_context: IActionContext, databaseName: string): Promise<boolean> {
        const client = await MongoClustersClient.getClient(this.mongoCluster.id);

        let success = false;

        await ext.state.showCreatingChild(
            this.id,
            localize('mongoClusters.tree.creating', 'Creating "{0}"...', databaseName),
            async () => {
                success = await client.createDatabase(databaseName);
            },
        );

        return success;
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'mongoClusters.item.mongoCluster',
            label: this.mongoCluster.name,
            description: this.mongoCluster.sku !== undefined ? `(${this.mongoCluster.sku})` : false,
            // iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'), // Uncomment if icon is available
            tooltip: new vscode.MarkdownString(
                `### Cluster: ${this.mongoCluster.name}\n\n` +
                    `---\n` +
                    (this.mongoCluster.location
                        ? `- Location: **${regionToDisplayName(this.mongoCluster.location)}**\n\n`
                        : '') +
                    (this.mongoCluster.diskSize ? `- Disk Size: **${this.mongoCluster.diskSize}GB**\n` : '') +
                    (this.mongoCluster.sku ? `- SKU: **${this.mongoCluster.sku}**\n` : '') +
                    (this.mongoCluster.enableHa !== undefined
                        ? `- High Availability: **${this.mongoCluster.enableHa ? 'Enabled' : 'Disabled'}**\n`
                        : '') +
                    (this.mongoCluster.nodeCount ? `- Node Count: **${this.mongoCluster.nodeCount}**\n\n` : '') +
                    (this.mongoCluster.serverVersion
                        ? `- Server Version: **${this.mongoCluster.serverVersion}**\n`
                        : '') +
                    (this.mongoCluster.systemData?.createdAt
                        ? `---\n- Created Date: **${this.mongoCluster.systemData.createdAt.toLocaleString()}**\n`
                        : ''),
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
