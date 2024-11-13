/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    nonNullValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

import { type CosmosDBManagementClient, type MongoClustersGetResponse } from '@azure/arm-cosmosdb';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { CredentialCache } from '../CredentialCache';
import { MongoClustersClient } from '../MongoClustersClient';
import { listMongoClusterNonAdminUsers } from '../utils/listMongoClusterUsers';
import { type AuthenticateWizardContext } from '../wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../wizards/authenticate/ProvidePasswordStep';
import { SelectUserNameFromListStep } from '../wizards/authenticate/SelectUserNameFromListStep';
import { MongoClusterItemBase } from './MongoClusterItemBase';
import { type MongoClusterModel } from './MongoClusterModel';

export class MongoClusterResourceItem extends MongoClusterItemBase {
    constructor(
        private readonly subscription: AzureSubscription,
        mongoCluster: MongoClusterModel,
    ) {
        super(mongoCluster);
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<MongoClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.authenticate',
            async (context: IActionContext) => {
                ext.outputChannel.appendLine(
                    `MongoDB Clusters: Attempting to authenticate with "${this.mongoCluster.name}"...`,
                );

                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createMongoClustersManagementClient(context, this.subscription);
                const clusterInformation = await managementClient.mongoClusters.get(
                    this.mongoCluster.resourceGroup as string,
                    this.mongoCluster.name,
                );

                const clusterConnectionString = nonNullValue(clusterInformation.connectionString);

                context.valuesToMask.push(clusterConnectionString);

                // Fetch non-admin users using the extracted method
                const clusterNonAdminUsers = await this.fetchNonAdminUsersFromAzure(
                    managementClient,
                    clusterInformation,
                );

                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    adminUserName: clusterInformation.administratorLogin,
                    otherUserNames: clusterNonAdminUsers,
                    resourceName: this.mongoCluster.name,
                };

                // Prompt the user for credentials
                const credentialsProvided = await this.promptForCredentials(wizardContext);

                // If the wizard was aborted or failed, return null
                if (!credentialsProvided) {
                    return null;
                }

                context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

                // Cache the credentials
                CredentialCache.setCredentials(
                    this.id,
                    nonNullValue(clusterConnectionString),
                    nonNullProp(wizardContext, 'selectedUserName'),
                    nonNullProp(wizardContext, 'password'),
                );

                ext.outputChannel.append(
                    `MongoDB Clusters: Connecting to the cluster as "${wizardContext.selectedUserName}"... `,
                );

                // Attempt to create the client with the provided credentials
                let mongoClustersClient: MongoClustersClient;
                try {
                    mongoClustersClient = await MongoClustersClient.getClient(this.id).catch((error: Error) => {
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

                ext.outputChannel.appendLine(
                    `MongoDB Clusters: Connected to "${this.mongoCluster.name}" as "${wizardContext.selectedUserName}".`,
                );

                return mongoClustersClient;
            },
        );

        return result ?? null;
    }

    /**
     * Prompts the user for credentials using a wizard.
     *
     * @param wizardContext The wizard context.
     * @returns True if the wizard completed successfully; false if the user canceled or an error occurred.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [new SelectUserNameFromListStep(), new ProvidePasswordStep()],
            title: localize('mongoClustersAuthenticateCluster', 'Authenticate to connect with your MongoDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials

        try {
            await wizard.prompt(); // This will prompt the user; results are stored in wizardContext
        } catch (error) {
            if (error instanceof UserCancelledError) {
                wizardContext.aborted = true;
            }
        }

        // Return true if the wizard completed successfully; false otherwise
        return !wizardContext.aborted;
    }

    /**
     * Fetches the list of non-admin users for the given cluster.
     * @param client The CosmosDBManagementClient instance.
     * @param cluster The cluster model.
     * @returns A list of non-admin user names.
     */
    private async fetchNonAdminUsersFromAzure(
        client: CosmosDBManagementClient,
        cluster: MongoClustersGetResponse,
    ): Promise<string[]> {
        ext.outputChannel.appendLine(`MongoDB (vCore): Listing non-admin users for ${this.mongoCluster.name}... `);

        // Fetch non-admin users
        const clusterNonAdminUsers: string[] = await listMongoClusterNonAdminUsers(client, {
            clusterAdminUser: nonNullValue(cluster.administratorLogin),
            subscriptionId: this.subscription.subscriptionId,
            resourceGroupName: this.mongoCluster.resourceGroup as string,
            mongoClusterName: this.mongoCluster.name,
        });

        ext.outputChannel.appendLine(`Discovered ${clusterNonAdminUsers.length} non-admin user(s).`);

        return clusterNonAdminUsers;
    }
}
