/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import * as vscode from 'vscode';
import { AzureTreeItem, createAzureClient, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { azureUtils } from '../utils/azureUtils';

export async function deleteCosmosDBAccount(node: AzureTreeItem): Promise<void> {
    const message: string = `Are you sure you want to delete server '${node.label}' and its contents?`;
    const result = await ext.ui.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    if (result === DialogResponses.deleteResponse) {
        const client: CosmosDBManagementClient = createAzureClient(node.root, CosmosDBManagementClient);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.fullId);
        const accountName: string = azureUtils.getAccountNameFromId(node.fullId);
        const deletingMessage: string = `Deleting server "${accountName}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.databaseAccounts.deleteMethod(resourceGroup, accountName);
        });
        // don't wait
        vscode.window.showInformationMessage(`Successfully deleted server "${accountName}".`);
    } else {
        throw new UserCancelledError();
    }
}
