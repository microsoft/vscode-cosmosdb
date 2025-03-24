/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { type DeleteWizardContext } from './DeleteWizardContext';

// TODO: A new one is needed for RU, but since we've decided not to support account deletions, we can skip it for now
export async function deleteMongoClustersAccount(
    context: DeleteWizardContext,
    node: MongoVCoreResourceItem,
): Promise<void> {
    const client = createMongoClustersManagementClient(context, node.subscription);
    const resourceGroup = node.cluster.resourceGroup as string;
    const accountName = node.cluster.name;

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
