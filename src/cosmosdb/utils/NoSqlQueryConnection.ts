/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../../tree/cosmosdb/CosmosDBItemsResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type NoSqlQueryConnection } from '../NoSqlCodeLensProvider';

export function createNoSqlQueryConnection(
    node: CosmosDBContainerResourceItem | CosmosDBItemsResourceItem,
): NoSqlQueryConnection {
    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;

    return {
        accountId: accountInfo.id,
        databaseId: databaseId,
        containerId: containerId,
        endpoint: accountInfo.endpoint,
        credentials: accountInfo.credentials,
        isEmulator: accountInfo.isEmulator,
    };
}

export async function getNoSqlQueryConnection(): Promise<NoSqlQueryConnection | undefined> {
    return callWithTelemetryAndErrorHandling<NoSqlQueryConnection>('cosmosDB.connectToDatabase', async (context) => {
        const node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
        return createNoSqlQueryConnection(node);
    });
}
