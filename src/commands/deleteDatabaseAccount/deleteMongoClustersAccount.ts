/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deleteMongoClustersAccount(
    context: DeleteWizardContext,
    node: MongoClusterResourceItem,
): Promise<void> {
    const client = createMongoClustersManagementClient(context, node.subscription);
    const resourceGroup = node.mongoCluster.resourceGroup as string;
    const accountName = node.mongoCluster.name;

    const deletePromise = (await client).mongoClusters.beginDeleteAndWait(resourceGroup, accountName);
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
