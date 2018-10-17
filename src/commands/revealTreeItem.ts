/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';

export async function revealTreeItem(treeItemId: string): Promise<void> {
    const node = await ext.tree.findTreeItem(treeItemId);
    if (!node) {
        throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
    }
    ext.cosmosView.reveal(node);
}
