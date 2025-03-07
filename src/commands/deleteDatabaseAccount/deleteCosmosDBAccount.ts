/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, createSubscriptionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { createCosmosDBClient } from '../../utils/azureClients';
import { getDatabaseAccountNameFromId } from '../../utils/azureUtils';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deleteCosmosDBAccount(
    context: DeleteWizardContext,
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase,
): Promise<void> {
    let client: CosmosDBManagementClient;
    let resourceGroup: string;
    let accountName: string;

    if (node instanceof AzExtTreeItem) {
        client = await createCosmosDBClient([context, node.subscription]);
        resourceGroup = getResourceGroupFromId(node.fullId);
        accountName = getDatabaseAccountNameFromId(node.fullId);
    } else if (node instanceof CosmosDBAccountResourceItemBase) {
        // Not all CosmosAccountResourceItemBase instances have a subscription property (attached account does not),
        // so we need to create a subscription context
        if (!('subscription' in node.account)) {
            throw new Error('Subscription is required to delete an account.');
        }

        const subscriptionContext = createSubscriptionContext(node.account.subscription as AzureSubscription);
        client = await createCosmosDBClient([context, subscriptionContext]);
        resourceGroup = getResourceGroupFromId(node.account.id);
        accountName = node.account.name;
    } else {
        throw new Error('Unexpected node type');
    }

    const deletePromise = client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    if (!context.suppressNotification) {
        const deletingMessage: string = `Deleting account "${accountName}"...`;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: deletingMessage },
            async () => {
                await deletePromise;
                const deleteMessage: string = vscode.l10n.t(`Successfully deleted account "{0}".`, accountName);
                void vscode.window.showInformationMessage(deleteMessage);
                ext.outputChannel.appendLog(deleteMessage);
            },
        );
    } else {
        await deletePromise;
    }
}
