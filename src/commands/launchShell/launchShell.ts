/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { MongoClustersClient } from '../../mongoClusters/MongoClustersClient';
import { type CollectionItem } from '../../mongoClusters/tree/CollectionItem';
import { type DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { MongoClusterWorkspaceItem } from '../../mongoClusters/tree/workspace/MongoClusterWorkspaceItem';
import { MongoAccountResourceItem } from '../../tree/mongo/MongoAccountResourceItem';

import { ConnectionString } from 'mongodb-connection-string-url';
import { isWindows } from '../../constants';

export async function launchShell(
    context: IActionContext,
    node?:
        | DatabaseItem
        | CollectionItem
        | MongoClusterWorkspaceItem
        | MongoClusterResourceItem
        | MongoAccountResourceItem,
): Promise<void> {
    if (!node) {
        throw new Error('No database or collection selected.');
    }

    context.telemetry.properties.experience = node.experience.api;

    let rawConnectionString: string | undefined;
    // connection string discovery for these items can be slow, so we need to run it with a temporary description

    if (
        node instanceof MongoClusterResourceItem ||
        node instanceof MongoAccountResourceItem ||
        node instanceof MongoClusterWorkspaceItem
    ) {
        rawConnectionString = await ext.state.runWithTemporaryDescription(node.id, 'Working...', async () => {
            return node.getConnectionString();
        });
    } else {
        // everything else has the connection string available in memory as we're connected to the server
        const client: MongoClustersClient = await MongoClustersClient.getClient(node.mongoCluster.id);
        rawConnectionString = client.getConnectionStringWithPassword();
    }

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage('Failed to extract the connection string from the selected cluster.');
        return;
    }

    const connectionString: ConnectionString = new ConnectionString(rawConnectionString);

    const username = connectionString.username;
    const password = connectionString.password;

    connectionString.username = isWindows ? '%USERNAME%' : '$USERNAME';
    connectionString.password = isWindows ? '%PASSWORD%' : '$PASSWORD';

    if ('databaseInfo' in node && node.databaseInfo?.name) {
        connectionString.pathname = node.databaseInfo.name;
    }

    // } else if (node instanceof CollectionItem) { // --> --eval terminates, we'd have to launch with a script etc. let's look into it latter
    //     const connStringWithDb = addDatabasePathToConnectionString(connectionStringWithUserName, node.databaseInfo.name);
    //     shellParameters = `"${connStringWithDb}" --eval 'db.getCollection("${node.collectionInfo.name}")'`
    // }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: `MongoDB Shell (${username})`,
        hideFromUser: false,
        env: {
            USERNAME: username,
            PASSWORD: password,
        },
    });

    // If the cluster is an emulator, we need to allow invalid certificates, if the user has disabled security
    const tlsConfiguration =
        'mongoCluster' in node &&
        node?.mongoCluster?.emulatorConfiguration?.isEmulator &&
        node?.mongoCluster.emulatorConfiguration.disableEmulatorSecurity
            ? '--tlsAllowInvalidCertificates'
            : '';

    terminal.sendText(`mongosh "${connectionString.toString()}" ${tlsConfiguration}`);
    terminal.show();
}
