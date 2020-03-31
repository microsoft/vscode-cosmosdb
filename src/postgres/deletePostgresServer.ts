/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import * as vscode from 'vscode';
import { AzureTreeItem, createAzureClient, DialogResponses } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { azureUtils } from '../utils/azureUtils';

export async function deletePostgresServer(node: AzureTreeItem): Promise<void> {
    const message: string = `Are you sure you want to delete server '${node.label}' and its contents?`;
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse);
    if (result === DialogResponses.deleteResponse) {
        const client: PostgreSQLManagementClient = createAzureClient(node.root, PostgreSQLManagementClient);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.fullId);
        const serverName: string = azureUtils.getServerNameFromId(node.fullId);
        const deletingMessage: string = `Deleting account "${serverName}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.servers.deleteMethod(resourceGroup, serverName);
        });
        // don't wait
        vscode.window.showInformationMessage(`Successfully deleted server "${serverName}".`);
    }
}
