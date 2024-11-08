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
    type AzureWizardPromptStep,
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
import { SelectUserNameFromListStep } from '../../wizards/authenticate/SelectUserNameFromListStep';
import { MongoClusterItemBase } from '../MongoClusterItemBase';
import { type MongoClusterModel } from '../MongoClusterModel';

export class MongoClusterWorkspaceItem extends MongoClusterItemBase {
    id: string;

    constructor(mongoCluster: MongoClusterModel) {
        super(mongoCluster);
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of MongoClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(context: IActionContext): Promise<MongoClustersClient | null> {
        ext.outputChannel.appendLine(`MongoDB Clusters: Attempting to authenticate with ${this.mongoCluster.name}`);

        let mongoClustersClient: MongoClustersClient;

        /**
         * Now, we should figure out whether it's an Azure environment (vCore) or not.
         * If it is, we should use the Azure SDK to fetch the cluster details.
         * If it's not, we should use the connection string to connect to the cluster directly.
         */

        const clusterConnectionString: string | undefined = 'undefined';
        const clusterAdministratorLogin: string | undefined = undefined;
        const clusterNonAdminUsers: string[] = [];

        const wizardContext: AuthenticateWizardContext = {
            ...context,
            adminUserName: clusterAdministratorLogin,
            otherUserNames: clusterNonAdminUsers,
            resourceName: this.mongoCluster.name,
        };

        // Prompt the user for credentials using the extracted method
        const credentialsProvided = await this.promptForCredentials(wizardContext);

        // If the wizard was aborted or failed, return null
        if (!credentialsProvided) {
            return null;
        }

        ext.outputChannel.append(
            `MongoDB (vCore): Connecting to the cluster as "${wizardContext.selectedUserName}"... `,
        );

        context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

        // Cache the credentials
        CredentialCache.setCredentials(
            this.id,
            nonNullValue(clusterConnectionString),
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

        ext.outputChannel.appendLine(
            `MongoDB (vCore): Connected to "${this.mongoCluster.name}" as "${wizardContext.selectedUserName}"`,
        );

        return mongoClustersClient;
    }

    /**
     * Prompts the user for credentials using a wizard.
     * @param wizardContext The wizard context.
     * @returns True if the wizard completed successfully; false if the user canceled or an error occurred.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        // Determine which prompt steps to include based on conditions
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const promptSteps: AzureWizardPromptStep<AuthenticateWizardContext>[] = [
            // Conditionally include steps without adding nulls
            ...(wizardContext.otherUserNames && wizardContext.otherUserNames.length > 0
                ? [new SelectUserNameFromListStep()]
                : [new ProvideUserNameStep()]),
            // Always include the password step
            new ProvidePasswordStep(),
        ];

        // Additional condition to decide whether to run the wizard at all
        // if (run wizard?) {
        // Initialize the wizard
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: promptSteps,
            title: localize('mongoClustersAuthenticateCluster', 'Authenticate to connect with your MongoDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials
        await callWithTelemetryAndErrorHandling(
            'mongoClusterItem.authenticate.promptForCredentials',
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
        // } else {
        //     // Handle the case where the wizard should not run
        //     wizardContext.aborted = true;
        // }

        // Return true if the wizard completed successfully; false otherwise
        return !wizardContext.aborted;
    }
}
