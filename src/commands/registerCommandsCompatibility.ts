/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    registerCommandWithTreeNodeUnwrapping,
    type AzExtTreeItem,
    type IActionContext,
    type ITreeItemPickerContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { cosmosMongoFilter, doubleClickDebounceDelay, sqlFilter } from '../constants';
import { registerDocDBCommands } from '../docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { type DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from '../docdb/tree/DocDBDocumentTreeItem';
import { ext } from '../extensionVariables';
import { registerGraphCommands } from '../graph/registerGraphCommands';
import { GraphAccountTreeItem } from '../graph/tree/GraphAccountTreeItem';
import { registerMongoCommands } from '../mongo/registerMongoCommands';
import { setConnectedNode } from '../mongo/setConnectedNode';
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { MongoDocumentTreeItem } from '../mongo/tree/MongoDocumentTreeItem';
import { registerPostgresCommands } from '../postgres/commands/registerPostgresCommands';
import { TableAccountTreeItem } from '../table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from '../tree/AttachedAccountsTreeItem';
import { localize } from '../utils/localize';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { cosmosDBCopyConnectionString } from './copyConnectionString/copyConnectionString';
import { createServer } from './createServer/createServer';
import { deleteAccount } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { detachDatabaseAccountV1 } from './detachDatabaseAccount/detachDatabaseAccount';
import { importDocuments } from './importDocuments';

const cosmosDBTopLevelContextValues: string[] = [
    GraphAccountTreeItem.contextValue,
    DocDBAccountTreeItem.contextValue,
    TableAccountTreeItem.contextValue,
    MongoAccountTreeItem.contextValue,
];

export function registerCommandsCompatibility(): void {
    registerDocDBCommands();
    registerGraphCommands();
    registerPostgresCommands();
    registerMongoCommands();

    registerCommandWithTreeNodeUnwrapping('cosmosDB.selectSubscriptions', () =>
        vscode.commands.executeCommand('azure-account.selectSubscriptions'),
    );

    registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', detachDatabaseAccountV1);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', attachEmulator);
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.refresh',
        async (actionContext: IActionContext, node?: AzExtTreeItem) => {
            if (node) {
                await node.refresh(actionContext);
            } else {
                await ext.rgApi.appResourceTree.refresh(actionContext, node);
            }
        },
    );

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
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', cosmosDBCopyConnectionString);
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.openDocument',
        async (actionContext: IActionContext, node?: MongoDocumentTreeItem | DocDBDocumentTreeItem) => {
            if (!node) {
                node = await ext.rgApi.pickAppResource<MongoDocumentTreeItem | DocDBDocumentTreeItem>(actionContext, {
                    filter: [cosmosMongoFilter, sqlFilter],
                    expectedChildContextValue: [MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue],
                });
            }

            // Clear un-uploaded local changes to the document before opening https://github.com/microsoft/vscode-cosmosdb/issues/1619
            ext.fileSystem.fireChangedEvent(node);
            await ext.fileSystem.showTextDocument(node);
        },
        doubleClickDebounceDelay,
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
