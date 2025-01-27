/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type CollectionItem } from '../../mongoClusters/tree/CollectionItem';
import { type DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { localize } from '../../utils/localize';
import { MongoScrapbookService } from '../MongoScrapbookService';

export const connectedMongoKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';

// export async function loadPersistedMongoDB(): Promise<void> {
//     return callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', async (context: IActionContext) => {
//         context.errorHandling.suppressDisplay = true;
//         context.telemetry.properties.isActivationEvent = 'true';

//         try {
//             const persistedNodeId: string | undefined = ext.context.globalState.get(connectedMongoKey);
//             if (persistedNodeId && (!ext.connectedMongoDB || ext.connectedMongoDB.fullId !== persistedNodeId)) {
//                 const persistedNode = await ext.rgApi.appResourceTree.findTreeItem(persistedNodeId, context);
//                 if (persistedNode) {
//                     await ext.mongoLanguageClient.client.onReady();
//                     await connectMongoDatabase(context, persistedNode as MongoDatabaseTreeItem);
//                 }
//             }
//         } finally {
//             // Get code lens provider out of initializing state if there's no connected DB
//             if (!ext.connectedMongoDB) {
//                 MongoScrapbookService.clearConnection();
//             }
//         }
//     });
// }

export async function connectMongoDatabase(
    context: IActionContext,
    _node?: DatabaseItem | CollectionItem,
): Promise<void> {
    if (!_node) {
        await vscode.window.showInformationMessage(
            localize(
                'mongo.scrapbook.howtoconnect',
                'You can connect to a different Mongo Cluster by:\n\n' +
                    "1. Locating the one you'd like from the resource view,\n" +
                    '2. Selecting a database or a collection,\n' +
                    '3. Right-clicking and then choosing the "Mongo Scrapbook" submenu,\n' +
                    '4. Selecting the "Connect to this database" command.',
            ),
            { modal: true },
        );
        return;
    }

    MongoScrapbookService.setConnectedCluster(_node.mongoCluster, _node.databaseInfo);
}
