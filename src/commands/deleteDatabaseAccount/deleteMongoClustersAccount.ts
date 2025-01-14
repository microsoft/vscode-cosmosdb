/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { createMongoClustersManagementClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { type IDeleteWizardContext } from './IDeleteWizardContext';

export async function deleteMongoClustersAccount(
    context: IDeleteWizardContext,
    node: MongoClusterResourceItem,
): Promise<void> {
    const client = createMongoClustersManagementClient(context, node.subscription);
    const resourceGroup = node.mongoCluster.resourceGroup as string;
    const accountName = node.mongoCluster.name;

    const deletePromise = (await client).mongoClusters.beginDeleteAndWait(resourceGroup, accountName);
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
