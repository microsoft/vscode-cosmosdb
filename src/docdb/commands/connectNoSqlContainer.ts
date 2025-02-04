/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { KeyValueStore } from '../../KeyValueStore';
import { ext } from '../../extensionVariables';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type NoSqlQueryConnection, noSqlQueryConnectionKey } from '../NoSqlCodeLensProvider';
import { getCosmosKeyCredential } from '../getCosmosClient';

export function createNoSqlQueryConnection(node: DocumentDBContainerResourceItem): NoSqlQueryConnection {
    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const keyCred = getCosmosKeyCredential(accountInfo.credentials);

    return {
        databaseId: databaseId,
        containerId: containerId,
        endpoint: accountInfo.endpoint,
        masterKey: keyCred?.key,
        isEmulator: accountInfo.isEmulator,
    };
}

export function setConnectedNoSqlContainer(node: DocumentDBContainerResourceItem): void {
    const noSqlQueryConnection = createNoSqlQueryConnection(node);
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
}

export async function connectNoSqlContainer(context: IActionContext): Promise<void> {
    const node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
        type: [AzExtResourceType.AzureCosmosDb],
        expectedChildContextValue: ['treeItem.container'],
    });
    setConnectedNoSqlContainer(node);
}

export async function getNoSqlQueryConnection(): Promise<NoSqlQueryConnection | undefined> {
    return callWithTelemetryAndErrorHandling<NoSqlQueryConnection>('cosmosDB.connectToDatabase', async (context) => {
        const node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
        return createNoSqlQueryConnection(node);
    });
}

export async function disconnectNoSqlContainer(): Promise<void> {
    KeyValueStore.instance.set(noSqlQueryConnectionKey, null);
    ext.noSqlCodeLensProvider.updateCodeLens();
}
