/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { Experience, MongoExperience } from "../../AzureDBExperiences";
import { ext } from "../../extensionVariables";
import { setConnectedNode } from "../setConnectedNode";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { pickMongo } from "./pickMongo";

export const connectedMongoKey: string = "ms-azuretools.vscode-cosmosdb.connectedDB";

export async function connectMongoDatabase(context: IActionContext, node?: MongoDatabaseTreeItem) {
    if (!node) {
        // Include defaultExperience in the context to prevent https://github.com/microsoft/vscode-cosmosdb/issues/1517
        const experienceContext: ITreeItemPickerContext & { defaultExperience?: Experience } = { ...context, defaultExperience: MongoExperience };
        node = await pickMongo<MongoDatabaseTreeItem>(experienceContext, MongoDatabaseTreeItem.contextValue);
    }

    const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
    await ext.mongoLanguageClient.connect(node.connectionString, node.databaseName);
    void ext.context.globalState.update(connectedMongoKey, node.fullId);
    setConnectedNode(node);
    await node.refresh(context);

    if (oldNodeId) {
        // We have to use findTreeItem to get the instance of the old node that's being displayed in the ext.rgApi.appResourceTree. Our specific instance might have been out-of-date
        const oldNode: AzExtTreeItem | undefined = await ext.rgApi.appResourceTree.findTreeItem(oldNodeId, context);
        if (oldNode) {
            await oldNode.refresh(context);
        }
    }
}
