/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type IActionContext,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { createDocDBDatabase } from '../docdb/commands/createDocDBDatabase';
import { type DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { ext } from '../extensionVariables';
import { createPostgresDatabase } from '../postgres/commands/createPostgresDatabase';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { createServer } from './createServer/createServer';
import { deleteAzureDatabaseAccount, deletePostgresServer } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { detachAzureDatabaseAccount, detachDatabaseAccountV1 } from './detachDatabaseAccount/detachDatabaseAccount';
import { importDocuments } from './importDocuments';
import { refreshTreeElement } from './refreshTreeElement/refreshTreeElement';

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

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.importDocument',
        async (
            actionContext: IActionContext,
            selectedNode: vscode.Uri | DocDBCollectionTreeItem,
            uris: vscode.Uri[],
        ) => {
            if (selectedNode instanceof vscode.Uri) {
                await importDocuments(actionContext, uris || [selectedNode], undefined);
            } else {
                await importDocuments(actionContext, undefined, selectedNode);
            }
        },
    );

    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.loadMore',
        async (actionContext: IActionContext, node: AzExtTreeItem) =>
            await ext.rgApi.appResourceTree.loadMore(node, actionContext),
    );
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createDatabase', createPostgresDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteServer', deletePostgresServer);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('postgreSQL.detachServer', detachDatabaseAccountV1);

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDatabase', createDocDBDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', async (actionContext: IActionContext) => {
        await ext.attachedAccountsNode.attachNewAccount(actionContext);
        await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
    });
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', attachEmulator);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('azureDatabases.detachDatabaseAccount', detachAzureDatabaseAccount);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
}
