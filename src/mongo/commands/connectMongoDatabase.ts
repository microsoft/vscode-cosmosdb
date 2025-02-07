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

export async function connectMongoDatabase(
    _context: IActionContext,
    node?: DatabaseItem | CollectionItem,
): Promise<void> {
    if (!node) {
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

    await MongoScrapbookService.setConnectedCluster(node.mongoCluster, node.databaseInfo);
}
