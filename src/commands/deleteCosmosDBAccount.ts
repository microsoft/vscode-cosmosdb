/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { IAzureNode, DialogResponses } from 'vscode-azureextensionui';
import { azureUtils } from '../utils/azureUtils';
import * as vscodeUtils from '../utils/vscodeUtils';
import { UserCancelledError } from 'vscode-azureextensionui';

export async function deleteCosmosDBAccount(node: IAzureNode): Promise<void> {
    const message: string = `Are you sure you want to delete account '${node.treeItem.label}' and its contents?`;
    const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    if (result === DialogResponses.deleteResponse) {
        const docDBClient = new CosmosDBManagementClient(node.credentials, node.subscriptionId);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.treeItem.id);
        const accountName: string = azureUtils.getAccountNameFromId(node.treeItem.id);
        const output = vscodeUtils.getOutputChannel();
        output.appendLine(`Deleting account "${accountName}"...`);
        output.show();
        await docDBClient.databaseAccounts.deleteMethod(resourceGroup, accountName);
        output.appendLine(`Successfully deleted account "${accountName}"`);
        output.show();
    } else {
        throw new UserCancelledError();
    }
}
