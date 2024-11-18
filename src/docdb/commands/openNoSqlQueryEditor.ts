/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { DocDBDocumentsTreeItem } from '../tree/DocDBDocumentsTreeItem';
import { createNoSqlQueryConnection } from './connectNoSqlContainer';

export const openNoSqlQueryEditor = (
    _context: IActionContext,
    node?: DocDBCollectionTreeItem | DocDBDocumentsTreeItem,
) => {
    const connection = node
        ? node instanceof DocDBDocumentsTreeItem
            ? createNoSqlQueryConnection(node.parent)
            : createNoSqlQueryConnection(node)
        : undefined;

    QueryEditorTab.render(connection);
};
