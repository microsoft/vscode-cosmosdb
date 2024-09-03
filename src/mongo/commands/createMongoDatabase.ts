/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import  { type MongoAccountTreeItem } from '../tree/MongoAccountTreeItem';
import  { type MongoDatabaseTreeItem } from '../tree/MongoDatabaseTreeItem';
import { pickMongo } from './pickMongo';

export async function createMongoDatabase(context: IActionContext, node?: MongoAccountTreeItem): Promise<void> {
    if (!node) {
        node = await pickMongo<MongoAccountTreeItem>(context);
    }
    const databaseNode = <MongoDatabaseTreeItem>await node.createChild(context);
    await databaseNode.createChild(context);

    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', databaseNode);
}
