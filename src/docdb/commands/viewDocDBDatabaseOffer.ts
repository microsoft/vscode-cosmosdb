/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { DocDBDatabaseTreeItem } from '../tree/DocDBDatabaseTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function viewDocDBDatabaseOffer(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBDatabaseTreeItem>(context, DocDBDatabaseTreeItem.contextValue);
    }
    const client = node.root.getCosmosClient();
    const offer = await node.getDatabaseClient(client).readOffer();
    await vscodeUtil.showNewFile(JSON.stringify(offer.resource, undefined, 2), `offer of ${node.label}`, '.json');
}
