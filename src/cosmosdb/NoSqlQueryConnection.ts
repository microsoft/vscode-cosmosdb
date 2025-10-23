/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type CosmosDBContainerResourceItem } from '../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../tree/cosmosdb/CosmosDBItemsResourceItem';
import { pickAppResource } from '../utils/pickItem/pickAppResource';
import { type CosmosDBCredential } from './CosmosDBCredential';

export type NoSqlQueryConnection = {
    databaseId: string;
    containerId: string;
    endpoint: string;
    credentials: CosmosDBCredential[];
    isEmulator: boolean;
};

export function isNoSqlQueryConnection(connection: unknown): connection is NoSqlQueryConnection {
    return (
        !!connection &&
        typeof connection === 'object' &&
        'databaseId' in connection &&
        typeof connection.databaseId === 'string' &&
        'containerId' in connection &&
        typeof connection.containerId === 'string' &&
        'endpoint' in connection &&
        typeof connection.endpoint === 'string' &&
        'credentials' in connection &&
        Array.isArray(connection.credentials) &&
        'isEmulator' in connection &&
        typeof connection.isEmulator === 'boolean'
    );
}

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
