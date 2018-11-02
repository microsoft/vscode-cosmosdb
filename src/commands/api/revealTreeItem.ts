/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';

export async function revealTreeItem(treeItemId: string): Promise<boolean> {
    let node = await ext.tree.findTreeItem(treeItemId);
    if (!node) {
        return false;
    }
    await ext.treeView.reveal(node);
    return true;
}
