/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionString } from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { isWindows } from '../../constants';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { MongoRUResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-ru/MongoRUResourceItem';
import { MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Currently it only supports launching the MongoDB shell
 */
export async function launchShell(
    context: IActionContext,
    node?: DatabaseItem | CollectionItem | ClusterItemBase,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No database or collection selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;

    let rawConnectionString: string | undefined;

    // connection string discovery for these items can be slow, so we need to run it with a temporary description

    if (node instanceof ClusterItemBase) {
        // connecting at the account level
        // we need to discover the connection string
        rawConnectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
            return node.getConnectionString();
        });
    } else {
        // node is instanceof DatabaseItem or CollectionItem and we alrady have the connection string somewhere
        const client: ClustersClient = await ClustersClient.getClient(node.cluster.id);
        rawConnectionString = client.getConnectionStringWithPassword();
    }

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }

    const connectionString: ConnectionString = new ConnectionString(rawConnectionString);

    const username = connectionString.username;
    const password = connectionString.password;

    // Check if PowerShell is being used on Windows
    const isWindowsPowerShell =
        isWindows &&
        (vscode.workspace.getConfiguration('terminal.integrated.defaultProfile').get('windows') === 'PowerShell' ||
            vscode.workspace.getConfiguration('terminal.integrated.defaultProfile').get('windows') === 'pwsh');

    // Use correct variable syntax based on shell
    if (isWindows && isWindowsPowerShell) {
        connectionString.username = '$env:USERNAME';
        connectionString.password = '$env:PASSWORD';
    } else if (isWindows) {
        connectionString.username = '%USERNAME%';
        connectionString.password = '%PASSWORD%';
    } else {
        connectionString.username = '$USERNAME';
        connectionString.password = '$PASSWORD';
    }

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

    // Determine if TLS certificate validation should be disabled
    // This only applies to emulator connections with security disabled
    const isRegularCloudAccount = node instanceof MongoVCoreResourceItem || node instanceof MongoRUResourceItem;
    const isEmulatorWithSecurityDisabled =
        !isRegularCloudAccount &&
        node.cluster.emulatorConfiguration &&
        node.cluster.emulatorConfiguration.isEmulator &&
        node.cluster.emulatorConfiguration.disableEmulatorSecurity;

    const tlsConfiguration = isEmulatorWithSecurityDisabled ? '--tlsAllowInvalidCertificates' : '';

    terminal.sendText(`mongosh "${connectionString.toString()}" ${tlsConfiguration}`);
    terminal.show();
}
