/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { MongoCollectionTreeItem } from '../tree/MongoCollectionTreeItem';
import { pickMongo } from './pickMongo';

export async function deleteMongoCollection(context: IActionContext, node?: MongoCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}
