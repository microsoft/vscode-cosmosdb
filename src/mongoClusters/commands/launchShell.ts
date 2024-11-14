/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { MongoClustersClient } from '../MongoClustersClient';
import { type CollectionItem } from '../tree/CollectionItem';
import { type DatabaseItem } from '../tree/DatabaseItem';
import { MongoClusterItemBase } from '../tree/MongoClusterItemBase';
import { type MongoClusterResourceItem } from '../tree/MongoClusterResourceItem';
import {
    addAuthenticationDataToConnectionString,
    addDatabasePathToConnectionString,
} from '../utils/connectionStringHelpers';

export async function launchShell(
    _context: IActionContext,
    node?: DatabaseItem | CollectionItem | MongoClusterResourceItem,
): Promise<void> {
    if (!node) {
        throw new Error('No database or collection selected.');
    }

    const client: MongoClustersClient = await MongoClustersClient.getClient(node.mongoCluster.id);

    const connectionString = client.getConnectionString();
    const username = client.getUserName();

    const connectionStringWithUserName = addAuthenticationDataToConnectionString(
        nonNullValue(connectionString),
        nonNullValue(username),
        undefined,
    );

    let shellParameters = '';

    if (node instanceof MongoClusterItemBase) {
        shellParameters = `"${connectionStringWithUserName}"`;
    } /*if (node instanceof DatabaseItem)*/ else {
        const connStringWithDb = addDatabasePathToConnectionString(
            connectionStringWithUserName,
            node.databaseInfo.name,
        );
        shellParameters = `"${connStringWithDb}"`;
    }
    // } else if (node instanceof CollectionItem) { // --> --eval terminates, we'd have to launch with a script etc. let's look into it latter
    //     const connStringWithDb = addDatabasePathToConnectionString(connectionStringWithUserName, node.databaseInfo.name);
    //     shellParameters = `"${connStringWithDb}" --eval 'db.getCollection("${node.collectionInfo.name}")'`
    // }

    const terminal: vscode.Terminal = vscode.window.createTerminal('MongoDB Clusters Shell');

    terminal.sendText('mongosh ' + shellParameters);
    terminal.show();
}
