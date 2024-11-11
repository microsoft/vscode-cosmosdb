/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/sharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace/sharedWorkspaceStorage';
import { localize } from '../../utils/localize';
import { type AddWorkspaceConnectionContext } from '../wizards/addWorkspaceConnection/AddWorkspaceConnectionContext';
import { ConnectionStringStep } from '../wizards/addWorkspaceConnection/ConnectionStringStep';
import { PasswordStep } from '../wizards/addWorkspaceConnection/PasswordStep';
import { UsernameStep } from '../wizards/addWorkspaceConnection/UsernameStep';


export async function addWorkspaceConnection(context: IActionContext): Promise<void> {
    const wizardContext: AddWorkspaceConnectionContext = context;

    const wizard: AzureWizard<AddWorkspaceConnectionContext> = new AzureWizard(wizardContext, {
        title: localize('mongoClusters.addWorkspaceConnection.title', 'Add new MongoDB Clusters connection'),
        promptSteps: [new ConnectionStringStep(), new UsernameStep(), new PasswordStep()],
    });

    // Prompt the user for credentials
    await callWithTelemetryAndErrorHandling(
        'mongoClusters.addWorkspaceConnection.promptForCredentials',
        async (context: IActionContext) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            try {
                await wizard.prompt();
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    // The user cancelled the wizard
                    wizardContext.aborted = true;
                    return;
                } else {
                    throw error;
                }
            }
        },
    );

    if (wizardContext.aborted) {
        return;
    }

    wizardContext.valuesToMask = [wizardContext.connectionString as string, wizardContext.password as string];

    // construct the connection string
    const connectionString = new ConnectionString(wizardContext.connectionString as string);
    connectionString.username = wizardContext.username as string;
    connectionString.password = wizardContext.password as string;

    const connectionStringWithCredentials = connectionString.toString();
    wizardContext.valuesToMask.push(connectionStringWithCredentials);

    // Save the connection string
    void await SharedWorkspaceStorage.push(
        WorkspaceResourceType.MongoClusters,
        {
            id: connectionString.username + '@' + connectionString.redact().toString(),
            name: connectionString.username + '@' + connectionString.hosts.join(','),
            secrets: [connectionStringWithCredentials],
        }
    )

    // refresh the workspace tree view
    ext.mongoClustersWorkspaceBranchDataProvider.refresh();
}
