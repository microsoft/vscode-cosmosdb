/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { MongoCollectionTreeItem } from '../tree/MongoCollectionTreeItem';
import { pickMongo } from './pickMongo';

export async function openMongoCollection(context: IActionContext, node?: MongoCollectionTreeItem): Promise<void> {
    if (!node) {
        node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
    }
    await ext.fileSystem.showTextDocument(node);
}
