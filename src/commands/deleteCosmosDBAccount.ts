/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { AzExtTreeItem, DialogResponses, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { createCosmosDBClient } from '../utils/azureClients';
import { azureUtils } from '../utils/azureUtils';
import { localize } from '../utils/localize';

export async function deleteCosmosDBAccount(context: IActionContext, node: AzExtTreeItem): Promise<void> {
    const message: string = `Are you sure you want to delete account '${node.label}' and its contents?`;
    await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteCosmosBDAccount' }, DialogResponses.deleteResponse);
    const client: CosmosDBManagementClient = await createCosmosDBClient([context, node]);
    const resourceGroup: string = azureUtils.getResourceGroupFromId(node.fullId);
    const accountName: string = azureUtils.getAccountNameFromId(node.fullId);
    const deletingMessage: string = `Deleting account "${accountName}"...`;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
        await client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    });
    const deleteMessage: string = localize("deleteAccountMsg", `Successfully deleted account "{0}".`, accountName);
    void vscode.window.showInformationMessage(deleteMessage);
    ext.outputChannel.appendLog(deleteMessage);
}
