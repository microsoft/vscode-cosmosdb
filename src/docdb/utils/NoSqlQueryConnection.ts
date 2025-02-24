/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { type DocumentDBItemsResourceItem } from '../../tree/docdb/DocumentDBItemsResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { getCosmosAuthCredential, getCosmosKeyCredential } from '../getCosmosClient';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';

export function createNoSqlQueryConnection(
    node: DocumentDBContainerResourceItem | DocumentDBItemsResourceItem,
): NoSqlQueryConnection {
    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const keyCred = getCosmosKeyCredential(accountInfo.credentials);
    const tenantId = getCosmosAuthCredential(accountInfo.credentials)?.tenantId;

    return {
        databaseId: databaseId,
        containerId: containerId,
        endpoint: accountInfo.endpoint,
        masterKey: keyCred?.key,
        emulatorConfiguration: { isEmulator: accountInfo.isEmulator },
        tenantId: tenantId,
    };
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
