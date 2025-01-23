/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type IActionContext,
    type ITreeItemPickerContext,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { createDocDBDatabase } from '../docdb/commands/createDocDBDatabase';
import { DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { ext } from '../extensionVariables';
import { GraphAccountTreeItem } from '../graph/tree/GraphAccountTreeItem';
import { setConnectedNode } from '../mongo/setConnectedNode';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { createPostgresDatabase } from '../postgres/commands/createPostgresDatabase';
import { TableAccountTreeItem } from '../table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from '../tree/AttachedAccountsTreeItem';
import { localize } from '../utils/localize';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { createServer } from './createServer/createServer';
import { deleteAzureDatabaseAccount, deletePostgresServer } from './deleteDatabaseAccount/deleteDatabaseAccount';

/**
 * DISCLAIMER:
 * It does not any matter to which category the command belongs to as long as it is a command.
 * Today it might be a resource group command, tomorrow it might be a subscription command.
 * Therefore, it is better to categorize the command as a command.
 *
 * However, in this file the commands might be categorized using different functions.
 */

export function registerCommands(): void {
    registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);

    registerAccountCommands();
}

const cosmosDBTopLevelContextValues: string[] = [
    GraphAccountTreeItem.contextValue,
    DocDBAccountTreeItem.contextValue,
    TableAccountTreeItem.contextValue,
    MongoAccountTreeItem.contextValue,
];

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createDatabase', createPostgresDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteServer', deletePostgresServer);

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDatabase', createDocDBDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', async (actionContext: IActionContext) => {
        await ext.attachedAccountsNode.attachNewAccount(actionContext);
        await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
    });
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', attachEmulator);
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.detachDatabaseAccount',
        async (actionContext: IActionContext & ITreeItemPickerContext, node?: AzExtTreeItem) => {
            const children = await ext.attachedAccountsNode.loadAllChildren(actionContext);
            if (children.length < 2) {
                const message = localize('noAttachedAccounts', 'There are no Attached Accounts.');
                void vscode.window.showInformationMessage(message);
            } else {
                if (!node) {
                    node = await ext.rgApi.workspaceResourceTree.showTreeItemPicker<AzExtTreeItem>(
                        cosmosDBTopLevelContextValues.map((val: string) => (val += AttachedAccountSuffix)),
                        actionContext,
                    );
                }
                if (node instanceof MongoAccountTreeItem) {
                    if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                        setConnectedNode(undefined);
                        await node.refresh(actionContext);
                    }
                }
                await ext.attachedAccountsNode.detach(node);
                await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
            }
        },
    );
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
}
