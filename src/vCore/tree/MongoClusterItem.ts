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
import { TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { getThemeAgnosticIconPath } from '../../constants';

import * as vscode from 'vscode';
import { createMongoClustersClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
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
    id: string;
    name: string;
    resourceGroup: string;
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

                void vscode.window.showInformationMessage(
                    'Loading Cluster Details for ' + this.mongoCluster.name?.toString() + '...',
                );

                const client = await createMongoClustersClient(context, this.subscription);
                const cluster = await client.mongoClusters.get(this.mongoCluster.resourceGroup, this.mongoCluster.name);

                context.valuesToMask.push(nonNullValue(cluster.connectionString));

                void vscode.window.showInformationMessage('Listing users...');

                const clusterNonAdminUsers: string[] = await listMongoClusterNonAdminUsers(client, {
                    clusterAdminUser: nonNullValue(cluster.administratorLogin),
                    subscriptionId: this.subscription.subscriptionId,
                    resourceGroupName: this.mongoCluster.resourceGroup,
                    mongoClusterNamer: this.mongoCluster.name,
                });

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

                void vscode.window.showInformationMessage(
                    `Connecting to the cluster as '${wizardContext.selectedUserName}'...`,
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
                        void vscode.window.showErrorMessage(
                            `Failed to connect to the cluster: ${(error as Error).message}`,
                        );

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
                        })
                    ]
                }

                void vscode.window.showInformationMessage('Listing databases...');

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
            iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'),
            //description: 'description',
            //tooltip: new MarkdownString('**a tooltip** with formatting'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
