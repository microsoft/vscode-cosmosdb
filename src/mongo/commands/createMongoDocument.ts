/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { MongoCollectionTreeItem } from '../tree/MongoCollectionTreeItem';
import { pickMongo } from './pickMongo';

export async function createMongoDocument(context: IActionContext, node?: MongoCollectionTreeItem) {
    if (!node) {
        node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
    }
    const documentNode = await node.createChild(context);
    await vscode.commands.executeCommand('cosmosDB.openDocument', documentNode);
}
