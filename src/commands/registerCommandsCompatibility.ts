/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommandWithTreeNodeUnwrapping, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { cosmosMongoFilter, doubleClickDebounceDelay, sqlFilter } from '../constants';
import { registerDocDBCommands } from '../docdb/registerDocDBCommands';
import { type DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from '../docdb/tree/DocDBDocumentTreeItem';
import { ext } from '../extensionVariables';
import { MongoDocumentTreeItem } from '../mongo/tree/MongoDocumentTreeItem';
import { importDocuments } from './importDocuments';

export function registerCommandsCompatibility(): void {
    registerDocDBCommands();

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
}
