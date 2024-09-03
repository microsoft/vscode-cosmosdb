/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext, type ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { setConnectedNode } from '../setConnectedNode';
import { MongoDatabaseTreeItem } from '../tree/MongoDatabaseTreeItem';
import { connectedMongoKey } from './connectMongoDatabase';
import { pickMongo } from './pickMongo';

export async function deleteMongoDB(context: IActionContext, node?: MongoDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickMongo<MongoDatabaseTreeItem>(context, MongoDatabaseTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
    if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
        setConnectedNode(undefined);
        void ext.context.globalState.update(connectedMongoKey, undefined);
        // Temporary workaround for https://github.com/microsoft/vscode-cosmosdb/issues/1754
        void ext.mongoLanguageClient.disconnect();
    }
    const successMessage = localize('deleteMongoDatabaseMsg', 'Successfully deleted database "{0}"', node.databaseName);
    void vscode.window.showInformationMessage(successMessage);
    ext.outputChannel.info(successMessage);
}
