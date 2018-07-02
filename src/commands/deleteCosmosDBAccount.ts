/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAzureNode, DialogResponses } from 'vscode-azureextensionui';
import { azureUtils } from '../utils/azureUtils';
import { UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { getCosmosDBManagementClient } from '../docdb/getCosmosDBManagementClient';

export async function deleteCosmosDBAccount(node: IAzureNode): Promise<void> {
    const message: string = `Are you sure you want to delete account '${node.treeItem.label}' and its contents?`;
    const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    if (result === DialogResponses.deleteResponse) {
        const docDBClient = getCosmosDBManagementClient(node.credentials, node.subscriptionId);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.treeItem.id);
        const accountName: string = azureUtils.getAccountNameFromId(node.treeItem.id);
        ext.outputChannel.appendLine(`Deleting account "${accountName}"...`);
        ext.outputChannel.show();
        await docDBClient.databaseAccounts.deleteMethod(resourceGroup, accountName);
        ext.outputChannel.appendLine(`Successfully deleted account "${accountName}"`);
        ext.outputChannel.show();
    } else {
        throw new UserCancelledError();
    }
}
