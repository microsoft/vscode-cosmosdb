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

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { CredentialCache } from '../../CredentialCache';
import { MongoClustersClient } from '../../MongoClustersClient';
import { type AuthenticateWizardContext } from '../../wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../wizards/authenticate/ProvideUsernameStep';
import { MongoClusterItemBase } from '../MongoClusterItemBase';
import { type MongoClusterModel } from '../MongoClusterModel';

import ConnectionString from 'mongodb-connection-string-url';

export class MongoClusterWorkspaceItem extends MongoClusterItemBase {
    constructor(mongoCluster: MongoClusterModel) {
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
                context.telemetry.properties.view = 'workspace';

                ext.outputChannel.appendLine(
                    `MongoDB Clusters: Attempting to authenticate with ${this.mongoCluster.name}`,
                );

                let mongoClustersClient: MongoClustersClient;

                const connectionString = new ConnectionString(nonNullValue(this.mongoCluster.connectionString));

                let username: string | undefined = connectionString.username;
                let password: string | undefined = connectionString.password;

                if (!username || username.length === 0 || !password || password.length === 0) {
                    const wizardContext: AuthenticateWizardContext = {
                        ...context,
                        adminUserName: undefined,
                        otherUserNames: [],
                        resourceName: this.mongoCluster.name,

                        // preconfigure the username in case it's provided connection string
                        selectedUserName: username,
                        // we'll always ask for the password
                    };

                    // Prompt the user for credentials using the extracted method
                    const credentialsProvided = await this.promptForCredentials(wizardContext);

                    // If the wizard was aborted or failed, return null
                    if (!credentialsProvided) {
                        return null;
                    }

                    context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

                    username = nonNullProp(wizardContext, 'selectedUserName');
                    password = nonNullProp(wizardContext, 'password');
                }

                ext.outputChannel.append(`MongoDB Clusters: Connecting to the cluster as "${username}"... `);

                // Cache the credentials
                CredentialCache.setCredentials(this.id, connectionString.toString(), username, password);

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

                ext.outputChannel.appendLine(
                    `MongoDB Clusters: Connected to "${this.mongoCluster.name}" as "${username}"`,
                );

                return mongoClustersClient;
            },
        );
        return result ?? null;
    }

    /**
     * Prompts the user for credentials using a wizard.
     * @param wizardContext The wizard context.
     * @returns True if the wizard completed successfully; false if the user canceled or an error occurred.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: localize('mongoClustersAuthenticateCluster', 'Authenticate to connect with your MongoDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.authenticate.promptForCredentials',
            async (context: IActionContext) => {
                context.telemetry.properties.view = 'workspace';

                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = false;
                try {
                    await wizard.prompt(); // This will prompt the user; results are stored in wizardContext
                } catch (error) {
                    if (error instanceof UserCancelledError) {
                        wizardContext.aborted = true;
                    }
                }
            },
        );

        // Return true if the wizard completed successfully; false otherwise
        return !wizardContext.aborted;
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: 'mongoClusters.item.mongoCluster',
            label: this.mongoCluster.name,
            description: this.mongoCluster.sku !== undefined ? `(${this.mongoCluster.sku})` : false,
            iconPath: new vscode.ThemeIcon('server-environment'), // Uncomment if icon is available
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
