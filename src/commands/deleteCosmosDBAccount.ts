/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");
import { IAzureNode } from 'vscode-azureextensionui';
import { DialogBoxResponses } from '../constants';
import { azureUtils } from '../utils/azureUtils';
import * as util from '../utils/vscodeUtils';
import { UserCancelledError } from 'vscode-azureextensionui';

export async function deleteCosmosDBAccount(node: IAzureNode): Promise<void> {
    const message: string = `Are you sure you want to delete account '${node.treeItem.label}' and its contents?`;
    const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
    if (result === DialogBoxResponses.Yes) {
        const docDBClient = new CosmosDBManagementClient(node.credentials, node.subscription.subscriptionId);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(node.treeItem.id);
        const accountName: string = azureUtils.getAccountNameFromId(node.treeItem.id);
        const output = util.getOutputChannel();
        output.appendLine(`Deleting account ${accountName}`);
        output.show();
        await docDBClient.databaseAccounts.deleteMethod(resourceGroup, accountName);
        output.appendLine(`Successfully deleted account ${accountName}`);
        output.show();
    } else {
        throw new UserCancelledError();
    }
}
