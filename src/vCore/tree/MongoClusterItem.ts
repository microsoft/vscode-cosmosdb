import { type MongoCluster, type Resource } from '@azure/arm-cosmosdb';
import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    createGenericElement,
    nonNullProp,
    nonNullValue,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type TreeItem } from 'vscode';

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createMongoClustersClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { regionToDisplayName } from '../../utils/regionToDisplayName';
import { CredentialsStore } from '../CredentialsStore';
import { addAuthenticationDataToConnectionString } from '../utils/connectionStringHelpers';
import { listMongoClusterNonAdminUsers } from '../utils/listMongoClusterUsers';
import { VCoreClient, type DatabaseItemModel } from '../VCoreClient';
import { type IAuthenticateWizardContext } from '../wizards/authenticate/IAuthenticateWizardContext';
import { ProvidePasswordStep } from '../wizards/authenticate/ProvidePasswordStep';
import { SelectUserNameStep } from '../wizards/authenticate/SelectUserNameStep';
import { DatabaseItem } from './DatabaseItem';

// Selecting only the properties used in the extension, but keeping an easy option to extend the model later and offer full coverage of MongoCluster
// '|' means that you can only access properties that are common to both types.
export type MongoClusterModel = (MongoCluster | ResourceModelInUse) & ResourceModelInUse;

interface ResourceModelInUse extends Resource {
    // from the original MongoCluster type
    id: string;
    name: string;
    location?: string;
    serverVersion?: string;
    systemData?: {
        createdAt?: Date;
    };

    // moved from nodeGroupSpecs[0] to the top level
    // todo: check the spec learn more about the nodeGroupSpecs array
    sku?: string;
    nodeCount?: number;
    diskSize?: number;
    enableHa?: boolean;

    // introduced new properties
    resourceGroup: string;

    // introduced new property to track the live session / database connection
    session?: {
        clientId?: string;
    };
}

// This info will be available at every level in the tree for immediate access
export interface MongoClusterItemBase extends TreeElementBase {
    subscription: AzureSubscription;
    mongoCluster: MongoClusterModel;
}

export class MongoClusterItem implements MongoClusterItemBase {
    id: string;

    constructor(
        public readonly subscription: AzureSubscription,
        readonly mongoCluster: MongoClusterModel,
    ) {
        this.id = mongoCluster.id ?? '';
    }

    /**
     * This function will authenticate and connect to the cluster to list all available databases.
     * (this operation can be slow as it involves some network and authentication calls)
     *
     * Children of MongoClusterItem == databases in the cluster, available after authentication against the cluster
     *
     * @returns a list of databases in the cluster
     */
    async getChildren(): Promise<TreeElementBase[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'mongoClusterItem.getChildren',
            async (context: IActionContext) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;
                context.valuesToMask.push(this.id, this.mongoCluster.name);

                ext.outputChannel.appendLine(`mongoClusters: loading cluster details for ${this.mongoCluster.name}`);

                const client = await createMongoClustersClient(context, this.subscription);
                const cluster = await client.mongoClusters.get(this.mongoCluster.resourceGroup, this.mongoCluster.name);

                context.valuesToMask.push(nonNullValue(cluster.connectionString));

                ext.outputChannel.append(`mongoClusters: listing non-admin users for ${this.mongoCluster.name}... `);

                const clusterNonAdminUsers: string[] = await listMongoClusterNonAdminUsers(client, {
                    clusterAdminUser: nonNullValue(cluster.administratorLogin),
                    subscriptionId: this.subscription.subscriptionId,
                    resourceGroupName: this.mongoCluster.resourceGroup,
                    mongoClusterNamer: this.mongoCluster.name,
                });

                ext.outputChannel.appendLine(`discovered ${clusterNonAdminUsers.length} non-admin user(s).`);

                const wizardContext: IAuthenticateWizardContext = {
                    ...context,
                    adminUserName: nonNullValue(cluster.administratorLogin),
                    otherUserNames: clusterNonAdminUsers,
                    resourceName: this.mongoCluster.name,
                };

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const wizard = new AzureWizard(wizardContext, {
                    promptSteps: [new SelectUserNameStep(), new ProvidePasswordStep()],
                    title: localize('authenticatevCoreCluster', 'Authenticate to your vCore Cluster'),
                });

                await callWithTelemetryAndErrorHandling(
                    'mongoClusterItem.getChildren.passwordPrompt',
                    async (_context: IActionContext) => {
                        await wizard.prompt(); // This will prompt the user for the username and password, results are stored in the wizardContext
                    },
                );

                ext.outputChannel.append(
                    `mongoClusters: connecting to the cluster as '${wizardContext.selectedUserName}'... `,
                );

                const connectionStringWithPassword = addAuthenticationDataToConnectionString(
                    nonNullValue(cluster.connectionString),
                    nonNullProp(wizardContext, 'selectedUserName'),
                    nonNullProp(wizardContext, 'password'),
                );

                context.valuesToMask.push(connectionStringWithPassword);

                // todo: hide the store from the user and move it to vcoreclient
                const clientId = CredentialsStore.setConnectionString(connectionStringWithPassword);
                this.mongoCluster.session = { clientId };

                let vCoreClient: VCoreClient;
                try {
                    vCoreClient = await VCoreClient.getClient(clientId).catch((error: Error) => {
                        ext.outputChannel.appendLine('failed.');
                        ext.outputChannel.appendLine(`Error: ${(error as Error).message}`);

                        void vscode.window.showErrorMessage(`Failed to connect: ${(error as Error).message}`);

                        throw error;
                    });
                } catch (error) {
                    return [
                        createGenericElement({
                            contextValue: 'error',
                            id: `${this.id}/error`,
                            label: (error as Error).message + ' (click to retry)',
                            iconPath: new vscode.ThemeIcon('chrome-close'),
                            commandId: 'azureResourceGroups.refreshTree',
                        }),
                    ];
                }

                ext.outputChannel.appendLine('connected.');

                return vCoreClient.listDatabases().then((databases: DatabaseItemModel[]) => {
                    return databases.map(
                        (database) => new DatabaseItem(this.subscription, this.mongoCluster, database),
                    );
                });
            },
        );

        return result ?? [];
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            label: this.mongoCluster.name,
            description: this.mongoCluster.sku !== undefined ? `(${this.mongoCluster.sku})` : false,
            // iconPath: getThemeAgnosticIconPath('CosmosDBAcscount.svg'),
            tooltip: new vscode.MarkdownString(
                `### Cluster: ${this.mongoCluster.name}\n\n` +
                    `--- \n` +
                    (this.mongoCluster.location
                        ? `- Location: **${regionToDisplayName(this.mongoCluster.location)}**\n\n`
                        : '') +
                    (this.mongoCluster.diskSize ? `- Disk Size: **${this.mongoCluster.diskSize}GB**\n` : '') +
                    (this.mongoCluster.sku ? `- SKU: **${this.mongoCluster.sku}**\n` : '') +
                    (this.mongoCluster.enableHa
                        ? `- High Avaialbility: **${this.mongoCluster.enableHa ? 'Enabled' : 'Disabled'}**\n`
                        : '') +
                    (this.mongoCluster.nodeCount ? `- Node Count: **${this.mongoCluster.nodeCount}**\n\n` : '') +
                    (this.mongoCluster.serverVersion
                        ? `- Server Version: **${this.mongoCluster.serverVersion}**\n`
                        : '') +
                    (this.mongoCluster.systemData?.createdAt
                        ? `--- \n` +
                          `- Created Date: **${this.mongoCluster.systemData?.createdAt?.toLocaleString()}**\n`
                        : ''),
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
