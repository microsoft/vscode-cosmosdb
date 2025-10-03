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
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../extensionVariables';
import { ClusterItemBase } from '../../documentdb/ClusterItemBase';
import { type AttachedClusterModel } from '../../documentdb/ClusterModel';
import { type TreeElementWithStorageId } from '../../TreeElementWithStorageId';

import ConnectionString from 'mongodb-connection-string-url';

export class ClusterItem extends ClusterItemBase implements TreeElementWithStorageId {
    public override readonly cluster: AttachedClusterModel;

    constructor(mongoCluster: AttachedClusterModel) {
        super(mongoCluster);
        this.cluster = mongoCluster; // Store with correct type
    }

    public get storageId(): string {
        return this.cluster.storageId;
    }

    public getConnectionString(): Promise<string | undefined> {
        return Promise.resolve(this.cluster.connectionString);
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.connect',
            async (context: IActionContext) => {
                context.telemetry.properties.view = 'workspace';

                ext.outputChannel.appendLine(
                    l10n.t('MongoDB Clusters: Attempting to authenticate with {cluster}', {
                        cluster: this.cluster.name,
                    }),
                );

                let clustersClient: ClustersClient;

                const connectionString = new ConnectionString(nonNullValue(this.cluster.connectionString));

                let username: string | undefined = connectionString.username;
                let password: string | undefined = connectionString.password;

                if (!username || username.length === 0 || !password || password.length === 0) {
                    const wizardContext: AuthenticateWizardContext = {
                        ...context,
                        adminUserName: undefined,
                        resourceName: this.cluster.name,

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

                ext.outputChannel.append(
                    l10n.t('MongoDB Clusters: Connecting to the cluster as "{username}"…', { username }),
                );

                // Cache the credentials
                CredentialCache.setCredentials(
                    this.id,
                    connectionString.toString(),
                    username,
                    password,
                    this.cluster.emulatorConfiguration, // workspace items can potentially be connecting to an emulator, so we always pass it
                );

                // Attempt to create the client with the provided credentials
                try {
                    clustersClient = await ClustersClient.getClient(this.id).catch((error: Error) => {
                        ext.outputChannel.appendLine(l10n.t('failed.'));
                        ext.outputChannel.appendLine(l10n.t('Error: {error}', { error: error.message }));

                        void vscode.window.showErrorMessage(
                            l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                            {
                                modal: true,
                                detail:
                                    l10n.t('Revisit connection details and try again.') +
                                    '\n\n' +
                                    l10n.t('Error: {error}', { error: error.message }),
                            },
                        );

                        throw error;
                    });
                } catch (error) {
                    console.error(error);
                    // If connection fails, remove cached credentials
                    await ClustersClient.deleteClient(this.id);
                    CredentialCache.deleteCredentials(this.id);

                    // Return null to indicate failure
                    return null;
                }

                ext.outputChannel.appendLine(
                    l10n.t('MongoDB Clusters: Connected to "{cluster}" as "{username}"', {
                        cluster: this.cluster.name,
                        username,
                    }),
                );

                return clustersClient;
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
            title: l10n.t('Authenticate to connect with your MongoDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials
        await callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.connect.promptForCredentials',
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
        let description: string | undefined = undefined;
        let tooltipMessage: string | undefined = undefined;

        if (this.cluster.emulatorConfiguration?.isEmulator) {
            // For emulator clusters, show TLS/SSL status if security is disabled
            if (this.cluster.emulatorConfiguration?.disableEmulatorSecurity) {
                description = l10n.t('⚠ TLS/SSL Disabled');
                tooltipMessage = l10n.t('⚠️ **Security:** TLS/SSL Disabled');
            } else {
                tooltipMessage = l10n.t('✅ **Security:** TLS/SSL Enabled');
            }
        } else {
            // For non-emulator clusters, show SKU if defined
            if (this.cluster.sku !== undefined) {
                description = `(${this.cluster.sku})`;
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.cluster.name,
            description: description,
            iconPath: this.cluster.emulatorConfiguration?.isEmulator
                ? new vscode.ThemeIcon('plug')
                : new vscode.ThemeIcon('server-environment'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            tooltip: new vscode.MarkdownString(tooltipMessage),
        };
    }
}
