/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { createCosmosDBClient } from '../../utils/azureClients';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deleteCosmosDBAccount(
    context: DeleteWizardContext,
    node: CosmosDBAccountResourceItemBase,
): Promise<void> {
    // Not all CosmosAccountResourceItemBase instances have a subscription property (attached account does not),
    // so we need to create a subscription context
    if (!('subscription' in node.account)) {
        throw new Error(l10n.t('Subscription is required to delete an account.'));
    }

    const subscriptionContext = createSubscriptionContext(node.account.subscription as AzureSubscription);
    const client = await createCosmosDBClient([context, subscriptionContext]);
    const resourceGroup = getResourceGroupFromId(node.account.id);
    const accountName = node.account.name;

    const deletePromise = client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    if (!context.suppressNotification) {
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
