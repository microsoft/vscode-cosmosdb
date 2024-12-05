/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace/sharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../../tree/workspace/sharedWorkspaceStorage';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { areMongoDBRU } from '../utils/connectionStringHelpers';
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

    // discover whether it's a MongoDB RU connection string and abort here.
    const isRU = areMongoDBRU(connectionString.hosts);

    if (isRU) {
        try {
            await vscode.window.showInformationMessage(
                localize(
                    'mongoClusters.addWorkspaceConnection.addingRU',
                    'The connection string you provided targets an Azure CosmosDB for MongoDB RU cluster.\n' +
                        'It will be added to the "Attached Database Accounts" section.',
                ),
                { modal: true },
            );

            void ext.attachedAccountsNode
                .attachConnectionString(context, connectionStringWithCredentials, API.MongoDB)
                .then((newItem) => {
                    ext.rgApi.workspaceResourceTreeView.reveal(newItem, { select: true, focus: true });
                });
        } catch (error) {
            void vscode.window.showErrorMessage(
                localize(
                    'mongoClusters.addWorkspaceConnection.errorRU',
                    'Failed to add the link to your Azure Cosmos DB for MongoDB RU cluster. \n\n' + error,
                ),
                { modal: true },
            );
        }

        return;
    }

    // Save the connection string
    void (await SharedWorkspaceStorage.push(WorkspaceResourceType.MongoClusters, {
        id: connectionString.username + '@' + connectionString.redact().toString(),
        name: connectionString.username + '@' + connectionString.hosts.join(','),
        secrets: [connectionStringWithCredentials],
    }));

    // refresh the workspace tree view
    ext.mongoClustersWorkspaceBranchDataProvider.refresh();

    showConfirmationAsInSettings(
        localize('showConfirmation.addedWorkspaceConnecdtion', 'New connection has been added to your workspace.'),
    );
}
