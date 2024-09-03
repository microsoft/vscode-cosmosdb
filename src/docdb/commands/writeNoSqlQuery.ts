/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { setConnectedNoSqlContainer } from './connectNoSqlContainer';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function writeNoSqlQuery(context: IActionContext, node?: DocDBCollectionTreeItem): Promise<void> {
    if (!node) {
        node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    }
    setConnectedNoSqlContainer(node);
    const sampleQuery = `SELECT * FROM ${node.id}`;
    await vscodeUtil.showNewFile(sampleQuery, `query for ${node.label}`, '.nosql');
}
