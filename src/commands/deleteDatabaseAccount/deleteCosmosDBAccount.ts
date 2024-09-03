/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import  { type AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { createCosmosDBClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import  { type IDeleteWizardContext } from './IDeleteWizardContext';

export async function deleteCosmosDBAccount(context: IDeleteWizardContext, node: AzExtTreeItem): Promise<void> {
    const client: CosmosDBManagementClient = await createCosmosDBClient([context, node.subscription]);
    const resourceGroup: string = getResourceGroupFromId(node.fullId);
    const accountName: string = getDatabaseAccountNameFromId(node.fullId);
    const deletePromise = client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    if (!context.suppressNotification) {
        const deletingMessage: string = `Deleting account "${accountName}"...`;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: deletingMessage },
            async () => {
                await deletePromise;
                const deleteMessage: string = localize(
                    'deleteAccountMsg',
                    `Successfully deleted account "{0}".`,
                    accountName,
                );
                void vscode.window.showInformationMessage(deleteMessage);
                ext.outputChannel.appendLog(deleteMessage);
            },
        );
    } else {
        await deletePromise;
    }
}
