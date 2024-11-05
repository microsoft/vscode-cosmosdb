/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { KeyValueStore } from '../../KeyValueStore';
import { ext } from '../../extensionVariables';
import { noSqlQueryConnectionKey, type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';
import { getCosmosKeyCredential } from '../getCosmosClient';
import { DocDBCollectionTreeItem } from '../tree/DocDBCollectionTreeItem';
import { pickDocDBAccount } from './pickDocDBAccount';

export function createNoSqlQueryConnection(node: DocDBCollectionTreeItem): NoSqlQueryConnection {
    const root = node.root;
    const keyCred = getCosmosKeyCredential(root.credentials);
    return {
        databaseId: node.parentDatabase.id,
        containerId: node.id,
        endpoint: root.endpoint,
        masterKey: keyCred?.key,
        isEmulator: !!root.isEmulator,
    };
}

export function setConnectedNoSqlContainer(node: DocDBCollectionTreeItem): void {
    const noSqlQueryConnection = createNoSqlQueryConnection(node);
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
}

export async function connectNoSqlContainer(context: IActionContext): Promise<void> {
    const node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    setConnectedNoSqlContainer(node);
}

export async function getNoSqlQueryConnection(): Promise<NoSqlQueryConnection | undefined> {
    return callWithTelemetryAndErrorHandling<NoSqlQueryConnection>('cosmosDB.connectToDatabase', async (context) => {
        const node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
        return createNoSqlQueryConnection(node);
    });
}

export async function disconnectNoSqlContainer(): Promise<void> {
    KeyValueStore.instance.set(noSqlQueryConnectionKey, null);
    ext.noSqlCodeLensProvider.updateCodeLens();
}
