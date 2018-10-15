/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import * as vscode from 'vscode';
import { AzureTreeItem, createAzureClient, DialogResponses } from 'vscode-azureextensionui';
import { UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { azureUtils } from '../utils/azureUtils';

export async function deleteCosmosDBAccount(node: AzureTreeItem): Promise<void> {
    const message: string = `Are you sure you want to delete account '${node.label}' and its contents?`;
    const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    if (result === DialogResponses.deleteResponse) {
        const client: CosmosDBManagementClient = createAzureClient(node.root, CosmosDBManagementClient);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.fullId);
        const accountName: string = azureUtils.getAccountNameFromId(node.fullId);
        ext.outputChannel.appendLine(`Deleting account "${accountName}"...`);
        ext.outputChannel.show();
        await client.databaseAccounts.deleteMethod(resourceGroup, accountName);
        ext.outputChannel.appendLine(`Successfully deleted account "${accountName}"`);
        ext.outputChannel.show();
    } else {
        throw new UserCancelledError();
    }
}
