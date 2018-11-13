/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';

export async function reveal(treeItemId: string): Promise<void> {
    let node = await ext.tree.findTreeItem(treeItemId);
    if (!node) {
        throw new Error(`Coudn't find database with cosmos id:${treeItemId}`);
    }
    await ext.treeView.reveal(node);
}
