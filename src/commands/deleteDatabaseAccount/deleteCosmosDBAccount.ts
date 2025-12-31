/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { createActivityContextV2 } from '../../utils/activityUtils';
import { createCosmosDBClient } from '../../utils/azureClients';

export async function deleteCosmosDBAccount(context: IActionContext, node: CosmosDBAccountResourceItem): Promise<void> {
    const activityContext = await createActivityContextV2();
    const client = await createCosmosDBClient({ ...context, ...activityContext }, node.account.subscription);
    const resourceGroup = getResourceGroupFromId(node.account.id);
    const accountName = node.account.name;

    const deletePromise = client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);

    if (!activityContext.suppressNotification) {
        const deletingMessage = l10n.t('Deleting account "{accountName}"…', { accountName });
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: deletingMessage },
            async () => {
                await deletePromise;
                const deleteMessage = l10n.t('Successfully deleted account "{accountName}".', { accountName });
                void vscode.window.showInformationMessage(deleteMessage);
                ext.outputChannel.appendLog(deleteMessage);
            },
        );
    } else {
        await deletePromise;
    }
}
