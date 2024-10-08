/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { createNoSqlQueryConnection } from './connectNoSqlContainer';

export const openNoSqlQueryEditor = (_context: IActionContext, node?: DocDBCollectionTreeItem) => {
    const connection = node ? createNoSqlQueryConnection(node) : undefined;

    QueryEditorTab.render<QueryEditorTab>(
        {
            c: QueryEditorTab,
            title: 'Query Editor',
            viewType: 'cosmosDbQuery',
        },
        connection,
    );
};
