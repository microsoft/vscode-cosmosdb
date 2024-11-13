/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement, type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type TreeItem } from 'vscode';

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { regionToDisplayName } from '../../utils/regionToDisplayName';
import { CredentialCache } from '../CredentialCache';
import { MongoClustersClient, type DatabaseItemModel } from '../MongoClustersClient';
import { DatabaseItem } from './DatabaseItem';
import { type MongoClusterModel } from './MongoClusterModel';

// This info will be available at every level in the tree for immediate access
export abstract class MongoClusterItemBase implements TreeElementBase {
    id: string;

    constructor(
        // public readonly subscription: AzureSubscription,
        public mongoCluster: MongoClusterModel,
    ) {
        this.id = mongoCluster.id ?? '';
    }

    /**
     * Abstract method to authenticate and connect to the MongoDB cluster.
     * Must be implemented by subclasses.
     *
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    protected abstract authenticateAndConnect(): Promise<MongoClustersClient | null>;

    /**
     * Authenticates and connects to the cluster to list all available databases.
     * Here, the MongoDB client is created and cached for future use.
     *
     * In case of the Azure environment (vCore), we might reach out to Azure to pull
     * the list of users known to the cluster.
     *
     * (These operations can be slow as they involve network and authentication calls.)
     *
     * Children of MongoClusterItemBase are databases in the cluster, available after authentication.
     *
     * @returns A list of databases in the cluster or a single element to create a new database.
     */
    async getChildren(): Promise<TreeElementBase[]> {
        ext.outputChannel.appendLine(`MongoDB Clusters: Loading cluster details for "${this.mongoCluster.name}"`);

        let mongoClustersClient: MongoClustersClient | null;

        // Check if credentials are cached, and return the cached client if available
        if (CredentialCache.hasCredentials(this.id)) {
            ext.outputChannel.appendLine(
                `MongoDB Clusters: Reusing active connection for "${this.mongoCluster.name}".`,
            );
            mongoClustersClient = await MongoClustersClient.getClient(this.id);
        } else {
            // Call to the abstract method to authenticate and connect to the cluster
            mongoClustersClient = await this.authenticateAndConnect();
        }

        // If authentication failed, return the error element
        if (!mongoClustersClient) {
            return [
                createGenericElement({
                    contextValue: 'error',
                    id: `${this.id}/error`,
                    label: 'Failed to authenticate (click to retry)',
                    iconPath: new vscode.ThemeIcon('error'),
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
                        commandId: 'command.mongoClusters.createDatabase',
                        commandArgs: [this],
                    }),
                ];
            }

            // Map the databases to DatabaseItem elements
            return databases.map((database) => new DatabaseItem(this.mongoCluster, database));
        });
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
