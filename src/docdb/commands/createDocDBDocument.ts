/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ViewColumn } from 'vscode';
import { DocumentTab } from '../../panels/DocumentTab';
import { DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { type DocDBDocumentsTreeItem } from '../tree/DocDBDocumentsTreeItem';
import { createNoSqlQueryConnection } from './connectNoSqlContainer';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function createDocDBDocument(context: IActionContext, node?: DocDBDocumentsTreeItem): Promise<void> {
    let collectionNode: DocDBCollectionTreeItem | undefined;

    if (!node) {
        collectionNode = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    } else {
        collectionNode = node.parent;
    }

    const connection = collectionNode ? createNoSqlQueryConnection(collectionNode) : undefined;

    if (!connection) {
        return;
    }

    DocumentTab.render(connection, 'add', undefined, ViewColumn.Active);
}
