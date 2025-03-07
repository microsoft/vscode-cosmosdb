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

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { CredentialCache } from '../CredentialCache';
import { MongoClustersClient } from '../MongoClustersClient';
import { type AuthenticateWizardContext } from '../wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../wizards/authenticate/ProvideUsernameStep';
import { MongoClusterItemBase } from './MongoClusterItemBase';
import { type MongoClusterModel } from './MongoClusterModel';

import ConnectionString from 'mongodb-connection-string-url';

export class MongoClusterResourceItem extends MongoClusterItemBase {
    constructor(
        readonly subscription: AzureSubscription,
        mongoCluster: MongoClusterModel,
    ) {
        super(mongoCluster);
    }

    public async getConnectionString(): Promise<string | undefined> {
        return callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.getConnectionString',
            async (context: IActionContext) => {
                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createMongoClustersManagementClient(context, this.subscription);

                const clusterInformation = await managementClient.mongoClusters.get(
                    this.mongoCluster.resourceGroup as string,
                    this.mongoCluster.name,
                );

                if (!clusterInformation.connectionString) {
                    return undefined;
                }

                context.valuesToMask.push(clusterInformation.connectionString);
                const connectionString = new ConnectionString(clusterInformation.connectionString as string);

                if (clusterInformation.administratorLogin) {
                    context.valuesToMask.push(clusterInformation.administratorLogin);
                    connectionString.username = clusterInformation.administratorLogin;
                }

                connectionString.password = '';

                return connectionString.toString();
            },
        );
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<MongoClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.connect',
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
                if (clusterInformation.administratorLogin) {
                    context.valuesToMask.push(clusterInformation.administratorLogin);
                }

                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    adminUserName: clusterInformation.administratorLogin,
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
                    // here, emulatorConfiguration is not set, as it's a resource item from Azure resources, not a workspace item, therefore, no emulator support needed
                );

                ext.outputChannel.append(
                    `MongoDB Clusters: Connecting to the cluster as "${wizardContext.selectedUserName}"... `,
                );

                // Attempt to create the client with the provided credentials
                let mongoClustersClient: MongoClustersClient;
                try {
                    mongoClustersClient = await MongoClustersClient.getClient(this.id).catch((error: Error) => {
                        ext.outputChannel.appendLine(`Error: ${error.message}`);

                        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to connect: {0}', error.message));

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
            promptSteps: [new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: vscode.l10n.t('Authenticate to connect with your MongoDB cluster'),
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
}
