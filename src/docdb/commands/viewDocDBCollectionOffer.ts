/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export async function viewDocDBCollectionOffer(context: IActionContext, node?: DocDBCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    }
    const client = node.root.getCosmosClient();
    const offer = await node.getContainerClient(client).readOffer();
    await vscodeUtil.showNewFile(JSON.stringify(offer.resource, undefined, 2), `offer of ${node.label}`, '.json');
}
